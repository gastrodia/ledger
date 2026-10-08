/* eslint-disable @typescript-eslint/no-require-imports -- isolated browser lifecycle fixtures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, deps = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require(id) { assert.ok(id in deps, id); return deps[id]; },
    AbortController, AbortSignal, DOMException, Error, ArrayBuffer,
    ...globals,
  });
  return exports;
}

const transcript = load('lib/assistant-speech-transcript.ts');
const audio = load('lib/assistant-audio.ts');
const preview = (item_id, text, stash = '') => ({ type: 'conversation.item.input_audio_transcription.text', item_id, text, stash });
const final = (item_id, text) => ({ type: 'conversation.item.input_audio_transcription.completed', item_id, transcript: text });
const committed = (item_id, previous_item_id) => ({ type: 'input_audio_buffer.committed', item_id, previous_item_id });
const flushMicrotasks = async () => { for (let i = 0; i < 15; i += 1) await Promise.resolve(); };

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture({ permission, resumed, sessionResponse } = {}) {
  const events = [];
  const texts = [], phases = [], seconds = [], contexts = [], captures = [], sockets = [];
  const timers = new Map(), documentListeners = new Map();
  let timerId = 0;
  const track = { stopped: 0, onended: null, stop() { this.stopped += 1; events.push('track.stop'); } };
  const media = { getTracks: () => [track] };
  const document = {
    hidden: false,
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener(type, listener) { if (documentListeners.get(type) === listener) documentListeners.delete(type); },
  };
  class AudioContext {
    constructor(options) {
      assert.equal(options.latencyHint, 'interactive');
      this.state = 'running';
      this.closed = 0;
      this.destination = {};
      this.audioWorklet = { addModule: async url => { assert.equal(url, '/audio/pcm-capture.worklet.js'); events.push('worklet.loaded'); } };
      contexts.push(this);
    }
    resume() { events.push('context.resume'); return resumed || Promise.resolve(); }
    close() { this.closed += 1; events.push('context.close'); return Promise.resolve(); }
    createMediaStreamSource(stream) {
      assert.equal(stream, media);
      const source = { disconnected: 0, connect(node) { assert.equal(node, captures.at(-1)); events.push('source.connect'); }, disconnect() { this.disconnected += 1; } };
      this.source = source;
      events.push('source.created');
      return source;
    }
  }
  class AudioWorkletNode {
    constructor(context, name) {
      assert.equal(context, contexts.at(-1));
      assert.equal(name, 'ledger-pcm-capture');
      this.disconnected = 0;
      this.port = {
        onmessage: null, closed: 0, sent: [],
        postMessage(message) { this.sent.push(message); events.push(`worklet.${message.type}`); },
        close() { this.closed += 1; },
      };
      captures.push(this);
    }
    connect(destination) { assert.equal(destination, contexts.at(-1).destination); events.push('capture.connect'); }
    disconnect() { this.disconnected += 1; }
    emit(data) { this.port.onmessage?.({ data }); }
  }
  class WebSocket {
    static OPEN = 1;
    constructor(url) {
      assert.equal(url, 'wss://speech.example.test');
      this.readyState = 0;
      this.bufferedAmount = 0;
      this.sent = [];
      this.closed = 0;
      sockets.push(this);
    }
    send(data) { assert.equal(this.readyState, 1); this.sent.push(data); events.push(typeof data === 'string' ? JSON.parse(data).type : 'pcm'); }
    close() { this.closed += 1; this.readyState = 3; events.push('socket.close'); this.onclose?.(); }
    open() { this.readyState = 1; this.onopen?.(); }
    emit(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
    disconnect() { this.readyState = 3; this.onclose?.(); }
  }
  const speech = load('lib/assistant-speech.ts', {
    '@/lib/assistant-speech-transcript': transcript,
    '@/lib/assistant-audio': audio,
  }, {
    AudioContext, AudioWorkletNode, WebSocket, document,
    navigator: { mediaDevices: { getUserMedia(options) {
      assert.equal(options.audio.channelCount, 1);
      assert.equal(options.audio.echoCancellation, true);
      events.push('permission');
      return permission || Promise.resolve(media);
    } } },
    fetch: async (url, options) => {
      assert.equal(url, '/api/assistant/transcribe/session');
      assert.equal(options.method, 'POST');
      assert.equal(options.cache, 'no-store');
      assert.ok(options.signal instanceof AbortSignal);
      events.push('session.request');
      return sessionResponse || { ok: true, json: async () => ({ url: 'wss://speech.example.test', ticket: 'short-lived-ticket' }) };
    },
    setTimeout(action, ms) { const id = ++timerId; timers.set(id, { action, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const controller = new AbortController();
  const recording = speech.startSpeechRecording({
    signal: controller.signal,
    onText: value => texts.push(value),
    onPhase: value => phases.push(value),
    onSeconds: value => seconds.push(value),
  });
  // Keep every expected rejection observed from the moment recording starts.
  const outcome = recording.done.then(value => ({ value }), error => ({ error }));
  return {
    recording, outcome, controller, events, texts, phases, seconds, contexts, captures, sockets, timers,
    track, media, documentListeners,
    async connect() {
      await flushMicrotasks();
      const socket = sockets.at(-1);
      assert.ok(socket, 'session creates a socket');
      socket.open();
      socket.emit({ type: 'ready' });
      await flushMicrotasks();
      assert.equal(phases.at(-1), 'recording');
      return socket;
    },
    tick(ms) {
      const matches = [...timers].filter(([, timer]) => timer.ms === ms);
      assert.ok(matches.length, `timer ${ms} is active`);
      for (const [id, timer] of matches) { timers.delete(id); timer.action(); }
    },
    hide() { document.hidden = true; documentListeners.get('visibilitychange')?.(); },
    assertReleased() {
      assert.ok(track.stopped >= 1);
      assert.equal(contexts[0].closed, 1);
      for (const capture of captures) {
        assert.equal(capture.disconnected, 1);
        assert.equal(capture.port.closed, 1);
        assert.equal(capture.port.onmessage, null);
      }
      for (const socket of sockets) {
        assert.equal(socket.closed, 1);
        assert.equal(socket.onmessage, null);
      }
      assert.equal(documentListeners.size, 0);
      assert.equal(timers.size, 0);
    },
  };
}

test('capture waits for authenticated ready and starts with the actual audio worklet', async () => {
  const f = fixture();
  assert.deepEqual(f.events.slice(0, 2), ['context.resume', 'permission']);
  assert.deepEqual(f.phases, ['starting']);
  assert.deepEqual(f.seconds, [0]);
  await flushMicrotasks();
  assert.equal(f.captures.length, 0);
  assert.equal(f.contexts[0].source, undefined);
  const socket = f.sockets[0];
  socket.open();
  assert.deepEqual(JSON.parse(socket.sent[0]), { type: 'authenticate', ticket: 'short-lived-ticket' });
  assert.equal(f.captures.length, 0);
  socket.emit({ type: 'ready' });
  await flushMicrotasks();
  assert.equal(f.captures.length, 1);
  assert.deepEqual(f.phases, ['starting', 'recording']);
  const packet = new ArrayBuffer(3200);
  f.captures[0].emit({ type: 'audio', buffer: packet, samples: 19_200 });
  assert.equal(socket.sent.at(-1), packet);
  assert.equal(f.seconds.at(-1), 1);
  f.recording.cancel();
  assert.equal((await f.outcome).error.name, 'AbortError');
  f.assertReleased();
});

test('live sentence snapshots replace previews and finals do not duplicate late updates', async () => {
  const f = fixture();
  const socket = await f.connect();
  socket.emit(committed('first', null));
  socket.emit(preview('first', '早饭', '十二'));
  socket.emit(preview('first', '早饭花了', '十二元'));
  socket.emit(final('first', '早饭花了十二元。'));
  socket.emit(preview('first', '早饭花了', '十二'));
  socket.emit(final('first', '早饭花了十二元。'));
  socket.emit(committed('second', 'first'));
  socket.emit(preview('second', '咖啡', '二十元'));
  socket.emit(final('second', '咖啡二十元。'));
  assert.deepEqual(f.texts, [
    '早饭十二', '早饭花了十二元', '早饭花了十二元。',
    '早饭花了十二元。咖啡二十元', '早饭花了十二元。咖啡二十元。',
  ]);
  f.recording.stop();
  f.captures[0].emit({ type: 'stopped' });
  socket.emit({ type: 'session.finished' });
  assert.equal((await f.outcome).value, '早饭花了十二元。咖啡二十元。');
  f.assertReleased();
});

test('sentence order follows committed predecessors even when finals arrive out of order', () => {
  const state = new transcript.SpeechTranscript();
  state.update(preview('second', '咖啡', '二十'));
  state.update(committed('first', null));
  state.update(preview('first', '早餐', '十二'));
  state.update(committed('second', 'first'));
  state.update(final('second', '咖啡二十元。'));
  assert.equal(state.text, '早餐十二咖啡二十元。');
  assert.equal(state.complete, false);
  state.update(final('first', '早餐十二元。'));
  state.update(committed('second', 'first'));
  assert.equal(state.text, '早餐十二元。咖啡二十元。');
  assert.equal(state.complete, true);
});

test('stop sends final PCM before finish and waits for provider finalization', async () => {
  const f = fixture();
  const socket = await f.connect();
  socket.emit(preview('first', '晚饭', '四十'));
  f.recording.stop();
  assert.equal(f.phases.at(-1), 'finishing');
  assert.equal(f.captures[0].port.sent[0].type, 'stop');
  assert.equal(socket.sent.some(value => typeof value === 'string' && JSON.parse(value).type === 'finish'), false);
  const tail = new ArrayBuffer(186);
  f.captures[0].emit({ type: 'audio', buffer: tail, samples: 1693 });
  f.captures[0].emit({ type: 'stopped' });
  assert.equal(socket.sent.at(-2), tail);
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'finish' });
  let settled = false;
  f.outcome.then(() => { settled = true; });
  socket.emit(final('first', '晚饭四十五元。'));
  await flushMicrotasks();
  assert.equal(settled, false, 'a completed sentence does not close the session');
  assert.equal(f.texts.at(-1), '晚饭四十五元。');
  socket.emit({ type: 'session.finished' });
  assert.equal((await f.outcome).value, '晚饭四十五元。');
  f.assertReleased();
});

test('early socket closure rejects while leaving the latest visible transcript intact', async () => {
  const f = fixture();
  const socket = await f.connect();
  socket.emit(preview('first', '买水果', '三十元'));
  socket.disconnect();
  assert.match((await f.outcome).error.message, /语音连接中断.*文字已保留/);
  assert.deepEqual(f.texts, ['买水果三十元']);
  f.assertReleased();
});

test('cancel during microphone permission closes context and releases late microphone tracks', async () => {
  const permission = deferred();
  const f = fixture({ permission: permission.promise });
  f.recording.cancel();
  assert.equal((await f.outcome).error.name, 'AbortError');
  assert.equal(f.contexts[0].closed, 1);
  assert.equal(f.sockets.length, 0);
  assert.equal(f.track.stopped, 0);
  permission.resolve(f.media);
  await flushMicrotasks();
  assert.equal(f.track.stopped, 1);
  f.assertReleased();
});

test('cancel while AudioContext resume is pending releases already granted microphone tracks', async () => {
  const resumed = deferred();
  const f = fixture({ resumed: resumed.promise });
  await flushMicrotasks();
  assert.equal(f.track.stopped, 0, 'microphone permission has resolved while resume is pending');
  assert.equal(f.sockets.length, 0);
  f.recording.cancel();
  assert.equal((await f.outcome).error.name, 'AbortError');
  f.assertReleased();
  resumed.resolve();
  await flushMicrotasks();
  assert.equal(f.track.stopped, 1, 'late resume cannot reclaim the stopped microphone');
  assert.equal(f.sockets.length, 0);
});

test('AudioContext resume rejection releases already granted microphone tracks', async () => {
  const resumed = deferred();
  const f = fixture({ resumed: resumed.promise });
  await flushMicrotasks();
  assert.equal(f.track.stopped, 0);
  resumed.reject(new Error('Audio context could not resume'));
  assert.match((await f.outcome).error.message, /could not resume/);
  assert.equal(f.sockets.length, 0);
  f.assertReleased();
});

test('cancellation during finalization rejects and ignores queued provider updates', async () => {
  const f = fixture();
  const socket = await f.connect();
  socket.emit(preview('first', '买水果', '三十'));
  f.recording.stop();
  f.captures[0].emit({ type: 'stopped' });
  const queuedMessage = socket.onmessage;
  f.controller.abort(new DOMException('Cancelled by page', 'AbortError'));
  queuedMessage({ data: JSON.stringify(final('first', '买水果三十五元。')) });
  queuedMessage({ data: JSON.stringify({ type: 'session.finished' }) });
  assert.equal((await f.outcome).error.name, 'AbortError');
  assert.deepEqual(f.texts, ['买水果三十']);
  f.assertReleased();
});

test('a completed blank session returns empty text without inventing an input update', async () => {
  const f = fixture();
  const socket = await f.connect();
  f.recording.stop();
  f.captures[0].emit({ type: 'stopped' });
  socket.emit({ type: 'session.finished' });
  assert.equal((await f.outcome).value, '');
  assert.deepEqual(f.texts, []);
  f.assertReleased();
});

test('session.finished with unfinished preview rejects instead of treating provisional text as final', async () => {
  const f = fixture();
  const socket = await f.connect();
  socket.emit(preview('first', '买水果', '三十'));
  f.recording.stop();
  f.captures[0].emit({ type: 'stopped' });
  socket.emit({ type: 'session.finished' });
  assert.match((await f.outcome).error.message, /未完整结束/);
  assert.deepEqual(f.texts, ['买水果三十']);
  f.assertReleased();
});

test('60 second recording deadline flushes capture before finishing normally', async () => {
  const f = fixture();
  const socket = await f.connect();
  f.tick(60_000);
  assert.equal(f.phases.at(-1), 'finishing');
  assert.equal(f.captures[0].port.sent.at(-1).type, 'stop');
  f.captures[0].emit({ type: 'audio', buffer: new ArrayBuffer(3200), samples: 960_000 });
  f.captures[0].emit({ type: 'stopped' });
  assert.equal(f.seconds.at(-1), 60);
  socket.emit({ type: 'session.finished' });
  assert.equal((await f.outcome).value, '');
  f.assertReleased();
});

test('worklet automatic stop does not require another user stop', async () => {
  const f = fixture();
  const socket = await f.connect();
  f.captures[0].emit({ type: 'audio', buffer: new ArrayBuffer(3200), samples: 960_000 });
  f.captures[0].emit({ type: 'stopped' });
  assert.equal(f.phases.at(-1), 'finishing');
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'finish' });
  socket.emit({ type: 'session.finished' });
  assert.equal((await f.outcome).value, '');
  f.assertReleased();
});

test('a missing final response times out with partial text retained and all resources closed', async () => {
  const f = fixture();
  const socket = await f.connect();
  socket.emit(preview('first', '公交', '两元'));
  f.recording.stop();
  f.captures[0].emit({ type: 'stopped' });
  f.tick(15_000);
  assert.match((await f.outcome).error.message, /末尾语音识别超时/);
  assert.deepEqual(f.texts, ['公交两元']);
  f.assertReleased();
});

test('capture flush timeout releases resources without sending finish ahead of missing audio', async () => {
  const f = fixture();
  const socket = await f.connect();
  f.recording.stop();
  f.tick(2_000);
  assert.match((await f.outcome).error.message, /录音已中断/);
  assert.equal(socket.sent.some(value => typeof value === 'string' && JSON.parse(value).type === 'finish'), false);
  f.assertReleased();
});

test('backgrounding the page stops capture, flushes, and removes visibility listener', async () => {
  const f = fixture();
  const socket = await f.connect();
  f.hide();
  assert.equal(f.captures[0].port.sent.at(-1).type, 'stop');
  f.captures[0].emit({ type: 'stopped' });
  socket.emit({ type: 'session.finished' });
  assert.equal((await f.outcome).value, '');
  f.assertReleased();
});

test('socket backpressure stops an unbounded microphone queue with a usable error', async () => {
  const f = fixture();
  const socket = await f.connect();
  socket.emit(preview('first', '车费', '十二元'));
  socket.bufferedAmount = 256_001;
  f.captures[0].emit({ type: 'audio', buffer: new ArrayBuffer(3200), samples: 1600 });
  assert.match((await f.outcome).error.message, /网络过慢/);
  assert.deepEqual(f.texts, ['车费十二元']);
  assert.equal(socket.sent.length, 1, 'only authentication was sent');
  f.assertReleased();
});

test('existing input joins the latest transcript once and respects the input length cap', () => {
  assert.equal(transcript.appendSpeechTranscript('早餐十二元', '咖啡二十元'), '早餐十二元，咖啡二十元');
  assert.equal(transcript.appendSpeechTranscript('早餐十二元，', '咖啡二十元'), '早餐十二元，咖啡二十元');
  assert.equal(transcript.appendSpeechTranscript('早餐十二元\n', '咖啡二十元'), '早餐十二元\n咖啡二十元');
  assert.equal(transcript.appendSpeechTranscript('早餐十二元', ''), '早餐十二元');
  assert.equal(transcript.appendSpeechTranscript('', '咖啡二十元'), '咖啡二十元');
  assert.equal(transcript.appendSpeechTranscript('一'.repeat(3998), '二三四').length, 4000);
  const state = new transcript.SpeechTranscript();
  state.update(preview('first', '一'.repeat(5000)));
  state.update(final('second', '二'.repeat(5000)));
  assert.equal(state.text.length, 4000);
});

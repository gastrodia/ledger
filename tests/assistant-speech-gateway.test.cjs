/* eslint-disable @typescript-eslint/no-require-imports -- local WebSocket integration tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const WebSocket = require('ws');
const { WebSocketServer } = WebSocket;
const SECRET = 'test-speech-gateway-secret-at-least-32-characters';
const ORIGIN = 'http://localhost:3000';
const path = '/api/assistant/transcribe/realtime';

async function ticket(overrides = {}, secret = SECRET) {
  const { SignJWT } = await import('jose');
  const { speechSigningSecret } = await import('../server/speech-auth.mjs');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: 'ledger', aud: 'ledger-speech', sub: 'user-1',
    jti: randomUUID(), iat: now, exp: now + 60, ...overrides })
    .setProtectedHeader({ alg: 'HS256' }).sign(speechSigningSecret(secret));
}

function inbox(socket) {
  const messages = [], waiters = [];
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString()); messages.push(message);
    for (const waiter of [...waiters]) if (message.type === waiter.type) {
      clearTimeout(waiter.timer); waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(message);
    }
  });
  return {
    messages,
    next(type) {
      const existing = messages.find(message => message.type === type);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve, timer: setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 2000) };
        waiters.push(waiter);
      });
    },
  };
}

async function fixture(t, overrides = {}) {
  const { attachSpeechGateway, createSpeechGatewayHandler } = await import('../server/assistant-speech-gateway.mjs');
  const { directHandler = false, ...gatewayOverrides } = overrides;
  const provider = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(provider, 'listening');
  const requests = [], sockets = [];
  let connections = 0;
  provider.on('connection', (socket, request) => {
    connections++; sockets.push(socket);
    assert.equal(request.headers.authorization, 'Bearer test-provider-key');
    socket.on('message', raw => {
      const event = JSON.parse(raw.toString()); requests.push(event);
      if (event.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
      if (event.type === 'input_audio_buffer.append') socket.send(JSON.stringify({
        type: 'conversation.item.input_audio_transcription.text', item_id: 'sentence-1', text: '午饭', stash: '二十',
        secret: 'must-not-leak', error: { message: 'private provider payload' },
      }));
      if (event.type === 'session.finish') setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'sentence-1', transcript: '午饭二十元。' }));
        socket.send(JSON.stringify({ type: 'session.finished' }));
      }, 10);
    });
  });
  const server = http.createServer();
  const options = {
    config: { apiKey: 'test-provider-key', jwtSecret: SECRET, allowedOrigins: [ORIGIN],
      upstreamURL: `ws://127.0.0.1:${provider.address().port}` }, ...gatewayOverrides,
  };
  const lifetimes = [];
  let gateway;
  if (directHandler) {
    // Vercel supplies the same ws socket after its HTTP upgrade; exercise that
    // boundary independently of attachSpeechGateway's local HTTP integration.
    const handler = createSpeechGatewayHandler(options);
    const upgrades = new WebSocketServer({ noServer: true, maxPayload: 16_384, perMessageDeflate: false });
    server.on('upgrade', (request, socket, head) => {
      upgrades.handleUpgrade(request, socket, head, client => lifetimes.push(handler.accept(client)));
    });
    gateway = { async close() { await handler.close(); await new Promise(resolve => upgrades.close(resolve)); } };
  } else {
    gateway = attachSpeechGateway(server, options);
  }
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}${path}`;
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.terminate();
    await gateway.close();
    for (const socket of sockets) socket.terminate();
    await new Promise(resolve => provider.close(resolve));
    await new Promise(resolve => server.close(resolve));
  });
  return {
    url, requests, sockets, lifetimes, close: () => gateway.close(), get connections() { return connections; },
    async connect() {
      const socket = new WebSocket(url, { origin: ORIGIN }); clients.push(socket);
      const box = inbox(socket); await once(socket, 'open');
      return { socket, box };
    },
    async authenticate(token = null) {
      const client = await this.connect();
      client.socket.send(JSON.stringify({ type: 'authenticate', ticket: token || await ticket() }));
      return client;
    },
  };
}

test('gateway derives provider region and workspace without leaking keys into the URL', async () => {
  const { speechGatewayConfig } = await import('../server/assistant-speech-gateway.mjs');
  const env = { DASHSCOPE_API_KEY: 'key', JWT_SECRET: SECRET };
  assert.equal(new URL(speechGatewayConfig(env).upstreamURL).hostname, 'dashscope.aliyuncs.com');
  assert.equal(new URL(speechGatewayConfig({ ...env, DASHSCOPE_WORKSPACE_ID: 'ws-123' }).upstreamURL).hostname, 'ws-123.cn-beijing.maas.aliyuncs.com');
  assert.equal(new URL(speechGatewayConfig({ ...env, DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }).upstreamURL).hostname, 'dashscope-intl.aliyuncs.com');
  for (const bad of ['https://evil.example', 'https://dashscope.aliyuncs.com.evil.example', 'http://dashscope.aliyuncs.com', 'https://x:y@dashscope.aliyuncs.com']) {
    assert.throws(() => speechGatewayConfig({ ...env, DASHSCOPE_BASE_URL: bad }));
  }
  assert.throws(() => speechGatewayConfig({ ...env, DASHSCOPE_REALTIME_URL: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?api_key=bad' }));
  assert.throws(() => speechGatewayConfig({ ...env, SPEECH_ALLOWED_ORIGINS: '*' }));
  assert.equal(speechGatewayConfig({ ...env, JWT_SECRET: '  secret with spaces  ' }).jwtSecret, '  secret with spaces  ');
});

test('rejects a foreign Origin and query credentials before accepting the socket', async t => {
  const f = await fixture(t);
  for (const [url, origin, status] of [[f.url, 'https://evil.example', 403], [f.url + '?ticket=bad', ORIGIN, 404]]) {
    const socket = new WebSocket(url, { origin });
    await new Promise(resolve => {
      socket.on('unexpected-response', (_request, response) => { assert.equal(response.statusCode, status); response.resume(); socket.terminate(); resolve(); });
      socket.on('error', () => {});
    });
  }
  assert.equal(f.connections, 0);
});

test('requires authentication before audio and never opens the provider for forged or stale tickets', async t => {
  const f = await fixture(t);
  const unauthenticated = await f.connect();
  unauthenticated.socket.send(Buffer.alloc(100));
  await unauthenticated.box.next('error');
  for (const token of [await ticket({}, 'wrong-signing-secret-at-least-32-characters'),
    await ticket({ exp: Math.floor(Date.now() / 1000) - 1 }), await ticket({ aud: 'other-app' }),
    await ticket({ exp: Math.floor(Date.now() / 1000) + 600 })]) {
    const client = await f.authenticate(token); await client.box.next('error');
  }
  assert.equal(f.connections, 0);
});

test('streams partial text before finish, preserves tail finalization, and filters provider fields', async t => {
  const f = await fixture(t);
  const { socket, box } = await f.authenticate();
  await box.next('ready');
  assert.equal(f.requests[0].session.sample_rate, 16000);
  socket.send(Buffer.from([0, 0, 12, 0]));
  const preview = await box.next('conversation.item.input_audio_transcription.text');
  assert.deepEqual(preview, { type: 'conversation.item.input_audio_transcription.text', item_id: 'sentence-1', text: '午饭', stash: '二十' });
  assert.equal(f.requests.filter(event => event.type === 'session.finish').length, 0);
  assert.equal(f.requests.find(event => event.type === 'input_audio_buffer.append').audio, 'AAAMAA==');
  const closed = once(socket, 'close');
  socket.send(JSON.stringify({ type: 'finish' }));
  const final = await box.next('conversation.item.input_audio_transcription.completed');
  assert.equal(final.transcript, '午饭二十元。');
  await box.next('session.finished');
  assert.equal((await closed)[0], 1000);
});

test('a consumed ticket cannot reconnect, including after its first socket closed', async t => {
  const f = await fixture(t);
  const token = await ticket();
  const first = await f.authenticate(token); await first.box.next('ready');
  const closed = once(first.socket, 'close'); first.socket.close(); await closed;
  const second = await f.authenticate(token); await second.box.next('error');
  assert.equal(f.connections, 1);
});

test('preserves the explicit first-sentence ordering marker', async t => {
  const f = await fixture(t);
  const client = await f.authenticate(); await client.box.next('ready');
  f.sockets[0].send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: 'sentence-1', previous_item_id: null }));
  const event = await client.box.next('input_audio_buffer.committed');
  assert.equal(event.previous_item_id, null);
});

test('limits active sessions per user and releases the slot after an early disconnect', async t => {
  const f = await fixture(t);
  const first = await f.authenticate(); await first.box.next('ready');
  const second = await f.authenticate(); await second.box.next('ready');
  const third = await f.authenticate(); await third.box.next('error');
  assert.equal(f.connections, 2);
  const providerClosed = once(f.sockets[0], 'close'); first.socket.terminate(); await providerClosed;
  const fourth = await f.authenticate(); await fourth.box.next('ready');
  assert.equal(f.connections, 3);
});

test('closes silent unauthenticated sessions and finalizes the recording time limit', async t => {
  const f = await fixture(t, { timeouts: { auth: 50, record: 50, drain: 50, lifetime: 500 } });
  const silent = await f.connect(); await silent.box.next('error');
  assert.equal(f.connections, 0);
  const recording = await f.authenticate(); await recording.box.next('ready');
  await recording.box.next('session.finished');
  assert.equal(f.requests.filter(event => event.type === 'session.finish').length, 1);
});

test('server recording limit drains the final worklet chunk before upstream finish', async t => {
  const f = await fixture(t, { timeouts: { record: 25, drain: 100 } });
  const client = await f.authenticate(); await client.box.next('ready');
  await client.box.next('finishing');
  client.socket.send(Buffer.from([10, 0, 20, 0]));
  client.socket.send(JSON.stringify({ type: 'finish' }));
  client.socket.send(Buffer.from([30, 0]));
  await client.box.next('session.finished');
  const forwarded = f.requests.filter(event => event.type === 'input_audio_buffer.append' || event.type === 'session.finish');
  assert.deepEqual(forwarded.map(event => event.type), ['input_audio_buffer.append', 'session.finish']);
  assert.equal(forwarded[0].audio, 'CgAUAA==');
  assert.equal(client.box.messages.some(event => event.type === 'error'), false);
});

test('rejects odd, oversized PCM chunks and sanitizes provider failure', async t => {
  const f = await fixture(t);
  for (const bytes of [1, 12_802]) {
    const client = await f.authenticate(await ticket({ sub: randomUUID() }));
    await client.box.next('ready'); client.socket.send(Buffer.alloc(bytes)); await client.box.next('error');
  }
  const client = await f.authenticate(); await client.box.next('ready');
  f.sockets.at(-1).send(JSON.stringify({ type: 'error', error: { message: 'SECRET-PROVIDER-PAYLOAD' } }));
  const error = await client.box.next('error');
  assert.equal(JSON.stringify(error).includes('SECRET'), false);
  assert.equal(f.requests.filter(event => event.type === 'input_audio_buffer.append').length, 0);
});


test('externally upgraded sockets stream through the shared handler until tail finalization closes them', async t => {
  const f = await fixture(t, { directHandler: true });
  const { socket, box } = await f.authenticate();
  await box.next('ready');
  let complete = false;
  f.lifetimes[0].then(() => { complete = true; });
  socket.send(Buffer.from([0, 0, 12, 0]));
  await box.next('conversation.item.input_audio_transcription.text');
  assert.equal(complete, false);
  socket.send(JSON.stringify({ type: 'finish' }));
  const final = await box.next('conversation.item.input_audio_transcription.completed');
  assert.equal(final.transcript, '午饭二十元。');
  await f.lifetimes[0];
  assert.equal(complete, true);
  assert.equal(f.requests.find(event => event.type === 'input_audio_buffer.append').audio, 'AAAMAA==');
});

test('externally upgraded sockets share replay and user limits and release resources on shutdown', async t => {
  const f = await fixture(t, { directHandler: true });
  const token = await ticket();
  const first = await f.authenticate(token); await first.box.next('ready');
  const replay = await f.authenticate(token); await replay.box.next('error');
  const second = await f.authenticate(); await second.box.next('ready');
  const third = await f.authenticate(); await third.box.next('error');
  assert.equal(f.connections, 2);
  first.socket.send(JSON.stringify({ type: 'cancel' }));
  await f.lifetimes[0];
  const fourth = await f.authenticate(); await fourth.box.next('ready');
  assert.equal(f.connections, 3);
  const providerCloses = f.sockets.filter(socket => socket.readyState !== WebSocket.CLOSED).map(socket => once(socket, 'close'));
  await f.close();
  await Promise.all(f.lifetimes);
  await Promise.all(providerCloses);
  assert.ok(f.sockets.every(socket => socket.readyState === WebSocket.CLOSED));
});

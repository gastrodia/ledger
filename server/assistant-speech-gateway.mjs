import { jwtVerify } from 'jose';
import WebSocket, { WebSocketServer } from 'ws';
import { speechSigningSecret } from './speech-auth.mjs';

const PATH = '/api/assistant/transcribe/realtime';
const MAX_FRAME_BYTES = 12_800;
const MAX_AUDIO_BYTES = 1_920_000;
const MAX_BUFFER_BYTES = 1_048_576;
const MAX_REPLAY_ENTRIES = 10_000;
const MAX_CONNECTIONS = 1000;
const safeFailure = '实时语音连接中断，已识别的文字已保留，请重试。';

export function speechGatewayConfig(env = process.env) {
  const apiKey = env.DASHSCOPE_API_KEY?.trim();
  const jwtSecret = env.JWT_SECRET;
  if (!apiKey || !jwtSecret?.trim()) throw new Error('语音网关需要 DASHSCOPE_API_KEY 和 JWT_SECRET。');
  const workspace = env.DASHSCOPE_WORKSPACE_ID?.trim();
  let base;
  try {
    base = new URL(env.DASHSCOPE_BASE_URL?.trim() || (workspace
      ? `https://${workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
      : 'https://dashscope.aliyuncs.com/compatible-mode/v1'));
  } catch { throw new Error('语音服务地址配置无效。'); }
  if (base.protocol !== 'https:' || !base.hostname.endsWith('.aliyuncs.com') || base.username || base.password || base.search || base.hash) {
    throw new Error('语音服务地址配置无效。');
  }
  let upstreamURL;
  try {
    upstreamURL = env.DASHSCOPE_REALTIME_URL?.trim()
      ? new URL(env.DASHSCOPE_REALTIME_URL.trim())
      : new URL('/api-ws/v1/realtime', base);
    if (!env.DASHSCOPE_REALTIME_URL?.trim()) upstreamURL.protocol = 'wss:';
  } catch { throw new Error('实时语音服务地址配置无效。'); }
  if (upstreamURL.protocol !== 'wss:' || !upstreamURL.hostname.endsWith('.aliyuncs.com')
    || upstreamURL.pathname !== '/api-ws/v1/realtime' || upstreamURL.username || upstreamURL.password
    || upstreamURL.search || upstreamURL.hash) throw new Error('实时语音服务地址配置无效。');
  const model = env.BAILIAN_REALTIME_ASR_MODEL?.trim() || 'qwen3-asr-flash-realtime';
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error('实时语音模型配置无效。');
  upstreamURL.searchParams.set('model', model);
  const allowedOrigins = (env.SPEECH_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',').map(value => value.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('语音网页来源配置无效。'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('语音网页来源配置无效。');
  }
  if (!allowedOrigins.length) throw new Error('语音网页来源配置无效。');
  return { apiKey, jwtSecret, upstreamURL: upstreamURL.toString(), allowedOrigins };
}

async function verifySpeechTicket(ticket, secret) {
  const { payload } = await jwtVerify(ticket, speechSigningSecret(secret), {
    algorithms: ['HS256'], issuer: 'ledger', audience: 'ledger-speech', requiredClaims: ['sub', 'jti', 'iat', 'exp'],
  });
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 256
    || typeof payload.jti !== 'string' || !payload.jti || payload.jti.length > 128
    || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)
    || payload.iat > now + 5 || payload.exp <= payload.iat || payload.exp - payload.iat > 60) {
    throw new Error('invalid_ticket');
  }
  return payload;
}

// Only the documented transcript fields cross the gateway. Provider errors,
// usage, session settings and credentials never reach the browser.
function publicEvent(event) {
  const allowed = new Set([
    'conversation.item.input_audio_transcription.text',
    'conversation.item.input_audio_transcription.completed',
    'input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped',
    'input_audio_buffer.committed', 'conversation.item.created', 'session.finished',
  ]);
  if (!allowed.has(event.type)) return null;
  const result = { type: event.type };
  for (const name of ['item_id', 'previous_item_id', 'text', 'stash', 'transcript']) {
    if (typeof event[name] === 'string') result[name] = event[name].slice(0, 4000);
  }
  if (event.previous_item_id === null) result.previous_item_id = null;
  if (event.type === 'conversation.item.created' && typeof event.item?.id === 'string') {
    result.item = { id: event.item.id.slice(0, 256) };
  }
  return result;
}

// Reuse one handler for all upgrades in a process so tickets and session limits
// are shared by the integrated server, standalone gateway, and Vercel route.
export function createSpeechGatewayHandler(options = {}) {
  const config = options.config || speechGatewayConfig();
  const connectUpstream = options.connectUpstream || ((url, settings) => new WebSocket(url, settings));
  const verifyTicket = options.verifyTicket || verifySpeechTicket;
  const timeouts = { auth: 5000, connect: 15000, record: 60000, drain: 1500, finish: 15000, lifetime: 90000, ...options.timeouts };
  const usedTickets = new Map();
  const activeUsers = new Map();
  const clients = new Map();
  let closing = false;
  const canAccept = () => !closing && clients.size < MAX_CONNECTIONS;
  const accept = client => {
    if (!canAccept()) { client.terminate(); return Promise.resolve(); }
    let resolveClosed;
    const closed = new Promise(resolve => { resolveClosed = resolve; });
    clients.set(client, closed);
    let state = 'authenticating';
    let verifying = false;
    let upstream;
    let userId;
    let audioBytes = 0;
    let eventNumber = 0;
    const timers = new Set();
    const later = (callback, delay) => {
      const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
      timer.unref?.(); timers.add(timer); return timer;
    };
    const clear = timer => { clearTimeout(timer); timers.delete(timer); };
    const cleanup = () => {
      if (state === 'closed') return;
      state = 'closed';
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
      if (userId) {
        const remaining = (activeUsers.get(userId) || 1) - 1;
        if (remaining) activeUsers.set(userId, remaining); else activeUsers.delete(userId);
        userId = undefined;
      }
    };
    const send = event => {
      if (client.readyState !== WebSocket.OPEN) return false;
      const payload = JSON.stringify(event);
      if (client.bufferedAmount + Buffer.byteLength(payload) > MAX_BUFFER_BYTES) { cleanup(); client.terminate(); return false; }
      client.send(payload); return true;
    };
    const fail = (message = safeFailure) => {
      if (state === 'closed') return;
      send({ type: 'error', message }); cleanup(); client.close(1008, 'Speech session ended');
      // A peer need not complete the closing handshake; bound that resource too.
      const timer = setTimeout(() => client.terminate(), 1000); timer.unref?.();
    };
    const toUpstream = event => {
      const payload = JSON.stringify({ event_id: `ledger_${++eventNumber}`, ...event });
      if (!upstream || upstream.readyState !== WebSocket.OPEN || upstream.bufferedAmount + Buffer.byteLength(payload) > MAX_BUFFER_BYTES) { fail(); return false; }
      upstream.send(payload); return true;
    };
    let recordTimer, drainTimer;
    const finish = () => {
      if (state === 'finishing') return;
      if (state !== 'recording' && state !== 'draining') { fail('语音服务尚未就绪，请重试。'); return; }
      state = 'finishing'; clear(recordTimer); clear(drainTimer);
      send({ type: 'finishing' });
      if (toUpstream({ type: 'session.finish' })) later(() => fail('语音识别超时，已识别的文字已保留，请重试。'), timeouts.finish);
    };
    const authTimer = later(() => fail('语音会话已过期，请重新开始。'), timeouts.auth);
    later(() => fail('语音会话已结束，请重新开始。'), timeouts.lifetime);
    client.on('message', async (data, isBinary) => {
      if (state === 'closed') return;
      if (isBinary) {
        // A stop notification may cross an already queued worklet chunk.
        if (state === 'finishing') return;
        if (!['recording', 'draining'].includes(state) || data.byteLength === 0 || data.byteLength % 2
          || data.byteLength > MAX_FRAME_BYTES || (state === 'recording' && audioBytes + data.byteLength > MAX_AUDIO_BYTES)) {
          fail('录音数据无效或超过60秒，请重新录音。'); return;
        }
        const accepted = data.subarray(0, MAX_AUDIO_BYTES - audioBytes);
        if (accepted.byteLength) {
          audioBytes += accepted.byteLength;
          toUpstream({ type: 'input_audio_buffer.append', audio: accepted.toString('base64') });
        }
        return;
      }
      if (data.byteLength > 8192) { fail(); return; }
      let message;
      try { message = JSON.parse(data.toString()); } catch { fail(); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { fail(); return; }
      if (message.type === 'cancel') { cleanup(); client.close(1000); return; }
      if (state === 'authenticating') {
        if (verifying || message.type !== 'authenticate' || typeof message.ticket !== 'string' || message.ticket.length > 4096) {
          fail('语音授权无效，请重新开始。'); return;
        }
        verifying = true;
        let claims;
        try { claims = await verifyTicket(message.ticket, config.jwtSecret); }
        catch { fail('语音授权已失效，请重新开始。'); return; }
        if (state === 'closed') return;
        const now = Math.floor(Date.now() / 1000);
        for (const [id, expiry] of usedTickets) if (expiry <= now) usedTickets.delete(id);
        if (usedTickets.has(claims.jti) || usedTickets.size >= MAX_REPLAY_ENTRIES) { fail('语音授权已失效，请重新开始。'); return; }
        if ((activeUsers.get(claims.sub) || 0) >= 2) { fail('同时进行的录音过多，请先结束其他录音。'); return; }
        usedTickets.set(claims.jti, claims.exp);
        userId = claims.sub;
        activeUsers.set(userId, (activeUsers.get(userId) || 0) + 1);
        state = 'connecting'; clear(authTimer);
        const connectTimer = later(() => fail('语音服务连接超时，请重试。'), timeouts.connect);
        try {
          upstream = connectUpstream(config.upstreamURL, {
            headers: { Authorization: `Bearer ${config.apiKey}` }, maxPayload: 65_536,
            handshakeTimeout: timeouts.connect, perMessageDeflate: false,
          });
        } catch { fail(); return; }
        upstream.on('open', () => {
          if (state !== 'connecting') return;
          toUpstream({ type: 'session.update', session: {
            input_audio_format: 'pcm', sample_rate: 16000,
            input_audio_transcription: { language: 'zh' },
            turn_detection: { type: 'server_vad', threshold: 0, silence_duration_ms: 400 },
          } });
        });
        upstream.on('message', raw => {
          if (state === 'closed') return;
          let event;
          try { event = JSON.parse(raw.toString()); } catch { fail(); return; }
          if (!event || typeof event !== 'object') { fail(); return; }
          if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') { fail(); return; }
          if (event.type === 'session.updated' && state === 'connecting') {
            clear(connectTimer); state = 'recording'; send({ type: 'ready' });
            recordTimer = later(() => {
              state = 'draining'; send({ type: 'finishing' });
              drainTimer = later(finish, timeouts.drain);
            }, timeouts.record); return;
          }
          if (event.type === 'session.finished' && state !== 'finishing') { fail(); return; }
          const visible = publicEvent(event);
          if (visible) send(visible);
          if (event.type === 'session.finished') { cleanup(); client.close(1000); }
        });
        upstream.on('error', () => fail());
        upstream.on('close', () => { if (state !== 'closed') fail(); });
        return;
      }
      if (message.type === 'finish') finish(); else fail();
    });
    client.on('error', cleanup);
    client.once('close', () => {
      cleanup(); clients.delete(client); resolveClosed();
    });
    return closed;
  };
  return {
    accept,
    canAccept,
    async close() {
      closing = true;
      const pending = [...clients.values()];
      for (const client of clients.keys()) client.terminate();
      await Promise.all(pending);
    },
  };
}

export function attachSpeechGateway(server, options = {}) {
  const config = options.config || speechGatewayConfig();
  const handler = createSpeechGatewayHandler({ ...options, config });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16_384, perMessageDeflate: false });
  const onUpgrade = (request, socket, head) => {
    let url;
    try { url = new URL(request.url, 'http://speech.local'); } catch { socket.destroy(); return; }
    // The integrated Next server also handles its development HMR upgrades.
    if (url.pathname !== PATH) return;
    const status = url.search ? 404
      : !config.allowedOrigins.includes(request.headers.origin) ? 403
        : !handler.canAccept() ? 503 : 0;
    if (status) {
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client));
  };
  server.on('upgrade', onUpgrade);
  wss.on('connection', client => { void handler.accept(client); });
  return {
    async close() {
      server.off('upgrade', onUpgrade);
      await handler.close();
      await new Promise(resolve => wss.close(resolve));
    },
  };
}

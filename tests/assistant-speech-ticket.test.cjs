/* eslint-disable @typescript-eslint/no-require-imports -- isolated route tests with real JWT signatures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const { NextResponse } = require('next/server');
const SECRET = '  raw-session-secret-used-for-speech-test  ';
const SOCKET_PATH = '/api/assistant/transcribe/realtime';

function load(file, dependencies, env = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { exports, URL, TextEncoder, Error, crypto: crypto.webcrypto,
    process: { env }, require: name => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; },
  });
  return exports;
}

async function helpers(env = {}) {
  const jose = await import('jose');
  const auth = await import('../server/speech-auth.mjs');
  return load('lib/assistant-speech-ticket.ts', {
    jose, '@/lib/session-secret': { sessionSecret: new TextEncoder().encode(SECRET) },
    '@/server/speech-auth.mjs': auth,
  }, { DASHSCOPE_API_KEY: 'provider-key-must-never-leak', ...env });
}

async function route(env = {}, options = {}) {
  const helper = await helpers(env);
  let issued = 0;
  const api = load('app/api/assistant/transcribe/session/route.ts', {
    'next/server': { NextResponse },
    '@/lib/auth': { getSession: options.getSession || (async () => ({ userId: 'user-test', username: 'private-name', email: 'private@example.test' })) },
    '@/lib/assistant-speech-ticket': {
      speechSocketUrl: helper.speechSocketUrl,
      createSpeechTicket: async userId => { issued++; return options.createSpeechTicket ? options.createSpeechTicket(userId) : helper.createSpeechTicket(userId); },
    },
  });
  return { ...api, get issued() { return issued; } };
}

function request(origin = 'http://localhost:3000', extraHeaders = {}) {
  return { nextUrl: new URL('http://localhost:3000/api/assistant/transcribe/session'),
    headers: new Headers({ ...(origin === null ? {} : { origin }), ...extraHeaders }) };
}

function assertNoStore(response) { assert.equal(response.headers.get('cache-control'), 'no-store'); }

test('speech tickets carry only a fresh bounded gateway identity with a separate signing domain', async () => {
  const { jwtVerify } = await import('jose');
  const { speechSigningSecret } = await import('../server/speech-auth.mjs');
  const h = await helpers();
  const first = await h.createSpeechTicket('user-test'), second = await h.createSpeechTicket('user-test');
  const settings = { issuer: 'ledger', audience: 'ledger-speech', algorithms: ['HS256'] };
  const { payload, protectedHeader } = await jwtVerify(first, speechSigningSecret(SECRET), settings);
  const { payload: other } = await jwtVerify(second, speechSigningSecret(SECRET), settings);
  assert.equal(protectedHeader.alg, 'HS256');
  assert.equal(payload.sub, 'user-test');
  assert.equal(payload.exp - payload.iat, 60);
  assert.ok(Math.abs(payload.iat - Math.floor(Date.now() / 1000)) <= 2);
  assert.match(payload.jti, /^[0-9a-f-]{36}$/);
  assert.notEqual(payload.jti, other.jti);
  assert.deepEqual(Object.keys(payload).sort(), ['aud', 'exp', 'iat', 'iss', 'jti', 'sub']);
  assert.equal(JSON.stringify(payload).includes('provider-key'), false);
  await assert.rejects(jwtVerify(first, speechSigningSecret(SECRET.trim()), settings));
  await assert.rejects(jwtVerify(first, new TextEncoder().encode(SECRET)), 'a speech ticket must not authenticate as a ledger session');
});

test('local and Vercel deployments default to same-origin sockets; an external gateway remains optional', async () => {
  const h = await helpers();
  assert.equal(h.speechSocketUrl('http://localhost:3000'), `ws://localhost:3000${SOCKET_PATH}`);
  assert.equal(h.speechSocketUrl('https://ledger.example'), `wss://ledger.example${SOCKET_PATH}`);
  const vercel = await helpers({ VERCEL: '1' });
  assert.equal(vercel.speechSocketUrl('https://ledger.jiajiwei.top'), `wss://ledger.jiajiwei.top${SOCKET_PATH}`);
  const external = await helpers({ VERCEL: '1', SPEECH_GATEWAY_URL: `wss://speech.example${SOCKET_PATH}` });
  assert.equal(external.speechSocketUrl('https://ledger.vercel.app'), `wss://speech.example${SOCKET_PATH}`);
});

test('gateway URL cannot use remote plaintext sockets, credentials, query strings, fragments, or another path', async () => {
  for (const url of [`ws://speech.example${SOCKET_PATH}`, `wss://user:password@speech.example${SOCKET_PATH}`,
    `wss://speech.example${SOCKET_PATH}?token=secret`, `wss://speech.example${SOCKET_PATH}#fragment`,
    'wss://speech.example/other', 'not-a-url']) {
    const h = await helpers({ SPEECH_GATEWAY_URL: url });
    assert.throws(() => h.speechSocketUrl('https://ledger.example'));
  }
});

test('session route authenticates and checks Origin before issuing a ticket; all responses are no-store', async () => {
  const anonymous = await route({}, { getSession: async () => null });
  const unauthorized = await anonymous.POST(request());
  assert.equal(unauthorized.status, 401); assertNoStore(unauthorized); assert.equal(anonymous.issued, 0);
  for (const req of [request('https://evil.example'), request('null'), request(null, { 'sec-fetch-site': 'cross-site' })]) {
    const api = await route(); const response = await api.POST(req);
    assert.equal(response.status, 403); assertNoStore(response); assert.equal(api.issued, 0);
  }
  const api = await route();
  const response = await api.POST(request());
  assert.equal(response.status, 200); assertNoStore(response);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['ticket', 'url']);
  assert.equal(body.url, `ws://localhost:3000${SOCKET_PATH}`);
  const { jwtVerify } = await import('jose');
  const { speechSigningSecret } = await import('../server/speech-auth.mjs');
  const { payload } = await jwtVerify(body.ticket, speechSigningSecret(SECRET), { issuer: 'ledger', audience: 'ledger-speech' });
  assert.equal(payload.sub, 'user-test');
  assert.equal(JSON.stringify(body).includes('provider-key'), false);
  assert.equal(api.issued, 1);
});

test('Vercel issues a same-origin ticket without any external gateway configuration', async () => {
  const api = await route({ VERCEL: '1' });
  const origin = 'https://ledger.jiajiwei.top';
  const response = await api.POST({ nextUrl: new URL(`${origin}/api/assistant/transcribe/session`), headers: new Headers({ host: 'ledger.jiajiwei.top', origin }) });
  assert.equal(response.status, 200); assertNoStore(response);
  assert.equal((await response.json()).url, `wss://ledger.jiajiwei.top${SOCKET_PATH}`);
  assert.equal(api.issued, 1);
});

test('custom Next bind hostname never replaces the browser or HTTPS reverse proxy origin', async () => {
  for (const [internal, host, origin, expected] of [
    ['http://0.0.0.0:3000', 'localhost:3000', 'http://localhost:3000', `ws://localhost:3000${SOCKET_PATH}`],
    ['https://0.0.0.0:3000', 'ledger.example', 'https://ledger.example', `wss://ledger.example${SOCKET_PATH}`],
    ['https://0.0.0.0:3000', 'ledger.example:8443', 'https://ledger.example:8443', `wss://ledger.example:8443${SOCKET_PATH}`],
  ]) {
    const api = await route();
    const req = { nextUrl: new URL(`${internal}/api/assistant/transcribe/session`), headers: new Headers({ host, origin }) };
    const response = await api.POST(req);
    assert.equal(response.status, 200, `should accept page origin ${origin}`); assertNoStore(response);
    assert.equal((await response.json()).url, expected);
    assert.equal(api.issued, 1);
    const attacker = await route();
    const rejected = await attacker.POST({ ...req, headers: new Headers({ host, origin: 'https://evil.example' }) });
    assert.equal(rejected.status, 403); assertNoStore(rejected);
    assert.equal(attacker.issued, 0);
  }
});

test('unexpected authentication or signing failures never escape as raw responses', async () => {
  for (const options of [
    { getSession: async () => { throw new Error('private-auth-failure-secret'); } },
    { createSpeechTicket: async () => { throw new Error('private-signing-failure-secret'); } },
  ]) {
    const api = await route({}, options);
    const response = await api.POST(request());
    assert.ok(response.status >= 500); assertNoStore(response);
    const body = await response.json();
    assert.equal(typeof body.error, 'string');
    assert.equal(JSON.stringify(body).includes('private-'), false);
  }
});

/* eslint-disable @typescript-eslint/no-require-imports -- isolated Vercel route boundary tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { NextResponse } = require('next/server');

const ORIGIN = 'https://ledger.jiajiwei.top';
const SOCKET_PATH = '/api/assistant/transcribe/realtime';
const SECRET = 'test-vercel-speech-secret-at-least-32-characters';

async function route(options = {}) {
  const { speechGatewayConfig } = await import('../server/assistant-speech-gateway.mjs');
  const configCalls = [], created = [], upgrades = [], accepted = [];
  const dependencies = {
    'next/server': { NextResponse },
    '@vercel/functions': {
      experimental_upgradeWebSocket: async (callback, settings) => {
        const socket = { id: upgrades.length + 1 };
        upgrades.push({ settings, socket });
        if (options.upgradeError) throw options.upgradeError;
        await callback(socket);
        return new Response(null, { status: 204 });
      },
    },
    '@/server/assistant-speech-gateway.mjs': {
      speechGatewayConfig: env => { configCalls.push(env); return speechGatewayConfig(env); },
      createSpeechGatewayHandler: settings => {
        const handler = {
          canAccept: () => options.canAccept !== false,
          accept: async socket => {
            accepted.push(socket);
            if (options.accept) await options.accept(socket);
          },
        };
        created.push({ settings, handler });
        return handler;
      },
    },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('app/api/assistant/transcribe/realtime/route.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, {
    exports, URL,
    process: { env: { DASHSCOPE_API_KEY: 'provider-key-must-never-leak', JWT_SECRET: SECRET, VERCEL: '1', ...options.env } },
    require: name => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; },
  });
  return { ...exports, configCalls, created, upgrades, accepted };
}

function request({ origin = ORIGIN, url = `${ORIGIN}${SOCKET_PATH}`, upgrade = 'websocket', host = 'ledger.jiajiwei.top' } = {}) {
  return {
    nextUrl: new URL(url),
    headers: new Headers({ ...(origin === null ? {} : { origin }), ...(host === null ? {} : { host }), ...(upgrade === null ? {} : { upgrade }) }),
  };
}

async function assertFailure(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(typeof body.error, 'string');
  assert.equal(JSON.stringify(body).includes('private-'), false);
  assert.equal(JSON.stringify(body).includes('provider-key'), false);
  return body;
}

test('Vercel route imports without credentials and rejects regular HTTP or query credentials before setup', async () => {
  const api = await route({ env: { DASHSCOPE_API_KEY: undefined, JWT_SECRET: undefined } });
  assert.equal(api.configCalls.length, 0);
  assert.equal(api.created.length, 0);
  await assertFailure(await api.GET(request({ upgrade: null })), 426);
  await assertFailure(await api.GET(request({ url: `${ORIGIN}${SOCKET_PATH}?ticket=private-query-secret` })), 404);
  assert.equal(api.configCalls.length, 0);
  assert.equal(api.upgrades.length, 0);
});

test('Vercel rejects missing and foreign Origins before constructing the speech service', async () => {
  const api = await route();
  for (const origin of [null, 'null', 'https://evil.example', `${ORIGIN}.evil.example`]) {
    await assertFailure(await api.GET(request({ origin })), 403);
  }
  assert.equal(api.configCalls.length, 0);
  assert.equal(api.created.length, 0);
  assert.equal(api.upgrades.length, 0);
});

test('Vercel accepts the production same-origin socket with only existing Bailian and JWT configuration', async () => {
  const api = await route();
  const response = await api.GET(request());
  assert.equal(response.status, 204);
  assert.equal(api.created.length, 1);
  assert.equal(api.configCalls[0].SPEECH_GATEWAY_URL, undefined);
  assert.deepEqual(api.created[0].settings.config.allowedOrigins, [ORIGIN]);
  assert.equal(new URL(api.created[0].settings.config.upstreamURL).hostname, 'dashscope.aliyuncs.com');
  assert.equal(api.upgrades.length, 1);
  assert.equal(api.upgrades[0].settings.maxPayload, 16_384);
  assert.equal(api.accepted[0], api.upgrades[0].socket);
});

test('Vercel honors an explicit origin allowlist in addition to the same-origin boundary', async () => {
  const disallowed = await route({ env: { SPEECH_ALLOWED_ORIGINS: 'https://other-ledger.example' } });
  await assertFailure(await disallowed.GET(request()), 403);
  assert.equal(disallowed.created.length, 0);
  assert.equal(disallowed.upgrades.length, 0);
  const allowed = await route({ env: { SPEECH_ALLOWED_ORIGINS: `https://other-ledger.example,${ORIGIN}` } });
  assert.equal((await allowed.GET(request())).status, 204);
  await assertFailure(await allowed.GET(request({ origin: 'https://other-ledger.example' })), 403);
  assert.equal(allowed.upgrades.length, 1);
});

test('Vercel compares the browser origin with the public Host when Next has an internal bind hostname', async () => {
  const api = await route();
  const response = await api.GET(request({ url: `https://0.0.0.0:3000${SOCKET_PATH}` }));
  assert.equal(response.status, 204);
  assert.deepEqual(api.created[0].settings.config.allowedOrigins, [ORIGIN]);
});

test('Vercel reuses a warm handler and leaves each upgrade pending through its socket lifetime', async () => {
  const lifetimes = [];
  const api = await route({ accept: socket => new Promise(resolve => { lifetimes.push({ socket, resolve }); }) });
  let firstDone = false, secondDone = false;
  const first = api.GET(request()).then(response => { firstDone = true; return response; });
  const second = api.GET(request()).then(response => { secondDone = true; return response; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(api.created.length, 1);
    assert.equal(api.accepted.length, 2);
    assert.equal(firstDone, false);
    assert.equal(secondDone, false);
    lifetimes[0].resolve();
    assert.equal((await first).status, 204);
    assert.equal(secondDone, false);
    lifetimes[1].resolve();
    assert.equal((await second).status, 204);
  } finally {
    for (const lifetime of lifetimes) lifetime.resolve();
    await Promise.all([first, second]);
  }
});

test('Vercel returns safe unavailable responses for configuration, capacity, upgrade, and handler failures', async () => {
  for (const options of [
    { env: { DASHSCOPE_API_KEY: undefined } },
    { env: { JWT_SECRET: undefined } },
    { env: { SPEECH_ALLOWED_ORIGINS: '*' } },
    { canAccept: false },
    { upgradeError: new Error('private-upgrade-runtime-secret') },
    { accept: async () => { throw new Error('private-handler-secret'); } },
  ]) {
    const api = await route(options);
    await assertFailure(await api.GET(request()), 503);
    if (options.env || options.canAccept === false) assert.equal(api.upgrades.length, 0);
  }
});

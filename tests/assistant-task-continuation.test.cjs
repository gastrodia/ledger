/* eslint-disable @typescript-eslint/no-require-imports -- isolated continuation routing and authenticated callback fixtures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const { NextResponse } = require('next/server');

const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const descriptor = { userId: 'owner', taskId: id(1), attempt: 2, runToken: id(2) };
const secret = new TextEncoder().encode('isolated-continuation-fixture-secret');
const plain = value => JSON.parse(JSON.stringify(value));

function fixture({ env = { NODE_ENV: 'development' }, worker, fetch: fetchStub } = {}) {
  let now = 1_800_000_000_000;
  const background = [], calls = [], requests = [], logs = [], modules = new Map();
  const dependencies = {
    'node:crypto': crypto,
    '@/lib/session-secret': { sessionSecret: secret },
    '@/lib/assistant-tasks': { runAssistantTask: async (...args) => {
      calls.push(args);
      return worker ? worker(...args) : null;
    } },
    'next/server': { NextResponse, after: callback => background.push(callback) },
  };
  const load = file => {
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, { exports, require: name => {
      if (name in dependencies) return dependencies[name];
      if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
      assert.fail(`Unexpected dependency ${name}`);
    }, Buffer, URL, Error, Number, JSON, TextEncoder,
    Date: class extends Date { static now() { return now; } },
    AbortSignal, process: { env },
    console: { warn: (...args) => logs.push(args) },
    fetch: async (...args) => {
      requests.push(args);
      if (fetchStub) return fetchStub(...args);
      assert.fail('No external HTTP requests are allowed in continuation tests');
    } }, { filename: file });
    return exports;
  };
  return { load, background, calls, requests, logs, setNow: value => { now = value; },
    security: load('lib/assistant-task-continuation.ts'),
    dispatch: load('lib/assistant-task-dispatch.ts'),
    route: load('app/api/assistant/tasks/continue/route.ts') };
}

function request(token, extraHeaders = {}) {
  return { headers: new Headers({ ...(token ? { 'x-assistant-task-continuation': token } : {}), ...extraHeaders }),
    get json() { assert.fail('Callback must use signed header claims, never an untrusted body'); },
    get nextUrl() { assert.fail('Callback must not trust request origin or query credentials'); } };
}

function signedClaims(claims, scope = 'assistant-task-continue:v1') {
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const key = crypto.createHmac('sha256', secret).update(scope).digest();
  return `${encoded}.${crypto.createHmac('sha256', key).update(encoded).digest('base64url')}`;
}

test('callback verifies scope, signature, expiry and exact descriptor before scheduling any work', async () => {
  const f = fixture();
  const token = f.security.signAssistantTaskContinuation(descriptor);
  const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
  const altered = Buffer.from(JSON.stringify({ ...payload, userId: 'foreign' })).toString('base64url');
  const invalid = [null, `${altered}.${token.split('.')[1]}`, `${token}.extra`, 'x'.repeat(2049),
    signedClaims({ ...payload, scope: 'login' }),
    signedClaims(payload, 'other-purpose'),
    signedClaims({ ...payload, expires: 1_800_000_000 }),
    signedClaims({ ...payload, expires: 1_800_000_301 }),
    signedClaims({ ...payload, attempt: 0 }), signedClaims({ ...payload, attempt: 2_147_483_648 }),
    signedClaims({ ...payload, taskId: 'invalid' }), signedClaims({ ...payload, runToken: 'invalid' }),
    signedClaims({ ...payload, userId: '../foreign' })];
  for (const value of invalid) {
    const response = await f.route.POST(request(value));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: '无效的任务接续凭证。' });
  }
  assert.equal(f.background.length + f.calls.length + f.requests.length, 0);
  assert.deepEqual(plain(f.security.verifyAssistantTaskContinuation(token)), descriptor);
  f.setNow(1_800_000_300_000);
  assert.equal(f.security.verifyAssistantTaskContinuation(token), null);
});

test('callback uses only the signed header claims and forwards their original run fence', async () => {
  const f = fixture();
  const token = f.security.signAssistantTaskContinuation(descriptor);
  const response = await f.route.POST(request(token, { host: 'attacker.example', 'x-forwarded-host': 'attacker.example' }));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(f.calls.length, 0);
  await f.background.shift()();
  assert.deepEqual(plain(f.calls), [[descriptor.userId, descriptor.taskId,
    { attempt: descriptor.attempt, runToken: descriptor.runToken }]]);
  assert.equal(f.requests.length, 0);
  const headerless = await f.route.POST(request(null, { authorization: `Bearer ${token}` }));
  assert.equal(headerless.status, 401);
});

test('trusted continuation origins reject public HTTP, credentials, paths and production fallback', () => {
  const { assistantTaskContinuationOrigin: origin } = fixture().security;
  for (const env of [{ NODE_ENV: 'production' },
    { ASSISTANT_TASK_ORIGIN: 'http://attacker.example' },
    { ASSISTANT_TASK_ORIGIN: 'https://user:password@ledger.example' },
    { ASSISTANT_TASK_ORIGIN: 'https://ledger.example/other' },
    { ASSISTANT_TASK_ORIGIN: 'https://ledger.example/?secret=1' },
    { ASSISTANT_TASK_ORIGIN: 'https://ledger.example/#hash' },
    { VERCEL_URL: 'deployment.vercel.app/path' }, { VERCEL_URL: 'https://deployment.vercel.app' },
    { VERCEL_URL: 'deployment.vercel.app@attacker.example' },
    { NODE_ENV: 'development', PORT: '0' }, { NODE_ENV: 'development', PORT: '65536' }]) {
    assert.equal(origin(env), null, JSON.stringify(env));
  }
  for (const [env, expected] of [
    [{ VERCEL_URL: 'deployment.vercel.app', ASSISTANT_TASK_ORIGIN: 'https://other.example' }, 'https://other.example/'],
    [{ ASSISTANT_TASK_ORIGIN: 'https://ledger.example' }, 'https://ledger.example/'],
    [{ VERCEL_ENV: 'production', VERCEL_URL: 'protected.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'ledger.example' }, 'https://ledger.example/'],
    [{ VERCEL_ENV: 'preview', VERCEL_URL: 'preview.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'ledger.example' }, 'https://preview.vercel.app/'],
    [{ VERCEL_ENV: 'production', VERCEL_URL: 'protected.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'ledger.example', VERCEL_AUTOMATION_BYPASS_SECRET: 'fixture' }, 'https://protected.vercel.app/'],
    [{ NODE_ENV: 'development' }, 'http://localhost:3000/'],
    [{ NODE_ENV: 'development', PORT: '3100' }, 'http://localhost:3100/'],
    [{ ASSISTANT_TASK_ORIGIN: 'http://127.0.0.1:3000' }, 'http://127.0.0.1:3000/'],
  ]) assert.equal(origin(env).href, expected);
});

test('server callbacks finish three waves with no browser requests, and stale replay cannot advance work', async () => {
  let runToken = null, status = 'queued', completed = 0;
  let f;
  const actualWork = [];
  f = fixture({ env: { NODE_ENV: 'production', VERCEL_URL: 'current-deployment.vercel.app' },
    worker: async (userId, taskId, expected) => {
      assert.equal(userId, descriptor.userId); assert.equal(taskId, descriptor.taskId);
      if (status !== 'queued' || (expected && (expected.attempt !== 2 || expected.runToken !== runToken))) return null;
      status = 'running'; runToken = id(10 + completed);
      actualWork.push(completed++);
      if (completed === 3) { status = 'succeeded'; return null; }
      status = 'queued'; return { attempt: 2, runToken };
    },
    fetch: async (url, options) => {
      assert.equal(url.href, 'https://current-deployment.vercel.app/api/assistant/tasks/continue');
      assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store'); assert.equal(url.search, '');
      return f.route.POST(request(options.headers['x-assistant-task-continuation']));
    },
  });
  await f.dispatch.runAndContinueAssistantTask(descriptor.userId, descriptor.taskId);
  const firstToken = f.requests[0][1].headers['x-assistant-task-continuation'];
  await f.background.shift()();
  // This old callback is still cryptographically valid, but must retain its old fence.
  await f.route.POST(request(firstToken));
  while (f.background.length) await f.background.shift()();
  assert.deepEqual(actualWork, [0, 1, 2]); assert.equal(status, 'succeeded');
  assert.equal(f.requests.length, 2); assert.equal(f.calls.length, 4);
  assert.deepEqual(plain(f.calls.at(-1)[2]), { attempt: 2, runToken: id(10) });
  assert.equal(f.logs.length, 0);
});

test('a lost callback acknowledgment retries the same fence without redoing a completed wave', async () => {
  let f, attempts = 0, waves = 0, current = null;
  f = fixture({ worker: async (_user, _task, expected) => {
    if (expected && expected.runToken !== current) return null;
    if (++waves === 1) { current = id(20); return { attempt: 2, runToken: current }; }
    current = id(21); return null;
  }, fetch: async (_url, options) => {
    const response = await f.route.POST(request(options.headers['x-assistant-task-continuation']));
    if (++attempts === 1) throw new Error('acknowledgment lost');
    return response;
  } });
  await f.dispatch.runAndContinueAssistantTask(descriptor.userId, descriptor.taskId);
  while (f.background.length) await f.background.shift()();
  assert.equal(attempts, 2); assert.equal(waves, 2);
  assert.equal(f.requests[0][1].headers['x-assistant-task-continuation'], f.requests[1][1].headers['x-assistant-task-continuation']);
});

test('dispatch fails safely after bounded retries and does not leak tokens, origin or raw errors', async () => {
  const next = { attempt: 2, runToken: id(30) };
  const f = fixture({ worker: async () => next, fetch: async () => { throw new Error('secret provider token private-origin'); } });
  await f.dispatch.runAndContinueAssistantTask(descriptor.userId, descriptor.taskId);
  assert.equal(f.calls.length, 1); assert.equal(f.requests.length, 2);
  assert.deepEqual(plain(f.logs), [['AI task continuation deferred',
    { taskId: descriptor.taskId, attempt: 2, reason: 'dispatch_failed' }]]);
  const missing = fixture({ env: { NODE_ENV: 'production' }, worker: async () => next });
  await missing.dispatch.runAndContinueAssistantTask(descriptor.userId, descriptor.taskId);
  assert.equal(missing.requests.length, 0);
  assert.equal(missing.logs[0][1].reason, 'origin_unavailable');
});

test('a login page, redirect or failed callback is never mistaken for accepted continuation', async () => {
  for (const status of [200, 302, 401, 500]) {
    const f = fixture({ worker: async () => ({ attempt: 2, runToken: id(35) }),
      fetch: async (_url, options) => {
        assert.equal(options.redirect, 'error');
        return new Response(null, { status });
      } });
    await f.dispatch.runAndContinueAssistantTask(descriptor.userId, descriptor.taskId);
    assert.equal(f.requests.length, 2, String(status));
    assert.equal(f.calls.length, 1);
    assert.equal(f.logs[0][1].reason, 'dispatch_failed');
  }
});

test('deployment protection bypass stays on the trusted current Vercel deployment', async () => {
  for (const [env, includeBypass] of [
    [{ VERCEL_URL: 'current.vercel.app', VERCEL_AUTOMATION_BYPASS_SECRET: 'fixture-platform-secret' }, true],
    [{ ASSISTANT_TASK_ORIGIN: 'https://ledger.example', VERCEL_AUTOMATION_BYPASS_SECRET: 'fixture-platform-secret' }, false],
    [{ ASSISTANT_TASK_ORIGIN: 'https://other.vercel.app', VERCEL_AUTOMATION_BYPASS_SECRET: 'fixture-platform-secret' }, false],
  ]) {
    const f = fixture({ env, worker: async () => ({ attempt: 2, runToken: id(40) }), fetch: async () => new Response(null, { status: 202 }) });
    await f.dispatch.runAndContinueAssistantTask(descriptor.userId, descriptor.taskId);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0][1].headers['x-vercel-protection-bypass'], includeBypass ? 'fixture-platform-secret' : undefined);
  }
});

/* eslint-disable @typescript-eslint/no-require-imports -- node:test CommonJS harness for TypeScript server modules. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { NextResponse } = require('next/server');

function load(file, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require: (name) => {
    if (!(name in dependencies)) throw new Error(`Unmocked ${name}`);
    return dependencies[name];
  }, URL, TextEncoder, console: { error() {} }, ...globals });
  return exports;
}
const pathHelpers = load('lib/attachment-path.ts');
const uploadId = '00000000-0000-4000-8000-000000000001';
const pathname = `transactions/user-a/${uploadId}/receipt.png`;
const url = `https://store.public.blob.vercel-storage.com/${pathname}`;
function attachments() {
  const deleted = [];
  const lookedUp = [];
  class BlobNotFoundError extends Error {}
  const exports = load('lib/attachments.ts', {
    'next/server': { NextResponse }, '@/lib/attachment-path': pathHelpers,
    '@vercel/blob': { BlobNotFoundError, head: async (path) => {
      lookedUp.push(path);
      return { pathname: path, url: `https://store.public.blob.vercel-storage.com/${path}` };
    }, del: async (path) => deleted.push(path) },
  });
  return { ...exports, deleted, lookedUp };
}

test('session signing requires explicit non-empty configuration', () => {
  for (const secret of [undefined, '', '   ']) {
    assert.throws(() => load('lib/session-secret.ts', {}, { process: { env: { JWT_SECRET: secret } } }), /JWT_SECRET/);
  }
  const configured = load('lib/session-secret.ts', {}, { process: { env: { JWT_SECRET: 'test-only-configured-secret' } } });
  assert.equal(new TextDecoder().decode(configured.sessionSecret), 'test-only-configured-secret');
});

test('only a complete owned upload pathname is valid', () => {
  assert.equal(pathHelpers.isOwnedAttachmentPath(pathname, 'user-a'), true);
  for (const path of [pathname.replace('/user-a/', '/user-b/'), 'transactions/receipt.png', `transactions/user-a/${uploadId}/..`, `transactions/user-a/${uploadId}/extra/receipt.png`]) {
    assert.equal(pathHelpers.isOwnedAttachmentPath(path, 'user-a'), false);
  }
  assert.equal(pathHelpers.ownedAttachmentPath(url + '?download=1', 'user-a'), null);
  assert.equal(pathHelpers.ownedAttachmentPath(url.replace('https:', 'http:'), 'user-a'), null);
});

test('binding verifies owned pathname against the configured store', async () => {
  const a = attachments();
  assert.equal(await a.validateAttachment(url, 'user-a'), null);
  assert.deepEqual(a.lookedUp, [pathname]);
  const response = await a.validateAttachment(url.replace('store.public', 'another.public'), 'user-a');
  assert.equal(response.status, 403);
});

test('unowned and arbitrary references cannot be newly bound or deleted', async () => {
  const a = attachments();
  for (const key of [url.replace('/user-a/', '/user-b/'), 'transactions/old.png', 42, 'https://example.com/file.png']) {
    assert.equal((await a.validateAttachment(key, 'user-a')).status, 403);
    if (typeof key === 'string') await a.deleteOwnedAttachment(key, 'user-a');
  }
  assert.deepEqual(a.deleted, []);
  assert.deepEqual(a.lookedUp, []);
});

test('legacy references can remain unchanged but grant no deletion authority', async () => {
  const a = attachments();
  const old = 'https://store.public.blob.vercel-storage.com/transactions/old.png';
  assert.equal(await a.validateAttachment(old, 'user-a', old), null);
  assert.equal((await a.validateAttachment(old, 'user-a')).status, 403);
  await a.deleteOwnedAttachment(old, 'user-a');
  assert.deepEqual(a.deleted, []);
  for (const key of [null, undefined, '']) assert.equal(await a.validateAttachment(key, 'user-a'), null);
});

test('owned deletion targets the store pathname only after canonical URL match', async () => {
  const a = attachments();
  await a.deleteOwnedAttachment(url.replace('store.public', 'another.public'), 'user-a');
  assert.deepEqual(a.deleted, []);
  await a.deleteOwnedAttachment(url, 'user-a');
  assert.deepEqual(a.deleted, [pathname]);
});

function loginFixture(passwords) {
  const sessions = [];
  const users = passwords.map((password, index) => ({ id: `user-${index}`, username: `name-${index}`, email: `mail-${index}@example.test`, password }));
  const api = load('app/api/auth/login/route.ts', {
    'next/server': { NextResponse }, '@/lib/db': { sql: async () => users },
    '@/lib/password': { verifyPassword: async (input, saved) => input === saved },
    '@/lib/auth': { setSessionCookie: async (session) => sessions.push(session) },
  });
  return { api, sessions };
}

test('legacy overlapping login identifiers resolve by a unique password match', async () => {
  const f = loginFixture(['first-password', 'second-password']);
  const response = await f.api.POST({ json: async () => ({ username: 'legacy@example.test', password: 'second-password' }) });
  assert.equal(response.status, 200);
  assert.equal(f.sessions[0].userId, 'user-1');
});

test('ambiguous credentials never select an arbitrary account', async () => {
  const f = loginFixture(['shared-password', 'shared-password']);
  const response = await f.api.POST({ json: async () => ({ username: 'legacy@example.test', password: 'shared-password' }) });
  assert.equal(response.status, 401);
  assert.equal(f.sessions.length, 0);
});

test('new usernames cannot occupy the email namespace', async () => {
  let queries = 0;
  const api = load('app/api/auth/register/route.ts', {
    'next/server': { NextResponse }, '@/lib/db': { sql: async () => { queries++; return []; } },
    '@/lib/password': {}, '@/lib/auth': {}, crypto: {},
  });
  const response = await api.POST({ json: async () => ({ username: 'someone@example.test', email: 'mail@example.test', password: 'valid-password' }) });
  assert.equal(response.status, 400);
  assert.equal(queries, 0);
});

test('an in-use category cannot change transaction type', async () => {
  let writes = 0;
  const sql = async (strings) => {
    const text = strings.join('?');
    if (text.includes('FROM categories')) return [{ id: 'cat', name: '餐饮', type: 'expense' }];
    if (text.includes('FROM transactions')) return [{ id: 'transaction' }];
    writes++; throw new Error('Unexpected write');
  };
  const api = load('app/api/categories/[id]/route.ts', { 'next/server': { NextResponse }, '@/lib/db': { sql }, '@/lib/auth': { getSession: async () => ({ userId: 'user-a' }) } });
  const response = await api.PATCH({ json: async () => ({ type: 'income' }) }, { params: Promise.resolve({ id: 'cat' }) });
  assert.equal(response.status, 409);
  assert.equal(writes, 0);
});

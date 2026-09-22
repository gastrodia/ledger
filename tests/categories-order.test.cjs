/* eslint-disable @typescript-eslint/no-require-imports -- node:test harness for authenticated category ordering. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { NextResponse } = require('next/server');

function load(file, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: id => {
    if (!(id in deps)) throw Error(`Unexpected dependency: ${id}`);
    return deps[id];
  }, console: { error() {} }, SyntaxError });
  return exports;
}
function fixture({ session = { userId: 'owner' }, result = [{ id: 'b' }, { id: 'a' }], fail = false } = {}) {
  const queries = [];
  let schemaCalls = 0;
  const deps = {
    'next/server': { NextResponse },
    '@/lib/auth': { getSession: async () => session },
    '@/lib/db': { sql: async (parts, ...values) => {
      queries.push({ text: parts.join('?'), values });
      if (fail) throw Error('offline');
      return result;
    } },
    '@/lib/categories-schema': { ensureCategoriesSchema: async () => { schemaCalls++; } },
    uuid: { v4: () => 'new' },
  };
  return {
    queries, schemaCalls: () => schemaCalls,
    reorder: load('app/api/categories/reorder/route.ts', deps).PATCH,
    list: load('app/api/categories/route.ts', deps).GET,
  };
}
const request = body => ({ json: async () => body });

test('category ordering requires authentication before any database access', async () => {
  const f = fixture({ session: null });
  assert.equal((await f.reorder(request({ type: 'expense', ids: ['a'] }))).status, 401);
  assert.equal((await f.list({})).status, 401);
  assert.equal(f.schemaCalls(), 0);
  assert.equal(f.queries.length, 0);
});

test('category ordering rejects invalid types, IDs, duplicates and malformed JSON before writes', async () => {
  for (const body of [null, [], {}, { type: 'all', ids: ['a'] }, ...[[], ['a', 'a'], [42], [''], [' '], ['a'.repeat(37)], 'a'].map(ids => ({ type: 'expense', ids }))]) {
    const f = fixture();
    assert.equal((await f.reorder(request(body))).status, 400);
    assert.equal(f.schemaCalls(), 0);
    assert.equal(f.queries.length, 0);
  }
  assert.equal((await fixture().reorder({ json: async () => { throw new SyntaxError(); } })).status, 400);
});

test('reordering performs one parameterized, owner- and type-scoped atomic update', async () => {
  const f = fixture();
  assert.equal((await f.reorder(request({ type: 'expense', ids: ['b', 'a'] }))).status, 200);
  assert.equal(f.queries.length, 1);
  const { text, values } = f.queries[0];
  assert.deepEqual(values, ['["b","a"]', 'owner', 'expense', 2, 2, 'owner', 'expense']);
  assert.match(text, /WITH ORDINALITY/);
  assert.match(text, /ORDER BY id FOR UPDATE/);
  assert.match(text, /COUNT\(\*\) FROM owned JOIN requested USING \(id\)/);
  assert.match(text, /FROM requested, valid/);
  assert.match(text, /category.user_id = \? AND category.type = \?/);
});

test('stale or unauthorized category sets return conflict and database failures are not success', async () => {
  assert.equal((await fixture({ result: [] }).reorder(request({ type: 'income', ids: ['foreign', 'a'] }))).status, 409);
  assert.equal((await fixture({ fail: true }).reorder(request({ type: 'income', ids: ['b', 'a'] }))).status, 500);
});

test('filtered and full category reads expose saved order with stable legacy fallbacks', async () => {
  const f = fixture();
  for (const query of ['', '?type=expense']) await f.list({ nextUrl: new URL(`https://ledger.invalid/api/categories${query}`) });
  for (const { text, values } of f.queries) {
    assert.match(text, /ORDER BY sort_order ASC NULLS LAST, created_at DESC, id ASC/);
    assert.equal(values[0], 'owner');
  }
  assert.deepEqual(f.queries[1].values, ['owner', 'expense']);
});

test('category schema migration preserves old rows, skips existing columns and retries failed upgrades', async () => {
  let present = false, denied = true;
  const writes = [];
  const { ensureCategoriesSchema } = load('lib/categories-schema.ts', { '@/lib/db': { sql: async parts => {
    const query = parts.join('');
    if (query.startsWith('SELECT')) { if (!present) throw { code: '42703' }; return []; }
    writes.push(query);
    if (denied) throw Error('permission denied');
    present = true;
  } } });
  await assert.rejects(ensureCategoriesSchema, /permission denied/);
  denied = false;
  await ensureCategoriesSchema();
  await ensureCategoriesSchema();
  assert.equal(writes.length, 2);
  assert.equal(writes[0], 'ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order INTEGER');
});

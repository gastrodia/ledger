/* eslint-disable @typescript-eslint/no-require-imports -- node:test harness for server modules. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, console: { error() {} }, require(name) { assert.ok(name in deps, name); return deps[name]; } });
  return exports;
}
function fixture() {
  const state = { user: 'u1', schemaError: null, txError: null, owned: true, transaction: true, calls: [], existing: [] };
  function query(text, values) {
    const q = { text: text.replace(/\s+/g, ' ').trim(), values };
    q.then = (ok, err) => Promise.resolve().then(() => {
      state.calls.push(q);
      if (q.text.startsWith('SELECT s.id')) return state.owned ? [{ id: 's1' }] : [];
      if (q.text.startsWith('SELECT l.source_id')) return state.existing;
      assert.fail(q.text);
    }).then(ok, err);
    return q;
  }
  const sql = (parts, ...values) => query(parts.join('?'), values);
  sql.query = query;
  sql.transaction = async (queries, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    state.calls.push(...queries);
    if (state.txError) throw { code: state.txError };
    const owned = state.owned ? [{ id: 's1' }] : [];
    if (queries.length === 2) return [owned, []];
    const transaction = state.transaction ? [{ id: 't1', type: 'expense', amount: '23.40', description: null, transaction_date: '2026-09-07' }] : [];
    return [owned, transaction, [], owned.length && transaction.length ? [{ transaction_id: 't1' }] : []];
  };
  const api = load('app/api/transaction-links/route.ts', {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
    '@/lib/auth': { getSession: async () => state.user ? { userId: state.user } : null },
    '@/lib/db': { sql },
    '@/lib/transaction-links-schema': { ensureTransactionLinksSchema: async () => { if (state.schemaError) throw { code: state.schemaError }; } },
    '@/lib/transaction-links': load('lib/transaction-links.ts'),
  });
  const payload = { sourceType: 'loan', sourceId: 's1', transactionId: 't1' };
  return { state, api, put: (body = payload) => api.PUT({ json: async () => body }), unlink: () => api.DELETE({ json: async () => payload }), get: query => api.GET({ nextUrl: new URL('https://local.test/?' + query) }) };
}

test('association API requires authentication before any database access', async () => {
  const f = fixture(); f.state.user = null;
  assert.equal((await f.put()).status, 401);
  assert.equal((await f.unlink()).status, 401);
  assert.equal((await f.get('sourceType=loan&sourceId=s1')).status, 401);
  assert.equal(f.state.calls.length, 0);
});

test('invalid source types, IDs and batches are rejected before database access', async () => {
  const f = fixture();
  for (const body of [null, [], { sourceType: 'transactions', sourceId: 's1', transactionId: 't1' }, { sourceType: 'loan', sourceId: "s1' OR true", transactionId: 't1' }]) assert.equal((await f.put(body)).status, 400);
  for (const query of ['sourceType=loan&sourceIds=', 'sourceType=loan&sourceId=s1&sourceIds=s1', 'sourceType=loan&sourceIds=' + Array.from({ length: 101 }, (_, i) => 's' + i).join(',')]) assert.equal((await f.get(query)).status, 400);
  assert.equal(f.state.calls.length, 0);
});

test('binding validates both owners inside a serializable guarded insert', async () => {
  const f = fixture();
  const saved = await f.put();
  assert.equal(saved.status, 200); assert.equal(saved.body.data.amount, 23.4);
  const insert = f.state.calls.find(q => q.text.startsWith('INSERT'));
  assert.match(insert.text, /WHERE EXISTS .*s.user_id = \$1/);
  assert.match(insert.text, /t.user_id = \$1 AND t.id = \$4/);
  assert.deepEqual(Array.from(insert.values), ['u1', 's1', 'loan', 't1']);
  assert.ok(f.state.calls.filter(q => /FOR SHARE/.test(q.text)).length === 2);
  f.state.owned = false; assert.equal((await f.put()).status, 404);
  f.state.owned = true; f.state.transaction = false; assert.equal((await f.put()).status, 404);
});

test('unlink only deletes relationship rows and verifies source ownership', async () => {
  const f = fixture(); assert.equal((await f.unlink()).status, 200);
  assert.match(f.state.calls[1].text, /^DELETE FROM transaction_links/);
  assert.match(f.state.calls[1].text, /AND EXISTS .*s.user_id = \$1/);
  f.state.owned = false; assert.equal((await f.unlink()).status, 404);
});

test('batch result filters both source and transaction ownership and deduplicates IDs', async () => {
  const f = fixture(); f.state.existing = [{ source_id: 's1', id: 't1', type: 'income', amount: '7.50', description: null, transaction_date: '2026-09-07' }];
  const response = await f.get('sourceType=repayment&sourceIds=s1,s1,s2');
  assert.equal(response.body.data[0].sourceId, 's1'); assert.equal(response.body.data[0].transaction.amount, 7.5);
  assert.deepEqual(Array.from(f.state.calls[0].values[2]), ['s1', 's2']);
  assert.match(f.state.calls[0].text, /t.user_id = l.user_id/);
  assert.match(f.state.calls[0].text, /p.user_id = s.user_id/);
});

test('ownership failures, occupied transactions, concurrency and unavailable schema are explicit', async () => {
  const f = fixture(); f.state.owned = false;
  assert.equal((await f.get('sourceType=given_gift&sourceId=s1')).status, 404);
  f.state.owned = true;
  for (const code of ['23505', '40001', '40P01', '23503']) { f.state.txError = code; assert.equal((await f.put()).status, 409); }
  f.state.txError = null; f.state.schemaError = '42501';
  const response = await f.put(); assert.equal(response.status, 503); assert.equal(response.body.code, 'LINK_SCHEMA_UNAVAILABLE');
});

test('SQL splitter preserves function bodies and quoted semicolons in schema scripts', () => {
  const { splitSqlStatements } = load('lib/sql-statements.ts');
  const statements = splitSqlStatements(fs.readFileSync(path.join(root, 'scripts/init-db.sql'), 'utf8'));
  const fn = statements.find(s => s.includes('CREATE OR REPLACE FUNCTION'));
  assert.match(fn, /RETURN NULL;\s*END;\s*\$\$$/);
  const split = splitSqlStatements("SELECT 'a;''b'; SELECT $$a;b$$; /* ; /* ; */ */ SELECT 1;");
  assert.equal(split.length, 3);
  assert.throws(() => splitSqlStatements('SELECT $$unfinished'), /unterminated/);
});

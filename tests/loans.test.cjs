/* eslint-disable @typescript-eslint/no-require-imports -- node:test CommonJS harness for TypeScript server modules. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function load(relativePath, mocks) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const evaluatedModule = { exports: {} };
  vm.runInNewContext(output, {
    module: evaluatedModule, exports: evaluatedModule.exports, console,
    require(name) {
      assert.ok(name in mocks, `Unexpected dependency: ${name}`);
      return mocks[name];
    },
  });
  return evaluatedModule.exports;
}

function fixture() {
  const state = {
    loan: {
      id: 'loan-1', user_id: 'user-1', direction: 'lent', subject_type: 'money',
      counterparty_name: 'Friend', amount: 100, item_name: null,
      item_quantity: null, item_unit: null, occurred_at: '2026-09-07', notes: 'old note',
    },
    repayments: [], beforeTransaction: null, serializationFailure: false,
  };
  function run({ text, values: v }) {
    if (text.startsWith('SELECT * FROM loans')) return [{ ...state.loan }];
    if (text.startsWith('SELECT COUNT(*)')) return [{ cnt: state.repayments.length }];
    if (text.startsWith('SELECT id, subject_type')) return [{ ...state.loan }];
    if (text.startsWith('UPDATE loans SET updated_at = updated_at')) return [];
    if (text.startsWith('UPDATE loans')) {
      assert.match(text, /AND subject_type = \?/);
      assert.match(text, /OR NOT EXISTS \( SELECT 1 FROM loan_repayments WHERE loan_id = \?/);
      if (state.loan.subject_type !== v[14]) return [];
      if (state.loan.subject_type !== v[15] && state.repayments.length > 0) return [];
      const columns = ['direction', 'subject_type', 'counterparty_name', 'amount', 'item_name',
        'item_quantity', 'item_unit', 'occurred_at', 'notes', 'attachment_key',
        'attachment_name', 'attachment_type'];
      columns.forEach((column, i) => { state.loan[column] = v[i]; });
      return [{ ...state.loan }];
    }
    if (text.startsWith('INSERT INTO loan_repayments')) {
      assert.match(text, /FROM loans l WHERE l.id = \? AND l.user_id = \? AND l.subject_type = \?/);
      if (state.loan.subject_type !== v.at(-1)) return [];
      const repayment = { id: v[0], user_id: v[1], loan_id: v[2], repaid_amount: v[3],
        repaid_quantity: v[4], repaid_at: v[5], notes: v[6] };
      state.repayments.push(repayment);
      return [{ ...repayment }];
    }
    throw new Error(`Unexpected SQL: ${text}`);
  }
  function sql(strings, ...values) {
    const query = { text: strings.join('?').replace(/\s+/g, ' ').trim(), values };
    query.then = (resolve, reject) => Promise.resolve().then(() => run(query)).then(resolve, reject);
    return query;
  }
  sql.transaction = async (queries, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    assert.match(queries[0].text, /^UPDATE loans SET updated_at = updated_at WHERE id = \? AND user_id = \?$/);
    const before = state.beforeTransaction;
    state.beforeTransaction = null;
    if (before) await before();
    if (state.serializationFailure) throw Object.assign(new Error('serialization failure'), { code: '40001' });
    return queries.map(run);
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
    '@/lib/db': { sql },
    '@/lib/auth': { getSession: async () => ({ userId: 'user-1' }) },
    '@/lib/loans-schema': { ensureLoansSchema: async () => {} },
    '@/lib/attachments': { validateAttachment: async () => null, deleteOwnedAttachment: async () => assert.fail('Unexpected blob deletion') },
    uuid: { v4: () => `repayment-${state.repayments.length + 1}` },
  };
  const patch = load('app/api/loans/[id]/route.ts', mocks).PATCH;
  const repay = load('app/api/loans/[id]/repayments/route.ts', mocks).POST;
  const call = (handler, body) => handler({ json: async () => body }, { params: Promise.resolve({ id: 'loan-1' }) });
  return { state, patch: body => call(patch, body), repay: body => call(repay, body) };
}
const itemChange = { subject_type: 'item', item_name: 'Book', item_quantity: 1, item_unit: 'copy' };
const payment = { repaid_at: '2026-09-07', repaid_amount: 50 };

test('first repayment committed after the initial count prevents a subject change', async () => {
  const f = fixture();
  f.state.beforeTransaction = async () => assert.equal((await f.repay(payment)).status, 201);
  assert.equal((await f.patch(itemChange)).status, 409);
  assert.equal(f.state.loan.subject_type, 'money');
  assert.equal(f.state.repayments[0].repaid_amount, 50);
});

test('subject change committed after the repayment read prevents an incompatible repayment', async () => {
  const f = fixture();
  f.state.beforeTransaction = async () => assert.equal((await f.patch(itemChange)).status, 200);
  assert.equal((await f.repay(payment)).status, 409);
  assert.equal(f.state.loan.subject_type, 'item');
  assert.equal(f.state.repayments.length, 0);
});

test('same-type edits and partial repayments continue to work', async () => {
  const f = fixture();
  assert.equal((await f.repay(payment)).status, 201);
  assert.equal((await f.patch({ notes: 'updated' })).status, 200);
  assert.equal(f.state.loan.notes, 'updated');
  assert.equal(f.state.repayments[0].repaid_amount, 50);
});

test('serializable conflicts return a retryable response from both writers', async () => {
  const f = fixture();
  f.state.serializationFailure = true;
  assert.equal((await f.patch(itemChange)).status, 409);
  assert.equal((await f.repay(payment)).status, 409);
  assert.equal(f.state.repayments.length, 0);
  assert.equal(f.state.loan.subject_type, 'money');
});

test('both loan forms serialize clearing a note explicitly', async () => {
  const source = fs.readFileSync(path.join(root, 'app/dashboard/loans/page.tsx'), 'utf8');
  const expressions = [...source.matchAll(/notes: (formData\.notes \|\| [^,]+),/g)];
  assert.equal(expressions.length, 2);
  for (const [, expression] of expressions) {
    const notes = vm.runInNewContext(expression, { formData: { notes: '' } });
    const payload = JSON.parse(JSON.stringify({ notes }));
    assert.equal(payload.notes, null);
    const f = fixture();
    assert.equal((await f.patch(payload)).status, 200);
    assert.equal(f.state.loan.notes, null);
  }
});

function migrationFixture({ fail = false } = {}) {
  const state = { marker: false, migrations: 0, fail, items: [], legacy: [{ item_name: 'Old', estimated_value: 10 }] };
  function sql(strings, ...values) {
    const query = { text: strings.join('?').replace(/\s+/g, ' ').trim(), values };
    query.then = (resolve, reject) => Promise.resolve([]).then(resolve, reject);
    return query;
  }
  sql.transaction = async (queries) => {
    assert.match(queries[0].text, /pg_advisory_xact_lock/);
    assert.match(queries[1].text, /CREATE TABLE IF NOT EXISTS ledger_schema_migrations/);
    const migration = queries[2].text;
    assert.match(migration, /IF NOT EXISTS \( SELECT 1 FROM ledger_schema_migrations/);
    assert.match(migration, /WHERE g.items = '\[\]'::jsonb/);
    assert.match(migration, /INSERT INTO ledger_schema_migrations/);
    assert.doesNotMatch(migration, /DROP TABLE/);
    if (!state.marker) {
      if (state.fail) throw new Error('migration failed');
      if (state.items.length === 0) state.items = structuredClone(state.legacy);
      state.marker = true;
      state.migrations++;
    }
    return [[], [], []];
  };
  const ensure = load('lib/gifts-given-schema.ts', { '@/lib/db': { sql } }).ensureGiftsGivenSchema;
  return { state, ensure };
}

test('legacy data migrates once while later edits and intentionally empty items survive', async () => {
  const f = migrationFixture();
  await f.ensure();
  assert.equal(f.state.items[0].estimated_value, 10);
  f.state.items = [{ item_name: 'New', estimated_value: 200 }];
  await f.ensure();
  assert.equal(f.state.items[0].estimated_value, 200);
  f.state.items = [];
  await f.ensure();
  assert.deepEqual(f.state.items, []);
  assert.equal(f.state.migrations, 1);
});

test('migration preserves JSONB data from an earlier partial deployment', async () => {
  const f = migrationFixture();
  f.state.items = [{ item_name: 'Already edited', estimated_value: 200 }];
  await f.ensure();
  assert.equal(f.state.items[0].estimated_value, 200);
});

test('failed migration is not marked complete or silently ignored and can retry', async () => {
  const f = migrationFixture({ fail: true });
  await assert.rejects(f.ensure(), /migration failed/);
  assert.equal(f.state.marker, false);
  assert.deepEqual(f.state.items, []);
  f.state.fail = false;
  await f.ensure();
  assert.equal(f.state.marker, true);
  assert.equal(f.state.items[0].estimated_value, 10);
});

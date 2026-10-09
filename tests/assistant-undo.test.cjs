/* eslint-disable @typescript-eslint/no-require-imports -- isolated authenticated route/SQL fixtures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { NextResponse } = require('next/server');

function load(file, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: id => { const contract = require('./helpers/assistant-contracts.cjs')(id); if (contract) return contract; assert.ok(id in deps, id); return deps[id]; }, Date, JSON, Number, Set, SyntaxError });
  return exports;
}
const helper = load('lib/assistant.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const batchId = id(3), undoId = id(4);
const row = { id: id(5), type: 'expense', amount_cents: 3900, category_id: id(1), member_id: id(2), transaction_date: '2026-10-08', description: '.top域名续费', payment_method: '支付宝/网银', note: '' };
const another = { ...row, id: id(6), description: '另一笔', amount_cents: 1200 };
const request = body => ({ json: async () => body });
const body = (drafts = [row], draft_ids = drafts.map(draft => draft.id)) => ({ batch_id: batchId, undo_id: undoId, drafts, draft_ids });
const requestHash = value => crypto.createHash('sha256').update(JSON.stringify({ batch_id: value.batch_id,
  original_hash: crypto.createHash('sha256').update(JSON.stringify(helper.confirmationRows(value.drafts))).digest('hex'),
  draft_ids: [...value.draft_ids].sort(),
})).digest('hex');

function routes({ session = { userId: 'owner' }, result = [], error, sql: suppliedSql, schema = false } = {}) {
  const queries = [], transactions = [];
  const sql = suppliedSql || ((strings, ...values) => { const query = { text: strings.map((part, i) => part + (i < values.length ? `$${i + 1}` : '')).join(''), values }; queries.push(query); return query; });
  if (!suppliedSql) sql.transaction = async (statements, options) => { transactions.push({ statements, options }); if (error) throw error; return statements.map(() => result); };
  const ensure = schema ? load('lib/assistant-schema.ts', { '@/lib/db': { sql } }).ensureAssistantSchema : async () => {};
  const deps = { 'next/server': { NextResponse }, 'node:crypto': crypto,
    '@/lib/auth': { getSession: async () => session }, '@/lib/db': { sql }, '@/lib/assistant': helper,
    '@/lib/assistant-schema': { ensureAssistantSchema: ensure } };
  return { undo: load('app/api/assistant/undo/route.ts', deps), confirm: load('app/api/assistant/confirm/route.ts', deps), queries, transactions, ensure };
}

test('undo authenticates before parsing and rejects malformed or foreign draft targets before SQL', async () => {
  const unauthorized = routes({ session: null });
  assert.equal((await unauthorized.undo.POST({ json: () => assert.fail('auth first') })).status, 401);
  assert.equal(unauthorized.queries.length, 0);
  for (const patch of [{ batch_id: 'bad' }, { undo_id: 'bad' }, { drafts: [] }, { drafts: [{ ...row, amount_cents: 0 }] },
    { draft_ids: [] }, { draft_ids: [id(99)] }, { draft_ids: [row.id, row.id] }, { drafts: [row, row] }]) {
    const f = routes(); const response = await f.undo.POST(request({ ...body(), ...patch }));
    assert.equal(response.status, 400); assert.equal((await response.json()).notUndone, true);
    assert.equal(f.transactions.length + f.queries.length, 0);
  }
});

test('undo returns the persisted restoration receipt and same fresh draft IDs on replay', async () => {
  const restored = [{ ...row, id: id(9) }];
  for (const replayed of [false, true]) {
    const f = routes({ result: [{ payload_hash: requestHash(body()), restored_batch_id: id(10), drafts: restored, undone_draft_ids: [row.id], replayed }] });
    const response = await f.undo.POST(request(body()));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { batch_id: id(10), drafts: restored, undone_draft_ids: [row.id], replayed });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const statement = f.transactions[0].statements[0];
    assert.equal(f.transactions[0].options.isolationLevel, 'Serializable');
    assert.match(statement.text, /FOR UPDATE OF t/);
    assert.match(statement.text, /DELETE FROM transactions t USING targets target,eligible e/);
    assert.match(statement.text, /undone_draft_ids=b.undone_draft_ids/);
    assert.match(statement.text, /INSERT INTO assistant_undos/);
    assert.ok(statement.values.includes('owner'));
    assert.ok(!statement.text.includes('DELETE FROM assistant_batches'));
  }
});

test('definite undo conflicts never claim success; reused undo IDs reject changed targets', async () => {
  for (const reason of ['missing', 'snapshot', 'legacy_partial', 'target', 'changed']) {
    const f = routes({ result: [{ reason }] }); const response = await f.undo.POST(request(body()));
    assert.equal(response.status, reason === 'missing' ? 404 : 409); assert.equal((await response.json()).notUndone, true);
  }
  const reused = routes({ result: [{ payload_hash: 'another-request', restored_batch_id: id(10), drafts: [], undone_draft_ids: [], replayed: true }] });
  const response = await reused.undo.POST(request(body()));
  assert.equal(response.status, 409); assert.equal((await response.json()).undoConflict, true);
});

test('ambiguous undo failures retain the retry key while malformed JSON is definitely unsaved', async () => {
  for (const code of ['40001', '23505', '08006']) {
    const f = routes({ error: Object.assign(new Error('fixture'), { code }) });
    const response = await f.undo.POST(request(body())); const payload = await response.json();
    assert.equal(response.status, code === '08006' ? 500 : 409); assert.equal(payload.notUndone, undefined);
  }
  const response = await routes().undo.POST({ json: async () => { throw new SyntaxError('malformed'); } });
  assert.equal(response.status, 400); assert.equal((await response.json()).notUndone, true);
});

test('confirmation refuses revoked batch replays and persists original draft-to-transaction mappings', async () => {
  const hash = crypto.createHash('sha256').update(JSON.stringify(helper.confirmationRows([row]))).digest('hex');
  const f = routes({ result: [{ payload_hash: hash, transaction_ids: [id(8)], revoked_at: '2026-10-08', created: false }] });
  const response = await f.confirm.POST(request({ batch_id: batchId, drafts: [row] }));
  assert.equal(response.status, 409); const payload = await response.json();
  assert.equal(payload.batchRevoked, true); assert.equal(payload.notSaved, true);
  const statement = f.transactions[0].statements[2];
  assert.match(statement.text, /draft_snapshot,draft_transactions/);
  assert.ok(statement.values.some(value => typeof value === 'string' && value.includes('"draft_id"') && value.includes('"transaction_id"')));
  assert.ok(statement.values.some(value => typeof value === 'string' && value.includes(row.description) && value.includes('"note"')));
});

// Optionally exercise the exact production SQL against an isolated PostgreSQL
// engine. No DATABASE_URL or account data is read; the fixture is discarded.
if (process.env.LEDGER_UNDO_PGLITE_MODULE) {
  const { PGlite } = require(process.env.LEDGER_UNDO_PGLITE_MODULE);
  async function databaseFixture(t, { legacy = false } = {}) {
    const db = new PGlite(); t.after(() => db.close());
    await db.exec(`CREATE TABLE users(id VARCHAR(36) PRIMARY KEY);
      CREATE TABLE categories(id VARCHAR(36) PRIMARY KEY,user_id VARCHAR(36),type TEXT);
      CREATE TABLE members(id VARCHAR(36) PRIMARY KEY,user_id VARCHAR(36));
      CREATE TABLE transactions(id VARCHAR(36) PRIMARY KEY,user_id VARCHAR(36),type TEXT,amount NUMERIC,
        category_id VARCHAR(36),member_id VARCHAR(36),transaction_date TIMESTAMP,description TEXT,
        attachment_key TEXT,attachment_name TEXT,attachment_type TEXT,created_at TIMESTAMP,updated_at TIMESTAMP);
      INSERT INTO users VALUES ('owner'),('foreign');
      INSERT INTO categories VALUES ('${id(1)}','owner','expense'); INSERT INTO members VALUES ('${id(2)}','owner');`);
    if (legacy) await db.exec(`CREATE TABLE assistant_batches(user_id VARCHAR(36) REFERENCES users(id),id VARCHAR(36),payload_hash TEXT,
      transaction_ids JSONB,created_at TIMESTAMP DEFAULT NOW(),PRIMARY KEY(user_id,id));`);
    const sql = (strings, ...values) => {
      const text = strings.map((part, index) => part + (index < values.length ? `$${index + 1}` : '')).join('');
      return { text, values, then(resolve, reject) { return db.query(text, values).then(result => result.rows).then(resolve, reject); } };
    };
    sql.transaction = (statements, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return db.transaction(async tx => { await tx.exec('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
        const results = []; for (const statement of statements) results.push((await tx.query(statement.text, statement.values)).rows); return results;
      });
    };
    return { db, ...routes({ sql, schema: true }) };
  }

  test('real PostgreSQL: confirm → undo → recover receipt → reconfirm writes exactly one new record', async t => {
    const f = await databaseFixture(t);
    const confirmed = await f.confirm.POST(request({ batch_id: batchId, drafts: [row] }));
    assert.equal(confirmed.status, 200, JSON.stringify(await confirmed.clone().json()));
    const originalIds = (await confirmed.json()).ids;
    await f.db.query("UPDATE transactions SET transaction_date=transaction_date+interval '1 hour'");
    assert.equal((await f.undo.POST(request(body()))).status, 409);
    await f.db.query("UPDATE transactions SET transaction_date=transaction_date-interval '1 hour',updated_at=updated_at+interval '1 second'");
    assert.equal((await f.undo.POST(request(body()))).status, 409);
    await f.db.query('UPDATE transactions SET updated_at=created_at');
    const response = await f.undo.POST(request(body())); assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const restored = await response.json(); assert.notEqual(restored.batch_id, batchId); assert.notEqual(restored.drafts[0].id, row.id);
    assert.equal(restored.drafts[0].payment_method, row.payment_method); assert.equal(restored.drafts[0].description, row.description);
    assert.equal((await f.db.query('SELECT * FROM transactions')).rows.length, 0);
    const retry = await f.undo.POST(request(body())); assert.deepEqual(await retry.json(), { ...restored, replayed: true });
    const tombstone = await f.confirm.POST(request({ batch_id: batchId, drafts: [row] })); assert.equal(tombstone.status, 409);
    assert.equal((await tombstone.json()).batchRevoked, true);
    const fresh = await f.confirm.POST(request({ batch_id: restored.batch_id, drafts: restored.drafts })); assert.equal(fresh.status, 200);
    const again = await f.confirm.POST(request({ batch_id: restored.batch_id, drafts: restored.drafts })); assert.equal((await again.json()).replayed, true);
    const records = (await f.db.query('SELECT * FROM transactions')).rows;
    assert.equal(records.length, 1); assert.ok(!originalIds.includes(records[0].id));
  });

  test('real PostgreSQL: whitespace-only payment fields round-trip their canonical saved description', async t => {
    const f = await databaseFixture(t); const draft = { ...row, payment_method: ' ' };
    assert.equal((await f.confirm.POST(request({ batch_id: batchId, drafts: [draft] }))).status, 200);
    const undone = await f.undo.POST(request(body([draft]))); assert.equal(undone.status, 200);
    const restored = await undone.json(); assert.deepEqual(JSON.parse(JSON.stringify(helper.confirmationRows(restored.drafts))), JSON.parse(JSON.stringify(helper.confirmationRows([draft]))));
  });

  test('real PostgreSQL: partial undo preserves other rows and rejects changed records atomically', async t => {
    const f = await databaseFixture(t);
    assert.equal((await f.confirm.POST(request({ batch_id: batchId, drafts: [row, another] }))).status, 200);
    const mapping = (await f.db.query('SELECT draft_transactions FROM assistant_batches')).rows[0].draft_transactions;
    const secondTransaction = mapping.find(entry => entry.draft_id === another.id).transaction_id;
    await f.db.query('UPDATE transactions SET amount=99 WHERE id=$1', [secondTransaction]);
    const conflict = await f.undo.POST(request(body([row, another]))); assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).notUndone, true);
    assert.equal((await f.db.query('SELECT * FROM transactions')).rows.length, 2);
    const partial = await f.undo.POST(request(body([row, another], [row.id]))); assert.equal(partial.status, 200, JSON.stringify(await partial.clone().json()));
    assert.equal((await partial.json()).drafts.length, 1);
    assert.equal((await f.db.query('SELECT * FROM transactions')).rows[0].id, secondTransaction);
    const duplicate = await f.undo.POST(request({ ...body([row, another], [row.id]), undo_id: id(44) })); assert.equal(duplicate.status, 409);
    const reused = await f.undo.POST(request(body([row, another], [another.id]))); assert.equal(reused.status, 409);
    assert.equal((await reused.json()).undoConflict, true);
    await f.db.query('UPDATE transactions SET amount=12 WHERE id=$1', [secondTransaction]);
    const remaining = await f.undo.POST(request({ ...body([row, another], [another.id]), undo_id: id(45) }));
    assert.equal(remaining.status, 200, JSON.stringify(await remaining.clone().json()));
    assert.equal((await remaining.json()).drafts[0].description, another.description);
    assert.equal((await f.db.query('SELECT * FROM transactions')).rows.length, 0);
  });

  test('real PostgreSQL: ownership, snapshot tampering, attachments and removed rows prevent deletion', async t => {
    const f = await databaseFixture(t);
    assert.equal((await f.confirm.POST(request({ batch_id: batchId, drafts: [row, another] }))).status, 200);
    const foreign = routes({ session: { userId: 'foreign' }, sql: (() => {
      const sql = (strings, ...values) => ({ text: strings.map((part, i) => part + (i < values.length ? `$${i + 1}` : '')).join(''), values,
        then(resolve, reject) { return f.db.query(this.text, this.values).then(result => result.rows).then(resolve, reject); } });
      sql.transaction = statements => f.db.transaction(async tx => { const results=[]; for (const statement of statements) results.push((await tx.query(statement.text,statement.values)).rows); return results; }); return sql;
    })(), schema: true });
    const other = await foreign.undo.POST(request(body([row, another]))); assert.equal(other.status, 404);
    const tampered = await f.undo.POST(request(body([{ ...row, amount_cents: 1 }, another]))); assert.equal(tampered.status, 409);
    await f.db.query('UPDATE transactions SET attachment_key=$1 WHERE description LIKE $2', ['owner/image.png', another.description + '%']);
    const attachment = await f.undo.POST(request(body([row, another]))); assert.equal(attachment.status, 409);
    assert.equal((await f.db.query('SELECT * FROM transactions')).rows.length, 2);
    await f.db.query('DELETE FROM transactions WHERE attachment_key IS NOT NULL');
    const removed = await f.undo.POST(request(body([row, another]))); assert.equal(removed.status, 409);
    assert.equal((await f.db.query('SELECT * FROM transactions')).rows.length, 1);
    assert.equal((await f.db.query('SELECT * FROM assistant_undos')).rows.length, 0);
  });

  test('real PostgreSQL: additive legacy migration allows whole-batch undo with duplicate-row multiset checks', async t => {
    const f = await databaseFixture(t, { legacy: true }); await f.ensure();
    const duplicate = { ...row, id: another.id };
    const rows = helper.confirmationRows([row, duplicate]); const hash = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    await f.db.query('INSERT INTO assistant_batches(user_id,id,payload_hash,transaction_ids) VALUES ($1,$2,$3,$4)', ['owner',batchId,hash,JSON.stringify([id(20),id(21)])]);
    for (const trxId of [id(20), id(21)]) await f.db.query(`INSERT INTO transactions(id,user_id,type,amount,category_id,member_id,transaction_date,description)
      VALUES ($1,'owner',$2,$3,$4,$5,$6,$7)`, [trxId,rows[0].type,rows[0].amount_cents/100,rows[0].category_id,rows[0].member_id,rows[0].transaction_date,rows[0].description]);
    const partial = await f.undo.POST(request(body([row, duplicate], [row.id]))); assert.equal(partial.status, 409);
    assert.match((await partial.json()).error, /旧版/);
    await f.db.query('UPDATE transactions SET amount=40 WHERE id=$1', [id(21)]);
    assert.equal((await f.undo.POST(request(body([row, duplicate])))).status, 409);
    assert.equal((await f.db.query('SELECT * FROM transactions')).rows.length, 2);
    await f.db.query('UPDATE transactions SET amount=39 WHERE id=$1', [id(21)]);
    const whole = await f.undo.POST(request(body([row, duplicate]))); assert.equal(whole.status, 200, JSON.stringify(await whole.clone().json()));
    assert.equal((await whole.json()).drafts.length, 2); assert.equal((await f.db.query('SELECT * FROM transactions')).rows.length, 0);
  });
}

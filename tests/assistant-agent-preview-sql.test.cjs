/* eslint-disable @typescript-eslint/no-require-imports -- disposable SQL preview/replay tests, never account data. */
const test = require('node:test');
const assert = require('node:assert/strict');
const createFixture = require('./helpers/ledger-sql-fixture.cjs');
const modulePath = process.env.LEDGER_TASKS_PGLITE_MODULE;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fingerprint = 'a'.repeat(64);
const plain = value => JSON.parse(JSON.stringify(value));
const filter = { keyword: null, start_date: null, end_date: null, type: null, category_id: null, member_id: null, status: null, amount_min: null, amount_max: null };
async function attachTask(f, approvalId, taskId = id(1)) {
  await f.load('lib/assistant-task-schema.ts').ensureAssistantTaskSchema();
  await f.db.query('INSERT INTO assistant_task_conversations(user_id,id) VALUES($1,$2) ON CONFLICT DO NOTHING', ['owner', id(2)]);
  await f.db.query(`INSERT INTO assistant_tasks(user_id,id,conversation_id,user_message_id,request_hash,display_input,status,phase,agent_checkpoint)
    VALUES($1,$2,$3,$4,'test','{}'::jsonb,'succeeded','thinking',$5::jsonb)`, ['owner', taskId, id(2), id(9), JSON.stringify({ status: 'waiting_approval', pending_approval: { action_id: approvalId } })]);
}

test('SQL: preview response loss reuses original IDs/snapshot and isolates users and goals', { skip: !modulePath }, async t => {
  const f = await createFixture(modulePath); t.after(() => f.close());
  const server = f.load('lib/assistant-command-server.ts');
  const signal = new AbortController().signal;
  let calls = 0;
  const work = async () => {
    calls++;
    return server.saveAssistantApproval('owner', id(2), { command: { operation: 'create' }, items: [{ id: id(5), before: null, values: { title: '原始' } }] }, '新增便利贴', 1);
  };
  const first = await server.prepareAssistantAgentPreview('owner', id(2), id(1), fingerprint, signal, work);
  const replay = await server.prepareAssistantAgentPreview('owner', id(2), id(1), fingerprint, signal, () => assert.fail('must reuse original preview'));
  assert.deepEqual(plain(replay), plain(first));
  assert.equal(calls, 1);
  assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM assistant_actions')).rows[0].count, 1);
  const other = await server.prepareAssistantAgentPreview('foreign', id(2), id(1), fingerprint, signal, () => server.saveAssistantApproval('foreign', id(2), { items: [] }, '另一账户', 0));
  assert.notEqual(other.approval.id, first.approval.id);
  const nextGoal = await server.prepareAssistantAgentPreview('owner', id(2), id(6), fingerprint, signal, work);
  assert.notEqual(nextGoal.approval.id, first.approval.id);
});

test('SQL: orphan/stopped/cleared agent previews cannot be approved or regenerated after cancellation', { skip: !modulePath }, async t => {
  const f = await createFixture(modulePath); t.after(() => f.close());
  await f.load('lib/assistant-task-schema.ts').ensureAssistantTaskSchema();
  const server = f.load('lib/assistant-command-server.ts');
  const preview = await server.prepareAssistantAgentPreview('owner', id(2), id(1), fingerprint, new AbortController().signal,
    () => server.saveAssistantApproval('owner', id(2), { command: { resource: 'notes', operation: 'create' }, items: [{ id: id(5), before: null, values: { content: '不得写入' } }], dependencies: [] }, '新增便利贴'));
  await assert.rejects(server.decideAssistantAction('owner', preview.approval.id, 'approve'), /任务已停止或尚未准备完成/);
  assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM notes')).rows[0].count, 0);
  await server.decideAssistantAction('owner', preview.approval.id, 'cancel');
  await assert.rejects(server.prepareAssistantAgentPreview('owner', id(2), id(1), fingerprint, new AbortController().signal, () => assert.fail('no replay')));
  await f.db.query('INSERT INTO assistant_task_conversations(user_id,id,cleared_at) VALUES($1,$2,NOW())', ['owner', id(2)]);
  await assert.rejects(server.prepareAssistantAgentPreview('owner', id(2), id(1), 'b'.repeat(64), new AbortController().signal, () => assert.fail('cleared')),
    /对话已清空/);
});

test('SQL: approved create and update return actual IDs and readback verifies intended field values', { skip: !modulePath }, async t => {
  const f = await createFixture(modulePath); t.after(() => f.close());
  const server = f.load('lib/assistant-command-server.ts');
  const command = { resource: 'notes', operation: 'create', scope: 'one', ids: [], parent_id: null, parent_name: null, filter, values_json: '{"title":"原始","content":"测试内容"}' };
  const preview = await server.prepareAssistantAgentPreview('owner', id(2), id(1), fingerprint, new AbortController().signal,
    () => server.prepareLedgerCommand('owner', id(2), command));
  await attachTask(f, preview.approval.id);
  const saved = await server.decideAssistantAction('owner', preview.approval.id, 'approve');
  assert.equal(saved.status, 'succeeded', saved.text);
  assert.equal(saved.targets.length, 1);
  assert.equal(saved.targets[0].ids.length, 1);
  const actualId = saved.targets[0].ids[0];
  assert.equal((await server.readAssistantAgentTargets('owner', saved.targets, saved.id)).verified, true);
  await f.db.query('UPDATE notes SET title=$1 WHERE user_id=$2 AND id=$3', ['后来改过', 'owner', actualId]);
  assert.equal((await server.readAssistantAgentTargets('owner', saved.targets, saved.id)).verified, false, 'existence alone cannot prove original fields');
  assert.equal((await server.readAssistantAgentTargets('foreign', saved.targets, saved.id)).verified, false);
  await assert.rejects(server.readAssistantAgentTargets('owner', [{ resource: '__proto__', operation: 'update', ids: [actualId] }]), /核对范围无效/);
});

test('SQL: clear between preflight and claim prevents dispatch at the atomic approval boundary', { skip: !modulePath }, async t => {
  const f = await createFixture(modulePath); t.after(() => f.close());
  const server = f.load('lib/assistant-command-server.ts');
  const command = { resource: 'notes', operation: 'create', scope: 'one', ids: [], parent_id: null, parent_name: null, filter, values_json: '{"content":"不应保存"}' };
  const preview = await server.prepareAssistantAgentPreview('owner', id(2), id(1), fingerprint, new AbortController().signal,
    () => server.prepareLedgerCommand('owner', id(2), command));
  await attachTask(f, preview.approval.id);
  const transaction = f.sql.transaction;
  f.sql.transaction = async statements => {
    await f.db.query('UPDATE assistant_task_conversations SET cleared_at=NOW() WHERE user_id=$1 AND id=$2', ['owner', id(2)]);
    return transaction(statements);
  };
  const result = await server.decideAssistantAction('owner', preview.approval.id, 'approve');
  assert.equal(result.status, 'cancelled');
  assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM notes')).rows[0].count, 0);
});

test('SQL: a linked gift receipt verifies both independent cash amounts and refuses a stopped task', { skip: !modulePath }, async t => {
  const f = await createFixture(modulePath); t.after(() => f.close());
  const server = f.load('lib/assistant-command-server.ts');
  const events = f.load('lib/ledger-event-server.ts');
  await f.db.query('INSERT INTO members(id,user_id,name) VALUES($1,$2,$3)', [id(7), 'owner', '我']);
  const input = { operation: 'create', kind: 'gift_given', counterparty: '大伯', amount_cents: 50000, date: '2026-10-09', cashflow: 'new',
    member_id: id(7), transaction_amount_cents: 60000, payment_recipient: '妈', items: [{ item_name: '泡子', quantity: 1, unit: '封', estimated_value: 50 }] };
  const preview = await server.prepareAssistantAgentPreview('owner', id(2), id(1), fingerprint, new AbortController().signal,
    () => events.prepareLedgerEvent('owner', id(2), input));
  await attachTask(f, preview.approval.id);
  const receipt = await server.decideAssistantAction('owner', preview.approval.id, 'approve');
  assert.equal(receipt.status, 'succeeded', receipt.text);
  assert.equal(receipt.targets.length, 2);
  const verification = await server.readAssistantAgentTargets('owner', receipt.targets, receipt.id);
  assert.equal(verification.verified, true);
  const cashId = receipt.targets.find(target => target.resource === 'transactions').ids[0];
  await f.db.query('UPDATE transactions SET amount=700 WHERE user_id=$1 AND id=$2', ['owner', cashId]);
  assert.equal((await server.readAssistantAgentTargets('owner', receipt.targets, receipt.id)).verified, false);

  const next = await server.prepareAssistantAgentPreview('owner', id(2), id(6), 'b'.repeat(64), new AbortController().signal,
    () => events.prepareLedgerEvent('owner', id(2), { ...input, counterparty: '二伯' }));
  await attachTask(f, next.approval.id, id(6));
  const transaction = f.sql.transaction;
  f.sql.transaction = async statements => {
    await f.db.query("UPDATE assistant_tasks SET status='cancelled' WHERE user_id=$1 AND id=$2", ['owner', id(6)]);
    return transaction(statements);
  };
  const stopped = await server.decideAssistantAction('owner', next.approval.id, 'approve');
  assert.notEqual(stopped.status, 'succeeded');
  assert.equal((await f.db.query("SELECT COUNT(*)::int AS count FROM given_gifts WHERE user_id='owner'")).rows[0].count, 1);
});

test('SQL: reorder verification detects a later wrong order even while all category IDs still exist', { skip: !modulePath }, async t => {
  const f = await createFixture(modulePath); t.after(() => f.close());
  const server = f.load('lib/assistant-command-server.ts');
  await f.db.query("INSERT INTO categories(id,user_id,name,type) VALUES($1,'owner','餐饮','expense'),($2,'owner','交通','expense')", [id(7), id(8)]);
  const command = { resource: 'categories', operation: 'reorder', scope: 'all', ids: [id(8), id(7)], parent_id: null, parent_name: null, filter: { ...filter, type: 'expense' }, values_json: '{}' };
  const plan = await server.prepareAssistantAgentPreview('owner', id(2), id(1), fingerprint, new AbortController().signal,
    () => server.prepareLedgerCommand('owner', id(2), command));
  await attachTask(f, plan.approval.id);
  const receipt = await server.decideAssistantAction('owner', plan.approval.id, 'approve');
  assert.equal(receipt.status, 'succeeded', receipt.text);
  assert.equal((await server.readAssistantAgentTargets('owner', receipt.targets, receipt.id)).verified, true);
  await f.db.query('UPDATE categories SET sort_order=10 WHERE user_id=$1 AND id=$2', ['owner', id(8)]);
  assert.equal((await server.readAssistantAgentTargets('owner', receipt.targets, receipt.id)).verified, false);
});

test('SQL: undo of reused loan cashflow verifies restoration of the original statistics scope', { skip: !modulePath }, async t => {
  const f = await createFixture(modulePath); t.after(() => f.close());
  const server = f.load('lib/assistant-command-server.ts'), events = f.load('lib/ledger-event-server.ts');
  await f.db.query("INSERT INTO members(id,user_id,name) VALUES($1,'owner','我')", [id(7)]);
  await f.db.query("INSERT INTO transactions(id,user_id,type,amount,transaction_date,member_id) VALUES($1,'owner','income',500,'2026-10-09',$2)", [id(8), id(7)]);
  const plan = await server.prepareAssistantAgentPreview('owner', id(2), id(1), fingerprint, new AbortController().signal,
    () => events.prepareLedgerEvent('owner', id(2), { operation: 'create', kind: 'loan_borrowed', counterparty: '小王', amount_cents: 50000, date: '2026-10-09', cashflow: 'existing', transaction_id: id(8) }));
  await attachTask(f, plan.approval.id);
  const saved = await server.decideAssistantAction('owner', plan.approval.id, 'approve');
  assert.equal(saved.status, 'succeeded', saved.text);
  const undo = await server.prepareAssistantAgentPreview('owner', id(2), id(6), 'b'.repeat(64), new AbortController().signal,
    () => events.prepareLedgerEvent('owner', id(2), { operation: 'undo', event_id: saved.event_context.event_id }));
  await attachTask(f, undo.approval.id, id(6));
  const receipt = await server.decideAssistantAction('owner', undo.approval.id, 'approve');
  assert.equal(receipt.status, 'succeeded', receipt.text);
  assert.equal((await server.readAssistantAgentTargets('owner', receipt.targets, receipt.id)).verified, true);
  await f.db.query("UPDATE transactions SET flow_kind='loan' WHERE user_id='owner' AND id=$1", [id(8)]);
  assert.equal((await server.readAssistantAgentTargets('owner', receipt.targets, receipt.id)).verified, false);
});

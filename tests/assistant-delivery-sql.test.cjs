/* eslint-disable @typescript-eslint/no-require-imports -- fenced delivery receipts in disposable PostgreSQL. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./helpers/ledger-sql-fixture.cjs');
const modulePath = process.env.LEDGER_TASKS_PGLITE_MODULE;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function setup(t, reply, action = 'edit') {
  const f = await fixture(modulePath); t.after(f.close);
  await f.load('lib/assistant-task-schema.ts').ensureAssistantTaskSchema();
  const plan = { action, reply, drafts: [], query: null, edit: action === 'edit' ? { batch_id: id(6), edits: [{ draft_id: id(7), description: '修改后' }] } : undefined };
  const checkpoint = { version: 1, goal_id: id(1), goal: '修改草稿', status: 'needs_input', steps: 1, messages: [], tool_results: [],
    pending_approval: null, preview_fingerprints: [], awaiting_delivery: true, output_id: id(4), current_operation_id: 'edit', pending_plan: plan,
    operations: [{ id: 'edit', label: '修改草稿', action: 'edit', effect: 'local', depends_on: [], status: 'needs_input' }],
    outputs: [{ id: id(4), user_message_id: id(3), input: { message: '修改草稿', display_text: '修改草稿', display_images: [] }, plan, attempt: 1 }] };
  const input = { message: '修改草稿', today: '2026-10-12', history: [], images: [], draft_batch: null, saved_batch: null };
  await f.db.query(`INSERT INTO assistant_tasks(user_id,id,conversation_id,user_message_id,request_hash,payload,display_input,status,phase,result,agent_checkpoint)
    VALUES('owner',$1,$2,$3,'initial',$4::jsonb,$5::jsonb,'succeeded','thinking',$6::jsonb,$7::jsonb)`,
  [id(1), id(2), id(3), JSON.stringify(input), JSON.stringify(checkpoint.outputs[0].input), JSON.stringify(plan), JSON.stringify(checkpoint)]);
  const request = ok => ({ id: id(1), conversation_id: id(2), user_message_id: id(3), message: '继续原任务', display_text: '继续原任务', today: '2026-10-12',
    continuation: { kind: 'delivery', attempt: 1, output_id: id(4), ok } });
  return { ...f, api: f.load('lib/assistant-tasks.ts'), request,
    async stored() { return (await f.db.query('SELECT attempt,agent_checkpoint FROM assistant_tasks WHERE id=$1', [id(1)])).rows[0]; } };
}

test('SQL delivery success and failure persist actual state despite contradictory reply wording and replay only once', { skip: !modulePath }, async t => {
  for (const ok of [true, false]) await t.test(String(ok), async t => {
    const f = await setup(t, ok ? '失败，本次未修改' : '已经成功了');
    await f.api.createAssistantTask('owner', f.request(ok));
    const stored = await f.stored(), receipt = stored.agent_checkpoint.tool_results.find(tool => tool.name === 'delivery_result');
    assert.equal(receipt.result.status, ok ? 'succeeded' : 'failed');
    assert.equal(stored.agent_checkpoint.operations[0].status, ok ? 'completed' : 'needs_input');
    assert.equal(receipt.result.text, ok ? '已修改待确认草稿，尚未入账。' : '页面操作未完成，请核对原卡片。');
    await f.api.createAssistantTask('owner', f.request(!ok));
    const replay = await f.stored();
    assert.equal(replay.attempt, stored.attempt);
    assert.equal(replay.agent_checkpoint.tool_results.filter(tool => tool.name === 'delivery_result').length, 1);
    assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 0);
  });
});

test('SQL delivery cannot promote a chat output or an unrelated output ID into a completed page action', { skip: !modulePath }, async t => {
  const f = await setup(t, '已修改', 'chat');
  await assert.rejects(f.api.createAssistantTask('owner', f.request(true)), /不属于待处理的页面操作/);
  const request = f.request(true); request.continuation.output_id = id(99);
  await assert.rejects(f.api.createAssistantTask('owner', request), /不等待此回答/);
  const stored = await f.stored();
  assert.equal(stored.attempt, 1);
  assert.equal(stored.agent_checkpoint.operations[0].status, 'needs_input');
  assert.equal(stored.agent_checkpoint.tool_results.length, 0);
});

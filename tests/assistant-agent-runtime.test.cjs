/* eslint-disable @typescript-eslint/no-require-imports -- isolated bounded runtime contract. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsRuntime = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/assistant-agent-runtime.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: exportsRuntime, require, structuredClone, AbortSignal, Date, Set, Map, Error });
const { runAssistantAgent } = exportsRuntime;
const ID = '00000000-0000-4000-8000-000000000001';
const ACTION = '00000000-0000-4000-8000-000000000002';
const query = extra => ({ start_date: '2026-10-01', end_date: '2026-10-09', type: null, category_id: null, member_id: null, keyword: null, ...extra });
const command = (operation = 'list', extra = {}) => ({ resource: 'transactions', operation, scope: 'all', ids: [], parent_id: null, parent_name: null,
  filter: { keyword: null, start_date: null, end_date: null, type: null, category_id: null, member_id: null, status: null, amount_min: null, amount_max: null }, values_json: '{}', ...extra });
const choose = (kind, tool, args) => ({ kind, tool, arguments_json: JSON.stringify(args), plan_json: null, needs_input: false });
const respond = (reply, extra = {}) => ({ kind: 'respond', tool: null, arguments_json: '{}', plan_json: JSON.stringify({ action: 'chat', reply, drafts: [], query: null, ...extra }), needs_input: false });
function fixture(steps, extras = {}) {
  const calls = [], checkpoints = [];
  const adapters = {
    chooseStep: async (messages, signal) => { signal.throwIfAborted(); calls.push(['model', structuredClone(messages)]); const next = steps.shift(); return typeof next === 'function' ? next(messages) : next; },
    validatePlan: plan => { if (plan.action === 'query' && plan.query.start_date === 'invalid') throw new Error('bad date'); return plan; },
    validateCommand: c => c, validateEvent: e => e,
    query: async q => { calls.push(['query', q]); return { facts: { summary: { income: '0.00', expense: '21.30', count: 3 } }, reply_view: { title: '真实统计' } }; },
    command: async (c, _signal, fingerprint) => { calls.push(['command', c, fingerprint]); return c.operation === 'list' ? { reply: '找到1条', record_context: { resource: 'transactions', rows: [{ id: ID, amount: '21.30' }] } } : { reply: '待确认，尚未执行', approval: { id: ACTION, summary: '修改', count: 1, expires_at: null } }; },
    event: async e => { calls.push(['event', e]); return { reply: '待确认', approval: { id: ACTION, summary: '事件', count: 1, expires_at: null } }; },
    ...extras.adapters,
  };
  return { calls, checkpoints, run: opts => runAssistantAgent({ goalId: ID, goal: '核对并整理账本', messages: [{ role: 'user', content: '本次目标' }], signal: new AbortController().signal,
    onCheckpoint: c => checkpoints.push(c), ...extras, adapters, ...opts }) };
}

test('model chooses successive reads from observed facts and final view uses actual query results', async () => {
  const f = fixture([choose('read', 'query', query()), messages => { assert.match(messages.at(-1).content, /21.30/); return choose('read', 'query', query({ start_date: '2026-09-01', end_date: '2026-09-30' })); }, respond('两个月的支出都为21.30元。')]);
  const result = await f.run();
  assert.equal(f.calls.filter(c => c[0] === 'query').length, 2);
  assert.equal(result.agent.status, 'completed'); assert.equal(result.agent.steps, 3); assert.equal(result.reply_view.title, '真实统计');
});

test('query validation blocks database access and feeds concrete error to the next model decision', async () => {
  const f = fixture([choose('read', 'query', query({ start_date: 'invalid' })), messages => { assert.match(messages.at(-1).content, /bad date/); return respond('请补充日期。'); }]);
  await f.run(); assert.equal(f.calls.filter(c => c[0] === 'query').length, 0);
});

test('write preview is prepared once and durable checkpoint precedes returning approval', async () => {
  const f = fixture([choose('read', 'records', command()), choose('preview', 'command', command('update', { ids: [ID], values_json: '{"amount":30}' }))]);
  const plan = await f.run(); const c = f.checkpoints.at(-1);
  assert.equal(plan.agent.status, 'waiting_approval'); assert.equal(c.pending_approval.action_id, ACTION);
  assert.equal(f.calls.filter(c => c[0] === 'command').length, 2); assert.match(c.pending_approval.fingerprint, /^[a-f0-9]{64}$/);
  const waiting = fixture([]); await waiting.run({ checkpoint: c }); assert.equal(waiting.calls.length, 0);
});

test('verified approval receipt resumes the same goal and requires a fresh read before completion', async () => {
  const first = fixture([choose('preview', 'command', command('create', { resource: 'notes', values_json: '{"content":"明天保养"}' }))]); await first.run();
  const resumed = fixture([respond('已完成。'), choose('read', 'records', command('list', { resource: 'notes' })), respond('已核对便利贴。')]);
  const result = await resumed.run({ checkpoint: first.checkpoints.at(-1), approvalOutcome: { id: ACTION, status: 'succeeded', text: '已创建便利贴。' } });
  assert.equal(result.agent.goal_id, ID); assert.equal(result.agent.steps, 4);
  assert.equal(resumed.calls.filter(c => c[0] === 'command').length, 1);
  assert.equal(resumed.checkpoints.at(-1).tool_results.some(r => r.name === 'validation_error' && r.result.message.includes('读取')), true);
});

test('cancellation receipt stops without provider calls or replacement previews', async () => {
  const first = fixture([choose('preview', 'command', command('delete'))]); await first.run();
  const cancelled = fixture([]); const plan = await cancelled.run({ checkpoint: first.checkpoints.at(-1), approvalOutcome: { id: ACTION, status: 'cancelled', text: '操作已取消。' } });
  assert.equal(plan.agent.status, 'stopped'); assert.equal(cancelled.calls.length, 0);
});

test('explicit IDs require actual current-account read results and successful previews cannot repeat', async () => {
  const bad = fixture([choose('preview', 'command', command('update', { ids: [ID], values_json: '{"amount":30}' })), respond('请先查询。')]); await bad.run();
  assert.equal(bad.calls.filter(c => c[0] === 'command').length, 0);
  const first = fixture([choose('preview', 'command', command('create', { resource: 'notes', values_json: '{"title":"A","content":"B"}' }))]); await first.run();
  const again = fixture([choose('read', 'records', command('list', { resource: 'notes' })), choose('preview', 'command', command('create', { resource: 'notes', values_json: '{"content":"B","title":"A"}' }))]);
  const plan = await again.run({ checkpoint: first.checkpoints.at(-1), approvalOutcome: { id: ACTION, status: 'succeeded', text: '创建成功。' } });
  assert.match(plan.reply, /不会重复/); assert.equal(again.calls.filter(c => c[0] === 'command').length, 1);
});

test('read tool cannot invoke a write and aborted model cannot reach tool execution', async () => {
  const illegal = fixture([choose('read', 'records', command('delete')), respond('需要确认方案。')]); await illegal.run(); assert.equal(illegal.calls.filter(c => c[0] === 'command').length, 0);
  const abort = new AbortController(); const f = fixture([() => { abort.abort(); return choose('read', 'query', query()); }]);
  await assert.rejects(f.run({ signal: abort.signal }), error => error.name === 'AbortError'); assert.equal(f.calls.filter(c => c[0] === 'query').length, 0);
});

test('bounded steps stop repeated reads without fabricating completion or writing', async () => {
  const f = fixture(Array(10).fill(choose('read', 'query', query()))); const result = await f.run({ maxSteps: 2 });
  assert.equal(result.agent.steps, 2); assert.equal(result.agent.status, 'needs_input'); assert.match(result.reply, /步骤上限/);
});

test('model success claims without an execution receipt are replaced and tool output stays bounded', async () => {
  const f = fixture([choose('read', 'records', command()), respond('已删除全部记录。'), respond('已删除全部记录。')], { adapters: { command: async () => ({ reply: 'X'.repeat(30000), record_context: { resource: 'notes', rows: [{ content: 'x'.repeat(30000) }] } }) } });
  const result = await f.run(); assert.match(result.reply, /尚未执行/);
  assert.equal(f.checkpoints.at(-1).tool_results[0].result.limited, true); assert.ok(JSON.stringify(f.checkpoints.at(-1)).length < 160000);
});

test('record drafts pause and durable batch receipt permits continuation after actual confirmation', async () => {
  const f = fixture([respond('请核对账单。', { action: 'record', drafts: [{ id: ACTION, amount_cents: 100 }] })]); const result = await f.run();
  assert.equal(result.agent.status, 'waiting_approval'); assert.deepEqual(f.checkpoints.at(-1).pending_batch.draft_ids, [ACTION]);
  const continued = fixture([choose('read', 'query', query()), respond('已核对本月统计。')]);
  const final = await continued.run({ checkpoint: f.checkpoints.at(-1), approvalOutcome: { id: ID, status: 'succeeded', text: '已入账1笔。' } });
  assert.equal(final.agent.goal_id, ID); assert.equal(final.agent.status, 'completed'); assert.equal(continued.checkpoints.at(-1).pending_batch, undefined);
});

test('pending draft retry returns exact generated IDs and card values without another provider call', async () => {
  const first = fixture([respond('请确认', { action: 'record', drafts: [{ id: ACTION, type: 'expense', amount_cents: 2130, description: '早餐' }] })]); const result = await first.run();
  const reloaded = fixture([]); const restored = await reloaded.run({ checkpoint: first.checkpoints.at(-1) });
  assert.equal(JSON.stringify(restored.drafts), JSON.stringify(result.drafts)); assert.equal(restored.agent.pending_batch_id, ID); assert.equal(reloaded.calls.length, 0);
});

test('saved draft normalization can register only server-mapped transaction IDs for fast correction', async () => {
  const f = fixture([choose('preview', 'command', command('update', { ids: [ACTION], values_json: '{"amount":80}' }))], { adapters: {
    trustedIds: () => [ID], validatePlan: p => ({ ...p, command: { ...p.command, ids: [ID] } }),
  } });
  const result = await f.run(); assert.equal(result.approval.id, ACTION); assert.deepEqual(f.calls.find(c => c[0] === 'command')[1].ids, [ID]);
});

test('server execution targets trigger exact readback before any further model decision', async () => {
  const first = fixture([choose('preview', 'command', command('create', { resource: 'notes', values_json: '{"content":"明天保养"}' }))]); await first.run();
  const order = [];
  const resumed = fixture([() => { order.push('model'); return respond('已核对记录。'); }], { adapters: { verifyTargets: async targets => { order.push('verify'); assert.equal(targets[0].ids[0], ID); return { verified: true, records: [{ ...targets[0], rows: [{ id: ID, content: '明天保养' }] }] }; } } });
  const result = await resumed.run({ checkpoint: first.checkpoints.at(-1), approvalOutcome: { id: ACTION, status: 'succeeded', text: '已创建便利贴。', targets: [{ resource: 'notes', operation: 'create', ids: [ID] }] } });
  assert.deepEqual(order, ['verify', 'model']); assert.equal(result.agent.status, 'completed');
});

test('failed target readback never allows arbitrary summaries to mark the goal complete', async () => {
  const first = fixture([choose('preview', 'command', command('delete'))]); await first.run();
  const resumed = fixture([], { adapters: { verifyTargets: async targets => ({ verified: false, records: [{ ...targets[0], rows: [{ id: ID }] }] }) } });
  const result = await resumed.run({ checkpoint: first.checkpoints.at(-1), approvalOutcome: { id: ACTION, status: 'succeeded', text: '已删除。', targets: [{ resource: 'transactions', operation: 'delete', ids: [ID] }] } });
  assert.equal(result.agent.status, 'needs_input'); assert.equal(resumed.calls.length, 0);
});

test('cross-query monetary differences use integer cents and retain each filter scope', async () => {
  const f = fixture([choose('read', 'query', query({ member_id: 'member-a' })), choose('read', 'query', query({ member_id: 'member-b' })), respond('差额0.20元。')], { adapters: {
    query: async q => ({ filters: q, facts: { summary: { income: '0.00', expense: q.member_id === 'member-a' ? '0.10' : '0.30', balance: q.member_id === 'member-a' ? '-0.10' : '-0.30' } } }),
  } });
  await f.run(); const comparison = f.checkpoints.at(-1).tool_results.find(r => r.name === 'query_comparison').result;
  assert.equal(comparison.difference_yuan.expense, '0.20'); assert.equal(comparison.difference_yuan.balance, '-0.20');
  assert.equal(comparison.current_filters.member_id, 'member-b'); assert.equal(comparison.previous_filters.member_id, 'member-a');
});

test('a target reader error leaves needs_input without a model completion or another write', async () => {
  const first = fixture([choose('preview', 'command', command('delete'))]); await first.run();
  const resumed = fixture([], { adapters: { verifyTargets: async () => { throw new Error('network unavailable'); } } });
  const result = await resumed.run({ checkpoint: first.checkpoints.at(-1), approvalOutcome: { id: ACTION, status: 'succeeded', text: '已删除。', targets: [{ resource: 'transactions', operation: 'delete', ids: [ID] }] } });
  assert.equal(result.agent.status, 'needs_input'); assert.equal(resumed.calls.length, 0);
  assert.equal(resumed.checkpoints.at(-1).tool_results.at(-1).name, 'verification_error');
});

const schemaExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/assistant-agent-schema.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: schemaExports, require, JSON });
const stepValidation = schemaExports.ASSISTANT_AGENT_STEP_SCHEMA.validate;

test('step schema discards only unused bounded plan commentary on recognized read or preview tools', async () => {
  for (const [kind, tool] of [['read', 'query'], ['read', 'records'], ['preview', 'command'], ['preview', 'event']]) {
    const output = { ...choose(kind, tool, {}), plan_json: '{"goal":"ignored","steps":["never execute"]}' };
    const validated = await stepValidation(output);
    assert.equal(validated.success, true); assert.equal(validated.value.plan_json, null); assert.equal(validated.value.arguments_json, '{}');
  }
  for (const output of [
    { ...choose('read', 'query', {}), tool: 'shell', plan_json: '{}' },
    { ...choose('read', 'query', {}), kind: 'execute', plan_json: '{}' },
    { ...choose('preview', 'command', {}), tool: 'query', plan_json: '{}' },
    { ...choose('read', 'query', {}), plan_json: {} },
    { ...choose('read', 'query', {}), plan_json: 'x'.repeat(24001) },
    { ...respond('hello'), plan_json: null },
    { ...respond('hello'), tool: 'command' },
    { ...choose('read', 'query', {}), sql: 'SELECT *' },
  ]) assert.equal((await stepValidation(output)).success, false);
});

const core = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/assistant.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: core, Error, Date, JSON, require: require('./helpers/assistant-contracts.cjs') });
const strictPlan = raw => core.validatePlan(raw, [], [], () => ACTION);

test('query loop fills only omitted nullable filters and keeps supplied dates, types and references strict', async () => {
  const minimal = { scope: 'daily', type: 'expense', start_date: '2026-09-01', end_date: '2026-09-30' };
  const f = fixture([choose('read', 'query', minimal), respond('汇总完成。')], { adapters: { validatePlan: strictPlan } });
  await f.run(); const actual = f.calls.find(c => c[0] === 'query')[1];
  assert.equal(actual.category_id, null); assert.equal(actual.member_id, null); assert.equal(actual.keyword, null);
  for (const extra of [{ start_date: '2026-02-30' }, { type: 'transfer' }, { type: undefined }, { category_id: ID }, { member_id: 1 }, { keyword: {} }, { scope: 'admin' }, { sql: 'SELECT * FROM users' }]) {
    const rejected = fixture([choose('read', 'query', { ...minimal, ...extra }), respond('请重新指定条件。')], { adapters: { validatePlan: strictPlan } });
    await rejected.run(); assert.equal(rejected.calls.filter(c => c[0] === 'query').length, 0);
  }
});

test('a confirmed ordinary batch cannot be reused for another new record batch in the same goal', async () => {
  const first = fixture([respond('请核对', { action: 'record', drafts: [{ id: ACTION, amount_cents: 100 }] })]); await first.run();
  const resumed = fixture([choose('read', 'query', query()), respond('还有一笔', { action: 'record', drafts: [{ id: ID, amount_cents: 200 }] })]);
  const result = await resumed.run({ checkpoint: first.checkpoints.at(-1), approvalOutcome: { id: ID, status: 'succeeded', text: '已入账1笔。' } });
  assert.equal(result.action, 'chat'); assert.equal(result.agent.status, 'needs_input'); assert.equal(result.drafts.length, 0);
  assert.match(result.reply, /新的请求/); assert.equal(resumed.checkpoints.at(-1).pending_batch, undefined);
});

test('capabilities, saved-record scope and conditional instructions are preserved without any ledger operation', async () => {
  const replies = [
    '我是账本助手，可以帮你完成收支记录、修改账目。',
    '我支持创建、修改和删除账目。',
    '账单整理：修改已保存记录的金额、日期、分类，或检查疑似重复账单。',
    '可以查询已保存的账目，也能核对已入账的记录。',
    '确认后，我会完成删除操作。',
    '如果删除成功，页面会显示结果。',
    '删除完成后可以刷新查看。',
    '尚未完成删除，需要先确认。',
  ];
  for (const reply of replies) {
    const f = fixture([respond(reply)]);
    const result = await f.run({ goal: '你可以做什么？' });
    assert.equal(result.reply, reply);
    assert.equal(result.agent.status, 'completed');
    assert.equal(f.calls.filter(call => call[0] !== 'model').length, 0);
  }
});

test('capability words elsewhere never exempt concrete unsupported completion claims', async () => {
  const replies = [
    '已删除全部账目。',
    '修改已完成。',
    '我已经帮你保存了三笔。',
    '可以帮你查询，但已删除全部账目。',
    '可以查询账目。已成功修改金额。',
    '**已删除全部账目**，也可以继续查询。',
    '可以帮你完成收支记录；账目已经删除。',
    '我可以查询账目并已经删除全部记录。',
    '我可以查询账目并删除成功。已经保存三笔。',
    '创建成功，可以继续查询。',
  ];
  for (const reply of replies) {
    const f = fixture([respond(reply), messages => {
      assert.match(messages.at(-1).content, /没有对应的结构化草稿/);
      return respond(reply);
    }]);
    const result = await f.run({ goal: '你可以做什么？' });
    assert.match(result.reply, /尚未执行账本更改/, reply);
    assert.equal(result.agent.status, 'needs_input');
    assert.equal(f.calls.filter(call => call[0] === 'model').length, 2);
  }
});

test('a verified receipt bounds success claims even when the reply also describes capabilities', async () => {
  const first = fixture([choose('preview', 'command', command('create', { resource: 'notes', values_json: '{"content":"测试提醒"}' }))]);
  await first.run();
  const receipt = { id: ACTION, status: 'succeeded', text: '已创建1条便利贴。', targets: [{ resource: 'notes', operation: 'create', ids: [ID] }] };
  const resumed = fixture([respond('可以继续查询。已删除全部账目。')], { adapters: {
    verifyTargets: async targets => ({ verified: true, records: targets.map(target => ({ ...target, rows: [{ id: ID, content: '测试提醒' }] })) }),
  } });
  const result = await resumed.run({ checkpoint: first.checkpoints.at(-1), approvalOutcome: receipt });
  assert.equal(result.reply, receipt.text);
  assert.doesNotMatch(result.reply, /删除全部/);
});

test('an unsupported chat claim after add-another is repaired into a distinct pending draft without writing', async () => {
  const draft = { id: ACTION, type: 'expense', amount_cents: 2000, description: '吃饭', transaction_date: '2026-10-09',
    category_id: null, member_id: null, payment_method: null, note: '' };
  const f = fixture([respond('已为你新增一笔吃饭20元。'), messages => {
    const feedback = JSON.parse(messages.at(-1).content.slice(messages.at(-1).content.indexOf('：') + 1));
    assert.equal(feedback.writes_executed, false);
    assert.match(feedback.message, /新增普通收支用record/);
    return respond('请核对这笔新的吃饭草稿，尚未入账。', { action: 'record', drafts: [draft] });
  }]);
  const result = await f.run({ goal: '新增一笔', messages: [
    { role: 'user', content: '吃饭20' },
    { role: 'assistant', content: '已有同额草稿，这是重复发送还是另外一笔？' },
    { role: 'user', content: '新增一笔' },
  ] });
  assert.equal(result.action, 'record');
  assert.equal(result.drafts[0].amount_cents, 2000);
  assert.equal(result.agent.status, 'waiting_approval');
  assert.deepEqual(f.checkpoints.at(-1).pending_batch.draft_ids, [ACTION]);
  assert.equal(f.calls.filter(call => call[0] !== 'model').length, 0);
});

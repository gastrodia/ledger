/* eslint-disable @typescript-eslint/no-require-imports -- isolated bounded runtime contract. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const workflow = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/assistant-workflow.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: workflow, require, Set, Map, Error });
const stepContract = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/assistant-agent-step.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: stepContract, require, Set, Error });
const eventClarification = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/assistant-event-clarification.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:eventClarification,require:name=>name==='@/lib/ledger-event'?{validateLedgerEvent:input=>input}:require(name),Error,JSON});
const exportsRuntime = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/assistant-agent-runtime.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: exportsRuntime, require: name => name === '@/lib/assistant-workflow' ? workflow : name === '@/lib/assistant-agent-step' ? stepContract : name === '@/lib/assistant-event-clarification' ? eventClarification : require(name), structuredClone, AbortSignal, Date, Set, Map, Error });
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

test('draft matching reads current context, persists evidence, and replaces an earlier aggregate view', async () => {
  let reads = 0;
  const f = fixture([choose('read', 'query', query()), choose('read', 'draft_matches', {}), messages => {
    assert.match(messages.at(-1).content, /draft_matches/);
    assert.match(messages.at(-1).content, /possible_match/);
    return respond('早餐有一条疑似匹配，请核对。');
  }], { adapters: { draftMatches: async signal => {
    signal.throwIfAborted(); reads++;
    return { reply_view: { title: '重复入账核对' }, rows: [{ draft_id: ACTION, status: 'possible_match', candidates: [{ id: ID, amount_cents: 2130 }] }] };
  } } });
  const result = await f.run();
  assert.equal(reads, 1);
  assert.equal(result.reply_view.title, '重复入账核对');
  assert.equal(result.agent.status, 'completed');
  assert.equal(result.agent.tool_calls, 2);
  assert.equal(result.drafts.length, 0);
  assert.equal(f.checkpoints.at(-1).pending_approval, null);
});

test('draft matching rejects caller-specified records and cannot be used as a preview tool', async () => {
  let reads = 0;
  const f = fixture([choose('read', 'draft_matches', { user_id: 'foreign', drafts: [] }), respond('请核对当前草稿。')],
    { adapters: { draftMatches: async () => { reads++; return {}; } } });
  await f.run();
  assert.equal(reads, 0);
  assert.match(f.checkpoints.at(-1).tool_results[0].result.message, /参数必须/);
  const illegal = fixture([choose('preview', 'draft_matches', {})]);
  await assert.rejects(illegal.run(), /允许范围/);
});

test('failed draft reads do not become evidence that there are no saved matches', async () => {
  const f = fixture([choose('read', 'draft_matches', {}), messages => {
    assert.match(messages.at(-1).content, /connection failed/);
    return respond('暂时无法核对，请稍后重试。');
  }], { adapters: { draftMatches: async () => { throw new Error('connection failed'); } } });
  const result = await f.run();
  assert.equal(f.checkpoints.at(-1).tool_results.some(r => r.name === 'draft_matches'), false);
  assert.equal(result.reply_view, undefined);
});

test('provider reply-format failure preserves the completed draft read using only its server summary', async () => {
  const serverReply = '逐笔核对结果：早餐，疑似重复；午餐，未找到同日同金额流水。没有更改账本。';
  const f = fixture([choose('read', 'draft_matches', {}), () => { throw Object.assign(new Error('bad model JSON'), { code: 'invalid_output' }); }],
    { adapters: { draftMatches: async () => ({ reply: serverReply, reply_view: { title: '重复入账核对' }, rows: [] }) } });
  const result = await f.run();
  assert.equal(result.reply, serverReply);
  assert.equal(result.action, 'chat');
  assert.equal(result.reply_view.title, '重复入账核对');
  assert.equal(result.agent.status, 'needs_input', 'a malformed next step cannot prove a compound goal is completed');
  assert.equal(result.approval, undefined);
  assert.equal(result.drafts.length, 0);
  const failedRead = fixture([choose('read', 'draft_matches', {}), () => { throw Object.assign(new Error('bad model JSON'), { code: 'invalid_output' }); }],
    { adapters: { draftMatches: async () => { throw new Error('DB unavailable'); } } });
  await assert.rejects(failedRead.run(), /bad model JSON/);
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
  assert.equal(result.agent.status, 'interrupted'); assert.equal(result.agent.awaiting_answer,undefined); assert.equal(resumed.calls.length, 0);
});

test('cross-query monetary differences use integer cents and retain each filter scope', async () => {
  const f = fixture([choose('read', 'query', query({ member_id: 'member-a' })), choose('read', 'query', query({ member_id: 'member-b' })), respond('差额0.20元。')], { adapters: {
    query: async q => ({ filters: q, facts: { summary: { income: '0.00', expense: q.member_id === 'member-a' ? '0.10' : '0.30', balance: q.member_id === 'member-a' ? '-0.10' : '-0.30' } } }),
  } });
  await f.run(); const comparison = f.checkpoints.at(-1).tool_results.find(r => r.name === 'query_comparison').result;
  assert.equal(comparison.difference_yuan.expense, '0.20'); assert.equal(comparison.difference_yuan.balance, '-0.20');
  assert.equal(comparison.current_filters.member_id, 'member-b'); assert.equal(comparison.previous_filters.member_id, 'member-a');
});

test('a target reader error leaves an interruption without a model completion or another write', async () => {
  const first = fixture([choose('preview', 'command', command('delete'))]); await first.run();
  const resumed = fixture([], { adapters: { verifyTargets: async () => { throw new Error('network unavailable'); } } });
  const result = await resumed.run({ checkpoint: first.checkpoints.at(-1), approvalOutcome: { id: ACTION, status: 'succeeded', text: '已删除。', targets: [{ resource: 'transactions', operation: 'delete', ids: [ID] }] } });
  assert.equal(result.agent.status, 'interrupted'); assert.equal(result.agent.awaiting_answer,undefined); assert.equal(resumed.calls.length, 0);
  assert.equal(resumed.checkpoints.at(-1).tool_results.at(-1).name, 'verification_error');
});

const schemaExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/assistant-agent-schema.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: schemaExports, require: name => name === '@/lib/assistant-agent-step' ? stepContract : name === '@/lib/assistant-event-clarification' ? eventClarification : require(name), JSON });
const stepValidation = schemaExports.ASSISTANT_AGENT_STEP_SCHEMA.validate;

test('step schema discards only unused bounded plan commentary on recognized read or preview tools', async () => {
  for (const [kind, tool] of [['plan', null], ['reuse', null], ['read', 'query'], ['read', 'records'], ['read', 'draft_matches'], ['preview', 'command'], ['preview', 'event']]) {
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

test('omitted conversational status defaults without relaxing plan fields or tool permissions', async () => {
  for (const output of [choose('read', 'draft_matches', {}), respond('逐笔核对结果如下。')]) {
    delete output.needs_input;
    const result = await stepValidation(output);
    assert.equal(result.success, true);
    assert.equal(result.value.needs_input, false);
  }
  assert.equal((await stepValidation({ ...respond('核对结果'), needs_input: 'false' })).success, false);
  const missingPlan = respond('核对结果'); delete missingPlan.plan_json;
  assert.equal((await stepValidation(missingPlan)).success, false);
  assert.equal((await stepValidation({ ...choose('preview', 'draft_matches', {}), needs_input: undefined })).success, false);
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
    '3. **修改与删除已入账记录**：对已经保存的账单进行更正或删除（需你确认）。',
    '7. **修改与管理**：调整已保存记录的分类、成员、金额，或删除错误记录。',
    '支持修正已经入账的交易，也可以更正已保存收支的金额。',
    '对已入账交易进行更正，需要先核对具体目标。',
    '针对已保存账单准备修改预览，核对后再执行。',
    '可以帮你查询已保存支出和已入账收入。',
    '更正已成功入账的交易，或查询已完成保存的账单。',
    '零食很忙疑似重复，存在一笔描述、日期、金额完全相同的已入账记录。',
    '匹配到一条已保存账单，请核对是否是同一交易。',
    '在已入账记录中找到了同日期、同金额的疑似重复项。',
    '已核对当前待确认草稿与已入账记录，结果如下。',
    '未找到已入账记录，请核对日期和金额。',
    '零食很忙：疑似已入账，存在同日期、同金额、同描述的记录。',

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
    '可以调整已保存记录的分类。已删除昨天的吃饭记录。',
    '对已入账交易进行更正。已经帮你保存三笔。',
    '修改已保存记录的金额，已成功更新全部账目。',
    '已保存账单。',
    '已新增分类。',
    '已成功新增分类。',
    '查询已保存记录，并已删除账单。',
    '存在一笔相同的已入账记录。已删除重复账单。',
    '零食很忙疑似已入账。已删除重复账单。',

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

const agenda = operations => ({...choose('plan', null, { operations }),operation_id:null});
const item = (id, action, depends_on = [], effect = ['query','chat'].includes(action) ? 'read' : ['edit','update','remove','navigate'].includes(action) ? 'local' : 'write') => ({ id, label: `${id} 原文事项`, action, effect, depends_on });
const forItem = (id, step) => ({ ...step, operation_id: id });
const recordStep = id => forItem(id, respond('核对后入账', { action: 'record', drafts: [{ id: ACTION, type: 'expense', amount_cents: 390, description: '早餐' }] }));

test('compound agenda keeps record, gift and later query through two verified approvals without replay', async () => {
  const first = fixture([agenda([item('breakfast','record'),item('gift','event'),item('summary','query',['breakfast','gift'])]),recordStep('breakfast')]);
  const breakfast = await first.run(); let checkpoint = first.checkpoints.at(-1);
  assert.equal(breakfast.agent.operations.length, 3);
  assert.equal(checkpoint.pending_batch.batch_id, breakfast.agent.output_id);
  assert.notEqual(checkpoint.pending_batch.batch_id, ID);
  const second = fixture([forItem('gift', choose('preview','event',{ kind:'gift_given', amount_cents:50000 }))], { adapters: { verifyTargets: async () => ({ verified:true,records:[] }) } });
  const gift = await second.run({ checkpoint, approvalOutcome:{ id:checkpoint.pending_batch.batch_id,status:'succeeded',text:'已核实早餐入账',targets:[{resource:'transactions',operation:'create',ids:[ID]}] } });
  checkpoint = second.checkpoints.at(-1);
  assert.equal(gift.agent.operations[0].status,'completed'); assert.equal(gift.agent.operations[1].status,'waiting_approval'); assert.equal(gift.agent.operations[2].status,'pending');
  assert.notEqual(gift.agent.output_id,breakfast.agent.output_id);
  assert.equal(checkpoint.outputs[0].receipt.status,'succeeded');
  const final = fixture([forItem('summary',choose('read','query',query())),forItem('summary',respond('按真实账本核对统计'))], { adapters:{verifyTargets:async()=>({verified:true,records:[]})} });
  const result = await final.run({checkpoint,approvalOutcome:{id:ACTION,status:'succeeded',text:'送礼已保存',targets:[{resource:'gifts_given',operation:'create',ids:[ID]}]}});
  assert.equal(result.agent.status,'completed'); assert.ok(result.agent.operations.every(op=>op.status==='completed'));
  assert.equal(final.calls.filter(call=>['event','command'].includes(call[0])).length,0);
  assert.equal(final.checkpoints.at(-1).outputs.length,3);
});

test('clarification pauses original item and retains all untouched operations; a chat cannot complete a write', async () => {
  const f = fixture([agenda([item('gift','event'),item('loan','event'),item('notes','manage')]),{...forItem('gift',respond('鞋子的200元是购入付款还是估值？')),needs_input:true}]);
  const result = await f.run(); const checkpoint = f.checkpoints.at(-1);
  assert.equal(result.agent.status,'needs_input'); assert.equal(result.agent.awaiting_answer,true);
  assert.deepEqual(checkpoint.operations.map(op=>op.status),['needs_input','pending','pending']);
  assert.equal(f.calls.filter(call=>['command','event'].includes(call[0])).length,0);
  const resumed = structuredClone(checkpoint); resumed.awaiting_answer=false; resumed.operations[0].status='pending'; resumed.messages.push({role:'user',content:'是估值，没有新买鞋'});
  const next = fixture([forItem('gift',choose('preview','event',{kind:'gift_given',amount_cents:50000,items:[{item_name:'鞋子',estimated_value:200}]}))]);
  const preview = await next.run({checkpoint:resumed});
  assert.equal(preview.agent.goal_id,ID); assert.equal(preview.agent.operations.length,3);
  assert.equal(preview.agent.operations[1].status,'pending');
});

test('dependency and completed-item guards reject unsafe model steps before adapters are called', async () => {
  const f = fixture([agenda([item('create','manage'),item('record','record',['create'])]),recordStep('record'),{...forItem('create',respond('请先确认成员名字',{ })),needs_input:true},]);
  const result = await f.run();
  assert.equal(result.agent.operations[1].status,'pending');
  assert.ok(f.checkpoints.at(-1).tool_results.some(call=>call.name==='validation_error'&& /前置/.test(call.result.message)));
  const checkpoint = structuredClone(f.checkpoints.at(-1)); checkpoint.operations[0].status='completed'; checkpoint.awaiting_answer=false;
  const next = fixture([forItem('create',choose('preview','command',command('create',{resource:'members'}))),recordStep('record')]);
  await next.run({checkpoint}); assert.equal(next.calls.filter(call=>call[0]==='command').length,0);
});

test('independent equal-value operations have distinct preview fingerprints and receipts', async () => {
  const event = {kind:'gift_given',counterparty:'小美',amount_cents:50000};
  const fingerprints=[];
  const adapters={ event:async (_e,_signal,fp)=>{fingerprints.push(fp);return {approval:{id:ACTION,summary:'送礼',count:1},reply:'待确认'};},verifyTargets:async()=>({verified:true,records:[]})};
  const first=fixture([agenda([item('first','event'),item('second','event')]),forItem('first',choose('preview','event',event))],{adapters}); await first.run();
  const next=fixture([forItem('second',choose('preview','event',event))],{adapters});
  await next.run({checkpoint:first.checkpoints.at(-1),approvalOutcome:{id:ACTION,status:'succeeded',text:'第一件完成',targets:[{resource:'gifts_given',operation:'create',ids:[ID]}]}});
  assert.equal(fingerprints.length,2);assert.notEqual(fingerprints[0],fingerprints[1]);
});

test('cycles, duplicate IDs and missing dependencies cannot install an agenda', () => {
  for(const operations of [[item('a','record',['b']),item('b','event',['a'])],[item('a','record'),item('a','event')],[item('a','event',['missing'])]]) assert.throws(()=>workflow.validateWorkflow(operations));
});

test('one reviewed record batch explicitly covers distinct agenda IDs without deleting their dependencies', async()=>{
  const records=recordStep('breakfast');records.covered_operation_ids=['breakfast','metro'];
  const raw=JSON.parse(records.plan_json);raw.drafts.push({...raw.drafts[0],id:ID,description:'地铁',amount_cents:296});records.plan_json=JSON.stringify(raw);
  const f=fixture([agenda([item('breakfast','record'),item('metro','record'),item('sum','query',['breakfast','metro'])]),records]);
  const result=await f.run();assert.equal(result.agent.operations.length,3);
  assert.deepEqual(result.agent.operations.map(op=>op.status),['waiting_approval','waiting_approval','pending']);
  assert.deepEqual(result.agent.operations[2].depends_on,['breakfast','metro']);
  assert.deepEqual(f.checkpoints.at(-1).pending_operation_ids,['breakfast','metro']);
});

test('literal source coverage binds every grouped row even when the model omitted the second agenda ID', async()=>{
  const records=recordStep('breakfast');
  const raw=JSON.parse(records.plan_json);raw.drafts.push({...raw.drafts[0],id:ID,description:'地铁',amount_cents:296});records.plan_json=JSON.stringify(raw);
  const f=fixture([agenda([{...item('breakfast','record'),sources:['早餐3.9']},{...item('metro','record'),sources:['地铁2.96']},item('gift','event')]),records]);
  const result=await f.run();
  assert.deepEqual(result.agent.operations.map(op=>op.status),['waiting_approval','waiting_approval','pending']);
  assert.deepEqual(f.checkpoints.at(-1).pending_operation_ids,['breakfast','metro']);
});

test('coverage reconciliation never guesses between repeated sources, approximate names, or failed receipts',()=>{
  const operations=[{...item('one','record'),sources:['地铁2.96'],status:'pending'},{...item('two','record'),sources:['地铁2.96'],status:'pending'}];
  assert.deepEqual(workflow.matchingRecordOperations(operations,[{description:'地铁',amount_cents:296}]),[]);
  assert.deepEqual(workflow.matchingRecordOperations([operations[0]],[{description:'公交',amount_cents:296}]),[]);
  assert.deepEqual(workflow.matchingRecordOperations([operations[0]],[{description:'地铁',amount_cents:300}]),[]);
  workflow.reconcileRecordWorkflowReceipts([operations[0]],[{id:ACTION,plan:{action:'record',drafts:[{description:'地铁',amount_cents:296}]},receipt:{id:ACTION,status:'failed'}}]);
  assert.equal(operations[0].status,'pending');
});

test('persisted questions stop even a model preview and preserve its unanswered original agenda',async()=>{
  const f=fixture([agenda([{...item('gift','event'),questions:['实际购买还是估值？']},item('query','query',['gift'])]),forItem('gift',choose('preview','event',{kind:'gift_given',amount_cents:50000}))]);
  const result=await f.run();assert.equal(result.agent.awaiting_answer,true);assert.equal(result.reply,'实际购买还是估值？');
  assert.equal(f.calls.filter(call=>call[0]==='event').length,0);assert.equal(result.agent.operations[1].status,'pending');
});

test('a final answer settles only the sole read item with successful evidence, never an unexecuted write',async()=>{
  const f=fixture([agenda([item('query','query')]),forItem('query',choose('read','query',query())),respond('根据实际查询统计')]);
  const result=await f.run();assert.equal(result.agent.status,'completed');assert.equal(result.agent.operations[0].status,'completed');
});

test('new production goals cannot execute their first action before the full agenda is saved',async()=>{
  const f=fixture([recordStep('op'),agenda([{...item('op','record'),sources:['核对并整理账本']}]),recordStep('op')]);
  const result=await f.run({requireWorkflow:true});
  assert.equal(result.agent.operations.length,1);assert.equal(f.checkpoints.at(-1).outputs.length,1);
  assert.ok(f.checkpoints.at(-1).tool_results.some(tool=>tool.name==='validation_error'&& /完整任务清单/.test(tool.result.message)));
});

test('failed batch receipts retain the original draft output and every unexecuted tail operation',async()=>{
  const f=fixture([agenda([item('record','record'),item('event','event')]),recordStep('record')]);await f.run();
  const checkpoint=f.checkpoints.at(-1),batchId=checkpoint.pending_batch.batch_id;
  const failed=fixture([]);const result=await failed.run({checkpoint,approvalOutcome:{id:batchId,status:'failed',completed:0,text:'保存未完成'}});
  const stored=failed.checkpoints.at(-1);assert.equal(result.agent.status,'stopped');assert.equal(stored.outputs[0].plan.action,'record');
  assert.equal(stored.outputs[0].plan.drafts[0].id,ACTION);assert.equal(stored.operations[1].status,'pending');assert.equal(failed.calls.length,0);
});

test('production workflow schema requires explicit operation references while legacy outputs remain readable', async()=>{
  const exportsSchema={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/assistant-agent-schema.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsSchema,require:name=>name==='@/lib/assistant-agent-step'?stepContract:require(name),Error,JSON,Set});
  const old=respond('普通答复');
  assert.equal((await exportsSchema.ASSISTANT_AGENT_STEP_SCHEMA.validate(old)).success,true);
  assert.equal((await exportsSchema.ASSISTANT_AGENT_WORKFLOW_STEP_SCHEMA.validate(old)).success,false);
  assert.equal((await exportsSchema.ASSISTANT_AGENT_WORKFLOW_STEP_SCHEMA.validate({...old,operation_id:null})).success,true);
});

test('cross-item identical drafts pause for clarification and can reuse a verified prior receipt without another batch',async()=>{
  const first=fixture([agenda([item('first','record'),item('second','record')]),recordStep('first')]);await first.run();
  const initial=first.checkpoints.at(-1),source=initial.output_id;
  const duplicate=fixture([recordStep('second')],{adapters:{verifyTargets:async()=>({verified:true,records:[]})}});
  const question=await duplicate.run({checkpoint:initial,approvalOutcome:{id:initial.pending_batch.batch_id,status:'succeeded',text:'第一笔已入账',targets:[{resource:'transactions',operation:'create',ids:[ID]}]}});
  assert.equal(question.agent.awaiting_answer,true);assert.match(question.reply,/同一笔/);
  const checkpoint=duplicate.checkpoints.at(-1);assert.equal(checkpoint.pending_batch,undefined);assert.equal(checkpoint.operations[1].status,'needs_input');
  checkpoint.duplicate_review.answered=true;checkpoint.awaiting_answer=false;checkpoint.operations[1].status='pending';checkpoint.messages.push({role:'user',content:'是同一笔'});
  const reused=fixture([forItem('second',choose('reuse',null,{source_output_id:source}))],{adapters:{verifyTargets:async()=>({verified:true,records:[]})}});
  const result=await reused.run({checkpoint});assert.equal(result.agent.status,'completed');assert.equal(result.agent.operations[1].receipt_id,initial.pending_batch.batch_id);
  assert.equal(reused.calls.filter(call=>['event','command'].includes(call[0])).length,0);
});

test('current-request coverage rejects omitted text and operations copied from historical goals',()=>{
  assert.throws(()=>workflow.assertWorkflowCoverage([{...item('a','record'),sources:['早餐3.9']}],'早餐3.9，保存后查本月支出'),/未覆盖/);
  assert.throws(()=>workflow.assertWorkflowCoverage([{...item('a','update'),sources:['这两笔支出人都选本人']},{...item('b','event'),sources:['小美生日送礼500']}],'这两笔支出人都选本人'),/不在当前请求/);
  assert.doesNotThrow(()=>workflow.assertWorkflowCoverage([{...item('a','record'),sources:['早餐3.9']},{...item('b','query'),sources:['保存后查本月支出']}],'早餐3.9，保存后查本月支出'));
});

test('clarified business type can refine a pending item without changing completed work or dropping its tail',async()=>{
 const f=fixture([agenda([item('a','query'),item('transfer','event')]),forItem('a',choose('read','query',query())),forItem('a',respond('查询完成'))]);await f.run();
 const checkpoint=f.checkpoints.at(-1);checkpoint.awaiting_delivery=false;
 const question=fixture([forItem('transfer',{...respond('转账是消费还是借还？'),needs_input:true})]);await question.run({checkpoint});
 const clarified=question.checkpoints.at(-1);clarified.awaiting_answer=false;delete clarified.pending_plan;clarified.operations[1].status='pending';clarified.messages.push({role:'user',content:'是生活费消费500元'});
 const data={...recordStep('transfer'),plan_json:JSON.stringify({action:'record',reply:'核对生活费',query:null,drafts:[{id:ACTION,type:'expense',amount_cents:50000,description:'生活费',transaction_date:'2026-10-10'}]})};
 const next=fixture([agenda([item('a','query'),{...item('transfer','record'),label:'生活费消费500元'}]),data]);
 const result=await next.run({checkpoint:clarified});assert.equal(result.agent.operations[0].status,'completed');assert.equal(result.agent.operations[1].action,'record');assert.equal(result.agent.pending_batch_id,next.checkpoints.at(-1).pending_batch.batch_id);
});

test('agenda refinement cannot remove unfinished items or rewrite completed operations',async()=>{
 const base=fixture([agenda([item('a','query'),item('b','event')]),forItem('a',choose('read','query',query())),forItem('a',respond('查询完成'))]);await base.run();
 const checkpoint=base.checkpoints.at(-1);checkpoint.awaiting_delivery=false;
 const f=fixture([agenda([item('b','event')]),agenda([{...item('a','query'),label:'改写已经执行的查询'},item('b','event')]),forItem('b',{...respond('请补充对象'),needs_input:true})]);
 const result=await f.run({checkpoint});assert.equal(result.agent.operations.length,2);assert.equal(result.agent.operations[0].status,'completed');
 assert.equal(f.checkpoints.at(-1).tool_results.filter(tool=>tool.name==='validation_error').length,2);
});


test('stale record coverage cannot block the next event or replay completed records', async () => {
  const operations=[{id:'breakfast',label:'早餐',action:'record',effect:'write',depends_on:[],status:'completed',receipt_id:ACTION},
    {id:'metro',label:'地铁',action:'record',effect:'write',depends_on:[],status:'completed',receipt_id:ACTION},
    {id:'gift',label:'送礼',action:'event',effect:'write',depends_on:[],status:'pending'}];
  const checkpoint={version:1,goal_id:ID,goal:'早餐、地铁和送礼',status:'running',steps:12,messages:[],tool_results:[],pending_approval:null,preview_fingerprints:[],operations};
  const decision={...respond('请核对送礼',{action:'event',event:{kind:'gift_given'}}),operation_id:'gift',covered_operation_ids:['breakfast','metro']};
  const f=fixture([decision]);const result=await f.run({checkpoint});
  assert.equal(result.agent.status,'waiting_approval');
  assert.deepEqual(f.calls.filter(c=>c[0]==='event').length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.checkpoints.at(-1).pending_operation_ids)),['gift']);
  assert.equal(result.agent.operations[0].status,'completed');assert.equal(result.agent.operations[1].status,'completed');
  assert.equal(f.checkpoints.at(-1).tool_results.some(t=>t.name==='validation_error'),false);
});

test('bounded workflow waves checkpoint unfinished reads and continue without emitting a question or output', async () => {
  const operations=[{id:'query',label:'本月统计',action:'query',effect:'read',depends_on:[]}];
  const plan={kind:'plan',tool:null,operation_id:null,arguments_json:JSON.stringify({operations}),plan_json:null};
  const f=fixture([plan,{...choose('read','query',query()),operation_id:'query'},{...respond('统计完成'),operation_id:'query'}]);
  const yielded=await f.run({maxSteps:2});const checkpoint=f.checkpoints.at(-1);
  assert.equal(yielded.agent.status,'running');assert.equal(yielded.agent.awaiting_answer,undefined);assert.equal(checkpoint.outputs,undefined);
  const finished=await f.run({checkpoint});assert.equal(finished.agent.status,'completed');
  assert.equal(f.calls.filter(c=>c[0]==='query').length,1);assert.equal(f.checkpoints.at(-1).outputs.length,1);
});

test('repeated invalid steps interrupt without asking an unrelated business question', async () => {
  const operations=[{id:'query',label:'查询',action:'query',effect:'read',depends_on:[]}];
  const f=fixture([{kind:'plan',tool:null,operation_id:null,arguments_json:JSON.stringify({operations}),plan_json:null},...Array(6).fill({...respond('总结'),operation_id:'unknown'})]);
  const result=await f.run();assert.equal(result.agent.status,'interrupted');assert.equal(result.agent.awaiting_answer,undefined);
  assert.equal(result.agent.steps,4);assert.equal(result.agent.operations[0].status,'pending');assert.equal(f.calls.filter(c=>c[0]==='query').length,0);
});


test('literal grouped records can resolve a missing primary reference without guessing other operations', async () => {
 const operations=[{...item('breakfast','record'),sources:['早餐3.9']},{...item('metro','record'),sources:['地铁2.96']},item('gift','event')];
 const decision={...respond('请核对',{action:'record',drafts:[{id:ID,description:'早餐',amount_cents:390},{id:ACTION,description:'地铁',amount_cents:296}]}),operation_id:null,covered_operation_ids:['breakfast','metro']};
 const f=fixture([agenda(operations),decision]);const result=await f.run();assert.equal(result.agent.status,'waiting_approval');assert.equal(result.agent.operations[2].status,'pending');
 assert.deepEqual(f.checkpoints.at(-1).pending_operation_ids,['breakfast','metro']);
});

test('completed-ID chat summaries are safe only after every item is settled', async () => {
 const c={version:1,goal_id:ID,goal:'记录早餐',status:'running',steps:2,messages:[],tool_results:[{call_id:'receipt',name:'approval_result',result:{id:ACTION,status:'succeeded',text:'早餐已入账'}},{call_id:'read',name:'target_verification',result:{verified:true}}],pending_approval:null,preview_fingerprints:[],operations:[{...item('record','record'),status:'completed',receipt_id:ACTION}]};
 const f=fixture([forItem('record',respond('根据凭据核对完成'))]);const result=await f.run({checkpoint:c});assert.equal(result.agent.status,'completed');assert.equal(f.calls.filter(call=>call[0]==='event'||call[0]==='command').length,0);
});

test('a premature write summary is repaired into a preview instead of becoming a fake question', async () => {
 const f=fixture([agenda([item('gift','event')]),forItem('gift',respond('送礼还未处理')),forItem('gift',choose('preview','event',{kind:'gift_given'}))]);
 const result=await f.run();assert.equal(result.agent.status,'waiting_approval');assert.equal(result.agent.awaiting_answer,undefined);assert.equal(f.calls.filter(call=>call[0]==='event').length,1);
 assert.match(f.checkpoints.at(-1).tool_results.find(call=>call.name==='validation_error').result.message,/结构化方案/);
});


test('misplaced agenda envelope is recovered only into strict operation validation', async () => {
 const schema=schemaExports.ASSISTANT_AGENT_WORKFLOW_STEP_SCHEMA;
 const operations=[{...item('record','record'),sources:['早餐3.9']}];
 const raw={kind:'plan',tool:null,operation_id:null,arguments_json:'{}',plan_json:JSON.stringify({operations})};
 const normalized=await schema.validate(raw);assert.equal(normalized.success,true);assert.equal(normalized.value.arguments_json,raw.plan_json);assert.equal(normalized.value.plan_json,null);
 const financial=await schema.validate({...raw,plan_json:JSON.stringify({action:'event',event:{kind:'gift_given'}})});
 assert.equal(financial.value.arguments_json,'{}');assert.equal(financial.value.plan_json,null);
 const invalid=fixture(Array(3).fill(financial.value));const paused=await invalid.run({requireWorkflow:true});assert.equal(paused.agent.status,'interrupted');assert.equal(paused.agent.awaiting_answer,undefined);assert.equal(invalid.calls.filter(c=>c[0]==='event').length,0);
});


test('provider and runtime share the same contract and deduplicate only redundant coverage IDs', async () => {
 const raw={...recordStep('record'),covered_operation_ids:['record','record']};
 const accepted=await schemaExports.ASSISTANT_AGENT_WORKFLOW_STEP_SCHEMA.validate(raw);
 assert.equal(accepted.success,true);assert.deepEqual(JSON.parse(JSON.stringify(accepted.value)),JSON.parse(JSON.stringify(stepContract.parseAssistantAgentStep(raw,true))));
 const f=fixture([agenda([{...item('record','record'),sources:['核对并整理账本']}]),raw]);const result=await f.run({requireWorkflow:true});
 assert.equal(result.agent.status,'waiting_approval');assert.deepEqual(f.checkpoints.at(-1).pending_operation_ids,['record']);assert.equal(f.checkpoints.at(-1).pending_batch.draft_ids.length,1);
 for(const invalid of [{...raw,operation_id:'非法编号'},{...raw,covered_operation_ids:['record','']},{...raw,kind:['respond']}]) assert.equal((await schemaExports.ASSISTANT_AGENT_WORKFLOW_STEP_SCHEMA.validate(invalid)).success,false);
});

test('an invalid step is repaired before tools while completed receipts and the untouched tail survive', async () => {
 const first=fixture([agenda([item('done','record'),item('gift','event')]),recordStep('done')]);await first.run();
 const c=first.checkpoints.at(-1),batch=c.pending_batch.batch_id;
 const f=fixture([{...forItem('gift',choose('preview','event',{kind:'gift_given'})),operation_id:'非法编号'},forItem('gift',choose('preview','event',{kind:'gift_given'}))],{adapters:{verifyTargets:async()=>({verified:true,records:[]})}});
 const result=await f.run({checkpoint:c,approvalOutcome:{id:batch,status:'succeeded',text:'已入账',targets:[{resource:'transactions',operation:'create',ids:[ID]}]}});
 assert.equal(result.agent.status,'waiting_approval');assert.equal(result.agent.operations[0].status,'completed');assert.equal(result.agent.operations[0].receipt_id,batch);
 assert.equal(f.calls.filter(call=>call[0]==='event').length,1);assert.equal(f.checkpoints.at(-1).outputs[0].receipt.status,'succeeded');
 assert.match(f.checkpoints.at(-1).tool_results.find(tool=>tool.name==='validation_error').result.message,/operation_id/);
});

test('final provider schema failures retry the current decision without replaying reads or writes', async () => {
 const invalid=()=>{throw Object.assign(new Error('private provider body'),{code:'invalid_output'});};
 const f=fixture([agenda([{...item('gift','event'),sources:['核对并整理账本']}]),invalid,forItem('gift',choose('preview','event',{kind:'gift_given'}))]);
 const result=await f.run({requireWorkflow:true});assert.equal(result.agent.status,'waiting_approval');assert.equal(f.calls.filter(call=>call[0]==='event').length,1);assert.equal(JSON.stringify(f.checkpoints).includes('private provider body'),false);
 const repeated=fixture([agenda([{...item('gift','event'),sources:['核对并整理账本']}]),invalid,invalid,invalid]);const paused=await repeated.run({requireWorkflow:true});
 assert.equal(paused.agent.status,'interrupted');assert.equal(paused.agent.awaiting_answer,undefined);assert.equal(paused.agent.operations[0].status,'pending');assert.equal(repeated.calls.filter(call=>call[0]==='event').length,0);
});


test('resolved event choices continue deterministically without letting the model repeat the duplicate question', async () => {
 const input={operation:'create',kind:'gift_given',counterparty:'小美',amount_cents:50000,date:'2026-10-10',allow_duplicate:true};
 const c={version:1,goal_id:ID,goal:'送礼',status:'running',steps:8,messages:[],tool_results:[],pending_approval:null,preview_fingerprints:[],operations:[{...item('breakfast','record'),status:'completed',receipt_id:ID},{...item('gift','event'),status:'pending'}],event_resolutions:[{operation_id:'gift',source_output_id:ACTION,input,pending:true}]};
 const f=fixture([()=>assert.fail('an accepted choice must not be reinterpreted by the model')]);const result=await f.run({checkpoint:c});
 assert.equal(result.agent.status,'waiting_approval');assert.equal(f.calls.filter(call=>call[0]==='event').length,1);assert.equal(f.calls.find(call=>call[0]==='event')[1].allow_duplicate,true);assert.equal(result.agent.operations[0].status,'completed');assert.equal(f.checkpoints.at(-1).event_resolutions[0].pending,false);
});

test('a granted duplicate decision is scoped to the selected occurrence and cannot authorize another amount or person', () => {
 const input={operation:'create',kind:'gift_given',counterparty:'小美',amount_cents:50000,date:'2026-10-10',allow_duplicate:true,member_id:null,category_id:null,note:null,transaction_amount_cents:null};
 assert.equal(eventClarification.sameEventOccurrence(input,{...input,allow_duplicate:false,member_id:ID}),true);
 for(const patch of [{amount_cents:60000},{counterparty:'另一位'},{date:'2026-10-11'},{transaction_amount_cents:70000}])assert.equal(eventClarification.sameEventOccurrence(input,{...input,...patch}),false);
 assert.equal(eventClarification.isDuplicateEventQuestion('这笔新发生的送礼支出属于哪个成员？'),false);
});


test('已有物品 cannot downgrade the unexecuted cash gift into a completed read', async () => {
 const operation={...item('gift','event'),sources:['小美送礼500元及200元鞋子'],status:'pending'};
 const c={version:1,goal_id:ID,goal:'小美送礼500元及200元鞋子',status:'running',steps:2,messages:[],tool_results:[],pending_approval:null,preview_fingerprints:[],operations:[operation],authorized_answers:['已有物品']};
 const f=fixture([agenda([{...item('gift','chat'),sources:operation.sources}]),forItem('gift',choose('preview','event',{kind:'gift_given',amount_cents:50000}))]);
 const result=await f.run({checkpoint:c});assert.equal(result.agent.status,'waiting_approval');assert.equal(result.agent.operations[0].action,'event');assert.equal(f.calls.filter(call=>call[0]==='event').length,1);assert.ok(f.checkpoints.at(-1).tool_results.some(tool=>tool.name==='validation_error'&&/写目标/.test(tool.result.message)));
});


test('a scoped existing-item answer cannot erase the cash gift while an explicit ledger-only answer can',async()=>{
 const event={operation:'create',kind:'gift_given',counterparty:'小美',amount_cents:50000,date:'2026-10-10',items:[{item_name:'鞋子',estimated_value:200}],cashflow:'none'};
 const c={version:1,goal_id:ID,goal:'送礼500及鞋子200',status:'running',steps:2,messages:[],tool_results:[],pending_approval:null,preview_fingerprints:[],operations:[{...item('gift','event'),status:'pending',sources:['送礼500及鞋子200']}],clarification_answers:[{operation_id:'gift',message_id:ID,output_id:ACTION,text:'已有物品'}]};
 const f=fixture([forItem('gift',choose('preview','event',event)),forItem('gift',choose('preview','event',{...event,cashflow:'auto'}))]);const result=await f.run({checkpoint:c});assert.equal(result.agent.status,'waiting_approval');assert.equal(f.calls.filter(call=>call[0]==='event').length,1);assert.equal(f.calls.find(call=>call[0]==='event')[1].cashflow,'auto');
 c.clarification_answers[0].text='仅登记人情台账，不计收支';const allowed=fixture([forItem('gift',choose('preview','event',event))]);await allowed.run({checkpoint:c});assert.equal(allowed.calls.find(call=>call[0]==='event')[1].cashflow,'none');
 c.clarification_answers[0].operation_id='other';const unrelated=fixture([forItem('gift',choose('preview','event',event)),forItem('gift',choose('preview','event',{...event,cashflow:'auto'}))]);await unrelated.run({checkpoint:c});assert.equal(unrelated.calls.find(call=>call[0]==='event')[1].cashflow,'auto');
});

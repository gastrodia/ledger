/* eslint-disable @typescript-eslint/no-require-imports -- native contracts against isolated domain adapters. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, JSON, Date, Error, Number, Set, Map, BigInt, TextEncoder, structuredClone, AbortSignal,
      require: name => { assert.notEqual(name, '@/lib/db'); return name.startsWith('@/') ? load(`${name.slice(2)}.ts`) : require(name); } });
  return exports;
}
const native = load('lib/assistant-native-tools.ts');
const { runAssistantAgent } = load('lib/assistant-agent-runtime.ts');
const { restoreAssistantAgentCheckpoint } = load('lib/assistant-agent-state.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
const operation = { id: 'query', label: '查支出', action: 'query', effect: 'read', depends_on: [], sources: ['查支出'], status: 'pending' };
const call = (name, input, n = 1, targets = [], quote = "当前测试请求") => native.assistantNativeDecision({ id: `native-${n}`, name, input }, targets, quote);
const query = { start_date: '2026-10-01', end_date: '2026-10-31', type: 'expense', category_id: null, member_id: null, keyword: null };
const command = { resource: 'notes', operation: 'create', scope: 'one', ids: [], parent_id: null, parent_name: null,
  filter: { keyword: null, start_date: null, end_date: null, type: null, category_id: null, member_id: null, status: null, amount_min: null, amount_max: null }, values: { content: '2026-10-14 下午三点取快递' } };

test('typed command/control parameters reach existing domain contracts without JSON strings in transport', () => {
  const prepared = call('prepare_command', { operation_id: 'note', command });
  assert.equal(prepared.step.kind, 'preview');
  assert.equal(JSON.parse(JSON.parse(prepared.step.arguments_json).values_json).content, command.values.content);
  const control = call('control', { control: { target_type: 'action', target_id: id(2), decision: 'approve',
    target_reference: null, requested_operation: null, changes: {} } }, 1, [{ target_type: 'action', target_id: id(2), operation: 'update', revision: 'revision' }], '按方案处理');
  assert.equal(JSON.parse(control.step.arguments_json).changes_json, '{}');
  assert.equal(JSON.parse(control.step.arguments_json).revision, 'revision');
  const exported = call('read_records', { operation_id: 'export', command: { ...command, operation: 'export', values: {} } });
  assert.equal(exported.step.kind, 'preview');
  assert.equal(exported.step.tool, 'command');
  assert.equal(JSON.parse(exported.step.arguments_json).operation, 'export');
  const wireSchema = JSON.stringify(native.ASSISTANT_NATIVE_TOOLS.prepare_command.inputSchema.jsonSchema);
  assert.ok(!wireSchema.includes('values_json'));
  assert.ok(!wireSchema.includes('arguments_json'));
  assert.ok(!wireSchema.includes('plan_json'));
  assert.throws(() => native.assistantNativeSchemas.draft_action.parse({ operation_id: 'edit', request: { action: 'edit', edit: { batch_id: id(1), edits: [] } } }));
});

test('available tools follow unresolved workflow dependencies and never user keywords', () => {
  assert.deepEqual(Object.keys(native.assistantNativeToolsForState()).sort(), ['respond', 'set_workflow']);
  const ops = [{ ...operation, status: 'completed' }, { ...operation, id: 'note', action: 'manage', effect: 'write', depends_on: ['query'] }];
  assert.ok(native.assistantNativeToolsForState(ops).prepare_command);
  assert.equal(native.assistantNativeToolsForState(ops).prepare_records, undefined);
  ops[0].status = 'pending';
  assert.equal(native.assistantNativeToolsForState(ops).prepare_command, undefined);
  assert.ok(native.assistantNativeToolsForState([{ ...operation, action: 'record', effect: 'write' }]).reuse_result);
  assert.equal(native.assistantNativeToolsForState([{ ...operation, action: 'event', effect: 'write' }]).reuse_result, undefined);
  const targets = [{ target_type: 'action', target_id: id(1), operation: 'update', revision: 'before-model-call' }];
  const available = native.assistantNativeToolsForState(undefined, targets);
  const controlProperties = available.control.inputSchema.jsonSchema.properties;
  assert.equal(controlProperties.operation_id, undefined);
  assert.equal(controlProperties.control.properties.revision, undefined);
  assert.equal(controlProperties.control.properties.operation, undefined);
  assert.equal(controlProperties.control.properties.target_reference, undefined);
  const multiple = native.assistantNativeToolsForState(undefined, [...targets, { ...targets[0], target_id: id(2) }]);
  assert.ok(multiple.control.inputSchema.jsonSchema.properties.control.properties.target_reference);
  const wrongLocalPlan = [{ ...operation, id: 'edit', action: 'edit', effect: 'local' }];
  const noBatch = native.assistantNativeToolsForState(wrongLocalPlan);
  assert.ok(noBatch.prepare_command, 'a mistaken model plan cannot hide the saved-record capability');
  assert.equal(noBatch.draft_action, undefined);
  assert.equal(noBatch.match_drafts, undefined);
  const withDraft = native.assistantNativeToolsForState(wrongLocalPlan, [], { draft_batch: true, saved_batch: false });
  assert.ok(withDraft.draft_action);
  assert.ok(withDraft.match_drafts);
  assert.ok(!JSON.stringify(withDraft.draft_action.inputSchema.jsonSchema).includes('"undo"'));
  const withSaved = native.assistantNativeToolsForState(wrongLocalPlan, [], { draft_batch: false, saved_batch: true });
  assert.ok(withSaved.draft_action);
  assert.ok(!JSON.stringify(withSaved.draft_action.inputSchema.jsonSchema).includes('"edit"'));
});

test('record IDs are projected from record facts rather than proposal identifiers', async () => {
  const ids = native.assistantNativeRecordIds([
    { name: 'command_preview', result: { approval: { id: id(2) } } },
    { name: 'records', result: { record_context: { resource: 'transactions', rows: [{ id: id(50) }] } } },
    { name: 'query', result: { facts: { largest_records: [{ id: id(51) }] } } },
    { name: 'target_verification', result: { records: [{ rows: [{ id: id(52) }] }] } },
  ], [id(53)]);
  assert.deepEqual(plain(ids).sort(), [id(50), id(51), id(52), id(53)]);
  const available = native.assistantNativeToolsForState([{ ...operation, action: 'manage', effect: 'write' }], [],
    { draft_batch: false, saved_batch: false, record_ids: ids });
  const validate = available.prepare_command.inputSchema.validate;
  assert.equal((await validate({ operation_id: 'query', command: { ...command, operation: 'update', ids: [id(50)] } })).success, true);
  assert.equal((await validate({ operation_id: 'query', command: { ...command, operation: 'update', ids: [id(2)] } })).success, false);
  const noIds = native.assistantNativeToolsForState([{ ...operation, action: 'manage', effect: 'write' }]);
  assert.equal((await noIds.prepare_command.inputSchema.validate({ operation_id: 'query', command: { ...command, operation: 'update', ids: [] } })).success, true);
});

test('control binds the current source quote and still rejects revisions and ambiguous targets', async () => {
  const context = { target_type: 'action', target_id: id(2), operation: 'update', revision: 'same-snapshot', summary: '早餐金额修改', status: 'pending' };
  const input = { control: { target_type: 'action', target_id: id(2), decision: 'approve',
    requested_operation: null, changes: {} } };
  const tools = native.assistantNativeToolsForState(undefined, [context]);
  const validated = await tools.control.inputSchema.validate(input);
  assert.equal(validated.success, true);
  const converted = native.assistantNativeDecision({ id: 'call', name: 'control', input: validated.value }, [context], '按这个方案执行');
  const value = JSON.parse(converted.step.arguments_json);
  const validateControl = load('lib/assistant-control.ts').validateAssistantControl;
  assert.equal(validateControl(value, [context], '按这个方案执行').user_quote, '按这个方案执行');
  assert.throws(() => validateControl({ ...value, changes_json: '{"amount":100}' }, [context], '按这个方案执行'));
  assert.throws(() => validateControl(value, [context, { ...context, target_id: id(3) }], '按这个方案执行'));
  assert.throws(() => validateControl(value, [{ ...context, revision: 'new-version' }], '按这个方案执行'));
});

test('a saved-record amount revision prepares a new preview in two decisions with no write', async () => {
  const goal = '确认，不过金额改成100元';
  const pending = { target_type: 'action', target_id: id(2), operation: 'update', revision: 'original', summary: '将早餐20元改成22元', status: 'pending' };
  let calls = 0, preparations = 0, controls = 0, saved;
  const editCommand = { ...command, resource: 'transactions', operation: 'update', values: { amount: 100 },
    filter: { ...command.filter, keyword: '早餐' } };
  const result = await runAssistantAgent({ goalId: id(1), goal, messages: [], requireWorkflow: true, signal: AbortSignal.timeout(1000),
    adapters: { protocol: 'native', controlContexts: [pending],
      chooseStep: async () => ++calls === 1 ? call('set_workflow', { reads: [], operations: [{ id: 'revision', label: '准备新修改方案', action: 'manage', effect: 'write', depends_on: [], sources: [goal] }] })
        : call('prepare_command', { operation_id: 'revision', command: editCommand }, 2),
      validatePlan: p => p, validateCommand: load('lib/assistant-commands.ts').validateLedgerCommand,
      command: async c => { preparations++; assert.equal(JSON.parse(c.values_json).amount, 100); return { reply: '100元新预览待确认', approval: { id: id(8), summary: '100元', count: 1, expires_at: null } }; },
      control: async () => { controls++; throw Error('must not approve old content'); } }, onCheckpoint: value => { saved = value; } });
  assert.equal(calls, 2);
  assert.equal(preparations, 1);
  assert.equal(controls, 0);
  assert.equal(result.agent.status, 'waiting_approval');
  assert.equal(result.approval.id, id(8));
  assert.equal(pending.status, 'pending');
  assert.ok(saved.tool_results.some(tool => tool.name === 'command_preview'));
});

test('workflow delta preserves completed identity and passes the existing full-agenda checks', async () => {
  const goal = '早餐3.9元，并把已保存午餐金额改100元';
  const done = { ...operation, id: 'breakfast', label: '早餐', action: 'record', effect: 'write', sources: ['早餐3.9元'], status: 'completed', receipt_id: id(9) };
  const todo = { ...operation, id: 'revision', label: '修改午餐', action: 'edit', effect: 'local', sources: ['并把已保存午餐金额改100元'] };
  const c = { version: 2, workflow_required: true, goal_id: id(1), goal, status: 'needs_input', steps: 2,
    messages: [], tool_results: [], pending_approval: null, preview_fingerprints: [], operations: [done, todo] };
  const editCommand = { ...command, resource: 'transactions', operation: 'update', values: { amount: 100 }, filter: { ...command.filter, keyword: '午餐' } };
  let saved, calls = 0;
  const result = await runAssistantAgent({ goalId: id(1), goal, messages: [], checkpoint: c, signal: AbortSignal.timeout(1000),
    adapters: { protocol: 'native', chooseStep: async (_messages, _signal, operations) => ++calls === 1
      ? native.assistantNativeDecision({ id: 'delta', name: 'revise_workflow', input: { changes: [{ id: 'revision', action: 'manage', effect: 'write' }] } }, [], goal, operations)
      : call('prepare_command', { operation_id: 'revision', command: editCommand }, 2),
    validatePlan: p => p, validateCommand: load('lib/assistant-commands.ts').validateLedgerCommand,
    command: async () => ({ reply: '新预览', approval: { id: id(8), summary: '100元', count: 1, expires_at: null } }) }, onCheckpoint: value => { saved = value; } });
  assert.equal(calls, 2);
  assert.equal(result.agent.status, 'waiting_approval');
  assert.deepEqual(plain(saved.operations[0]), done);
  assert.equal(saved.operations[1].action, 'manage');
  assert.deepEqual(plain(saved.operations[1].sources), todo.sources);
  assert.throws(() => native.assistantNativeDecision({ id: 'bad', name: 'revise_workflow', input: { changes: [{ id: 'breakfast', action: 'chat', effect: 'read' }] } }, [], goal, c.operations));
  const schema = native.assistantNativeToolsForState(c.operations).revise_workflow.inputSchema;
  assert.equal((await schema.validate({ changes: [{ id: 'breakfast', action: 'chat', effect: 'read' }] })).success, false);
});

test('native call IDs pair with typed results across domain instructions and preserve later user answers', () => {
  const decision = call('query_statistics', { operation_id: 'query', query });
  const messages = native.assistantNativeMessages([
    { role: 'assistant', content: JSON.stringify(decision.step), native_call: decision.call },
    { role: 'system', content: '领域规则' },
    { role: 'user', content: 'display trace', tool_feedback: { name: 'query', result: { summary: { expense: '80.00' } } } },
    { role: 'user', content: '下一轮用户回答' },
  ]);
  assert.equal(messages[0].content[0].toolCallId, 'native-1');
  assert.equal(messages[1].role, 'tool');
  assert.equal(messages[1].content[0].toolCallId, 'native-1');
  assert.equal(messages[1].content[0].output.value.results[0].result.summary.expense, '80.00');
  assert.equal(messages.at(-1).content, '下一轮用户回答');
  assert.ok(!JSON.stringify(messages).includes('arguments_json'));
  const old = native.assistantNativeMessages([{ role: 'assistant', content: JSON.stringify(decision.step) }, { role: 'assistant', content: '哪个成员？' }]);
  assert.equal(old[0].role, 'user');
  assert.ok(!old[0].content.includes('arguments_json'));
  assert.equal(old[1].role, 'assistant');
  const failedHistory = native.assistantNativeMessages([{ role: 'assistant', content: JSON.stringify({ ...decision.step, arguments_json: '{invalid' }) }]);
  assert.match(failedHistory[0].content, /invalid_json/);
  const resumed = native.assistantNativeMessages([
    { role: 'assistant', content: JSON.stringify(decision.step), native_call: decision.call },
    { role: 'user', content: '批准成功，继续回读核对' },
    { role: 'user', content: 'target_verification verified=true', tool_feedback: { name: 'target_verification', result: { verified: true } } },
  ]);
  assert.equal(resumed.at(-2).content, '批准成功，继续回读核对');
  assert.equal(resumed.at(-1).content, 'target_verification verified=true');
  assert.equal(resumed[1].content[0].output.value.results.length, 0);
});

test('v1 waiting approval converts without replaying the preview or changing any identities', async () => {
  const c = { version: 1, goal_id: id(1), goal: '修改便签', status: 'waiting_approval', steps: 2,
    messages: [{ role: 'system', content: 'old protocol' }], tool_results: [], pending_approval: { action_id: id(2), fingerprint: 'same' },
    pending_approvals: [{ action_id: id(2), fingerprint: 'same' }], preview_fingerprints: ['same'], output_id: id(3),
    pending_plan: { action: 'manage', reply: '待确认', drafts: [], query: null, approval: { id: id(2), summary: '改便签', count: 1, expires_at: null } } };
  let saved, calls = 0;
  const result = await runAssistantAgent({ goalId: c.goal_id, goal: c.goal, checkpoint: restoreAssistantAgentCheckpoint(c), messages: [], signal: AbortSignal.timeout(1000),
    adapters: { protocol: 'native', chooseStep: async () => { calls++; throw Error('must not replay'); } }, onCheckpoint: value => { saved = value; } });
  assert.equal(calls, 0);
  assert.equal(saved.version, 2);
  assert.equal(result.approval.id, id(2));
  assert.equal(saved.output_id, id(3));
  assert.equal(saved.pending_approval.fingerprint, 'same');
  assert.equal(c.version, 1);
  assert.deepEqual(plain(restoreAssistantAgentCheckpoint(saved)), plain(saved));
});

test('native read resumes a v1 workflow and persists typed history before final delivery', async () => {
  const c = { version: 1, workflow_required: true, goal_id: id(1), goal: '查支出', status: 'needs_input', steps: 2,
    messages: [{ role: 'system', content: 'obsolete' }, { role: 'user', content: '查支出' }], tool_results: [], pending_approval: null, preview_fingerprints: [], operations: [operation] };
  let saved, reads = 0, choices = 0;
  const result = await runAssistantAgent({ goalId: c.goal_id, goal: c.goal, checkpoint: c, messages: [{ role: 'system', content: native.ASSISTANT_NATIVE_AGENT_PROMPT }], signal: AbortSignal.timeout(1000),
    adapters: { protocol: 'native', chooseStep: async () => ++choices === 1 ? call('query_statistics', { operation_id: 'query', query })
      : call('respond', { reply: '支出80元', needs_input: false }, 2),
    validatePlan: p => p, query: async () => { reads++; return { reply: '支出80元', facts: { summary: { expense: '80.00' } } }; } },
    onCheckpoint: value => { saved = value; } });
  assert.equal(reads, 1);
  assert.equal(result.agent.status, 'completed');
  assert.equal(saved.version, 2);
  assert.equal(saved.operations[0].id, 'query');
  assert.equal(saved.messages.some(m => m.content === 'obsolete'), false);
  assert.equal(saved.messages.filter(m => m.native_call).length, 2);
  assert.ok(restoreAssistantAgentCheckpoint(saved));
  assert.equal(native.assistantNativeMessages(saved.messages).filter(m => m.role === 'tool').length, 2);
});

test('native calls cannot bypass workflow coverage to run business adapters', async () => {
  let writes = 0, saved;
  await runAssistantAgent({ goalId: id(1), goal: '创建便签', messages: [], requireWorkflow: true, maxSteps: 1, signal: AbortSignal.timeout(1000),
    adapters: { protocol: 'native', chooseStep: async () => call('prepare_command', { operation_id: 'note', command }), command: async () => { writes++; },
      validateCommand: load('lib/assistant-commands.ts').validateLedgerCommand, validatePlan: p => p }, onCheckpoint: value => { saved = value; } });
  assert.equal(writes, 0);
  assert.ok(saved.tool_results.some(r => r.name === 'validation_error'));
});

test('final verified receipt completes without a model call and retains the original saved draft output', async () => {
  const batch = id(3);
  const plan = { action: 'record', reply: '核对', drafts: [{ id: id(4), type: 'expense', amount_cents: 1800, description: '午餐' }], query: null };
  const c = { version: 1, workflow_required: true, goal_id: id(1), goal: '记午餐', status: 'waiting_approval', steps: 192, messages: [], tool_results: [],
    pending_approval: null, preview_fingerprints: [], output_id: batch, pending_plan: plan, pending_batch: { batch_id: batch, draft_ids: [id(4)] },
    pending_operation_ids: ['record'], current_operation_id: 'record', operations: [{ ...operation, id: 'record', action: 'record', effect: 'write', status: 'waiting_approval' }],
    outputs: [{ id: batch, user_message_id: id(1), input: { message: '记午餐', display_text: '记午餐', display_images: [] }, plan, attempt: 1, operation_ids: ['record'] }] };
  let saved, calls = 0;
  const result = await runAssistantAgent({ goalId: id(1), goal: c.goal, messages: [], checkpoint: c, signal: AbortSignal.timeout(1000),
    approvalOutcome: { id: batch, status: 'succeeded', text: '已保存午餐18元', targets: [{ resource: 'transactions', operation: 'create', ids: [id(5)] }] },
    adapters: { protocol: 'native', chooseStep: async () => { calls++; throw Error('completed goal must not call model'); }, verifyTargets: async () => ({ verified: true, records: [] }) },
    onCheckpoint: value => { saved = value; } });
  assert.equal(calls, 0);
  assert.equal(result.agent.status, 'completed');
  assert.equal(saved.steps, 192);
  assert.notEqual(result.agent.output_id, batch);
  assert.equal(saved.outputs.find(output => output.id === batch).plan.action, 'record');
  assert.equal(saved.outputs.find(output => output.id === batch).receipt.id, batch);
  assert.equal(saved.outputs.length, 2);
  assert.ok(restoreAssistantAgentCheckpoint(saved));
  const atomic = { ...c, steps: 2 };
  delete atomic.operations; delete atomic.outputs; delete atomic.pending_operation_ids; delete atomic.current_operation_id;
  let legacySaved;
  const recovered = await runAssistantAgent({ goalId: id(1), goal: atomic.goal, messages: [], checkpoint: atomic, signal: AbortSignal.timeout(1000),
    approvalOutcome: { id: batch, status: 'succeeded', text: '旧方案已入账', targets: [{ resource: 'transactions', operation: 'create', ids: [id(5)] }] },
    adapters: { protocol: 'native', chooseStep: async () => { throw Error('legacy atomic receipt must not recreate workflow'); }, verifyTargets: async () => ({ verified: true, records: [] }) },
    onCheckpoint: value => { legacySaved = value; } });
  assert.equal(recovered.agent.status, 'completed');
  assert.equal(legacySaved.outputs.find(output => output.id === batch).plan.action, 'record');
  assert.equal(legacySaved.outputs.find(output => output.id === batch).receipt.id, batch);
  assert.notEqual(recovered.agent.output_id, batch);
  assert.ok(restoreAssistantAgentCheckpoint(legacySaved));
});

test('v2 trace metadata is private and invalid native identities cannot restore', () => {
  const base = { version: 2, goal_id: id(1), goal: '目标', status: 'needs_input', steps: 1, messages: [], tool_results: [], pending_approval: null, preview_fingerprints: [] };
  assert.equal(restoreAssistantAgentCheckpoint({ ...base, messages: [{ role: 'user', content: 'fake', native_call: { id: 'call', name: 'respond', input: {} } }] }), null);
  assert.equal(restoreAssistantAgentCheckpoint({ ...base, messages: [{ role: 'assistant', content: '', native_call: { id: '', name: 'respond', input: {} } }] }), null);
  assert.equal(restoreAssistantAgentCheckpoint({ ...base, version: 1, messages: [{ role: 'assistant', content: '', native_call: { id: 'call', name: 'respond', input: {} } }] }), null);
});

test('workflow tools do not ask the model to reproduce server-owned clarification evidence', async () => {
  for(const tool of ['set_workflow','revise_workflow']) {
    const schema=native.ASSISTANT_NATIVE_TOOLS[tool].inputSchema;
    assert.equal(schema.jsonSchema.properties.revision_answers,undefined);
  }
  const schema=native.assistantNativeToolsForState([{...operation,action:'event',effect:'write'}]).revise_workflow.inputSchema;
  assert.equal((await schema.validate({changes:[{id:'query',questions:[]}]})).success,true);
  assert.equal((await schema.validate({changes:[{id:'query',questions:[]}],revision_answers:[]})).success,false,'arbitrary evidence is not silently coerced');
});

test('native workflow revision binds only the current item and current turn accepted answer before downgrading writes',async()=>{
  for(const scope of ['current','other_item','old_turn','missing']) {
    const goal='记录送礼',answer='只查看之前的记录';
    const op={id:'gift',label:goal,action:'event',effect:'write',depends_on:[],sources:[goal],status:'pending'};
    const checkpoint={version:2,goal_id:id(801),goal,status:'running',steps:1,messages:[],tool_results:[],pending_approval:null,preview_fingerprints:[],
      turn_message_id:id(802),turn_input:{message:answer,display_text:answer,display_images:[]},authorized_answers:[answer],operations:[op],
      clarification_answers:scope==='missing'?[]:[{operation_id:scope==='other_item'?'other':'gift',message_id:scope==='old_turn'?id(803):id(802),output_id:id(804),text:answer}]};
    let saved,calls=0;
    await runAssistantAgent({goalId:checkpoint.goal_id,goal,checkpoint,messages:[],maxSteps:1,signal:AbortSignal.timeout(1000),
      adapters:{protocol:'native',chooseStep:async(_messages,_signal,operations)=>{calls++;return native.assistantNativeDecision({id:'revision',name:'revise_workflow',input:{changes:[{id:'gift',action:'manage',effect:'read'}]}},[],answer,operations);}},
      onCheckpoint:c=>{saved=c;}});
    assert.equal(calls,1);assert.equal(saved.operations[0].effect,scope==='current'?'read':'write',scope);
    assert.equal(saved.tool_results.some(r=>r.name==='workflow'),scope==='current',scope);
    if(scope!=='current')assert.match(saved.tool_results.at(-1).result.message,/已接受的澄清回答/);
  }
});

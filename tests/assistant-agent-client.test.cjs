/* eslint-disable @typescript-eslint/no-require-imports -- exercise real recovery functions with no network writes. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const modules = new Map();
function load(filename) {
  if (modules.has(filename)) return modules.get(filename);
  const exports = {}; modules.set(filename, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, JSON, Date, Error, AbortController, setTimeout, clearTimeout,
    fetch() { throw new Error('Recovery must not perform a write'); },
    require(name) { return name === 'zod' ? require('zod') : load(`${name.slice(2)}.ts`); } });
  return exports;
}
const client = load('lib/assistant-task-client.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const agent = (extra = {}) => ({ goal_id: uuid(1), goal: '核对午餐记录并补充备注', status: 'waiting_approval', steps: 2, tool_calls: 2, pending_action_id: uuid(2), ...extra });
const approval = { id: uuid(2), summary: '修改午餐备注', expires_at: '2026-10-09T01:00:00.000Z', preview: { title: '修改午餐', metrics: [], sections: [], notices: [] } };
const plan = (extra = {}) => ({ action: 'chat', reply: '请核对方案', drafts: [], query: null, agent: agent(), ...extra });
const task = (extra = {}) => ({ id: uuid(3), conversation_id: uuid(4), user_message_id: uuid(5), status: 'succeeded', phase: 'query',
  text: '', result: plan(), error: null, attempt: 1, created_at: '2026-10-09T00:00:00.000Z', updated_at: '2026-10-09T00:01:00.000Z', ...extra });
const user = { id: uuid(5), role: 'user', text: '核对午餐记录并补充备注' };
const result = (extra = {}) => ({ id: uuid(2), status: 'succeeded', text: '已保存并核对备注', ...extra });

function checkpoint() {
  const recovered = client.mergeAssistantTasks([user], [task({ result: plan({ action: 'manage', approval,
    record_context: { resource: 'transactions', rows: [{ id: uuid(6), description: '午餐' }] } }) })], uuid(4), []);
  return recovered.map(message => message.role === 'assistant' ? { ...message, approval: undefined, actionResult: result(), actionPreview: approval.preview } : message);
}

test('valid public metadata is restored while invalid identities and states fail closed', () => {
  assert.deepEqual(plain(client.restoreAssistantAgent(agent())), agent());
  for (const value of [agent({ goal_id: 'bad' }), agent({ pending_action_id: 'bad' }), agent({ goal: '' }), agent({ status: 'done' }), agent({ steps: -1 }), agent({ tool_calls: 0.2 })]) {
    assert.equal(client.restoreAssistantAgent(value), undefined);
  }
});

test('only a verified settled action without replacement is eligible to resume', () => {
  for (const status of ['pending', 'executing']) assert.equal(client.assistantAgentActionSettled(result({ status })), false);
  for (const status of ['succeeded', 'failed', 'cancelled', 'expired']) assert.equal(client.assistantAgentActionSettled(result({ status })), true);
  assert.equal(client.assistantAgentActionSettled(result({ status: 'failed', replacement_approval: approval })), false);
});

test('same task resume sends only its attempt, leaving outcome authority on the server', async () => {
  const requests = [];
  const response = await client.resumeAssistantAgentTask(task(), async (url, options) => {
    requests.push({ url, method: options.method, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ task: task({ status: 'queued', attempt: 2 }) }) };
  });
  assert.equal(response.task.id, uuid(3));
  assert.deepEqual(requests, [{ url: `/api/assistant/tasks/${uuid(3)}`, method: 'PATCH', body: { action: 'resume', attempt: 1 } }]);
});

test('resume preserves the settled approval card during running and archives it once on completion', () => {
  const before = checkpoint();
  const active = task({ status: 'running', attempt: 2, agent: agent({ status: 'running' }), updated_at: '2026-10-09T00:02:00.000Z' });
  const running = client.mergeAssistantTasks(before, [active], uuid(4), []);
  assert.equal(running.length, 2);
  assert.equal(running[1].actionResult.status, 'succeeded');
  assert.equal(running[1].taskAttempt, 1, 'previous card keeps its applied checkpoint until next result');
  assert.equal(running[1].agent.status, 'running');
  const completed = task({ attempt: 2, agent: agent({ status: 'completed', pending_action_id: undefined }), result: plan({ reply: '备注已核对，任务完成', agent: agent({ status: 'completed', pending_action_id: undefined }) }) });
  const done = client.mergeAssistantTasks(running, [completed], uuid(4), []);
  assert.equal(done.length, 2);
  assert.equal(done[1].text, '备注已核对，任务完成');
  assert.equal(done[1].taskHistory.length, 1);
  assert.equal(done[1].taskHistory[0].actionResult.id, uuid(2));
  assert.equal(done[1].taskHistory[0].actionResult.status, 'succeeded');
  assert.equal(done[1].taskHistory[0].ledgerContext.rows[0].description, '午餐');
  assert.equal(done[1].taskHistory[0].approval, undefined);
  const reopened = client.mergeAssistantTasks(plain(done), [completed, completed], uuid(4), []);
  assert.deepEqual(plain(reopened), plain(done));
});

test('an agent can advance after a checkpoint but stale polls and unrelated completed drafts cannot', () => {
  const previous = task({ agent: agent() });
  const resumed = task({ status: 'queued', attempt: 2, agent: agent({ status: 'running' }), updated_at: '2026-10-09T00:02:00.000Z' });
  const snapshot = client.reconcileAssistantTaskSnapshots([previous], [resumed]);
  assert.equal(snapshot[0].attempt, 2);
  assert.equal(snapshot[0].status, 'queued');
  assert.equal(client.reconcileAssistantTaskSnapshots(snapshot, [previous]), snapshot);
  const unrelated = task({ result: plan({ agent: undefined }) });
  assert.deepEqual(plain(client.reconcileAssistantTaskSnapshots([unrelated], [resumed])), plain([unrelated]));
});

test('stopping a waiting checkpoint clears execution controls and preserves committed receipt', () => {
  const before = checkpoint();
  const stopped = task({ status: 'cancelled', agent: agent({ status: 'stopped', pending_action_id: undefined }) });
  const reconciled = client.reconcileAssistantTaskSnapshots([task({ agent: agent() })], [stopped]);
  assert.equal(reconciled[0].status, 'cancelled');
  const next = client.mergeAssistantTasks(before, reconciled, uuid(4), []);
  assert.equal(next[1].approval, undefined);
  assert.equal(next[1].actionResult.status, 'succeeded');
  assert.equal(next[1].agent.status, 'stopped');
  assert.equal(next[1].incomplete, undefined);
  assert.equal(client.reconcileAssistantTaskSnapshots(reconciled, [task({ updated_at: '2026-10-09T00:03:00.000Z' })]), reconciled);
});

test('a server replacement on the same attempt swaps a stale approval after reload and preserves its failed receipt', () => {
  const original = task({ result: plan({ action: 'manage', approval }) });
  const before = client.mergeAssistantTasks([user], [original], uuid(4), []);
  const replacement = { ...approval, id: uuid(9), summary: '数据已变化，请核对新备注' };
  const rebound = task({ agent: agent({ pending_action_id: replacement.id }),
    result: plan({ action: 'manage', approval: replacement }), approval_history: [{ approval, result: result({ status: 'failed', text: '原预览已过期，本次未保存' }) }] });
  const recovered = client.mergeAssistantTasks(plain(before), [rebound], uuid(4), []);
  assert.equal(recovered[1].approval.id, replacement.id);
  assert.equal(recovered[1].text, replacement.summary);
  assert.equal(recovered[1].taskHistory[0].actionResult.status, 'failed');
  const approved = recovered.map(message => message.role === 'assistant' ? { ...message, approval: undefined, actionResult: result({ id: replacement.id }) } : message);
  const done = task({ attempt: 2, agent: agent({ status: 'completed', pending_action_id: undefined }),
    result: plan({ reply: '已核对新备注', agent: agent({ status: 'completed', pending_action_id: undefined }) }) });
  const finished = client.mergeAssistantTasks(approved, [done], uuid(4), []);
  assert.equal(finished[1].taskHistory.length, 2, 'both old and replacement outcomes stay visible');
  assert.deepEqual(plain(finished[1].taskHistory.map(output => output.actionResult.id)), [uuid(2), uuid(9)]);
});

test('fresh task recovery restores public approval receipts without exposing executable controls', () => {
  const completed = task({ input: { display_text: user.text, display_images: [] }, agent: agent({ status: 'completed', pending_action_id: undefined }),
    result: plan({ reply: '已核对完成', agent: agent({ status: 'completed', pending_action_id: undefined }) }),
    approval_history: [{ approval, result: result() }] });
  const recovered = client.mergeAssistantTasks([], [completed], uuid(4), []);
  assert.equal(recovered[1].approval, undefined);
  assert.equal(recovered[1].approvalHistory[0].result.status, 'succeeded');
  assert.equal(client.assistantAgentWaiting(completed), false);
  assert.deepEqual(plain(client.restoreAssistantApprovalHistory([{ approval: { ...approval, id: 'bad' } }])), []);
  assert.deepEqual(plain(client.restoreAssistantTaskHistory('corrupt')), []);
});

test('draft confirmation checkpoints remain resumable and retain saved row cards and undo context at completion', () => {
  const batchAgent = agent({ pending_action_id: undefined, pending_batch_id: uuid(3) });
  const draft = { id: uuid(11), type: 'expense', amount_cents: 1200, amount: '12.00', description: '午餐', category_id: uuid(12), member_id: uuid(13),
    transaction_date: '2026-10-09', payment_method: null, note: '' };
  const pending = task({ agent: batchAgent, result: plan({ action: 'record', drafts: [draft], agent: batchAgent }) });
  assert.equal(client.assistantAgentWaiting(pending), true);
  const before = client.mergeAssistantTasks([user], [pending], uuid(4), [{ id: uuid(13), name: '自己' }]);
  const saved = before.map(message => message.role === 'assistant' ? { ...message, status: 'saved', savedDrafts: [draft] } : message);
  const completed = task({ attempt: 2, agent: agent({ status: 'completed', pending_action_id: undefined }),
    result: plan({ reply: '已核对午餐入账', agent: agent({ status: 'completed', pending_action_id: undefined }) }) });
  const next = client.mergeAssistantTasks(saved, [completed], uuid(4), []);
  assert.equal(next[1].id, uuid(3));
  assert.equal(next[1].status, 'saved');
  assert.equal(next[1].drafts[0].amount, '12.00');
  assert.equal(next[1].savedDrafts[0].id, draft.id);
  assert.equal(next[1].text, '已核对午餐入账');
  assert.deepEqual(plain(client.mergeAssistantTasks(plain(next), [completed], uuid(4), [])), plain(next));
});

test('stop follows a raced resume attempt before a replacement user request can continue', async () => {
  const attempts = [];
  const stopped = await client.cancelAssistantTaskCheckpoint(task({ agent: agent() }), async (_url, options) => {
    const { action, attempt } = JSON.parse(options.body); assert.equal(action, 'cancel'); attempts.push(attempt);
    return { ok: true, json: async () => ({ task: attempts.length === 1
      ? task({ status: 'running', attempt: 2, agent: agent({ status: 'running' }) })
      : task({ status: 'cancelled', attempt: 2, agent: agent({ status: 'stopped', pending_action_id: undefined }) }) }) };
  });
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(stopped.task.status, 'cancelled');
  await assert.rejects(client.cancelAssistantTaskCheckpoint(task(), async () => ({ ok: true, json: async () => ({ task: task() }) })), /暂未停止/);
});

test('unchanged resumed polling preserves the stable goal subtree and its earlier results', () => {
  const active = task({ status: 'running', attempt: 2, agent: agent({ status: 'running' }), updated_at: '2026-10-09T00:02:00.000Z' });
  const running = client.mergeAssistantTasks(checkpoint(), [active], uuid(4), []);
  const repeated = client.mergeAssistantTasks(running, [plain(active)], uuid(4), []);
  assert.equal(repeated, running);
  assert.equal(repeated[1], running[1]);
});

test('expandable agent processing details show observed ledger steps and a checkpoint label without model payloads', () => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/assistant/processing-details.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Date, require(name) {
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'lucide-react') return { Check: 'Check', ChevronRight: 'ChevronRight', Circle: 'Circle', Loader2: 'Loader2', Minus: 'Minus', X: 'X' };
    if (name === 'react') return {};
    return load(`${name.slice(2)}.ts`);
  } });
  const process = load('lib/assistant-process.ts').assistantProcessFromTask(task({ execution_steps: [{ id: 'read', label: '查询账本记录', kind: 'tool',
    state: 'done', startedAt: 1000, finishedAt: 2000, details: ['匹配 3 笔午餐记录'], prompt: 'private prompt', sql: 'private SQL' }] }));
  const tree = exports.AssistantProcessingDetails({ process, summaryLabel: '等待确认方案' });
  const text = element => element == null || typeof element === 'boolean' ? '' : Array.isArray(element) ? element.map(text).join('')
    : typeof element === 'object' ? text(element.props?.children) : String(element);
  assert.equal(tree.type, 'details');
  assert.match(text(tree), /等待确认方案/);
  assert.match(text(tree), /查询账本记录.*匹配 3 笔午餐记录/);
  assert.doesNotMatch(text(tree), /处理完成|private prompt|private SQL/);
});

test('explicit retry of a stopped active run accepts only a newer authoritative attempt and clears stopped feedback', () => {
  const stopped = task({ status: 'cancelled', result: null, agent: agent({ status: 'stopped', pending_action_id: undefined }) });
  const staleRevival = task({ status: 'running', result: null, agent: agent({ status: 'running', pending_action_id: undefined }), updated_at: '2026-10-09T00:02:00.000Z' });
  const current = [stopped];
  assert.equal(client.reconcileAssistantTaskSnapshots(current, [staleRevival]), current);
  const retry = { ...staleRevival, attempt: 2 };
  const snapshots = client.reconcileAssistantTaskSnapshots(current, [retry]);
  assert.equal(snapshots[0].attempt, 2);
  assert.equal(snapshots[0].status, 'running');
  assert.equal(snapshots[0].agent.status, 'running');
  const messages = client.mergeAssistantTasks([user], [stopped], uuid(4), []);
  assert.equal(messages[1].incomplete, 'stopped');
  const resumed = client.mergeAssistantTasks(messages, snapshots, uuid(4), []);
  assert.equal(resumed[1].id, stopped.id);
  assert.equal(resumed[1].agent.status, 'running');
  assert.equal(resumed[1].taskStatus, 'running');
  assert.equal(resumed[1].incomplete, undefined);
  assert.equal(resumed[1].error, undefined);
  assert.equal(client.reconcileAssistantTaskSnapshots(snapshots, [stopped]), snapshots);
});

test('stopped pending action keeps one authoritative card across polls and fresh recovery', () => {
  const pending = task({ result: plan({ action: 'manage', approval }), approval_history: [{ approval }] });
  const before = client.mergeAssistantTasks([user], [pending], uuid(4), []);
  const cancelled = result({ status: 'cancelled', text: '本次操作已取消，未执行。' });
  const stopped = task({ status: 'cancelled', agent: agent({ status: 'stopped', pending_action_id: undefined }),
    result: plan({ action: 'manage', approval }), approval_history: [{ approval, result: cancelled }] });
  for (const messages of [before, [], before.map(m => m.role === 'assistant' ? { ...m, approval: undefined, agent: stopped.agent } : m)]) {
    const next = client.mergeAssistantTasks(messages, [{ ...stopped, input: { display_text: user.text, display_images: [] } }], uuid(4), []);
    const card = next.find(m => m.role === 'assistant');
    assert.equal(card.actionResult.id, approval.id);
    assert.equal(card.actionResult.status, 'cancelled');
    assert.equal(card.approval, undefined);
    assert.equal(card.actionPreview.title, approval.preview.title);
    assert.equal(card.incomplete, undefined);
    const historyCards = card.approvalHistory.filter(entry => entry.approval.id !== (card.approval?.id || card.actionResult?.id));
    assert.equal(historyCards.length, 0, 'receipt is rendered on the current card only');
    assert.equal(client.mergeAssistantTasks(next, [{ ...stopped, input: { display_text: user.text, display_images: [] } }], uuid(4), []), next);
  }
});

test('sending an unrelated request preserves all waiting approvals and never submits cancellation', async () => {
  const source = fs.readFileSync('app/dashboard/assistant/page.tsx', 'utf8');
  const file = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let send;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'send') send = node; ts.forEachChild(node, visit); }
  visit(file); assert.ok(send);
  const waiting = client.mergeAssistantTasks([user], [task({ result: plan({ action: 'manage', approval }) })], uuid(4), []);
  const otherApproval = { ...approval, id: uuid(20), summary: '另一条待确认便利贴' };
  waiting.push({ id: uuid(21), role: 'assistant', text: otherApproval.summary, approval: otherApproval });
  const submitted = [], persisted = [];
  const ref = current => ({ current });
  const exports = {};
  vm.runInNewContext(ts.transpileModule(`export ${send.getText(file)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, crypto: require('node:crypto'), input: '小美生日，我送她一双200元鞋子和500元礼金', images: [], messages: waiting,
    actionPendingRef: ref(false), busy: false, outboxRef: ref(null), sendLock: ref(false), saveLock: ref(false),
    draft: { hasDraft: false, status: 'ready', persist: snapshot => { persisted.push(plain(snapshot)); return true; } }, configured: true,
    conversationId: uuid(4), conversationEpoch: ref(0), currentConversation: () => true,
    knownTasks: ref([task()]), assistantAgentWaiting: client.assistantAgentWaiting,
    cancelAssistantTaskCheckpoint: () => { throw new Error('New message must not cancel an old proposal'); },
    isActionStatusRequest: () => false, approvalDecision: () => null, localCalendarDate: () => '2026-10-09',
    setSending() {}, setOutbox() {}, setOutboxPersistable() {}, setMessages() {}, setInput() {}, setImages() {},
    confirmationsRef: ref([]), undosRef: ref([]), toast: { error(message) { throw new Error(message); }, info() {} },
    submitTask: async request => submitted.push(plain(request)),
  });
  await exports.send();
  assert.equal(submitted.length, 1);
  assert.equal(persisted[0].messages.filter(m => m.approval).length, 2);
  assert.equal(persisted[0].messages.find(m => m.id === uuid(3)).approval.id, approval.id);
  assert.equal(persisted[0].messages.at(-1).text, submitted[0].message);
});

test('add-another creates a separate draft batch and recovery preserves the original pending transaction', () => {
  const original = { id: uuid(11), type: 'expense', amount_cents: 2000, description: '吃饭', category_id: uuid(12), member_id: null,
    transaction_date: '2026-10-09', payment_method: null, note: '' };
  const batchAgent = agent({ pending_action_id: undefined, pending_batch_id: uuid(3) });
  const first = task({ agent: batchAgent, result: plan({ action: 'record', drafts: [original], agent: batchAgent }) });
  const before = client.mergeAssistantTasks([user], [first], uuid(4), []);
  const nextId = uuid(30), nextUserId = uuid(31), nextDraft = { ...original, id: uuid(32) };
  const nextAgent = agent({ goal_id: nextId, goal: '新增一笔', pending_action_id: undefined, pending_batch_id: nextId });
  const second = task({ id: nextId, user_message_id: nextUserId, agent: nextAgent, result: plan({ action: 'record', drafts: [nextDraft], agent: nextAgent }),
    input: { display_text: '新增一笔', display_images: [] } });
  const after = client.mergeAssistantTasks(before, [second], uuid(4), []);
  assert.equal(after.find(m => m.id === first.id), before.find(m => m.id === first.id));
  const added = after.find(m => m.id === second.id);
  assert.equal(added.status, 'pending');
  assert.equal(added.drafts.length, 1);
  assert.equal(added.drafts[0].amount, '20.00');
  assert.equal(added.drafts[0].id, nextDraft.id);
  assert.notEqual(added.drafts[0].id, original.id);
  assert.deepEqual(plain(client.mergeAssistantTasks(plain(after), [first, second], uuid(4), [])), plain(after));
});

test('member selection keeps question-answer-review order and the stable agent batch through polling and stopping', () => {
  const draft = { id: uuid(11), type: 'expense', amount_cents: 2000, description: '吃饭', category_id: uuid(12), member_id: null,
    transaction_date: '2026-10-09', payment_method: null, note: '' };
  const batchAgent = agent({ pending_action_id: undefined, pending_batch_id: uuid(3) });
  const original = task({ agent: batchAgent, result: plan({ action: 'record', drafts: [draft], agent: batchAgent }) });
  const before = client.mergeAssistantTasks([user], [original], uuid(4), [{ id: uuid(13), name: '本人' }]);
  const answer = { id: uuid(20), role: 'user', text: '吃饭：支出人是「本人」' };
  const selected = client.completeAssistantMemberSelection([...before, answer], original.id, { id: uuid(13), name: '本人' }, [{ id: uuid(13), name: '本人' }], answer.id, uuid(21));
  assert.deepEqual(plain(selected.map(m => m.id)), [user.id, uuid(21), answer.id, original.id]);
  assert.equal(selected.at(-1).agent.pending_batch_id, original.id);
  assert.equal(selected.at(-1).drafts[0].id, draft.id);
  assert.equal(selected.at(-1).drafts[0].member_id, uuid(13));
  assert.equal(selected[1].taskId, undefined, 'the static question cannot replay the old task');
  const restored = client.mergeAssistantTasks(plain(selected), [original], uuid(4), [{ id: uuid(13), name: '本人' }]);
  assert.deepEqual(plain(restored), plain(selected));
  assert.equal(client.completeAssistantMemberSelection(restored, original.id, { id: uuid(13), name: '本人' }, [{ id: uuid(13), name: '本人' }], answer.id, uuid(22)), restored, 'repeated acknowledgements cannot duplicate the card');
  const stopped = task({ ...original, status: 'cancelled', agent: { ...batchAgent, status: 'stopped', pending_batch_id: undefined } });
  const next = client.mergeAssistantTasks(restored, [stopped], uuid(4), [{ id: uuid(13), name: '本人' }]);
  assert.deepEqual(plain(next.map(m => m.id)), plain(selected.map(m => m.id)));
  assert.equal(next.at(-1).drafts[0].member_id, uuid(13));
});

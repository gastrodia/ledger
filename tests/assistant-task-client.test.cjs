/* eslint-disable @typescript-eslint/no-require-imports -- real recovery contracts in an isolated module loader. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const conversationId = uuid(100);
const members = [{ id: uuid(2), name: '自己' }, { id: uuid(3), name: '家人' }];
const plain = value => JSON.parse(JSON.stringify(value));
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };

function loadClient(globals = {}) {
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const exports = {};
    modules.set(filename, exports);
    const source = ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
      exports, JSON, Date, Error, AbortController, setTimeout, clearTimeout,
      fetch() { throw new Error('Recovery must not make financial requests'); },
      ...globals,
      require(name) {
        assert.ok(name.startsWith('@/lib/'), `Unexpected dependency ${name}`);
        return load(`${name.slice(2)}.ts`);
      },
    });
    return exports;
  }
  return load('lib/assistant-task-client.ts');
}

const client = loadClient();
function row(id = 10, extra = {}) {
  return { id: uuid(id), type: 'expense', amount_cents: 697, category_id: uuid(1), member_id: uuid(2),
    transaction_date: '2026-09-30', description: '深圳通乘车', payment_method: '微信', note: '', ...extra };
}
function plan(extra = {}) {
  return { action: 'record', reply: '已识别，请核对后确认入账。', drafts: [row()], query: null, ...extra };
}
function task(extra = {}) {
  return { id: uuid(30), conversation_id: conversationId, user_message_id: uuid(20), status: 'succeeded', phase: 'images',
    text: '', result: plan(), error: null, attempt: 1, created_at: '2026-10-08T01:00:00.000Z',
    updated_at: '2026-10-08T01:01:00.000Z', ...extra };
}
const imageProgress = (extra = {}) => ({ total: 5, completed: 2, failed: [], active: [3, 4], stage: 'recognizing', ...extra });
function user(extra = {}) { return { id: uuid(20), role: 'user', text: '识别这张截图', ...extra }; }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function pollFixture(fetch, extra = {}) {
  const timers = new Map(), received = [], errors = [];
  let nextTimer = 0;
  const pollClient = loadClient({
    setTimeout(action, ms) { const id = ++nextTimer; timers.set(id, { action, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const subscription = pollClient.subscribeAssistantTasks({
    conversationId, needsInput: () => false, onTasks: tasks => received.push(tasks), onError: error => errors.push(error),
    fetch, ...extra,
  });
  return { subscription, timers, received, errors, tick() {
    assert.equal(timers.size, 1);
    const [id, timer] = [...timers][0];
    timers.delete(id);
    timer.action();
  } };
}

test('reopening restores the original input and exactly one stable pending draft batch', () => {
  const image = { name: 'metro.png', data: 'data:image/png;base64,YQ==' };
  const completed = task({ input: { message: '识别截图', display_text: '识别这 1 张截图', display_images: [image] } });
  const recovered = client.mergeAssistantTasks([], [completed], conversationId, members);
  assert.equal(recovered.length, 2);
  assert.equal(recovered[0].id, completed.user_message_id);
  assert.equal(recovered[0].text, completed.input.display_text);
  assert.deepEqual(plain(recovered[0].images), [image]);
  const reply = recovered[1];
  assert.equal(reply.id, completed.id);
  assert.equal(reply.status, 'pending');
  assert.equal(reply.taskApplied, true);
  assert.equal(reply.drafts[0].amount, '6.97');
  assert.equal(reply.drafts[0].amount_cents, 697);
  assert.equal(reply.commit, undefined);
  assert.equal(reply.savedDrafts, undefined);
  const reopened = client.mergeAssistantTasks(plain(recovered), [completed, completed], conversationId, members);
  assert.deepEqual(plain(reopened), plain(recovered));
});

test('applied replies never resurrect edited, deleted, saved or moved member-selection drafts', () => {
  const completed = task();
  const recovered = client.mergeAssistantTasks([user()], [completed], conversationId, members);
  const originalReply = recovered[1];
  const variants = [
    [{ ...originalReply, drafts: [{ ...originalReply.drafts[0], amount: '8.00', description: '手动修正', member_id: uuid(3) }] }],
    [{ ...originalReply, status: 'deleted', drafts: [] }],
    [{ ...originalReply, status: 'saved', savedDrafts: [row()] }],
    [{ ...originalReply, drafts: undefined, memberFlow: false },
      { id: uuid(50), role: 'assistant', text: '已选择家人', status: 'pending', drafts: [{ ...originalReply.drafts[0], member_id: uuid(3) }] }],
  ];
  for (const replies of variants) {
    // Serialize first to exercise the persisted taskApplied marker after reload.
    const persisted = plain([recovered[0], ...replies]);
    const repeated = client.mergeAssistantTasks(persisted, [completed], conversationId, members);
    assert.deepEqual(plain(repeated.slice(1)), plain(persisted.slice(1)));
    assert.equal(repeated.filter(message => message.id === completed.id).length, 1);
  }
});

test('recovered member updates apply once and never overwrite a subsequent user edit', () => {
  const original = { id: uuid(40), role: 'assistant', text: '待核对', status: 'pending',
    drafts: [row(10, { amount: '6.97' }), row(11, { amount: '6.97' })] };
  const completed = task({ result: plan({ action: 'update', drafts: [], update: {
    batch_id: original.id, draft_ids: [uuid(10)], member_id: uuid(3),
  } }) });
  const merged = client.mergeAssistantTasks([original, user()], [completed], conversationId, members);
  assert.equal(merged[0].drafts[0].member_id, uuid(3));
  assert.equal(merged[0].drafts[1].member_id, uuid(2));
  assert.equal(original.drafts[0].member_id, uuid(2), 'merge leaves the input immutable');
  const edited = plain(merged);
  edited[0].drafts[0].member_id = uuid(2);
  edited[0].drafts[0].amount = '9.00';
  const replayed = client.mergeAssistantTasks(edited, [completed], conversationId, members);
  assert.deepEqual(plain(replayed), edited);
});

test('recovered member choices target only current editable rows and keep the displayed sort order', () => {
  const original = { id: uuid(40), role: 'assistant', text: '待核对', status: 'pending', draftSort: 'date-desc',
    drafts: [row(10, { transaction_date: '2026-09-29' }), row(11, { transaction_date: '2026-09-30' })] };
  const choice = { batch_id: original.id, draft_ids: [uuid(10), uuid(11)], member_id: null };
  const completed = task({ result: plan({ action: 'update', drafts: [], update: choice }) });
  const recovered = client.mergeAssistantTasks([original, user()], [completed], conversationId, members);
  assert.deepEqual(plain(recovered.at(-1).memberChoice), choice);
  assert.deepEqual(plain(client.assistantMemberChoiceTarget(choice, recovered).drafts.map(draft => draft.id)), [uuid(11), uuid(10)]);
  for (const invalidTarget of [
    { ...original, status: 'saved' }, { ...original, commit: [row()] },
    { ...original, drafts: [row(10), row(11, { ignored: true })] },
  ]) {
    const invalid = client.mergeAssistantTasks([invalidTarget, user()], [completed], conversationId, members);
    assert.equal(invalid.at(-1).memberChoice, undefined);
    assert.match(invalid.at(-1).text, /草稿状态已变化/);
  }
});

test('recovering an undo offers explicit confirmation without fetching or modifying saved transactions', () => {
  let requests = 0;
  const undoClient = loadClient({ fetch() { requests += 1; throw new Error('Unexpected financial write'); } });
  const saved = { id: uuid(40), role: 'assistant', text: '已入账', status: 'saved', drafts: [row()] };
  const undo = { batch_id: saved.id, draft_ids: [uuid(10)] };
  const completed = task({ result: plan({ action: 'undo', drafts: [], undo }) });
  const recovered = undoClient.mergeAssistantTasks([saved, user()], [completed], conversationId, members);
  assert.deepEqual(plain(recovered[0]), saved);
  assert.deepEqual(plain(recovered.at(-1).undoChoice), undo);
  assert.match(recovered.at(-1).text, /确认撤销/);
  assert.equal(recovered.at(-1).drafts, undefined);
  assert.equal(requests, 0);
  const stale = undoClient.mergeAssistantTasks([{ ...saved, status: 'undone' }, user()], [completed], conversationId, members);
  assert.equal(stale.at(-1).undoChoice, undefined);
  assert.match(stale.at(-1).text, /原账单状态已变化/);
  assert.equal(requests, 0);
});

test('different conversations, invalid task identities and missing inputs cannot add replies to the conversation', () => {
  const messages = [user()];
  for (const unrelated of [
    task({ conversation_id: uuid(101) }), task({ id: 'invalid' }), task({ user_message_id: 'invalid' }),
    task({ user_message_id: uuid(999) }),
  ]) assert.deepEqual(plain(client.mergeAssistantTasks(messages, [unrelated], conversationId, members)), messages);
});

test('failed and cancelled tasks preserve retry context while successful recovery removes interrupted state', () => {
  for (const status of ['failed', 'cancelled']) {
    const incomplete = task({ status, result: null, error: status === 'failed' ? '识别超时' : null });
    const recovered = client.mergeAssistantTasks([user()], [incomplete], conversationId, members);
    assert.equal(recovered[0].taskId, incomplete.id);
    assert.equal(recovered[1].taskApplied, undefined);
    assert.equal(recovered[1].incomplete, status === 'failed' ? 'interrupted' : 'stopped');
    assert.match(recovered[1].error, status === 'failed' ? /识别超时/ : /重新识别/);
    const finished = client.mergeAssistantTasks(recovered, [task({ attempt: 2 })], conversationId, members);
    assert.equal(finished.length, 2);
    assert.equal(finished[0].incomplete, undefined);
    assert.equal(finished[1].error, undefined);
    assert.equal(finished[1].taskApplied, true);
  }
});

test('task snapshots reject stale attempts and timestamps and never regress a successful result', () => {
  const input = { message: '识别截图', display_text: '识别这张截图', display_images: [] };
  const running = task({ status: 'running', result: null, attempt: 2, updated_at: '2026-10-08T01:02:00.000Z', input });
  for (const stale of [
    task({ attempt: 1, updated_at: '2026-10-08T01:03:00.000Z' }),
    task({ attempt: 2, updated_at: '2026-10-08T01:01:00.000Z' }),
  ]) assert.deepEqual(plain(client.reconcileAssistantTaskSnapshots([running], [stale])), [running]);
  const succeeded = task({ attempt: 2, updated_at: '2026-10-08T01:03:00.000Z' });
  const complete = client.reconcileAssistantTaskSnapshots([running], [succeeded]);
  assert.equal(complete[0].status, 'succeeded');
  assert.deepEqual(plain(complete[0].input), input);
  for (const status of ['queued', 'running', 'failed', 'cancelled']) {
    const late = task({ status, attempt: 3, updated_at: '2026-10-08T01:04:00.000Z', result: null });
    assert.deepEqual(plain(client.reconcileAssistantTaskSnapshots(complete, [late])), plain(complete));
  }
  const failed = task({ status: 'failed', result: null, updated_at: '2026-10-08T01:02:00.000Z' });
  assert.equal(client.reconcileAssistantTaskSnapshots([failed], [task({ status: 'running', result: null,
    updated_at: '2026-10-08T01:03:00.000Z' })])[0].status, 'failed');
  assert.equal(client.reconcileAssistantTaskSnapshots([failed], [running])[0].status, 'running', 'a new retry attempt may start');
});

test('identical running and terminal polls preserve the message array and every message reference', () => {
  for (const status of ['running', 'succeeded', 'failed', 'cancelled']) {
    const snapshot = task({ status, result: status === 'succeeded' ? plan() : null,
      error: status === 'failed' ? '识别超时' : null });
    const unrelated = { id: uuid(90), role: 'assistant', text: '之前的对话' };
    const recovered = client.mergeAssistantTasks([unrelated, user()], [snapshot], conversationId, members);
    assert.equal(recovered[0], unrelated);
    for (let poll = 0; poll < 3; poll += 1) {
      const repeated = client.mergeAssistantTasks(recovered, [plain(snapshot)], conversationId, members);
      assert.equal(repeated, recovered, `${status}: an unchanged poll must not publish new messages`);
      repeated.forEach((message, index) => assert.equal(message, recovered[index], `${status}: message ${index} stays mounted`));
    }
  }
});

test('polling preserves applied message references after edits, deletion, saving and moving a member card', () => {
  const completed = task();
  const recovered = client.mergeAssistantTasks([user()], [completed], conversationId, members);
  const originalReply = recovered[1];
  const variants = [
    [{ ...originalReply, drafts: [{ ...originalReply.drafts[0], amount: '8.00', description: '手动修正', member_id: uuid(3) }] }],
    [{ ...originalReply, status: 'deleted', drafts: [] }],
    [{ ...originalReply, status: 'saved', savedDrafts: [row()] }],
    [{ ...originalReply, drafts: undefined, memberFlow: false },
      { id: uuid(50), role: 'assistant', text: '已选择家人', status: 'pending', drafts: [{ ...originalReply.drafts[0], member_id: uuid(3) }] }],
  ];
  for (const replies of variants) {
    const edited = [recovered[0], ...replies];
    const repeated = client.mergeAssistantTasks(edited, [plain(completed)], conversationId, members);
    assert.equal(repeated, edited, 'polling must not reset the edited conversation');
    repeated.forEach((message, index) => {
      assert.equal(message, edited[index]);
      assert.equal(message.drafts, edited[index].drafts, 'draft cards retain their local edit state');
    });
  }
});

test('retrying a failed task removes its failed reply once and repeated running polls are stable', () => {
  const failed = task({ status: 'failed', result: null, error: '识别超时' });
  const unrelated = { id: uuid(90), role: 'assistant', text: '之前的对话' };
  const messages = client.mergeAssistantTasks([unrelated, user()], [failed], conversationId, members);
  const before = plain(messages);
  const retry = task({ status: 'running', result: null, attempt: 2, updated_at: '2026-10-08T01:02:00.000Z' });
  const resumed = client.mergeAssistantTasks(messages, [retry], conversationId, members);
  assert.notEqual(resumed, messages);
  assert.equal(resumed.length, 2);
  assert.equal(resumed[0], unrelated);
  assert.notEqual(resumed[1], messages[1]);
  assert.equal(resumed[1].taskStatus, 'running');
  assert.equal(resumed[1].taskAttempt, 2);
  assert.equal(resumed[1].error, undefined);
  assert.ok(resumed.every(message => message.id !== failed.id), 'the old failure must disappear while retrying');
  assert.deepEqual(plain(messages), before, 'retrying must leave the prior snapshot immutable');
  const repeated = client.mergeAssistantTasks(resumed, [plain(retry)], conversationId, members);
  assert.equal(repeated, resumed);
  repeated.forEach((message, index) => assert.equal(message, resumed[index]));
});

test('deeply equal task snapshots preserve the array, tasks and nested input and result references', () => {
  const completed = task({ input: { message: '识别截图', display_text: '识别这张截图',
    display_images: [{ name: 'metro.png', data: 'data:image/png;base64,YQ==' }] } });
  const other = task({ id: uuid(31), user_message_id: uuid(21), created_at: '2026-10-08T01:01:00.000Z' });
  const current = [completed, other];
  const cloned = plain(current);
  // JSON responses need not preserve object key insertion order.
  cloned[0].input.display_images[0] = { data: completed.input.display_images[0].data, name: 'metro.png' };
  cloned[0].result.drafts[0] = Object.fromEntries(Object.entries(cloned[0].result.drafts[0]).reverse());
  const repeated = client.reconcileAssistantTaskSnapshots(current, cloned);
  assert.equal(repeated, current);
  repeated.forEach((snapshot, index) => assert.equal(snapshot, current[index]));
  assert.equal(repeated[0].result, completed.result);
  assert.equal(repeated[0].input, completed.input);
  assert.equal(client.reconcileAssistantTaskSnapshots(current, []), current, 'empty polls cannot recreate unchanged snapshots');
});

test('rejected stale task snapshots retain the original task array and objects', () => {
  const running = task({ status: 'running', result: null, text: '识别中', attempt: 2,
    updated_at: '2026-10-08T01:02:00.000Z' });
  const current = [running];
  for (const stale of [
    task({ attempt: 1, updated_at: '2026-10-08T01:03:00.000Z' }),
    task({ attempt: 2, updated_at: '2026-10-08T01:01:00.000Z', text: '过期回复' }),
  ]) {
    const repeated = client.reconcileAssistantTaskSnapshots(current, [stale]);
    assert.equal(repeated, current);
    assert.equal(repeated[0], running);
  }
  const completed = [task()];
  const lateRunning = task({ status: 'running', result: null, attempt: 2, updated_at: '2026-10-08T01:03:00.000Z' });
  assert.equal(client.reconcileAssistantTaskSnapshots(completed, [lateRunning]), completed);
});

test('heartbeat polls advance the freshness watermark without changing nested data or conversation messages', () => {
  const completed = task({ input: { message: '识别截图', display_text: '识别这张截图',
    display_images: [{ name: 'metro.png', data: 'data:image/png;base64,YQ==' }] } });
  const current = [completed];
  const messages = client.mergeAssistantTasks([], current, conversationId, members);
  const heartbeat = { ...plain(completed), updated_at: '2026-10-08T01:03:00.000Z' };
  const refreshed = client.reconcileAssistantTaskSnapshots(current, [heartbeat]);
  assert.notEqual(refreshed, current, 'the new freshness watermark must be recorded');
  assert.notEqual(refreshed[0], completed);
  assert.equal(refreshed[0].updated_at, heartbeat.updated_at);
  assert.equal(refreshed[0].input, completed.input);
  assert.equal(refreshed[0].result, completed.result);
  assert.equal(client.mergeAssistantTasks(messages, refreshed, conversationId, members), messages);
  assert.equal(client.reconcileAssistantTaskSnapshots(refreshed, [plain(heartbeat)]), refreshed);
  const staleText = { ...plain(completed), text: '较旧请求迟到的不同文本', updated_at: '2026-10-08T01:02:00.000Z' };
  assert.equal(client.reconcileAssistantTaskSnapshots(refreshed, [staleText]), refreshed,
    'ignoring a heartbeat visually must not allow an older different response through');
  assert.equal(completed.updated_at, '2026-10-08T01:01:00.000Z', 'watermark updates are immutable');
});

test('real response text and retry attempts still publish updated task snapshots', () => {
  const running = task({ status: 'running', result: null, text: '正在读取' });
  const current = [running];
  const progress = { ...plain(running), text: '已识别第一笔', updated_at: '2026-10-08T01:02:00.000Z' };
  const advanced = client.reconcileAssistantTaskSnapshots(current, [progress]);
  assert.notEqual(advanced, current);
  assert.notEqual(advanced[0], running);
  assert.equal(advanced[0].text, progress.text);
  const failed = task({ status: 'failed', result: null, error: '识别超时', updated_at: '2026-10-08T01:03:00.000Z' });
  const prior = [failed];
  const retry = { ...plain(failed), status: 'running', attempt: 2, error: null, text: '', updated_at: '2026-10-08T01:04:00.000Z' };
  const resumed = client.reconcileAssistantTaskSnapshots(prior, [retry]);
  assert.notEqual(resumed, prior);
  assert.notEqual(resumed[0], failed);
  assert.equal(resumed[0].attempt, 2);
  assert.equal(resumed[0].status, 'running');
  assert.equal(resumed[0].error, null);
});

test('image progress advances without publishing drafts and survives failed-task recovery', () => {
  const running = task({ status: 'running', result: null, image_progress: imageProgress() });
  const first = client.mergeAssistantTasks([user()], [running], conversationId, members);
  assert.equal(first.length, 1);
  assert.equal(first[0].drafts, undefined);
  assert.deepEqual(plain(first[0].image_progress), imageProgress());
  const next = { ...running, image_progress: imageProgress({ completed: 3, active: [4, 5] }), updated_at: '2026-10-08T01:02:00.000Z' };
  const advanced = client.reconcileAssistantTaskSnapshots([running], [next]);
  assert.notEqual(advanced[0], running);
  assert.deepEqual(plain(advanced[0].image_progress), next.image_progress);
  assert.equal(client.reconcileAssistantTaskSnapshots(advanced, [plain(next)]), advanced);
  const failed = { ...next, status: 'failed', error: '识别超时', image_progress: imageProgress({ completed: 4, failed: [5], active: [] }) };
  const recovered = client.mergeAssistantTasks(plain(first), [failed], conversationId, members);
  assert.equal(recovered.length, 2);
  assert.deepEqual(plain(recovered[1].image_progress), failed.image_progress);
  assert.equal(recovered[1].drafts, undefined);
  assert.equal(recovered[1].taskApplied, undefined);
  assert.equal(client.mergeAssistantTasks(recovered, [plain(failed)], conversationId, members), recovered);
  assert.equal(client.assistantTaskRetryLabel(recovered[1]), '继续识别');
  assert.match(client.assistantImageProgressText(recovered[1].image_progress, 'failed'), /第 5 张识别失败；已完成 4\/5 张，结果已保留/);
});

test('invalid image progress is dropped without losing the task or producing misleading completion', () => {
  for (const invalid of [
    [], '5/5', imageProgress({ total: 0 }), imageProgress({ total: 6 }), imageProgress({ total: '5' }),
    imageProgress({ completed: -1 }), imageProgress({ completed: 1.5 }), imageProgress({ completed: 6 }),
    imageProgress({ completed: NaN }), imageProgress({ active: [0] }), imageProgress({ active: [6] }),
    imageProgress({ active: ['3'] }), imageProgress({ active: [3, 3] }), imageProgress({ failed: [4, 4], active: [] }),
    imageProgress({ failed: [3] }), imageProgress({ completed: 4 }), imageProgress({ failed: null }),
    imageProgress({ stage: 'completed' }), imageProgress({ stage: 'merging' }),
    imageProgress({ stage: 'merging', completed: 5, active: [], failed: [1] }),
  ]) {
    const remote = task({ status: 'running', result: null, image_progress: invalid });
    const reconciled = client.reconcileAssistantTaskSnapshots([], [remote]);
    assert.equal(reconciled[0].id, remote.id);
    assert.equal(reconciled[0].image_progress, null);
    const merged = client.mergeAssistantTasks([user()], [remote], conversationId, members);
    assert.equal(merged[0].image_progress, undefined);
    assert.equal(merged[0].drafts, undefined);
    assert.equal(client.assistantTaskRetryLabel({ taskId: remote.id, taskStatus: 'failed', image_progress: invalid }), '重新处理');
  }
});

test('stale image attempts cannot overwrite retained results or retry progress', () => {
  const resumed = task({ status: 'running', result: null, attempt: 2,
    image_progress: imageProgress({ completed: 4, active: [5] }), updated_at: '2026-10-08T01:04:00.000Z' });
  const current = [resumed];
  const messages = client.mergeAssistantTasks([user()], current, conversationId, members);
  const late = task({ status: 'failed', result: null, attempt: 1,
    image_progress: imageProgress({ completed: 2, active: [], failed: [3, 4, 5] }), updated_at: '2026-10-08T01:05:00.000Z' });
  assert.equal(client.reconcileAssistantTaskSnapshots(current, [late]), current);
  assert.equal(client.mergeAssistantTasks(messages, [late], conversationId, members), messages);
  assert.equal(messages[0].image_progress.completed, 4);
});

test('queued, active, merging and recovered image labels describe observed progress only', () => {
  assert.equal(client.assistantImageProgressText(imageProgress({ active: [] }), 'queued'), '已完成 2/5 张，等待继续识别…');
  assert.equal(client.assistantImageProgressText(imageProgress(), 'running'), '已完成 2/5 张，正在识别第 3、4 张…');
  assert.equal(client.assistantImageProgressText(imageProgress(), 'recovering'), '上次进度：已完成 2/5 张，正在恢复处理进度…');
  const merged = imageProgress({ completed: 5, active: [], stage: 'merging' });
  assert.equal(client.assistantImageProgressText(merged, 'running'), '已完成 5/5 张，正在整理账目…');
  assert.equal(client.assistantTaskRetryLabel({ taskId: uuid(30), taskStatus: 'failed', image_progress: merged }), '重新整理结果');
  assert.equal(client.assistantTaskRetryLabel({ taskId: uuid(30), taskStatus: 'failed' }), '重新处理');
  assert.equal(client.assistantTaskRetryLabel({ taskId: uuid(30), taskStatus: 'missing', image_progress: merged }), '重试发送');
});

test('polling sanitizes image progress before publishing remote snapshots', async () => {
  const remote = task({ status: 'running', result: null, image_progress: imageProgress({ completed: 99 }) });
  const polling = pollFixture(async () => response({ tasks: [remote] }));
  try {
    await flush();
    assert.equal(polling.received.length, 1);
    assert.equal(polling.received[0][0].image_progress, null);
    assert.equal(polling.errors.length, 0);
  } finally { polling.subscription.stop(); }
});

test('stopping a page subscription only aborts its GET and cannot cancel the durable task', async () => {
  const calls = [], pending = deferred();
  const polling = pollFixture((url, options) => {
    calls.push({ url, options });
    options.signal.addEventListener('abort', () => pending.reject(new Error('aborted')), { once: true });
    return pending.promise;
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method || 'GET', 'GET');
  assert.equal(calls[0].options.cache, 'no-store');
  polling.subscription.stop();
  await flush();
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(calls.length, 1);
  assert.ok(calls.every(call => !call.url.includes('/cancel')));
  assert.equal(polling.received.length, 0);
  assert.equal(polling.errors.length, 0);
  assert.equal(polling.timers.size, 0);
  polling.subscription.refresh();
  await flush();
  assert.equal(calls.length, 1);
});

test('polling fetches unknown input with include_input=1 at concurrency three and skips existing screenshots', async () => {
  const tasks = Array.from({ length: 8 }, (_, index) => task({ id: uuid(200 + index), user_message_id: uuid(300 + index) }));
  tasks[6].input = { message: 'already returned', display_text: '已有内容', display_images: [] };
  tasks[7].conversation_id = uuid(101);
  const known = tasks[0].user_message_id;
  const calls = [], pending = [];
  let active = 0, peak = 0;
  const polling = pollFixture(async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith('/api/assistant/tasks?')) return response({ tasks });
    const match = url.match(/^\/api\/assistant\/tasks\/([^?]+)\?include_input=1$/);
    assert.ok(match, 'only explicitly requested unknown input is downloaded');
    const item = tasks.find(task => task.id === match[1]);
    assert.ok(item);
    active += 1;
    peak = Math.max(peak, active);
    const request = deferred();
    pending.push({ request, item });
    try { return await request.promise; } finally { active -= 1; }
  }, { needsInput: item => item.user_message_id !== known });
  try {
    await flush();
    assert.equal(pending.length, 3);
    assert.equal(active, 3);
    assert.equal(polling.received.length, 0);
    for (let index = 0; index < 5; index += 1) {
      const { request, item } = pending[index];
      request.resolve(response({ task: { ...item, input: {
        message: '识别截图', display_text: `截图 ${index + 1}`, display_images: [{ name: 'preview.png', data: 'data:image/png;base64,YQ==' }],
      } } }));
      await flush();
    }
    assert.equal(peak, 3);
    assert.equal(active, 0);
    assert.equal(calls.length, 6, 'one list request and five unknown-message requests');
    assert.ok(calls.every(call => (call.options.method || 'GET') === 'GET'));
    assert.ok(calls.slice(1).every(call => ![tasks[0], tasks[6], tasks[7]].some(task => call.url.includes(task.id))));
    assert.equal(polling.received.length, 1);
    assert.ok(polling.received[0].slice(1, 6).every(task => task.input.display_images.length === 1));
    assert.equal(polling.received[0][0].input, undefined);
    assert.equal([...polling.timers.values()][0].ms, 15000);
    assert.deepEqual(polling.errors, []);
  } finally { polling.subscription.stop(); }
});

test('refreshes coalesce while polling and terminal results use the idle interval', async () => {
  const pending = deferred();
  let requests = 0;
  const polling = pollFixture(async () => {
    requests += 1;
    return requests === 1 ? pending.promise : response({ tasks: [task()] });
  });
  try {
    polling.subscription.refresh();
    polling.subscription.refresh();
    assert.equal(requests, 1);
    pending.resolve(response({ tasks: [task({ status: 'running', result: null })] }));
    await flush();
    assert.equal(polling.received.length, 1);
    assert.equal([...polling.timers.values()][0].ms, 0);
    polling.tick();
    await flush();
    assert.equal(requests, 2);
    assert.equal(polling.received.length, 2);
    assert.equal([...polling.timers.values()][0].ms, 15000);
  } finally { polling.subscription.stop(); }
});

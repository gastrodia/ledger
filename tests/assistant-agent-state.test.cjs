/* eslint-disable @typescript-eslint/no-require-imports -- test durable server state with isolated dependencies. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const taskId = id(1), conversationId = id(2), actionId = id(3);
const checkpoint = () => ({ version: 1, goal_id: taskId, goal: '核对并整理重复记录', status: 'waiting_approval', steps: 2,
  messages: [{ role: 'system', content: 'PRIVATE PROMPT' }], tool_results: [{ call_id: 'tool-2', name: 'command_preview', result: { private_field: 'secret' } }],
  pending_approval: { action_id: actionId, fingerprint: 'abc' }, pending_approvals: [{ action_id: actionId, fingerprint: 'abc' }], preview_fingerprints: ['abc'] });
function load(file, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: name => { if (name in deps) return deps[name]; if (name.startsWith('@/')) return load(name.slice(2) + '.ts', deps); throw new Error(name); },
      Error, Date, JSON, Number, setTimeout, clearTimeout, console, AbortController, AbortSignal, process });
  return exports;
}
const state = load('lib/assistant-agent-state.ts');
const plain = value => JSON.parse(JSON.stringify(value));
test('checkpoint restores defensively and public state excludes model prompts and tool results', () => {
  const original = checkpoint();
  const restored = state.restoreAssistantAgentCheckpoint(original);
  assert.ok(restored); original.messages[0].content = 'changed';
  assert.equal(restored.messages[0].content, 'PRIVATE PROMPT');
  const metadata = state.assistantAgentMetadata(restored);
  assert.equal(metadata.status, 'waiting_approval');
  assert.equal(metadata.pending_action_id, actionId);
  assert.equal(JSON.stringify(metadata).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(metadata).includes('secret'), false);
  assert.deepEqual(plain(state.assistantAgentApprovalIds(restored)), [actionId]);
  for (const patch of [{ version: 2 }, { steps: -1 }, { status: 'made_up' }, { pending_approval: { action_id: 'foreign', fingerprint: '' } }, { messages: [{ role: 'tool', content: '' }] }]) {
    assert.equal(state.restoreAssistantAgentCheckpoint({ ...checkpoint(), ...patch }), null);
  }
});
test('pending and uncertain executing writes cannot resume; terminal decisions can', () => {
  for (const status of ['pending', 'executing']) assert.equal(state.assistantAgentApprovalSettled({ status }), false);
  for (const status of ['succeeded', 'cancelled', 'failed', 'expired']) assert.equal(state.assistantAgentApprovalSettled({ status }), true);
});
const PGlite = process.env.LEDGER_TASKS_PGLITE_MODULE ? require(process.env.LEDGER_TASKS_PGLITE_MODULE).PGlite : null;
async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec("CREATE TABLE users(id varchar(36) PRIMARY KEY); INSERT INTO users VALUES('owner'),('other');");
  const query = (text, values = []) => ({ text, values, then: (resolve, reject) => db.query(text, values).then(r => r.rows).then(resolve, reject) });
  const sql = () => { throw new Error('unexpected tagged SQL'); };
  sql.query = query;
  sql.transaction = async queries => { await db.exec('BEGIN'); try { const results = []; for (const q of queries) results.push(await q); await db.exec('COMMIT'); return results; } catch (e) { await db.exec('ROLLBACK'); throw e; } };
  const modules = { '@/lib/db': { sql }, 'node:crypto': crypto, '@/lib/assistant': { UUID_PATTERN: /^[0-9a-f-]{36}$/ },
    '@/lib/assistant-generation': { AssistantInputError: class extends Error {}, AssistantPlanError: class extends Error {}, validateAssistantInput: raw => raw },
    '@/lib/assistant-image-batches': {}, '@/lib/bailian': { bailianFailure: () => ({ message: '已停止' }) }, '@/lib/assistant-command-server': { decideAssistantAction: async (user, action) => {
      await db.query("UPDATE assistant_actions SET status='cancelled' WHERE user_id=$1 AND id=$2 AND status='pending'", [user, action]);
    } } };
  const schema = load('lib/assistant-task-schema.ts', modules); await schema.ensureAssistantTaskSchema();
  await db.exec("CREATE TABLE assistant_actions(id varchar(36) PRIMARY KEY,user_id varchar(36),conversation_id varchar(36),status text,result jsonb,payload jsonb);");
  await db.query('INSERT INTO assistant_task_conversations(user_id,id) VALUES($1,$2)', ['owner', conversationId]);
  await db.query(`INSERT INTO assistant_tasks(user_id,id,conversation_id,user_message_id,request_hash,payload,display_input,status,phase,result,agent_checkpoint)
    VALUES($1,$2,$3,$4,'hash',$5::jsonb,'{}','succeeded','thinking',$6::jsonb,$7::jsonb)`, ['owner', taskId, conversationId, id(4),
      JSON.stringify({ message: '原始目标', images: [] }), JSON.stringify({ action: 'manage', reply: '等待确认', drafts: [], query: null }), JSON.stringify(checkpoint())]);
  await db.query('INSERT INTO assistant_actions(id,user_id,conversation_id,status,result) VALUES($1,$2,$3,$4,$5::jsonb)', [actionId, 'owner', conversationId, 'pending', null]);
  return { db, modules, tasks: load('lib/assistant-tasks.ts', modules) };
}
if (PGlite) {
  test('SQL resume checks durable decisions and queues the same task once after lost acknowledgement', async t => {
    const f = await fixture(t);
    assert.equal((await f.tasks.changeAssistantTask('owner', taskId, 'resume', 1)).status, 'succeeded');
    await f.db.query("UPDATE assistant_actions SET status='succeeded',result=$1::jsonb", [JSON.stringify({ id: actionId, status: 'succeeded', text: '已删除1条' })]);
    const queued = await f.tasks.changeAssistantTask('owner', taskId, 'resume', 1);
    assert.equal(queued.status, 'queued'); assert.equal(queued.attempt, 2); assert.equal(queued.id, taskId);
    assert.equal(queued.result.reply, '等待确认');
    const replay = await f.tasks.changeAssistantTask('owner', taskId, 'resume', 1);
    assert.equal(replay.attempt, 2);
    const stored = (await f.db.query('SELECT agent_checkpoint,payload FROM assistant_tasks')).rows[0];
    assert.equal(stored.agent_checkpoint.approval_outcome.status, 'succeeded'); assert.equal(stored.payload.message, '原始目标');
    assert.equal(JSON.stringify(queued).includes('PRIVATE PROMPT'), false);
  });
  test('SQL foreign users, mismatched conversations, and cleared conversations cannot resume', async t => {
    const f = await fixture(t);
    await assert.rejects(f.tasks.changeAssistantTask('other', taskId, 'resume', 1), e => e.status === 404);
    await f.db.query("UPDATE assistant_actions SET status='cancelled',conversation_id=$1", [id(99)]);
    await assert.rejects(f.tasks.changeAssistantTask('owner', taskId, 'resume', 1), e => e.status === 409);
    await f.db.query('UPDATE assistant_actions SET conversation_id=$1', [conversationId]);
    await f.tasks.cancelConversationTasks('owner', conversationId);
    await assert.rejects(f.tasks.changeAssistantTask('owner', taskId, 'resume', 1), e => e.status === 409);
    const stored = (await f.db.query('SELECT agent_checkpoint,payload FROM assistant_tasks')).rows[0];
    assert.equal(stored.agent_checkpoint, null); assert.equal(stored.payload, null);
  });
  test('SQL all pending approvals must settle and waiting task cancellation stops continuation', async t => {
    const f = await fixture(t);
    const c = checkpoint(); c.pending_approvals.push({ action_id: id(5), fingerprint: 'second' });
    await f.db.query('UPDATE assistant_tasks SET agent_checkpoint=$1::jsonb', [JSON.stringify(c)]);
    await f.db.query("INSERT INTO assistant_actions(id,user_id,conversation_id,status,result) VALUES($1,'owner',$2,'executing',NULL)", [id(5), conversationId]);
    await f.db.query("UPDATE assistant_actions SET status='succeeded' WHERE id=$1", [actionId]);
    assert.equal((await f.tasks.changeAssistantTask('owner', taskId, 'resume', 1)).status, 'succeeded');
    const cancelled = await f.tasks.changeAssistantTask('owner', taskId, 'cancel', 1);
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.agent.status, 'stopped');
    assert.equal((await f.tasks.changeAssistantTask('owner', taskId, 'resume', 1)).status, 'cancelled');
  });
  test('SQL replacement previews rebind without running the provider until replacement settles', async t => {
    const f = await fixture(t);
    const savedCheckpoint = checkpoint(); savedCheckpoint.pending_plan = { action: 'manage', reply: '旧方案', drafts: [], query: null, approval: { id: actionId, summary: '旧方案', count: 1, expires_at: null } };
    await f.db.query('UPDATE assistant_tasks SET agent_checkpoint=$1::jsonb', [JSON.stringify(savedCheckpoint)]);
    const replacement = { id: id(8), summary: '请核对最新记录', count: 1, expires_at: null };
    await f.db.query("UPDATE assistant_actions SET status='failed',result=$1::jsonb WHERE id=$2", [JSON.stringify({ id: actionId, status: 'failed', text: '目标已变化', replacement_approval: replacement }), actionId]);
    await f.db.query("INSERT INTO assistant_actions(id,user_id,conversation_id,status) VALUES($1,'owner',$2,'pending')", [replacement.id, conversationId]);
    const rebound = await f.tasks.changeAssistantTask('owner', taskId, 'resume', 1);
    assert.equal(rebound.status, 'succeeded'); assert.equal(rebound.attempt, 1);
    assert.equal(rebound.agent.pending_action_id, replacement.id); assert.equal(rebound.result.approval.id, replacement.id);
    await f.db.query("UPDATE assistant_actions SET status='cancelled' WHERE id=$1", [replacement.id]);
    const resumed = await f.tasks.changeAssistantTask('owner', taskId, 'resume', 1);
    assert.equal(resumed.status, 'queued'); assert.equal(resumed.attempt, 2);
    const stored = (await f.db.query('SELECT agent_checkpoint FROM assistant_tasks')).rows[0].agent_checkpoint;
    assert.equal(stored.approval_outcome.id, replacement.id); assert.equal(stored.approval_outcome.status, 'cancelled');
    assert.equal(stored.pending_plan.approval.id, replacement.id);
  });
  test('SQL draft confirmation restores only server-mapped owned rows; partial batches stop safely', async t => {
    const f = await fixture(t);
    await f.db.exec("CREATE TABLE assistant_batches(user_id varchar(36),id varchar(36),payload_hash text,draft_transactions jsonb,undone_draft_ids jsonb,revoked_at timestamptz); CREATE TABLE transactions(id varchar(36),user_id varchar(36));");
    const c = checkpoint(); c.pending_approval = null; c.pending_approvals = []; c.pending_batch = { batch_id: taskId, draft_ids: [id(10), id(11)] };
    await f.db.query('UPDATE assistant_tasks SET agent_checkpoint=$1::jsonb', [JSON.stringify(c)]);
    assert.equal((await f.tasks.changeAssistantTask('owner', taskId, 'resume', 1)).status, 'succeeded');
    await f.db.query("INSERT INTO assistant_batches VALUES('owner',$1,'batch-hash',$2::jsonb,'[]',NULL)", [taskId, JSON.stringify([{ draft_id: id(10), transaction_id: id(20) }, { draft_id: id(11), transaction_id: id(21) }])]);
    await f.db.query("INSERT INTO transactions VALUES($1,'owner'),($2,'owner')", [id(20), id(21)]);
    const resumed = await f.tasks.changeAssistantTask('owner', taskId, 'resume', 1);
    assert.equal(resumed.status, 'queued'); assert.equal(resumed.agent.pending_batch_id, taskId);
    const full = (await f.db.query('SELECT agent_checkpoint FROM assistant_tasks')).rows[0].agent_checkpoint;
    assert.equal(full.approval_outcome.status, 'succeeded'); assert.equal(full.approval_outcome.completed, 2);
    assert.deepEqual(full.approval_outcome.targets[0].ids.sort(), [id(20), id(21)]);
    assert.ok(full.messages.at(-1).content.includes(id(20)));
    await f.db.query("UPDATE assistant_tasks SET status='succeeded',attempt=1,agent_checkpoint=$1::jsonb", [JSON.stringify(c)]);
    await f.db.query('DELETE FROM transactions WHERE id=$1', [id(21)]);
    await f.tasks.changeAssistantTask('owner', taskId, 'resume', 1);
    const partial = (await f.db.query('SELECT agent_checkpoint FROM assistant_tasks')).rows[0].agent_checkpoint;
    assert.equal(partial.approval_outcome.status, 'failed'); assert.equal(partial.approval_outcome.completed, 1);
  });
  test('SQL cancellation also retires orphan previews and stopped goals cannot retry', async t => {
    const f = await fixture(t);
    await f.db.query("INSERT INTO assistant_actions(id,user_id,conversation_id,status,payload) VALUES($1,'owner',$2,'pending',$3::jsonb)", [id(30), conversationId, JSON.stringify({ _agent_preview: { goal_id: taskId, fingerprint: 'orphan' } })]);
    await f.tasks.changeAssistantTask('owner', taskId, 'cancel', 1);
    const actions = (await f.db.query('SELECT status FROM assistant_actions')).rows;
    assert.ok(actions.every(action => action.status === 'cancelled'));
    const replay = await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1);
    assert.equal(replay.status, 'cancelled'); assert.equal(replay.attempt, 1);
  });

  test('SQL delayed checkpoints are fenced after a newer attempt and cannot overwrite its result', async t => {
    const f = await fixture(t);
    let started, release;
    const ready = new Promise(resolve => { started = resolve; });
    const wait = new Promise(resolve => { release = resolve; });
    f.modules['@/lib/assistant-generation'].prepareAssistantGeneration = async (_user, _input, options) => ({ telemetryId: 'test', generate: async () => {
      await options.onAgentCheckpoint(checkpoint()); started(); await wait;
      await options.onAgentCheckpoint({ ...checkpoint(), status: 'completed' });
      return { action: 'chat', reply: 'OLD RESULT', drafts: [], query: null };
    } });
    await f.db.exec("UPDATE assistant_tasks SET status='queued'");
    const worker = f.tasks.runAssistantTask('owner', taskId); await ready;
    await f.db.query("UPDATE assistant_tasks SET status='running',attempt=2,run_token=$1,lease_until=NOW()+INTERVAL '240 seconds',partial_text='NEW RESULT'", [id(50)]);
    release(); await worker;
    const stored = (await f.db.query('SELECT status,attempt,partial_text,agent_checkpoint FROM assistant_tasks')).rows[0];
    assert.equal(stored.attempt, 2); assert.equal(stored.status, 'running'); assert.equal(stored.partial_text, 'NEW RESULT');
    assert.equal(stored.agent_checkpoint.status, 'waiting_approval');
  });

  test('SQL task worker retains waiting input, pauses repeated dispatch, and consumes one resumed receipt', async t => {
    const f = await fixture(t); let calls = 0;
    f.modules['@/lib/assistant-generation'].prepareAssistantGeneration = async (_user, input, options) => ({ telemetryId: 'durable', generate: async () => {
      calls++; assert.equal(input.message, '原始目标');
      if (!options.agentApprovalOutcome) {
        await options.onAgentCheckpoint(checkpoint());
        return { action: 'manage', reply: '等待确认', drafts: [], query: null, approval: { id: actionId, summary: '请确认', count: 1, expires_at: null }, agent: { goal_id: taskId, status: 'waiting_approval' } };
      }
      assert.equal(options.agentApprovalOutcome.id, actionId);
      const completed = { ...options.agentCheckpoint, status: 'completed', pending_approval: null, pending_approvals: [], approval_outcome: null };
      await options.onAgentCheckpoint(completed);
      return { action: 'chat', reply: '已核对结果', drafts: [], query: null };
    } });
    await f.db.exec("UPDATE assistant_tasks SET status='queued',agent_checkpoint=NULL");
    await f.tasks.runAssistantTask('owner', taskId);
    const waiting = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(waiting.status, 'succeeded'); assert.equal(waiting.agent.status, 'waiting_approval');
    assert.ok((await f.db.query('SELECT payload FROM assistant_tasks')).rows[0].payload);
    await f.tasks.runAssistantTask('owner', taskId); assert.equal(calls, 1);
    await f.db.query("UPDATE assistant_actions SET status='succeeded',result=$1::jsonb", [JSON.stringify({ id: actionId, status: 'succeeded', text: '已完成' })]);
    await f.tasks.changeAssistantTask('owner', taskId, 'resume', 1);
    await f.tasks.runAssistantTask('owner', taskId); assert.equal(calls, 2);
    const done = (await f.db.query('SELECT status,payload,agent_checkpoint FROM assistant_tasks')).rows[0];
    assert.equal(done.status, 'succeeded'); assert.equal(done.payload, null); assert.equal(done.agent_checkpoint.status, 'completed');
  });

  test('SQL public agent status follows cancelled, failed and retry task states without altering resumable private state', async t => {
    const f = await fixture(t);
    const c = { ...checkpoint(), status: 'running', pending_approval: null, pending_approvals: [] };
    await f.db.query("UPDATE assistant_tasks SET status='running',run_token=$1,lease_until=NOW()+INTERVAL '240 seconds',agent_checkpoint=$2::jsonb,result=$3::jsonb", [id(60), JSON.stringify(c), JSON.stringify({ action: 'chat', reply: '正在处理', drafts: [], query: null, agent: { goal_id: taskId, goal: c.goal, status: 'running', steps: 2, tool_calls: 1 } })]);
    const cancelled = await f.tasks.changeAssistantTask('owner', taskId, 'cancel', 1);
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.agent.status, 'stopped'); assert.equal(cancelled.result.agent.status, 'stopped');
    assert.equal((await f.db.query('SELECT agent_checkpoint FROM assistant_tasks')).rows[0].agent_checkpoint.status, 'running');
    const retry = await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1);
    assert.equal(retry.status, 'queued'); assert.equal(retry.attempt, 2); assert.equal(retry.agent.status, 'running');
    await f.db.query("UPDATE assistant_tasks SET status='failed',result=$1::jsonb,agent_checkpoint=$2::jsonb", [JSON.stringify({ action: 'manage', reply: '旧确认方案', drafts: [], query: null, agent: { goal_id: taskId, goal: c.goal, status: 'waiting_approval', steps: 2, tool_calls: 1 } }), JSON.stringify(checkpoint())]);
    const failed = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(failed.agent.status, 'needs_input'); assert.equal(failed.result.agent.status, 'needs_input');
    assert.equal((await f.db.query('SELECT agent_checkpoint FROM assistant_tasks')).rows[0].agent_checkpoint.status, 'waiting_approval');
  });

}

test('replayed tool previews produce one public action receipt per approval ID', () => {
  const approval = { id: actionId, summary: '创建便利贴', count: 1, expires_at: null };
  const c = checkpoint();
  c.tool_results = [
    { call_id: 'preview-1', name: 'command_preview', result: { approval } },
    { call_id: 'preview-2', name: 'command_preview', result: { approval } },
    { call_id: 'cancel', name: 'approval_result', result: { id: actionId, status: 'cancelled', text: '本次操作已取消，未执行。' } },
    { call_id: 'other', name: 'event_preview', result: { approval: { ...approval, id: id(20), summary: '送礼方案' } } },
  ];
  const history = state.assistantAgentApprovalHistory(c);
  assert.equal(history.length, 2);
  assert.equal(history[0].result.status, 'cancelled');
  assert.equal(history[1].approval.id, id(20));
});

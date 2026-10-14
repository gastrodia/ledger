/* eslint-disable @typescript-eslint/no-require-imports -- complete native workflow against isolated SQL. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDraftReview } = require('../scripts/fixtures/assistant-draft-review.cjs');
const skip = !process.env.LEDGER_TASKS_PGLITE_MODULE;
async function fixture(t) {
  const f = await createDraftReview(); t.after(f.close);
  const native = f.load('lib/assistant-native-tools.ts');
  let checkpoint, decisions = 0;
  f.adapters.chooseStep = async (_messages, _signal, operations, contexts = []) => {
    decisions++;
    const input = f.request();
    const parsed = await native.assistantNativeToolsForState(operations, contexts, { draft_batch: true, saved_batch: false }).set_workflow.inputSchema.validate(input);
    assert.equal(parsed.success, true);
    return native.assistantNativeDecision({ id: 'plan', name: 'set_workflow', input: parsed.value }, contexts, f.goal, operations);
  };
  f.adapters.summarize = async () => '核对已完成，相似记录只是候选，没有修改草稿或账本。';
  const run = options => f.load('lib/assistant-agent-runtime.ts').runAssistantAgent({ goalId: f.id(80), goal: f.goal, requireWorkflow: true,
    messages: [], adapters: f.adapters, signal: AbortSignal.timeout(10000), checkpoint,
    onCheckpoint: value => { checkpoint = value; }, ...options });
  return { ...f, native, run, checkpoint: () => checkpoint, decisions: () => decisions };
}
test('six pending drafts complete scoped native SQL matching with deterministic comparison cards and no writes', { skip }, async t => {
  const f = await fixture(t); const start = f.statements.length;
  const plan = await f.run(); await f.check(plan, f.checkpoint());
  assert.equal(f.decisions(), 1);
  assert.equal(f.reads.length, 1);
  assert.ok(f.statements.slice(start).every(s => /^\s*SELECT\b/.test(s.text)));
});
test('a failed queued matching read survives checkpoint restoration and resumes without replanning', { skip }, async t => {
  const f = await fixture(t), original = f.adapters.draftMatches;
  f.adapters.draftMatches = async () => { throw Error('database unavailable'); };
  await assert.rejects(f.run(), /database unavailable/);
  const restored = f.load('lib/assistant-agent-state.ts').restoreAssistantAgentCheckpoint(f.checkpoint());
  assert.ok(restored); assert.equal(restored.pending_reads[0].step.tool, 'draft_matches');
  f.adapters.draftMatches = original;
  const plan = await f.run({ checkpoint: restored }); await f.check(plan, f.checkpoint());
  assert.equal(f.decisions(), 1); assert.equal(f.reads.length, 1);
});
test('summary timeout preserves successful matching and automatic continuation only summarizes', { skip }, async t => {
  const f = await fixture(t);
  f.adapters.summarize = async (_goal, _results, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive));
  const first = await f.run({ timeoutMs: 30 });
  assert.equal(first.agent.status, 'running'); assert.equal(first.agent.awaiting_answer, undefined);
  const restored = f.load('lib/assistant-agent-state.ts').restoreAssistantAgentCheckpoint(f.checkpoint()); assert.ok(restored);
  f.adapters.summarize = async () => '核对完成。';
  const plan = await f.run({ checkpoint: restored }); await f.check(plan, f.checkpoint());
  assert.equal(f.decisions(), 1); assert.equal(f.reads.length, 1);
});
test('observing self status before an agenda exists continues the original business task without manufacturing a question', { skip }, async t => {
  const f = await fixture(t), choose = f.adapters.chooseStep;
  let observed = false;
  const checkpoint = { version: 2, workflow_required: true, goal_id: f.id(80), goal: f.goal, status: 'running', steps: 3,
    messages: [], tool_results: [], pending_approval: null, preview_fingerprints: [] };
  f.adapters.chooseStep = async (messages, signal, operations, contexts) => {
    if (!observed) {
      observed = true;
      return f.native.assistantNativeDecision({ id: 'status', name: 'control', input: { control: {
        target_type: 'task', target_id: f.id(80), decision: 'status', requested_operation: null, changes: {},
      } } }, contexts, f.goal, operations);
    }
    assert.ok(messages.some(m => m.tool_feedback?.name === 'task_status'));
    assert.equal(f.checkpoint().awaiting_answer, undefined);
    return choose(messages, signal, operations, contexts);
  };
  const plan = await f.run({ checkpoint }); await f.check(plan, f.checkpoint());
  assert.equal(plan.reply.includes('当前任务：处理中'), false);
});

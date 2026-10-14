/* eslint-disable @typescript-eslint/no-require-imports -- synthetic PostgreSQL, never account data. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const createFixture = require('../../tests/helpers/ledger-sql-fixture.cjs');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const goal = '核对这组待确认账目是否存在重复记录，请逐笔对照已保存账本，只查询，不修改草稿或账本。';
async function createDraftReview() {
  const f = await createFixture(process.env.LEDGER_TASKS_PGLITE_MODULE);
  const names = ['蚂蚁财富-建信纳斯达克1...', '民治星河传奇店', '德生龙社区厨房（永香路店）', '德生龙社区厨房（永香路店）', '【试用】露安适羽感薄护学走裤拉拉裤5...', '正新鸡排·鸡腿汉堡(深圳五和雅园店)...'];
  const amounts = [1000, 524, 139, 3728, 783, 2190];
  const dates = ['2026-10-14', '2026-10-13', '2026-10-10', '2026-10-10', '2026-10-10', '2026-10-09'];
  const batch = { batch_id: id(90), status: 'pending', drafts: names.map((description, n) => ({ id: id(100 + n), type: 'expense', description,
    amount_cents: amounts[n], transaction_date: dates[n], member_id: null, category_id: null, note: '' })) };
  for (const [n, owner, type, amount, date, description] of [
    [1, 'owner', 'expense', 10, dates[0], names[0]],
    [2, 'owner', 'expense', 1.39, '2026-10-09', names[2]],
    [3, 'owner', 'expense', 37.28, dates[3], names[3]],
    [4, 'foreign', 'expense', 5.24, dates[1], names[1]],
    [5, 'owner', 'expense', 5.24, dates[1], '其他商户'],
    [6, 'owner', 'income', 7.83, dates[4], names[4]],
    [7, 'owner', 'expense', 21.90, '2026-09-01', names[5]],
  ]) await f.db.query('INSERT INTO transactions(id,user_id,type,amount,transaction_date,description) VALUES($1,$2,$3,$4,$5,$6)', [id(n), owner, type, amount, date, description]);
  const snapshot = async () => JSON.stringify((await f.db.query('SELECT * FROM transactions ORDER BY id')).rows);
  const before = await snapshot(), originalBatch = JSON.stringify(batch);
  const reads = [];
  const adapters = {
    protocol: 'native', controlContexts: [],
    validatePlan: value => f.load('lib/assistant.ts').validatePlan(value, [], [], randomUUID),
    validateCommand: f.load('lib/assistant-commands.ts').validateLedgerCommand,
    validateEvent: () => { throw Error('No event authorized'); },
    query: async () => { throw Error('Draft review must use its scoped matching tool'); },
    command: async () => { throw Error('Draft review must use its scoped matching tool'); },
    draftMatches: async signal => {
      signal.throwIfAborted(); reads.push('draft_matches');
      return f.load('lib/assistant-draft-matches.ts').readAssistantDraftMatches('owner', batch);
    },
  };
  function request() {
    return { operations: [{ id: 'review', label: '逐笔核对当前草稿', effect: 'read', depends_on: [], sources: [goal] }],
      reads: [{ operation_id: 'review', tool: 'draft_matches' }] };
  }
  async function check(plan, checkpoint) {
    const matches = checkpoint.tool_results.filter(r => r.name === 'draft_matches');
    assert.equal(matches.length, 1);
    assert.deepEqual(Array.from(matches[0].result.rows, row => row.status), ['possible_match', 'no_match', 'possible_match', 'possible_match', 'no_match', 'no_match']);
    assert.equal(matches[0].result.rows[2].candidates[0].date_difference_days, -1);
    assert.equal(plan.agent.status, 'completed'); assert.equal(plan.agent.awaiting_answer, undefined);
    assert.ok(plan.agent.operations.every(op => op.status === 'completed'));
    assert.equal(plan.agent.tool_calls, 1);
    assert.equal(plan.reply_view.kind, 'draft_matches');
    assert.equal(plan.reply_view.records.length, 6);
    assert.equal(plan.drafts.length, 0);
    assert.ok(names.every(name => plan.reply.includes(name)));
    assert.equal(checkpoint.tool_results.some(r => r.name === 'validation_error'), false);
    assert.equal(checkpoint.pending_approval, null);
    assert.equal(checkpoint.pending_batch, undefined);
    assert.equal(JSON.stringify(batch), originalBatch);
    assert.equal(await snapshot(), before);
    return { completed: true, six_rows: true, correct_candidates: true, unchanged_drafts_and_ledger: true, no_approval_or_question: true };
  }
  return { ...f, id, goal, batch, adapters, reads, request, check };
}
module.exports = { createDraftReview, goal, id };

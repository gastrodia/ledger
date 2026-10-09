/* eslint-disable @typescript-eslint/no-require-imports -- isolated command contracts and approval journal. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const { NextRequest, NextResponse } = require('next/server');
const contract = require('./helpers/assistant-contracts.cjs');
const commands = contract('@/lib/assistant-commands');
const draftActions = contract('@/lib/assistant-draft-actions');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
const emptyFilter = { keyword: null, start_date: null, end_date: null, type: null, category_id: null, member_id: null, status: null, amount_min: null, amount_max: null };
const command = extra => ({ resource: 'notes', operation: 'update', scope: 'one', ids: [uuid(1)], parent_id: null, parent_name: null, filter: emptyFilter, values_json: '{"title":"新标题"}', ...extra });
function fixture(seed = {}, options = {}) {
  const tables = plain({ notes: [{ id: uuid(1), user_id: 'owner', title: '购物', content: '买鸡蛋', color: 'yellow' }], ...seed });
  const actions = new Map(); const writes = []; const sqlCalls = [];
  const tableFor = resource => ({ repayments: 'loan_repayments', gifts_given: 'given_gifts' }[resource] || resource);
  async function query(text, values = []) {
    sqlCalls.push({ text, values });
    if (text.includes('FROM assistant_actions LIMIT 0')) return [];
    if (text.startsWith('INSERT INTO assistant_actions')) {
      const [id, user_id, conversation_id, payload, summary, expires_at] = values;
      actions.set(id, { id, user_id, conversation_id, payload: JSON.parse(payload), summary, expires_at, status: 'pending', result: null }); return [];
    }
    if (text.includes('assistant_actions')) {
      const [userId, id] = values; const row = actions.get(id);
      if (text.includes("status='cancelled'") && text.includes('conversation_id')) {
        for (const action of actions.values()) if (action.user_id === userId && action.conversation_id === id && action.status === 'pending') action.status = 'cancelled'; return [];
      }
      if (!row || row.user_id !== userId) return [];
      if (text.startsWith('SELECT')) return [row];
      if (text.includes("SET status='executing'")) {
        assert.match(text, /status='pending'/);
        assert.doesNotMatch(text, /expires_at>NOW/);
        if (row.status !== 'pending') return [];
        row.status = 'executing'; return [row];
      }
      if (text.includes("SET status='cancelled'")) { if (row.status === 'pending') row.status = 'cancelled'; return []; }
      if (text.includes('SET status=$3')) { row.status = values[2]; row.result = JSON.parse(values[3]); return []; }
      if (text.includes('SET result=$3')) { row.result = JSON.parse(values[2]); return []; }
    }
    const table = text.match(/FROM (\w+)/)?.[1];
    let rows = (tables[table] || []).filter(row => row.user_id === values[0]);
    if (text.includes('id=$2')) rows = rows.filter(row => row.id === values[1]);
    if (text.includes('r.id=ANY')) rows = rows.filter(row => values[1].includes(row.id));
    if (text.includes('loan_id=$2')) rows = (tables[table] || []).filter(row => row.user_id === values[0] && row.loan_id === values[1]);
    if (text.includes('giftbook_id=$2')) rows = (tables[table] || []).filter(row => row.user_id === values[0] && row.giftbook_id === values[1]);
    return rows.map(row => ({ ...row, ...(text.includes('match_count') ? { match_count: rows.length } : {}) }));
  }
  const sql = { query, transaction: queries => Promise.all(queries) };
  const route = resource => ({
    async PATCH(request, context) {
      const { id } = await context.params; const body = await request.json();
      writes.push({ resource, id, body });
      if (options.failAt === writes.length) return NextResponse.json({ error: '模拟冲突' }, { status: 409 });
      const row = tables[tableFor(resource)]?.find(row => row.id === id); Object.assign(row, body);
      return NextResponse.json({ data: row });
    },
    async POST(request) { writes.push({ resource, body: await request.json() }); return NextResponse.json({ data: { id: uuid(90) } }); },
    async DELETE(_request, context) { const { id } = await context.params; writes.push({ resource, id }); tables[tableFor(resource)] = tables[tableFor(resource)].filter(row => row.id !== id); return NextResponse.json({ message: '删除成功' }); },
  });
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/assistant-command-server.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, Date, JSON, Error, require(name) {
      if (name === 'node:crypto') return crypto;
      if (name === 'node:async_hooks') return require(name);
      if (name === 'next/server') return { NextRequest };
      if (name === '@/lib/db') return { sql };
      if (name === '@/lib/assistant-commands') return commands;
      if (name === '@/lib/assistant-action-preview') return contract(name);
      if (name.endsWith('-schema')) return { ensureLoansSchema: async () => {}, ensureCategoriesSchema: async () => {}, ensureGiftsGivenSchema: async () => {}, ensureGiftBooksSchema: async () => {}, ensureNotesSchema: async () => {} };
      if (name.startsWith('@/app/api/')) return route(name.split('/')[3]);
      throw Error(name);
    } });
  return { server: exports, tables, actions, writes, sqlCalls };
}

test('approval language distinguishes a direct approval from negation, questions and mixed instructions', () => {
  for (const input of ['确认执行', '确认删除。']) assert.equal(commands.approvalDecision(input), 'approve');
  for (const input of ['同意', '好的！', '是的', '确认', '批准']) {
    assert.equal(commands.approvalDecision(input), null);
    assert.equal(commands.approvalDecision(input, true), 'approve');
  }
  for (const input of ['取消', '算了', '不执行']) assert.equal(commands.approvalDecision(input), 'cancel');
  for (const input of ['不要确认', '确认会怎样', '确认但金额改成100', '如果确认执行会怎样', '先别删，确认一下日期', '网页上写着确认执行']) assert.equal(commands.approvalDecision(input), null);
});

test('resource fields and filters reject invented IDs, malformed money, dates, mixed operations and ownership fields', () => {
  for (const values of [{ user_id: 'foreign' }, { sql: 'DROP TABLE notes' }, { content: '' }, { pinned: 'yes' }]) assert.throws(() => commands.validateLedgerCommand(command({ values_json: JSON.stringify(values) })));
  for (const values of [{ amount: 0 }, { amount: -1 }, { amount: 1.001 }, { transaction_date: '2026-02-30' }, { category_id: 'foreign' }]) assert.throws(() => commands.validateLedgerCommand(command({ resource: 'transactions', values_json: JSON.stringify(values) })));
  assert.throws(() => commands.validateLedgerCommand(command({ operation: 'delete' })));
  assert.throws(() => commands.validateLedgerCommand(command({ resource: 'transactions', operation: 'create', values_json: '{"amount":1}' })));
  assert.throws(() => commands.validateLedgerCommand(command({ ids: [uuid(1), uuid(1)] })));
  assert.throws(() => commands.validateLedgerCommand(command({ filter: { ...emptyFilter, start_date: '2026-10-09', end_date: '2026-10-01' } })));
});

test('all nine resources accept their real creation or update fields and require mandatory information', () => {
  const values = {
    transactions: { type: 'expense', amount: 18.5, category_id: uuid(2), member_id: uuid(3), transaction_date: '2026-10-09' },
    categories: { name: '宠物', type: 'expense' }, members: { name: '小王' },
    loans: { direction: 'lent', subject_type: 'money', counterparty_name: '小王', amount: 100, occurred_at: '2026-10-09' },
    repayments: { repaid_at: '2026-10-09', repaid_amount: 50 }, giftbooks: { name: '婚礼' },
    gift_records: { gift_type: 'cash', counterparty_name: '小王', amount: 200, gift_date: '2026-10-09' },
    gifts_given: { recipient_name: '小王', gift_date: '2026-10-09', items: [{ item_name: '茶叶', quantity: 2, unit: '盒', estimated_value: 100 }] },
    notes: { content: '明天买鸡蛋', title: '采购', pinned: true, color: 'green' },
  };
  for (const [resource, value] of Object.entries(values)) {
    commands.validateLedgerCommand(command({ resource, values_json: JSON.stringify(value) }));
    commands.validateCommandRow(resource, value);
    assert.throws(() => commands.validateCommandRow(resource, {}));
  }
});

test('lookup SQL binds ownership, IDs, keywords, dates and amount limits instead of interpolating user data', () => {
  const f = fixture();
  const selected = f.server.buildCommandSelection('owner', command({ resource: 'transactions', filter: { ...emptyFilter, keyword: "x' OR 1=1--", start_date: '2026-10-01', amount_min: 10 } }));
  assert.match(selected.text, /r.user_id=\$1/);
  assert.equal(selected.text.includes("x' OR"), false);
  assert.ok(selected.params.includes("x' OR 1=1--"));
  assert.match(selected.text, /COUNT\(\*\) OVER/);
});

test('preparation is read-only for ledger data; approval claims once and replay never dispatches again', async () => {
  const f = fixture();
  const prepared = await f.server.prepareLedgerCommand('owner', uuid(30), command());
  assert.equal(f.writes.length, 0);
  assert.match(prepared.reply, /购物/); assert.match(prepared.reply, /新标题/); assert.match(prepared.reply, /尚未执行/);
  await assert.rejects(f.server.decideAssistantAction('foreign', prepared.approval.id, 'approve'), /不存在/);
  assert.equal(f.writes.length, 0);
  const results = await Promise.all([f.server.decideAssistantAction('owner', prepared.approval.id, 'approve'), f.server.decideAssistantAction('owner', prepared.approval.id, 'approve')]);
  assert.ok(results.some(r => r.status === 'succeeded'));
  assert.equal(f.writes.length, 1);
  assert.equal(f.tables.notes[0].title, '新标题');
  assert.equal((await f.server.decideAssistantAction('owner', prepared.approval.id, 'approve')).status, 'succeeded');
  assert.equal(f.writes.length, 1);
});

test('cancelled and edited previews cannot write', async () => {
  for (const reason of ['cancelled', 'edited']) {
    const f = fixture(); const prepared = await f.server.prepareLedgerCommand('owner', uuid(30), command());
    if (reason === 'cancelled') await f.server.decideAssistantAction('owner', prepared.approval.id, 'cancel');
    if (reason === 'edited') f.tables.notes[0].content = '已经更新';
    const result = await f.server.decideAssistantAction('owner', prepared.approval.id, 'approve');
    assert.notEqual(result.status, 'succeeded', reason);
    assert.equal(f.writes.length, 0, reason);
  }
});

test('new previews preserve earlier approvals and decisions affect only the selected ID', async () => {
  const f = fixture();
  const gift = await f.server.prepareLedgerCommand('owner', uuid(30), command({ resource: 'gifts_given', operation: 'create', ids: [], values_json: JSON.stringify({ recipient_name: '大伯', gift_date: '2026-10-09', cash_amount: 300, items: [] }) }));
  const note = await f.server.prepareLedgerCommand('owner', uuid(30), command({ operation: 'create', ids: [], values_json: '{"content":"买鸡蛋"}' }));
  assert.equal((await f.server.getAssistantAction('owner', gift.approval.id)).status, 'pending');
  assert.equal((await f.server.getAssistantAction('owner', note.approval.id)).status, 'pending');
  assert.equal(f.writes.length, 0);
  await f.server.decideAssistantAction('owner', note.approval.id, 'cancel');
  assert.equal((await f.server.getAssistantAction('owner', gift.approval.id)).status, 'pending');
  assert.equal((await f.server.decideAssistantAction('owner', gift.approval.id, 'approve')).status, 'succeeded');
  assert.deepEqual(f.writes.map(w => w.resource), ['gifts-given']);
});

test('ambiguous, foreign, over-limit and no-match selections never create an executable preview', async () => {
  const f = fixture({ notes: Array.from({ length: 2 }, (_, i) => ({ id: uuid(i + 1), user_id: 'owner', content: '相似' })) });
  await assert.rejects(f.server.prepareLedgerCommand('owner', uuid(30), command({ ids: [] })), /找到 2 条/);
  await assert.rejects(f.server.prepareLedgerCommand('owner', uuid(30), command({ ids: [uuid(99)] })), /不存在/);
  await assert.rejects(f.server.prepareLedgerCommand('foreign', uuid(30), command()), /不存在/);
  const large = fixture({ notes: Array.from({ length: 51 }, (_, i) => ({ id: uuid(i + 1), user_id: 'owner', content: '相似' })) });
  await assert.rejects(large.server.prepareLedgerCommand('owner', uuid(30), command({ ids: [], scope: 'all' })), /51 条/);
  assert.equal(f.actions.size, 0); assert.equal(large.actions.size, 0);
});

test('batch failure reports completed count and never replays completed records', async () => {
  const f = fixture({ notes: [1, 2, 3].map(i => ({ id: uuid(i), user_id: 'owner', content: '原内容' })) }, { failAt: 2 });
  const p = await f.server.prepareLedgerCommand('owner', uuid(30), command({ ids: [], scope: 'all' }));
  const result = await f.server.decideAssistantAction('owner', p.approval.id, 'approve');
  assert.equal(result.status, 'failed'); assert.equal(result.completed, 1); assert.equal(f.writes.length, 2);
  await f.server.decideAssistantAction('owner', p.approval.id, 'approve');
  assert.equal(f.writes.length, 2);
});

test('parent deletion previews child records and refuses newly added cascade targets', async () => {
  const f = fixture({ giftbooks: [{ id: uuid(5), user_id: 'owner', name: '婚礼' }], gift_records: [{ id: uuid(6), user_id: 'owner', giftbook_id: uuid(5), counterparty_name: '小王', amount: '100' }] });
  const p = await f.server.prepareLedgerCommand('owner', uuid(30), command({ resource: 'giftbooks', operation: 'delete', ids: [uuid(5)], values_json: '{}' }));
  assert.match(p.reply, /同时删除 1 条关联明细/); assert.match(p.reply, /小王/);
  f.tables.gift_records.push({ id: uuid(7), user_id: 'owner', giftbook_id: uuid(5), counterparty_name: '小李', amount: '200' });
  const result = await f.server.decideAssistantAction('owner', p.approval.id, 'approve');
  assert.equal(result.status, 'failed'); assert.equal(f.writes.length, 0);
});

test('export is read-only and neutralizes spreadsheet formulas', async () => {
  const f = fixture({ notes: [{ id: uuid(1), user_id: 'owner', title: '=HYPERLINK("evil")', content: '+cmd' }] });
  const result = await f.server.prepareLedgerCommand('owner', uuid(30), command({ operation: 'export', values_json: '{}' }));
  assert.ok(result.export_file.csv.includes("'=HYPERLINK")); assert.ok(result.export_file.csv.includes("'+cmd"));
  assert.equal(f.actions.size, 0); assert.equal(f.writes.length, 0);
});

test('draft edits preserve row identity and untouched fields while updating displayed amount', () => {
  const categories = [{ id: uuid(2), type: 'expense', name: '餐饮' }]; const members = [{ id: uuid(3), name: '本人' }];
  const drafts = [{ id: uuid(1), type: 'expense', amount_cents: 100, amount: '1.00', category_id: uuid(2), member_id: uuid(3), transaction_date: '2026-10-09', description: '饭', payment_method: null, note: '' }];
  const edit = { batch_id: uuid(20), edits: [{ draft_id: uuid(1), amount_cents: 2850, transaction_date: '2026-10-08', note: '补记' }] };
  const result = draftActions.applyDraftEdit(drafts, edit, categories, members);
  assert.deepEqual(plain(result[0]), { ...drafts[0], amount: '28.50', amount_cents: 2850, transaction_date: '2026-10-08', note: '补记' });
  assert.equal(drafts[0].amount, '1.00');
  assert.throws(() => draftActions.applyDraftEdit(drafts, { ...edit, edits: [{ draft_id: uuid(99), amount_cents: 1 }] }, categories, members));
});


test('approval age does not expire management operations; legacy timestamps are ignored', async () => {
  const f = fixture(); const prepared = await f.server.prepareLedgerCommand('owner', uuid(30), command());
  assert.equal(prepared.approval.expires_at, null);
  assert.doesNotMatch(prepared.reply, /15 分钟|有效期/);
  f.actions.get(prepared.approval.id).expires_at = '2000-01-01';
  assert.equal((await f.server.getAssistantAction('owner',prepared.approval.id)).status,'pending');
  assert.equal((await f.server.decideAssistantAction('owner',prepared.approval.id,'approve')).status,'succeeded');
  assert.equal(f.writes.length,1);
});

/* eslint-disable @typescript-eslint/no-require-imports -- real SQL in a disposable database. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const createFixture = require('./helpers/ledger-sql-fixture.cjs');
const modulePath = process.env.LEDGER_TASKS_PGLITE_MODULE;
const member = '10000000-0000-4000-8000-000000000001';
const expenseCategory = '10000000-0000-4000-8000-000000000002', incomeCategory = '10000000-0000-4000-8000-000000000003';
const base = { operation: 'create', counterparty: '小王', amount_cents: 50000, date: '2026-10-09', cashflow: 'new' };
async function setup(t) {
  const f = await createFixture(modulePath); t.after(() => f.close());
  await f.db.query("INSERT INTO members(id,user_id,name) VALUES($1,'owner','本人')", [member]);
  await f.db.query("INSERT INTO categories(id,user_id,name,type) VALUES($1,'owner','明确支出','expense'),($2,'owner','明确收入','income')", [expenseCategory, incomeCategory]);
  const api = f.load('lib/ledger-event-server.ts'), actions = f.load('lib/assistant-command-server.ts');
  return { ...f, ...api, ...actions, async prepare(input) { return api.prepareLedgerEvent('owner', randomUUID(), { ...base,
      ...(input.operation && input.operation !== 'create' ? {} : { member_id: member, category_id: ['gift_received','loan_borrowed','repayment_received'].includes(input.kind) ? incomeCategory : expenseCategory }),
      ...(input.cashflow === 'none' ? { cashflow_basis: '只登记台账，不计资金流水' } : {}), ...input }); },
    async approve(plan) { assert.ok(plan.approval, plan.reply); const r = await actions.decideAssistantAction('owner', plan.approval.id, 'approve'); assert.equal(r.status, 'succeeded', r.text); return r; } };
}
test('six cash scenarios commit ledger, cashflow and association once; loans stay out of daily statistics', { skip: !modulePath }, async t => {
  const f = await setup(t);
  for (const kind of ['gift_given', 'gift_received', 'loan_lent', 'loan_borrowed', 'repayment_received', 'repayment_paid']) {
    const plan = await f.prepare({ kind, ...(kind === 'gift_received' ? { book_name: '婚礼', create_book: true } : {}), ...(kind.startsWith('repayment') ? { amount_cents: 20000 } : {}) });
    const before = (await f.db.query('SELECT count(*) FROM transactions')).rows[0].count;
    assert.equal(Number(before), ['gift_given', 'gift_received', 'loan_lent', 'loan_borrowed', 'repayment_received', 'repayment_paid'].indexOf(kind));
    const r = await f.approve(plan);
    assert.equal((await f.decideAssistantAction('owner', plan.approval.id, 'approve')).event_context.event_id, r.event_context.event_id);
  }
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 6);
  assert.equal(Number((await f.db.query("SELECT count(*) FROM transactions WHERE flow_kind='loan'")).rows[0].count), 4);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transaction_links')).rows[0].count), 6);
  const { NextRequest } = require('next/server');
  const stats = await (await f.load('app/api/stats/route.ts').GET(new NextRequest('http://test/api/stats?month=2026-10&asOf=2026-10-09'))).json();
  assert.equal(stats.data.summary.totalIncome, 500);
  assert.equal(stats.data.summary.totalExpense, 500);
  assert.equal(stats.data.cashflow.inflow, 1200);
  assert.equal(stats.data.cashflow.loanOutflow, 700);
});
test('existing flow requires a choice, no duplicate insert, undo preserves original and restores classification', { skip: !modulePath }, async t => {
  const f = await setup(t), id = randomUUID();
  await f.db.query("INSERT INTO transactions(id,user_id,type,amount,transaction_date,member_id,description) VALUES($1,'owner','expense',500,'2026-10-09',$2,'转给小王')", [id, member]);
  const choice = await f.prepare({ kind: 'loan_lent', cashflow: 'auto' });
  assert.equal(choice.approval, undefined);
  const selected = choice.event_choices.find(c => c.input.transaction_id === id);
  assert.ok(selected);
  const done = await f.approve(await f.prepare(selected.input));
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 1);
  const undo = await f.prepare({ operation: 'undo', event_id: done.event_context.event_id, kind: null, counterparty: null, amount_cents: null, date: null });
  await f.approve(undo);
  const flow = (await f.db.query('SELECT * FROM transactions')).rows[0];
  assert.equal(flow.id, id); assert.equal(flow.flow_kind, 'daily'); assert.equal(flow.description, '转给小王');
  assert.equal(Number((await f.db.query('SELECT count(*) FROM loans')).rows[0].count), 0);
});
test('whole-event edits synchronize cash amount; historical record has no flow; missing information never writes', { skip: !modulePath }, async t => {
  const f = await setup(t);
  const done = await f.approve(await f.prepare({ kind: 'gift_given' }));
  const edited = await f.approve(await f.prepare({ operation: 'update', event_id: done.event_context.event_id, kind: null, counterparty: null, date: null, amount_cents: 80000 }));
  assert.equal(Number((await f.db.query('SELECT cash_amount FROM given_gifts')).rows[0].cash_amount), 800);
  assert.equal(Number((await f.db.query('SELECT amount FROM transactions')).rows[0].amount), 800);
  await f.approve(await f.prepare({ operation: 'undo', event_id: edited.event_context.event_id, kind: null, counterparty: null, date: null, amount_cents: null }));
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 0);
  await f.approve(await f.prepare({ kind: 'loan_lent', cashflow: 'none', date: '2025-03-01' }));
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 0);
  assert.equal((await f.prepare({ kind: 'gift_received', book_name: null })).approval, undefined);
});
test('stale dependencies roll back all writes; cancelled and cross-owner confirmations cannot execute', { skip: !modulePath }, async t => {
  const f = await setup(t);
  const plan = await f.prepare({ kind: 'gift_received', book_name: '生日', create_book: true });
  await f.db.query("UPDATE members SET name='成员变动' WHERE id=$1", [member]);
  const result = await f.decideAssistantAction('owner', plan.approval.id, 'approve');
  assert.equal(result.status, 'failed'); assert.equal(result.completed, 0);
  for (const table of ['giftbooks', 'gift_records', 'transactions', 'ledger_events']) assert.equal(Number((await f.db.query(`SELECT count(*) FROM ${table}`)).rows[0].count), 0, table);
  const other = await f.prepare({ kind: 'gift_given' });
  await assert.rejects(() => f.decideAssistantAction('foreign', other.approval.id, 'approve'), /不存在/);
  assert.equal((await f.decideAssistantAction('owner', other.approval.id, 'cancel')).status, 'cancelled');
  assert.equal((await f.decideAssistantAction('owner', other.approval.id, 'approve')).status, 'cancelled');
});
test('repayment choices, settle remaining, cap principal, detect new child repayment at confirmation', { skip: !modulePath }, async t => {
  const f = await setup(t);
  await f.approve(await f.prepare({ kind: 'loan_lent' }));
  await f.approve(await f.prepare({ kind: 'loan_lent', date: '2026-09-01', amount_cents: 60000 }));
  const pick = await f.prepare({ kind: 'repayment_received', amount_cents: 20000 });
  assert.equal(pick.event_choices.length, 2);
  const input = pick.event_choices[0].input;
  await assert.rejects(() => f.prepare({ ...input, amount_cents: 999999 }), /最多/);
  const plan = await f.prepare(input);
  await f.db.query("INSERT INTO loan_repayments(id,user_id,loan_id,repaid_amount,repaid_at) VALUES($1,'owner',$2,20,'2026-10-09')", [randomUUID(), input.loan_id]);
  assert.equal((await f.decideAssistantAction('owner', plan.approval.id, 'approve')).status, 'failed');
  const settled = await f.approve(await f.prepare({ ...input, amount_cents: null, settle: true }));
  assert.equal(settled.event_context.input.amount_cents, 48000);
  assert.match(settled.text, /剩余未还 ¥0.00/);
});
test('failure after source and cashflow inserts rolls back everything, including automatically created book/category', { skip: !modulePath }, async t => {
  const f = await setup(t);
  const plan = await f.prepare({ kind: 'gift_received', book_name: '回滚验证', create_book: true });
  await f.db.query("ALTER TABLE transaction_links ADD CONSTRAINT fixture_failure CHECK(source_type!='gift_group')");
  assert.equal((await f.decideAssistantAction('owner', plan.approval.id, 'approve')).status, 'failed');
  for (const table of ['giftbooks','gift_records','transactions','transaction_links','ledger_events']) assert.equal(Number((await f.db.query(`SELECT COUNT(*) FROM ${table}`)).rows[0].count), 0, table);
});
test('parallel approvals and a lost commit response recover the same event without duplicate financial writes', { skip: !modulePath }, async t => {
  const f = await setup(t);
  const plan = await f.prepare({ kind: 'gift_given' });
  const results = await Promise.all([f.decideAssistantAction('owner', plan.approval.id, 'approve'), f.decideAssistantAction('owner', plan.approval.id, 'approve')]);
  assert.ok(results.every(r=>r.status === 'succeeded'));
  assert.equal(Number((await f.db.query('SELECT COUNT(*) FROM transactions')).rows[0].count), 1);
  const second = await f.prepare({ kind: 'gift_given', counterparty: '小李' });
  const transaction = f.sql.transaction;
  f.sql.transaction = async statements => { await transaction(statements); throw new Error('simulated lost HTTP response'); };
  const recovered = await f.decideAssistantAction('owner', second.approval.id, 'approve');
  assert.equal(recovered.status, 'succeeded');
  assert.equal(Number((await f.db.query('SELECT COUNT(*) FROM transactions')).rows[0].count), 2);
});
test('new book selection survives member clarification, and correction context never contains provisional category IDs', { skip: !modulePath }, async t => {
  const f = await setup(t);
  await f.db.query("INSERT INTO members(id,user_id,name) VALUES($1,'owner','家人')", [randomUUID()]);
  const pick = await f.prepare({ kind: 'gift_received', book_name: '婚礼', create_book: true, member_id: null });
  assert.equal(pick.event_choices.length, 2);
  assert.equal(pick.event_context.input.book_id, null);
  const preview = await f.prepare(pick.event_choices[0].input);
  assert.equal(preview.event_context.input.category_id, incomeCategory);
  const corrected = await f.prepare({ ...preview.event_context.input, amount_cents: 60000 });
  await f.approve(corrected);
  assert.equal(Number((await f.db.query('SELECT amount FROM transactions')).rows[0].amount), 600);
  assert.equal(Number((await f.db.query('SELECT COUNT(*) FROM giftbooks')).rows[0].count), 1);
});
test('repayment undo restores remaining debt, while a loan with repayments cannot be undone', { skip: !modulePath }, async t => {
  const f = await setup(t);
  const loan = await f.approve(await f.prepare({ kind: 'loan_lent' }));
  const repaid = await f.approve(await f.prepare({ kind: 'repayment_received', amount_cents: 20000 }));
  await assert.rejects(()=>f.prepare({ operation:'undo', event_id:loan.event_context.event_id, kind:null, date:null, amount_cents:null, counterparty:null }),/已有归还/);
  const undone = await f.approve(await f.prepare({ operation:'undo', event_id:repaid.event_context.event_id, kind:null, date:null, amount_cents:null, counterparty:null }));
  assert.match(undone.text,/剩余未还 ¥500.00/);
  assert.equal(Number((await f.db.query('SELECT COUNT(*) FROM loan_repayments')).rows[0].count),0);
});
test('generic ledger delete resolves to whole-event undo; reused flows cannot be overwritten by changing event amount', { skip: !modulePath }, async t => {
  const f = await setup(t);
  await f.approve(await f.prepare({ kind:'gift_given' }));
  const source = (await f.db.query('SELECT id FROM given_gifts')).rows[0].id;
  const plan = await f.prepareLedgerCommand('owner',randomUUID(),{ resource:'gifts_given', operation:'delete',scope:'one',ids:[source],parent_id:null,parent_name:null,filter:{keyword:null,start_date:null,end_date:null,type:null,category_id:null,member_id:null,status:null,amount_min:null,amount_max:null},values_json:'{}' });
  await f.approve(plan);
  assert.equal(Number((await f.db.query('SELECT COUNT(*) FROM transactions')).rows[0].count),0);
  const id=randomUUID();
  await f.db.query("INSERT INTO transactions(id,user_id,type,amount,transaction_date,member_id) VALUES($1,'owner','expense',500,'2026-10-09',$2)",[id,member]);
  const saved=await f.approve(await f.prepare({kind:'loan_lent',cashflow:'existing',transaction_id:id}));
  await assert.rejects(()=>f.prepare({operation:'update',event_id:saved.event_context.event_id,kind:null,date:null,counterparty:null,amount_cents:60000}),/原有流水/);
});
test('old approvals remain executable, cleared conversations cannot execute; duplicate real-world events require explicit override', { skip: !modulePath }, async t => {
  const f=await setup(t);
  const expired=await f.prepare({kind:'gift_given',counterparty:'历史测试',cashflow:'none'});
  assert.equal((await f.db.query('SELECT isfinite(expires_at) AS finite FROM assistant_actions WHERE id=$1',[expired.approval.id])).rows[0].finite,false);
  await f.db.query("UPDATE assistant_actions SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[expired.approval.id]);
  assert.equal(expired.approval.expires_at,null);
  assert.doesNotMatch(expired.reply,/15 分钟|有效期/);
  assert.equal((await f.decideAssistantAction('owner',expired.approval.id,'approve')).status,'succeeded');
  const cleared=await f.prepare({kind:'gift_given'});
  const conversation=(await f.db.query('SELECT conversation_id FROM assistant_actions WHERE id=$1',[cleared.approval.id])).rows[0].conversation_id;
  await f.db.exec('CREATE TABLE IF NOT EXISTS assistant_task_conversations(id varchar(36),user_id varchar(36),cleared_at timestamptz)');
  await f.db.query("INSERT INTO assistant_task_conversations(id,user_id,cleared_at) VALUES($1,'owner',NOW())",[conversation]);
  assert.equal((await f.decideAssistantAction('owner',cleared.approval.id,'approve')).status,'cancelled');
  assert.equal(Number((await f.db.query('SELECT COUNT(*) FROM transactions')).rows[0].count),0);
  await f.approve(await f.prepare({kind:'gift_given'}));
  const duplicate=await f.prepare({kind:'gift_given'});
  assert.equal(duplicate.approval,undefined);
  assert.equal(duplicate.event_choices[0].input.allow_duplicate,true);
  assert.equal(Number((await f.db.query('SELECT COUNT(*) FROM transactions')).rows[0].count),1);
});
test('old database column migration is idempotent and preserves pre-existing ordinary transaction amounts', { skip: !modulePath }, async t => {
  const f=await setup(t);
  await f.db.query("INSERT INTO transactions(id,user_id,type,amount,transaction_date) VALUES($1,'owner','income',123.45,'2026-10-09')",[randomUUID()]);
  await f.db.exec('ALTER TABLE transactions DROP COLUMN flow_kind');
  const {ensureCashflowSchema}=f.load('lib/ledger-event-schema.ts');
  await ensureCashflowSchema();await ensureCashflowSchema();
  const row=(await f.db.query('SELECT amount,flow_kind FROM transactions')).rows[0];
  assert.equal(Number(row.amount),123.45);assert.equal(row.flow_kind,'daily');
});
test('a matching cashflow arriving after auto-match preview invalidates approval instead of creating a duplicate', { skip: !modulePath }, async t => {
  const f=await setup(t);
  const plan=await f.prepare({kind:'gift_given',cashflow:'auto'});
  assert.equal(plan.event_context.input.cashflow,'auto');
  await f.db.query("INSERT INTO transactions(id,user_id,type,amount,transaction_date) VALUES($1,'owner','expense',500,'2026-10-09')",[randomUUID()]);
  assert.equal((await f.decideAssistantAction('owner',plan.approval.id,'approve')).status,'failed');
  assert.equal(Number((await f.db.query('SELECT COUNT(*) FROM transactions')).rows[0].count),1);
  assert.equal(Number((await f.db.query('SELECT COUNT(*) FROM given_gifts')).rows[0].count),0);
});

const mixedGift = { kind: 'gift_given', counterparty: '大伯', amount_cents: 50000, transaction_amount_cents: 60000,
  payment_recipient: '妈', occasion: '生日', items: [{ item_name: '泡子', quantity: 1, unit: '封', estimated_value: 50 }] };
test('mixed gift preview separates gift cash, item value and actual payment; one approval links exactly one expense', { skip: !modulePath }, async t => {
  const f = await setup(t), plan = await f.prepare(mixedGift);
  assert.equal(plan.approval.preview.metrics[0].value,'¥600.00');
  assert.equal(plan.approval.preview.metrics[1].value,'¥550.00');
  assert.equal(plan.approval.preview.sections[0].rows[1].label,'泡子');
  assert.match(plan.reply, /泡子 × 1封/); assert.match(plan.reply, /送礼合计价值：¥550.00/);
  assert.match(plan.reply, /实际付款 ¥600.00/); assert.match(plan.reply, /多于送礼价值 ¥50.00/);
  assert.match(plan.reply, /转给妈用于代办给大伯的送礼/);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM given_gifts')).rows[0].count), 0);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 0);
  const result = await f.approve(plan);
  await f.decideAssistantAction('owner', plan.approval.id, 'approve');
  const gifts = (await f.db.query('SELECT * FROM given_gifts')).rows, flows = (await f.db.query('SELECT * FROM transactions')).rows;
  assert.equal(gifts.length, 1); assert.equal(flows.length, 1);
  assert.equal(Number(gifts[0].cash_amount), 500); assert.equal(gifts[0].occasion, '生日');
  assert.deepEqual(gifts[0].items, mixedGift.items);
  assert.equal(Number(flows[0].amount), 600); assert.match(flows[0].description, /转给妈代办/);
  assert.equal((await f.db.query('SELECT * FROM transaction_links')).rows[0].transaction_id, flows[0].id);
  assert.equal(result.event_context.input.transaction_amount_cents, 60000);
  assert.doesNotMatch(result.text, /请确认此关联理解/);
});
test('mixed gift modifications preserve independent payment and item details; undo removes event and owned flow together', { skip: !modulePath }, async t => {
  const f = await setup(t), saved = await f.approve(await f.prepare(mixedGift));
  const edited = await f.approve(await f.prepare({ operation: 'update', event_id: saved.event_context.event_id, kind: null, counterparty: null, date: null, amount_cents: 40000 }));
  assert.equal(Number((await f.db.query('SELECT cash_amount FROM given_gifts')).rows[0].cash_amount), 400);
  assert.equal(Number((await f.db.query('SELECT amount FROM transactions')).rows[0].amount), 600);
  assert.deepEqual((await f.db.query('SELECT items FROM given_gifts')).rows[0].items, mixedGift.items);
  await f.approve(await f.prepare({ operation: 'update', event_id: edited.event_context.event_id, kind: null, counterparty: null, date: null, amount_cents: null, transaction_amount_cents: 65000 }));
  assert.equal(Number((await f.db.query('SELECT amount FROM transactions')).rows[0].amount), 650);
  assert.equal(Number((await f.db.query('SELECT cash_amount FROM given_gifts')).rows[0].cash_amount), 400);
  await f.approve(await f.prepare({ operation: 'undo', event_id: edited.event_context.event_id, kind: null, counterparty: null, date: null, amount_cents: null }));
  for (const table of ['given_gifts','transactions','transaction_links']) assert.equal(Number((await f.db.query(`SELECT count(*) FROM ${table}`)).rows[0].count), 0);
});
test('mixed gift links an existing 600 expense instead of a 500 gift-cash flow; unrelated source edits and stale previews block execution', { skip: !modulePath }, async t => {
  const f = await setup(t), id = randomUUID();
  await f.db.query("INSERT INTO transactions(id,user_id,type,amount,transaction_date,member_id,description) VALUES($1,'owner','expense',600,'2026-10-09',$2,'转给妈妈')", [id, member]);
  const pick = await f.prepare({ ...mixedGift, cashflow:'auto' });
  assert.ok(pick.event_choices.find(c => c.input.transaction_id === id));
  const saved = await f.approve(await f.prepare(pick.event_choices.find(c => c.input.transaction_id === id).input));
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 1);
  const undo = await f.prepare({ operation:'undo',event_id:saved.event_context.event_id,kind:null,counterparty:null,date:null,amount_cents:null });
  await f.db.query("UPDATE given_gifts SET items='[]'::jsonb");
  assert.equal((await f.decideAssistantAction('owner',undo.approval.id,'approve')).status,'failed');
  assert.equal(Number((await f.db.query('SELECT count(*) FROM given_gifts')).rows[0].count), 1);
  await assert.rejects(() => f.prepare({operation:'undo',event_id:saved.event_context.event_id,kind:null,counterparty:null,date:null,amount_cents:null}), /物品或事由/);
});
test('item valuation alone is never added to cashflow and cancellation leaves both ledgers untouched', { skip: !modulePath }, async t => {
  const f = await setup(t);
  const plan = await f.prepare({ ...mixedGift,transaction_amount_cents:null,payment_recipient:null });
  assert.match(plan.reply, /流出 ¥500.00并关联/);
  await f.decideAssistantAction('owner',plan.approval.id,'cancel');
  assert.equal(Number((await f.db.query('SELECT count(*) FROM given_gifts')).rows[0].count),0);
  await f.approve(await f.prepare({ ...mixedGift,cashflow:'none' }));
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count),0);
  await assert.rejects(() => f.prepare({ ...mixedGift,kind:'loan_lent' }), /仅用于送礼/);
});

test('already-recorded payment without an ID finds candidates or asks for details, never creates a second flow', { skip: !modulePath }, async t => {
  const f = await setup(t);
  const missing = await f.prepare({ ...mixedGift,cashflow:'existing',transaction_id:null });
  assert.equal(missing.approval,undefined); assert.match(missing.reply,/不会新建支出/);
  const id=randomUUID();
  await f.db.query("INSERT INTO transactions(id,user_id,type,amount,transaction_date,member_id) VALUES($1,'owner','expense',600,'2026-10-09',$2)",[id,member]);
  const pick=await f.prepare({ ...mixedGift,cashflow:'existing',transaction_id:null });
  assert.equal(pick.approval,undefined); assert.equal(pick.event_choices.length,1);
  assert.equal(pick.event_choices[0].input.transaction_id,id);
  await f.approve(await f.prepare(pick.event_choices[0].input));
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count),1);
});

test('missing event member and category remain explicit choices even when each has a single option', { skip: !modulePath }, async t => {
  const f = await setup(t);
  const memberQuestion = await f.prepare({ kind: 'gift_given', member_id: null, category_id: null });
  assert.equal(memberQuestion.approval, undefined);
  assert.equal(memberQuestion.event_context.input.member_id, null);
  assert.equal(memberQuestion.event_choices.length, 1);
  const categoryQuestion = await f.prepare(memberQuestion.event_choices[0].input);
  assert.equal(categoryQuestion.approval, undefined);
  assert.equal(categoryQuestion.event_context.input.category_id, null);
  assert.equal(categoryQuestion.event_choices.length, 1);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM categories')).rows[0].count), 2);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 0);
  const reviewed = await f.prepare(categoryQuestion.event_choices[0].input);
  assert.ok(reviewed.approval);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 0);
  await f.approve(reviewed);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 1);
});

test('missing event categories are not silently created and ledger-only requires a stated condition', { skip: !modulePath }, async t => {
  const f = await setup(t);
  await f.db.query('DELETE FROM categories');
  const noCategory = await f.prepare({ kind: 'gift_given', category_id: null });
  assert.equal(noCategory.approval, undefined);
  assert.equal(noCategory.event_choices.length, 0);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM categories')).rows[0].count), 0);
  const ledgerOnly = await f.prepare({ kind: 'gift_given', cashflow: 'none', cashflow_basis: null });
  assert.equal(ledgerOnly.approval, undefined);
  assert.equal(ledgerOnly.event_choices.length, 1);
  assert.equal(ledgerOnly.event_choices[0].input.cashflow_basis, ledgerOnly.event_choices[0].label);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM given_gifts')).rows[0].count), 0);
});

const payment = patch => ({ components:[{purpose:patch.description ? 'purchase':'gift_cash',amount_cents:'amount_cents' in patch?patch.amount_cents:5000,basis:patch.basis||'送礼50'}],transaction_id:null, amount_cents:5000, date:'2026-10-09', category_id:expenseCategory,member_id:member,description:'礼金',cashflow:'new',basis:'送礼50',...patch });
const giftPayments = patch => ({ kind:'gift_given',counterparty:'小美',amount_cents:5000,occasion:'生日',items:[{item_name:'鞋子',quantity:1,unit:'双',estimated_value:200}],payments:[payment({}),payment({amount_cents:20000,description:'买鞋',basis:'买鞋200'})],...patch });
test('multiple real payments preserve dates and integer totals; approval retry and exact receipt verification are idempotent', {skip:!modulePath}, async t=>{
 const f=await setup(t);
 const plan=await f.prepare(giftPayments({payments:[payment({}),payment({amount_cents:20000,date:'2026-09-30',description:'买鞋',basis:'买鞋200'})]}));
 assert.equal(plan.approval.preview.metrics[0].value,'¥250.00');
 assert.match(plan.reply,/2026-09-30/);
 const receipt=await f.approve(plan);
 await f.decideAssistantAction('owner',plan.approval.id,'approve');
 const flows=(await f.db.query('SELECT amount,transaction_date FROM transactions ORDER BY amount')).rows;
 assert.deepEqual(flows.map(row=>Number(row.amount)),[50,200]);
 assert.equal(Number((await f.db.query('SELECT count(*) FROM given_gifts')).rows[0].count),1);
 assert.equal(Number((await f.db.query('SELECT count(*) FROM transaction_links')).rows[0].count),2);
 assert.equal((await f.readAssistantAgentTargets('owner',receipt.targets,receipt.id)).verified,true);
 await f.db.query('UPDATE transactions SET amount=201 WHERE amount=200');
 assert.equal((await f.readAssistantAgentTargets('owner',receipt.targets,receipt.id)).verified,false);
});
test('a referenced purchase is reused: 20 meal plus 200 purchase plus 50 gift totals 270; undo preserves prior payments', {skip:!modulePath}, async t=>{
 const f=await setup(t), meal=randomUUID(), shoes=randomUUID();
 await f.db.query("INSERT INTO transactions(id,user_id,type,amount,transaction_date,category_id,member_id,description) VALUES($1,'owner','expense',20,'2026-10-09',$3,$4,'吃饭'),($2,'owner','expense',200,'2026-10-09',$3,$4,'买鞋')",[meal,shoes,expenseCategory,member]);
 const receipt=await f.approve(await f.prepare(giftPayments({payments:[payment({}),payment({transaction_id:shoes,amount_cents:20000,cashflow:'existing',description:'买鞋',basis:'给小美买鞋子200'})]})));
 const summary=(await f.db.query('SELECT count(*) AS count,sum(amount) AS amount FROM transactions')).rows[0];
 assert.equal(Number(summary.count),3);assert.equal(Number(summary.amount),270);
 assert.equal((await f.readAssistantAgentTargets('owner',receipt.targets,receipt.id)).verified,true);
 const undo=await f.approve(await f.prepare({operation:'undo',event_id:receipt.event_context.event_id,kind:null,counterparty:null,amount_cents:null,date:null}));
 assert.equal((await f.readAssistantAgentTargets('owner',undo.targets,undo.id)).verified,true);
 assert.deepEqual((await f.db.query('SELECT id FROM transactions ORDER BY id')).rows.map(row=>row.id).sort(),[meal,shoes].sort());
});
test('payment updates retain stable IDs; removal restores existing flow and additions are atomic', {skip:!modulePath}, async t=>{
 const f=await setup(t), original=randomUUID();
 await f.db.query("INSERT INTO transactions(id,user_id,type,amount,transaction_date,category_id,member_id,flow_kind) VALUES($1,'owner','expense',200,'2026-10-09',$2,$3,'loan')",[original,expenseCategory,member]);
 const saved=await f.approve(await f.prepare(giftPayments({payments:[payment({}),payment({transaction_id:original,amount_cents:20000,cashflow:'existing',description:'购买',basis:'购买200'})]})));
 const inputs=saved.event_context.input.payments, owned=inputs.find(p=>p.transaction_id!==original);
 const update={operation:'update',event_id:saved.event_context.event_id,kind:null,counterparty:null,date:null,amount_cents:null};
 await assert.rejects(()=>f.prepare({...update,payments:inputs.map(p=>p.transaction_id===original?{...p,amount_cents:19000,components:[{purpose:'purchase',amount_cents:19000,basis:'购买190'}]}:p)}),/原有流水/);
 const edited=await f.approve(await f.prepare({...update,payments:[{...owned,amount_cents:6000,components:[{purpose:'gift_cash',amount_cents:5000,basis:'送礼50'},{purpose:'other',amount_cents:1000,basis:'费用10'}]},payment({amount_cents:3000,description:'追加付款',basis:'追加30'})]}));
 assert.equal(Number((await f.db.query('SELECT amount FROM transactions WHERE id=$1',[owned.transaction_id])).rows[0].amount),60);
 assert.equal((await f.db.query('SELECT flow_kind FROM transactions WHERE id=$1',[original])).rows[0].flow_kind,'loan');
 assert.equal((await f.readAssistantAgentTargets('owner',edited.targets,edited.id)).verified,true);
 assert.equal(Number((await f.db.query('SELECT count(*) FROM transaction_links')).rows[0].count),2);
});
test('unknown actual price asks before approval, valuation never supplies it; duplicate IDs and foreign flows are rejected', {skip:!modulePath}, async t=>{
 const f=await setup(t);
 const question=await f.prepare(giftPayments({payments:[payment({}),payment({amount_cents:null,description:'新买的礼物',basis:'价值200，新买的要入账'})]}));
 assert.equal(question.approval,undefined);assert.match(question.reply,/实际支付/);
 assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count),0);
 const id=randomUUID();
 await assert.rejects(()=>f.prepare(giftPayments({payments:[payment({transaction_id:id,cashflow:'existing'}),payment({transaction_id:id,cashflow:'existing'})]})),/重复关联/);
 await f.db.query("INSERT INTO transactions(id,user_id,type,amount,transaction_date) VALUES($1,'foreign','expense',50,'2026-10-09')",[id]);
 await assert.rejects(()=>f.prepare(giftPayments({payments:[payment({transaction_id:id,cashflow:'existing'})]})),/不匹配/);
});
test('stale second payment rolls back the whole multi-payment event', {skip:!modulePath}, async t=>{
 const f=await setup(t),a=randomUUID(),b=randomUUID();
 await f.db.query("INSERT INTO transactions(id,user_id,type,amount,transaction_date) VALUES($1,'owner','expense',50,'2026-10-09'),($2,'owner','expense',200,'2026-10-09')",[a,b]);
 const plan=await f.prepare(giftPayments({payments:[payment({transaction_id:a,cashflow:'existing'}),payment({transaction_id:b,cashflow:'existing',amount_cents:20000,description:'购买'})]}));
 await f.db.query("UPDATE transactions SET description='改动' WHERE id=$1",[b]);
 const result=await f.decideAssistantAction('owner',plan.approval.id,'approve');
 assert.equal(result.status,'failed');
 assert.equal(Number((await f.db.query('SELECT count(*) FROM given_gifts')).rows[0].count),0);
 assert.equal(Number((await f.db.query('SELECT count(*) FROM transaction_links')).rows[0].count),0);
});

test('legacy schema upgrade preserves original IDs, amount and approval; unrelated ledger sources stay one-to-one', {skip:!modulePath}, async t=>{
 const f=await setup(t),saved=await f.approve(await f.prepare({kind:'gift_given'}));
 const before=(await f.db.query('SELECT id,amount FROM transactions')).rows;
 await f.db.exec("ALTER TABLE transaction_links DROP CONSTRAINT transaction_links_pkey, ADD PRIMARY KEY(user_id,source_type,source_id); DROP INDEX transaction_links_single_source; ALTER TABLE ledger_events DROP COLUMN payments;");
 const ensure=f.load('lib/ledger-event-schema.ts').ensureLedgerEventsSchema;
 await ensure();await ensure();
 assert.deepEqual((await f.db.query('SELECT id,amount FROM transactions')).rows,before);
 assert.equal((await f.readAssistantAgentTargets('owner',saved.targets,saved.id)).verified,true);
 const undone=await f.approve(await f.prepare({operation:'undo',event_id:saved.event_context.event_id,kind:null,counterparty:null,date:null,amount_cents:null}));
 assert.equal(undone.status,'succeeded');
});
test('link API lists all gift payments, appends independently and unlinks only the requested payment', {skip:!modulePath}, async t=>{
 const f=await setup(t),gift=randomUUID(),a=randomUUID(),b=randomUUID();
 const {NextRequest}=require('next/server'),api=f.load('app/api/transaction-links/route.ts');
 await f.db.query("INSERT INTO given_gifts(id,user_id,recipient_name,gift_date,cash_amount) VALUES($1,'owner','朋友','2026-10-09',50)",[gift]);
 await f.db.query("INSERT INTO transactions(id,user_id,type,amount,transaction_date) VALUES($1,'owner','expense',50,'2026-10-09'),($2,'owner','expense',200,'2026-09-30')",[a,b]);
 const request=(method,transactionId)=>new NextRequest('http://test/api/transaction-links',{method,headers:{'content-type':'application/json'},body:JSON.stringify({sourceType:'given_gift',sourceId:gift,transactionId})});
 assert.equal((await api.PUT(request('PUT',a))).status,200);assert.equal((await api.PUT(request('PUT',b))).status,200);
 const get=()=>api.GET(new NextRequest(`http://test/api/transaction-links?sourceType=given_gift&sourceId=${gift}`));
 assert.equal((await (await get()).json()).data.length,2);
 assert.equal((await api.DELETE(request('DELETE',a))).status,200);
 assert.deepEqual((await (await get()).json()).data.map(row=>row.id),[b]);
 assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count),2);
});

test('payment components distinguish one combined payment from omitted cash and calculate totals independently of model arithmetic', {skip:!modulePath}, async t=>{
 const f=await setup(t);
 await assert.rejects(()=>f.prepare(giftPayments({payments:[payment({amount_cents:20000,description:'买礼品',basis:'买礼品200'})]})),/没有完整覆盖礼金/);
 const plan=await f.prepare(giftPayments({payments:[payment({amount_cents:1,description:'一次代办付款',basis:'代办250',components:[{purpose:'gift_cash',amount_cents:5000,basis:'礼金50'},{purpose:'purchase',amount_cents:20000,basis:'购买实付200'}]})]}));
 assert.equal(plan.approval.preview.metrics[0].value,'¥250.00');
 await f.approve(plan);
 const rows=(await f.db.query('SELECT amount FROM transactions')).rows;
 assert.equal(rows.length,1);assert.equal(Number(rows[0].amount),250);
});

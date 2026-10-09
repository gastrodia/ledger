/* eslint-disable @typescript-eslint/no-require-imports -- real SQL in a disposable database. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const createFixture = require('./helpers/ledger-sql-fixture.cjs');
const modulePath = process.env.LEDGER_TASKS_PGLITE_MODULE;
const member = '10000000-0000-4000-8000-000000000001';
const base = { operation: 'create', counterparty: '小王', amount_cents: 50000, date: '2026-10-09', cashflow: 'new' };
async function setup(t) {
  const f = await createFixture(modulePath); t.after(() => f.close());
  await f.db.query("INSERT INTO members(id,user_id,name) VALUES($1,'owner','本人')", [member]);
  const api = f.load('lib/ledger-event-server.ts'), actions = f.load('lib/assistant-command-server.ts');
  return { ...f, ...api, ...actions, async prepare(input) { return api.prepareLedgerEvent('owner', randomUUID(), { ...base, ...input }); },
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
  for (const table of ['giftbooks', 'gift_records', 'transactions', 'ledger_events', 'categories']) assert.equal(Number((await f.db.query(`SELECT count(*) FROM ${table}`)).rows[0].count), 0, table);
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
  for (const table of ['giftbooks','gift_records','transactions','transaction_links','ledger_events','categories']) assert.equal(Number((await f.db.query(`SELECT COUNT(*) FROM ${table}`)).rows[0].count), 0, table);
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
  const pick = await f.prepare({ kind: 'gift_received', book_name: '婚礼', create_book: true });
  assert.equal(pick.event_choices.length, 2);
  assert.equal(pick.event_context.input.book_id, null);
  const preview = await f.prepare(pick.event_choices[0].input);
  assert.equal(preview.event_context.input.category_id, null);
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

/* eslint-disable @typescript-eslint/no-require-imports -- disposable PostgreSQL, never account data. */
const test = require('node:test');
const assert = require('node:assert/strict');
const createFixture = require('./helpers/ledger-sql-fixture.cjs');
const modulePath = process.env.LEDGER_TASKS_PGLITE_MODULE;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const draft = (n, extra = {}) => ({ id: id(n), type: 'expense', description: '零食很忙', member_id: null, amount_cents: 980, transaction_date: '2026-10-09', ...extra });
const batch = drafts => ({ batch_id: id(90), status: 'pending', drafts });
const plain = value => JSON.parse(JSON.stringify(value));

test('draft matching finds even one saved match, scopes ownership and filters type/date/amount without requiring a member', { skip: !modulePath }, async t => {
  const f = await createFixture(modulePath); t.after(f.close);
  for (const [n, owner, type, amount, date, description] of [
    [1, 'owner', 'expense', '9.80', '2026-10-09', '零食很忙'],
    [2, 'foreign', 'expense', '9.80', '2026-10-09', '零食很忙'],
    [3, 'owner', 'income', '9.80', '2026-10-09', '零食很忙'],
    [4, 'owner', 'expense', '9.81', '2026-10-09', '零食很忙'],
    [5, 'owner', 'expense', '9.80', '2026-10-18', '零食很忙'],
    [6, 'owner', 'expense', '39.00', '2026-10-09', '阿里云云服务器'],
  ]) await f.db.query('INSERT INTO transactions(id,user_id,type,amount,transaction_date,description) VALUES($1,$2,$3,$4,$5,$6)', [id(n), owner, type, amount, date, description]);
  const input = batch([draft(21), draft(22, { description: '阿里云服务购买', amount_cents: 3900 }), draft(23, { amount_cents: 3126 }),
    draft(24, { transaction_date: undefined }), draft(25, { amount_cents: undefined })]);
  const before = JSON.stringify(input), start = f.statements.length;
  const result = plain(await f.load('lib/assistant-draft-matches.ts').readAssistantDraftMatches('owner', input));
  assert.deepEqual(result.rows.map(row => row.status), ['possible_match', 'possible_match', 'no_match', 'incomplete', 'incomplete']);
  assert.equal(result.rows[0].candidate_count, 1);
  assert.equal(result.rows[0].candidates[0].id, id(1));
  assert.equal(result.rows[0].candidates[0].amount_cents, 980);
  assert.equal(result.rows[0].candidates[0].transaction_date, '2026-10-09');
  assert.equal(result.rows[0].candidates[0].same_description, true);
  assert.equal(result.rows[1].candidates[0].same_description, false, 'changed descriptions remain candidates');
  assert.equal(result.same_description_is_only_suspected, true);
  assert.match(result.reply, /零食很忙｜2026-10-09｜¥9.80：找到.*商户名称一致/);
  assert.match(result.reply, /用途相关.*仍需确认/);
  assert.match(result.reply, /暂未核对/);
  assert.match(result.reply, /没有更改草稿或账本/);
  assert.equal(JSON.stringify(input), before);
  assert.ok(f.statements.slice(start).every(statement => /^\s*SELECT\b/.test(statement.text)));
  assert.equal((await f.db.query('SELECT * FROM transactions')).rows.length, 6);
});

test('screenshot reproduction finds the previous-day merchant matches and changed cloud description, with a formatted comparison', { skip: !modulePath }, async t => {
  const f = await createFixture(modulePath); t.after(f.close);
  const saved = [['零食很忙', 980], ['德生龙社区厨房（永香路店）', 3126], ['.top域名 jiajiwei.top 续费', 3900]];
  for (let i = 0; i < saved.length; i++) await f.db.query('INSERT INTO transactions(id,user_id,type,amount,transaction_date,description) VALUES($1,\'owner\',\'expense\',$2,\'2026-10-08\',$3)', [id(i + 1), saved[i][1] / 100, saved[i][0]]);
  const input = batch([draft(21, { description: '蚂蚁财富-建信纳斯达克100', amount_cents: 1000, transaction_date: '2026-10-10' }), draft(22),
    draft(23, { description: saved[1][0], amount_cents: 3126 }), draft(24, { description: '阿里云服务购买', amount_cents: 3900 }), draft(25, { description: '蚂蚁财富-建信纳斯达克100', amount_cents: 1000 })]);
  const start = f.statements.length;
  const result = plain(await f.load('lib/assistant-draft-matches.ts').readAssistantDraftMatches('owner', input));
  assert.deepEqual(result.rows.map(row => row.status), ['no_match', 'possible_match', 'possible_match', 'possible_match', 'no_match']);
  for (const row of result.rows.slice(1, 4)) {
    assert.equal(row.candidates[0].transaction_date, '2026-10-08');
    assert.equal(row.candidates[0].date_difference_days, -1);
  }
  assert.equal(result.rows[3].candidates[0].same_description, false);
  assert.equal(result.reply_view.title, '重复入账核对');
  assert.equal(result.reply_view.records[1].badge.label, '疑似重复');
  assert.equal(result.reply_view.records[3].badge.label, '用途相关，待核对');
  assert.match(result.reply_view.records[2].rows[0].value, /2026-10-08.*¥31.26/);
  assert.match(result.reply_view.records[2].rows[0].value, /早 1 天/);
  assert.match(result.reply_view.records[3].rows[0].value, /用途相关/);
  assert.ok(f.statements.slice(start).every(statement => /^\s*SELECT\b/.test(statement.text)));
  assert.equal((await f.db.query('SELECT * FROM transactions')).rows.length, 3);
});

test('nearby dates rank matching merchants first, keep recurring payments ambiguous, and disclose the bounded range', { skip: !modulePath }, async t => {
  const f = await createFixture(modulePath); t.after(f.close);
  for (const [n, date, description] of [[1, '2026-10-09', '别的商户'], [2, '2026-10-08', '零食很忙'], [3, '2026-10-10', '零食很忙'], [4, '2026-10-02', '零食很忙'], [5, '2026-10-01', '零食很忙'], [6, '2026-10-16 23:59:59', '零食很忙'], [7, '2026-10-17', '零食很忙']]) {
    await f.db.query('INSERT INTO transactions(id,user_id,type,amount,transaction_date,description) VALUES($1,\'owner\',\'expense\',9.8,$2,$3)', [id(n), date, description]);
  }
  const result = plain(await f.load('lib/assistant-draft-matches.ts').readAssistantDraftMatches('owner', batch([draft(21)])));
  const row = result.rows[0];
  assert.equal(row.candidate_count, 4);
  assert.equal(row.candidates.length, 3);
  assert.equal(row.candidates_limited, true);
  assert.deepEqual(row.candidates.slice(0, 2).map(candidate => candidate.id), [id(2), id(3)]);
  assert.match(result.reply_view.notices.map(n => n.text).join(' '), /同商户可能多次消费/);
  assert.match(result.reply_view.subtitle, /前后 7 天/);
});

test('candidate limits preserve complete counts and prefer same descriptions; decimal amounts remain exact', { skip: !modulePath }, async t => {
  const f = await createFixture(modulePath); t.after(f.close);
  for (let n = 1; n <= 7; n++) await f.db.query('INSERT INTO transactions(id,user_id,type,amount,transaction_date,description) VALUES($1,\'owner\',\'expense\',31.26,\'2026-10-09\',$2)', [id(n), '社区厨房']);
  const read = f.load('lib/assistant-draft-matches.ts').readAssistantDraftMatches;
  const result = plain(await read('owner', batch([draft(21, { description: '社区厨房', amount_cents: 3126 }), draft(22, { description: '社区厨房', amount_cents: 3126 })])));
  for (const row of result.rows) {
    assert.equal(row.candidate_count, 7);
    assert.equal(row.candidates.length, 3);
    assert.equal(row.candidates_limited, true);
    assert.equal(row.candidates[0].id, id(1));
    assert.equal(row.candidates[0].amount_cents, 3126);
  }
  assert.deepEqual(result.rows.map(row => row.draft_id), [id(21), id(22)]);
  const start = f.statements.length;
  await assert.rejects(read('owner', null), /没有可核对/);
  await assert.rejects(read('owner', { ...batch([draft(21)]), status: 'saved' }), /上下文无效/);
  const incomplete = await read('owner', batch([draft(21, { amount_cents: undefined })]));
  assert.equal(incomplete.rows[0].status, 'incomplete');
  assert.equal(f.statements.length, start);
});


test('screenshot false positives are excluded; blank-purpose fund is information-poor rather than a duplicate', { skip: !modulePath }, async t => {
  const f = await createFixture(modulePath); t.after(f.close);
  const categories = [{ id: id(81), name: '基金', type: 'expense' }, { id: id(82), name: '餐饮', type: 'expense' }];
  for (const c of categories) await f.db.query("INSERT INTO categories(id,user_id,name,type) VALUES($1,'owner',$2,'expense')", [c.id, c.name]);
  for (const [n, amount, date, description, category, member] of [
    [1, 9.8, '2026-10-08', '零食很忙', id(82), null],
    [2, 9.8, '2026-10-02', '扫收钱码付款-给椰子店', id(82), null],
    [3, 10, '2026-10-08', '', id(81), null],
    [4, 10, '2026-10-02', '阳朔桂粉记快餐店(个体工商户)', id(82), null],
    [5, 10, '2026-10-08', '阳朔桂粉记快餐店', id(82), null],
  ]) await f.db.query("INSERT INTO transactions(id,user_id,type,amount,transaction_date,description,category_id,member_id) VALUES($1,'owner','expense',$2,$3,$4,$5,$6)", [id(n), amount, date, description, category, member]);
  const input = batch([draft(21, { category_id: id(82) }), draft(22, { description: '蚂蚁财富-建信纳斯达克1...', category_id: id(81), amount_cents: 1000 })]);
  const result = plain(await f.load('lib/assistant-draft-matches.ts').readAssistantDraftMatches('owner', input, [], categories));
  assert.deepEqual(result.rows.map(r => r.candidates.map(c => c.id)), [[id(1)], [id(3)]]);
  assert.equal(result.rows[1].candidates[0].match_reason, 'missing_description');
  assert.equal(result.reply_view.records[1].badge.label, '缺少用途，待核对');
  assert.doesNotMatch(result.reply, /给椰子|桂粉记/);
  assert.equal(result.reply_view.draftComparison.batch_id, input.batch_id);
  assert.equal(result.reply_view.draftComparison.rows[0].draft_id, id(21));
});

test('purpose evidence needs a nearby date, compatible category and member; generic blank descriptions cannot match', { skip: !modulePath }, async t => {
  const f = await createFixture(modulePath); t.after(f.close);
  for (const c of [[81, '线上购物'], [82, '餐饮']]) await f.db.query("INSERT INTO categories(id,user_id,name,type) VALUES($1,'owner',$2,'expense')", [id(c[0]), c[1]]);
  for (const n of [83,84]) await f.db.query("INSERT INTO members(id,user_id,name) VALUES($1,'owner',$2)", [id(n), String(n)]);
  for (const [n, date, description, category, member] of [
    [1,'2026-10-08','.top域名续费',81,83], [2,'2026-10-07','.top域名续费',81,83],
    [3,'2026-10-08','.top域名续费',82,83], [4,'2026-10-08','.top域名续费',81,84], [5,'2026-10-08','',81,83],
  ]) await f.db.query("INSERT INTO transactions(id,user_id,type,amount,transaction_date,description,category_id,member_id) VALUES($1,'owner','expense',39,$2,$3,$4,$5)", [id(n),date,description,id(category),id(member)]);
  const result = plain(await f.load('lib/assistant-draft-matches.ts').readAssistantDraftMatches('owner', batch([draft(21, {description:'阿里云服务购买',amount_cents:3900,category_id:id(81),member_id:id(83)})]), [], [{id:id(81),name:'线上购物',type:'expense'}]));
  assert.deepEqual(result.rows[0].candidates.map(c => c.id), [id(1)]);
  assert.equal(result.rows[0].candidates[0].match_reason,'purpose');
});

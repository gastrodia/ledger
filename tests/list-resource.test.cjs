/* eslint-disable @typescript-eslint/no-require-imports -- deterministic deferred-request regression tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
function load(file) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, AbortController, Error, Date, require: id => load(`${id.slice(2)}.ts`) });
  return exports;
}
const { ListResource } = load('lib/list-resource.ts');
const { updateTransactions, updateCategories, updateLoan } = load('lib/list-updates.ts');
const { groupGiftRecords, giftSummary, matchesGiftSearch } = load('lib/gift-list-updates.ts');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const plain = value => JSON.parse(JSON.stringify(value));

test('initial failure is distinct from an empty list; retry recovers without classifying failure as no data', async () => {
  const list = new ListResource();
  let fail = true;
  list.start('members', async () => { if (fail) throw Error('offline'); return []; });
  await settle();
  assert.equal(list.getSnapshot().data, null);
  assert.equal(list.getSnapshot().error, 'offline');
  fail = false;
  await list.refresh();
  assert.deepEqual(list.getSnapshot().data, []);
  assert.equal(list.getSnapshot().error, null);
  assert.equal(list.getSnapshot().loading, false);
});

test('background refresh keeps the same data; failure retains it and a later retry replaces it', async () => {
  const list = new ListResource();
  let next = Promise.resolve([{ id: 'a' }]);
  list.start('members', () => next);
  await settle();
  const previous = list.getSnapshot().data;
  const pending = deferred(); next = pending.promise;
  const work = list.refresh();
  assert.equal(list.getSnapshot().data, previous);
  assert.equal(list.getSnapshot().loading, true);
  pending.reject(Error('offline')); await work;
  assert.equal(list.getSnapshot().data, previous);
  assert.equal(list.getSnapshot().error, 'offline');
  next = Promise.resolve([{ id: 'b' }]); await list.refresh();
  assert.deepEqual(list.getSnapshot().data, [{ id: 'b' }]);
});

test('a read already decoding its response cannot undo either of two confirmed writes', async () => {
  const list = new ListResource();
  const reads = [];
  list.start('records', signal => { const request = deferred(); reads.push({ ...request, signal }); return request.promise; });
  reads[0].resolve([{ id: 'a', value: 1 }]); await settle();
  const slow = list.refresh();
  list.update('records', rows => rows.map(row => ({ ...row, value: 2 })));
  assert.equal(reads[1].signal.aborted, true);
  list.update('records', rows => [...rows, { id: 'b', value: 3 }]);
  reads[1].resolve([{ id: 'a', value: 1 }]);
  reads[2].resolve([{ id: 'a', value: 2 }]);
  await slow; await settle();
  assert.deepEqual(plain(list.getSnapshot().data), [{ id: 'a', value: 2 }, { id: 'b', value: 3 }]);
  reads[3].reject(Error('sync failed')); await settle();
  assert.equal(list.getSnapshot().data.length, 2);
  assert.equal(list.getSnapshot().error, 'sync failed');
});

test('switching query scopes rejects old reads and late writes without injecting records into the new query', async () => {
  const list = new ListResource(); const old = deferred();
  list.start('old-account:old-filter', () => old.promise);
  list.start('new-account:new-filter', async () => [{ id: 'current' }]); await settle();
  list.update('old-account:old-filter', () => assert.fail('old scope must not apply'));
  old.resolve([{ id: 'old' }]); await settle();
  assert.equal(list.getSnapshot().key, 'new-account:new-filter');
  assert.deepEqual(list.getSnapshot().data, [{ id: 'current' }]);
});

test('unmount rejects pending reads and late mutation callbacks; Strict Mode restart can load again', async () => {
  const list = new ListResource(); const pending = deferred();
  let publications = 0; list.subscribe(() => publications++);
  list.start('key', () => pending.promise); list.stop(); const count = publications;
  pending.resolve(['old']); list.update('key', () => assert.fail('unmounted update')); await settle();
  assert.equal(publications, count);
  list.start('key', async () => ['new']); await settle();
  assert.deepEqual(list.getSnapshot().data, ['new']);
});

test('creation before the initial read does not replace the full collection with just the created row', async () => {
  const list = new ListResource(); let calls = 0; const old = deferred();
  list.start('key', () => ++calls === 1 ? old.promise : Promise.resolve([{ id: 'existing' }, { id: 'new' }]));
  list.update('key', () => assert.fail('no complete collection to patch yet'));
  old.resolve([{ id: 'existing' }]); await settle();
  assert.equal(list.getSnapshot().data.length, 2);
});

const filters = { startDate: '2026-09-01', endDate: '2026-09-30', type: 'all', categoryId: '__all__', memberId: '__all__', q: '' };
const row = (id, amount, extra = {}) => ({ id, amount, type: 'expense', transaction_date: '2026-09-20T00:00:00.000Z', created_at: '2026-09-20T00:00:00.000Z', ...extra });
const initial = { data: [row('a', 0.1), row('b', 0.2)], summary: { totalIncome: 0, totalExpense: 0.3, balance: -0.3 }, hasAnyTransactions: true };

test('transaction edits/deletes update cent-accurate totals and preserve unchanged row identities', () => {
  const result = updateTransactions(initial, filters, row('a', 0.2));
  assert.equal(result.data.find(item => item.id === 'b'), initial.data[1]);
  assert.equal(result.summary.totalExpense, 0.4);
  const removed = updateTransactions(result, filters, undefined, 'b');
  assert.equal(removed.data.length, 1);
  assert.equal(removed.summary.balance, -0.2);
});

test('edits move out of active date/category/member/type/search filters; new rows use server order', () => {
  for (const active of [
    { ...filters, startDate: '2026-09-21' }, { ...filters, endDate: '2026-09-19' },
    { ...filters, type: 'income' }, { ...filters, categoryId: 'food' },
    { ...filters, memberId: 'member' }, { ...filters, q: '50%_literal' },
  ]) assert.equal(updateTransactions(initial, active, row('a', 12)).data.some(item => item.id === 'a'), false);
  assert.equal(updateTransactions(initial, { ...filters, categoryId: 'none', memberId: 'none' }, row('a', 12)).data.length, 2);
  const result = updateTransactions(initial, filters, row('new', 20, { created_at: '2026-09-29T12:00:00Z' }));
  assert.equal(result.data[0].id, 'new');
  const empty = updateTransactions({ ...initial, data: [initial.data[0]] }, filters, undefined, 'a');
  assert.equal(empty.hasAnyTransactions, null, 'A filtered empty list cannot establish that the entire ledger is empty');
});

test('category insertion retains persisted ordering and loan edits retain repayment aggregates', () => {
  const categories = [{ id: 'a', sort_order: 1, created_at: '2026-09-01' }, { id: 'b', sort_order: 0, created_at: '2026-09-01' }];
  assert.deepEqual(Array.from(updateCategories(categories, { id: 'new', created_at: '2026-09-29' }), row => row.id), ['b', 'a', 'new']);
  const loan = { id: 'loan', subject_type: 'money', amount: 100, repaid_amount_total: 25, repaid_quantity_total: 0, repayment_count: 1, occurred_at: '2026-09-01', created_at: '2026-09-01' };
  const result = updateLoan([loan], { ...loan, amount: 50 });
  assert.equal(result[0].remaining_amount, 25);
  assert.equal(result[0].status, 'partial');
  assert.equal(result[0].repayment_count, 1);
});

test('combined gifts use persisted group IDs, attachments and rounded cash/item totals', () => {
  const base = { counterparty_name: 'friend', gift_date: '2026-09-20', group_id: 'group' };
  const result = groupGiftRecords([
    { ...base, id: 'cash', gift_type: 'cash', amount: 0.1 },
    { ...base, id: 'item', gift_type: 'item', estimated_value: 0.2, attachment_key: '/item.png' },
  ]);
  assert.equal(result.id, 'group'); assert.equal(result.items_count, 1); assert.equal(result.attachment_key, '/item.png');
  assert.deepEqual(plain(giftSummary([result])), { cashTotal: 0.1, itemEstimatedTotal: 0.2, recordCount: 1 });
  assert.ok(matchesGiftSearch('Alice gift', 'AL%_gift'));
  assert.ok(matchesGiftSearch('50% off', '50\\%'));
  assert.ok(!matchesGiftSearch('500 off', '50\\%'));
  assert.ok(matchesGiftSearch('prefix abc%', 'abc\\'));
  assert.ok(!matchesGiftSearch('abc\\', 'abc\\'));
});

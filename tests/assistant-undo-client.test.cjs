/* eslint-disable @typescript-eslint/no-require-imports -- real client contracts in an isolated module loader. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const modules = new Map();
function load(filename) {
  if (modules.has(filename)) return modules.get(filename);
  const exports = {};
  modules.set(filename, exports);
  const source = ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, JSON, Date, require(name) {
    assert.ok(name.startsWith('@/lib/'), `Unexpected dependency ${name}`);
    return load(`${name.slice(2)}.ts`);
  } });
  return exports;
}
const undo = load('lib/assistant-undo.ts');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
function row(id, extra = {}) {
  return { id: uuid(id), type: 'expense', amount_cents: 3900, category_id: uuid(1), member_id: uuid(2),
    transaction_date: '2026-10-08', description: '.top 域名续费', payment_method: '支付宝', note: '', ...extra };
}
function operation(extra = {}) {
  return { id: uuid(30), batch_id: uuid(40), drafts: [row(10), row(11, { amount_cents: 3000 })],
    draft_ids: [uuid(10)], draftSort: 'date-desc', ...extra };
}
function result(request, extra = {}) {
  return { batch_id: uuid(50), drafts: request.drafts.filter(draft => request.draft_ids.includes(draft.id))
    .map((draft, index) => ({ ...draft, id: uuid(60 + index) })),
  undone_draft_ids: request.draft_ids, replayed: false, ...extra };
}

test('saved undo snapshots retain exact financial values, detach mutable rows and reject unusable original batches', () => {
  const original = [row(10, { note: '用于个人网站', extra: 'not a financial field' })];
  const snapshot = undo.savedDraftSnapshot(original);
  assert.deepEqual(plain(snapshot), [row(10, { note: '用于个人网站' })]);
  original[0].amount_cents = 1;
  original[0].description = 'mutated after capture';
  assert.equal(snapshot[0].amount_cents, 3900);
  assert.equal(snapshot[0].description, '.top 域名续费');
  for (const invalid of [
    null, [], [row(10, { id: 'invalid' })], [row(10), row(10)],
    [row(10, { amount_cents: 39.9 })], [row(10, { amount_cents: 0 })],
    [row(10, { transaction_date: '2026-02-30' })], [row(10, { member_id: null })],
    [row(10, { category_id: null })], [row(10, { note: undefined })],
    [row(10, { note: 'x'.repeat(1001) })],
  ]) assert.throws(() => undo.savedDraftSnapshot(invalid));
});

test('undo recovery rejects corrupted or foreign targets while preserving idempotent identity and exact full source payload', () => {
  const valid = operation();
  const malformed = [
    operation({ id: 'invalid' }), operation({ batch_id: 'invalid' }),
    operation({ draft_ids: [] }), operation({ draft_ids: [uuid(999)] }),
    operation({ draft_ids: [uuid(10), uuid(10)] }),
    operation({ drafts: [row(10, { amount_cents: -3900 })] }),
  ];
  const restored = undo.undoRecoverySnapshots([null, ...malformed, valid]);
  assert.deepEqual(plain(restored), [valid]);
  assert.deepEqual(plain(undo.undoRecoverySnapshots({ undos: [valid] })), []);
  valid.drafts[0].description = 'changed later';
  assert.equal(restored[0].drafts[0].description, '.top 域名续费');
});

test('restored undo recovery deduplicates operation identities and normalizes corrupt UI metadata without changing money', () => {
  const original = operation();
  const last = operation({ error: 'x'.repeat(4100), draftSort: 'corrupt' });
  const restored = undo.undoRecoverySnapshots([original, last]);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, original.id);
  assert.equal(restored[0].batch_id, original.batch_id);
  assert.equal(restored[0].draftSort, 'original');
  assert.equal(restored[0].error.length, 4000);
  assert.deepEqual(plain(restored[0].drafts), original.drafts);
  assert.deepEqual(plain(restored[0].draft_ids), original.draft_ids);
});

test('undo success binds the selected original rows to fresh identities and accepts reordered server rows without changing their values', () => {
  const request = operation({ draft_ids: [uuid(10), uuid(11)] });
  const success = result(request, { replayed: true });
  success.drafts.reverse();
  success.undone_draft_ids = [uuid(11), uuid(10)];
  const validated = undo.validateUndoResult(success, request);
  assert.deepEqual(plain(validated), success);
  assert.notEqual(validated.batch_id, request.batch_id);
  assert.ok(validated.drafts.every(draft => !request.drafts.some(original => original.id === draft.id)));
  assert.equal(validated.replayed, true);
});

test('undo success validation rejects every changed financial field, target mismatch and reused identity', () => {
  const request = operation();
  const success = result(request);
  for (const changed of [
    { type: 'income' }, { amount_cents: 3901 }, { category_id: uuid(3) },
    { member_id: uuid(3) }, { transaction_date: '2026-10-07' },
    { description: 'another purchase' }, { payment_method: '微信' },
  ]) assert.throws(() => undo.validateUndoResult({ ...success, drafts: [{ ...success.drafts[0], ...changed }] }, request));
  for (const invalid of [
    null, { reply: '已撤销，未入账。' },
    { ...success, batch_id: request.batch_id }, { ...success, batch_id: 'invalid' },
    { ...success, drafts: [row(10)] }, { ...success, drafts: [] },
    { ...success, drafts: [success.drafts[0], { ...success.drafts[0], id: uuid(61) }] },
    { ...success, undone_draft_ids: [uuid(11)] }, { ...success, undone_draft_ids: [] },
    { ...success, undone_draft_ids: [uuid(10), uuid(10)] },
  ]) assert.throws(() => undo.validateUndoResult(invalid, request));
});

test('same-amount entries preserve their original financial multiplicity and cannot replace a different selected transaction', () => {
  const request = operation({ drafts: [row(10), row(11, { description: '餐饮消费' })], draft_ids: [uuid(10), uuid(11)] });
  const success = result(request);
  assert.equal(undo.validateUndoResult(success, request).drafts.length, 2);
  const duplicated = { ...success, drafts: [success.drafts[0], { ...success.drafts[0], id: uuid(61) }] };
  assert.throws(() => undo.validateUndoResult(duplicated, request));
  const reused = { ...success, drafts: [success.drafts[0], { ...success.drafts[1], id: success.drafts[0].id }] };
  assert.throws(() => undo.validateUndoResult(reused, request));
});

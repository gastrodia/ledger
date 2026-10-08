/* eslint-disable @typescript-eslint/no-require-imports -- isolated image import contracts. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
function load(file, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Date, JSON, Number, Error,
    require: id => { assert.ok(id in deps, id); return deps[id]; },
  });
  return exports;
}
const assistant = load('lib/assistant.ts');
const images = load('lib/assistant-images.ts');
const imports = load('lib/assistant-image-import.ts', { '@/lib/assistant': assistant, '@/lib/assistant-images': images });
const image = 'data:image/png;base64,YWJj';
const row = { type: 'expense', amount_cents: 1200, category_id: null, member_id: null,
  transaction_date: '2026-10-03', description: '好友甲', payment_method: null, note: '' };
const source = (image_index, row_index, time = '11:47', transaction_id = null) => ({ image_index, row_index, time, transaction_id, kind: 'statement' });
const plan = drafts => ({ action: 'record', reply: '请核对后确认', drafts, query: null, update: null });
const merge = drafts => imports.mergeAssistantImageImport(plan(drafts), 2);

test('multi-image request accepts the old single-image contract and bounds count, individual size and total request size', () => {
  assert.equal(imports.assistantRequestImages({ image }).join(), image);
  assert.equal(imports.assistantRequestImages({ images: [image, image] }).length, 2);
  assert.equal(imports.assistantRequestImages({}).length, 0);
  const prefix = 'data:image/jpeg;base64,';
  const nearLimit = prefix + 'A'.repeat(images.MAX_ASSISTANT_IMAGE_LENGTH - prefix.length);
  assert.equal(imports.assistantRequestImages({ images: [nearLimit, nearLimit] }).length, 2);
  for (const body of [{ images: Array(6).fill(image) }, { images: image }, { images: [null] },
    { images: [image], image }, { image: null }, { images: ['https://private.example/image.png'] },
    { images: ['data:image/svg+xml;base64,YWJj'] }, { images: [nearLimit + 'A'] },
    { images: [nearLimit, nearLimit, image] }]) assert.throws(() => imports.assistantRequestImages(body));
});

test('two scrolling bill screenshots keep 14 independent rows, joining only the shared 12 yuan boundary', () => {
  // The amounts and boundary structure mirror the reported scroll overlap;
  // the descriptions are synthetic and no image or account is transmitted.
  const first = [
    ['咖啡店', 1279, '2026-10-08', '14:04'], ['旅行社', 200, '2026-10-04', '09:21'],
    ['商户甲', 20000, '2026-10-03', '20:03'], ['商户乙', 20000, '2026-10-03', '15:29'],
    ['码头', 2000, '2026-10-03', '13:47'], ['食堂', 36000, '2026-10-03', '13:32'],
    ['好友甲', 600, '2026-10-03', '11:47'], ['好友甲', 1200, '2026-10-03', '11:47'],
  ];
  const second = [first.at(-1), ['好友乙', 2300, '2026-10-02', '19:12'], ['商户丙', 23000, '2026-10-02', '09:33'],
    ['外卖', 2500, '2026-10-01', '20:21'], ['加油站', 10000, '2026-10-01', '18:52'],
    ['出行平台', 32518, '2026-09-30', '18:39'], ['生活服务', 2500, '2026-09-30', '18:14']];
  const drafts = [first, second].flatMap((entries, imageIndex) => entries.map(([description, amount_cents, transaction_date, time], index) => (
    { ...row, description, amount_cents, transaction_date, source: source(imageIndex + 1, index + 1, time) }
  )));
  const result = merge(drafts);
  assert.equal(result.summary.extracted_count, 15);
  assert.equal(result.summary.removed_duplicates, 1);
  assert.equal(result.summary.retained_count, 14);
  assert.equal(result.summary.review_required, false);
  assert.equal(result.output.drafts.length, 14);
  assert.equal(result.output.drafts.reduce((sum, draft) => sum + draft.amount_cents, 0), 154097);
  assert.equal(result.output.drafts.filter(draft => draft.description === '好友甲').map(draft => draft.amount_cents).join(), '600,1200');
  assert.equal(result.output.drafts.filter(draft => draft.amount_cents === 20000).length, 2);
  assert.equal(result.output.drafts.filter(draft => draft.amount_cents === 2500).length, 2);
  assert.equal(drafts.length, 15, 'the model response must not be mutated');
});

test('a complete multi-row suffix-prefix overlap joins adjacent screenshots and retains the original order', () => {
  const first = ['甲', '乙', '丙'].map((description, index) => ({ ...row, description, source: source(1, index + 1) }));
  const second = ['乙', '丙', '丁'].map((description, index) => ({ ...row, description, source: source(2, index + 1) }));
  const result = merge([...first, ...second]);
  assert.equal(result.summary.removed_duplicates, 2);
  assert.equal(result.output.drafts.map(draft => draft.description).join(), '甲,乙,丙,丁');
});

test('only neighboring screenshot boundaries qualify, never matching rows in the middle or non-neighboring images', () => {
  const middle = merge([{ ...row, source: source(1, 1) }, { ...row, description: '其他交易', source: source(1, 2) },
    { ...row, source: source(2, 1) }]);
  assert.equal(middle.summary.removed_duplicates, 0);
  const separated = imports.mergeAssistantImageImport(plan([{ ...row, source: source(1, 1) },
    { ...row, source: source(3, 1) }]), 3);
  assert.equal(separated.summary.removed_duplicates, 0);
});

test('same merchant and amount without matching printed time or transaction ID remain as separate drafts', () => {
  for (const sourcePatch of [{ time: null }, { time: '11:48' }, { time: '11:47:00' },
    { time: null, transaction_id: 'order-other' }]) {
    const result = merge([{ ...row, source: source(1, 1) }, { ...row, source: { ...source(2, 1), ...sourcePatch } }]);
    assert.equal(result.summary.removed_duplicates, 0);
    assert.equal(result.output.drafts.length, 2);
  }
  const missing = merge([{ ...row, source: source(1, 1, null) }, { ...row, source: source(2, 1, null) }]);
  assert.equal(missing.summary.review_required, true);
  assert.match(missing.summary.warnings.join(), /时间或交易单号/);
});

test('explicitly different payment methods or members prevent boundary deletion even with matching minute or order ID', () => {
  for (const evidence of [['11:47', null], [null, 'printed-order']]) {
    for (const [left, right] of [[{ payment_method: '微信' }, { payment_method: '支付宝' }],
      [{ member_id: 'member-a' }, { member_id: 'member-b' }]]) {
      const result = merge([{ ...row, ...left, source: source(1, 1, ...evidence) }, { ...row, ...right, source: source(2, 1, ...evidence) }]);
      assert.equal(result.summary.removed_duplicates, 0);
      assert.equal(result.output.drafts.length, 2);
      assert.equal(result.summary.review_required, true);
      assert.match(result.summary.warnings.join(), /冲突/);
    }
  }
});

test('same printed transaction ID can identify an overlap, but conflicting time or IDs never delete a row', () => {
  const shared = merge([{ ...row, source: source(1, 1, null, 'order-123') }, { ...row, source: source(2, 1, null, 'order-123') }]);
  assert.equal(shared.summary.removed_duplicates, 1);
  for (const patch of [{ time: '11:48', transaction_id: 'order-123' }, { time: '11:47', transaction_id: 'order-other' }]) {
    const result = merge([{ ...row, source: source(1, 1, '11:47', 'order-123') }, { ...row, source: { ...source(2, 1), ...patch } }]);
    assert.equal(result.summary.removed_duplicates, 0);
  }
});

test('independent receipts and unspecified image kinds do not merge from merchant, minute and amount alone', () => {
  for (const kind of ['receipt', 'unknown', undefined]) {
    const result = merge([{ ...row, source: { ...source(1, 1), kind } }, { ...row, source: { ...source(2, 1), kind } }]);
    assert.equal(result.summary.removed_duplicates, 0);
    assert.equal(result.output.drafts.length, 2);
    assert.equal(result.summary.review_required, true);
  }
  const mixed = merge([{ ...row, source: source(1, 1) }, { ...row, source: { ...source(2, 1), kind: 'receipt' } }]);
  assert.equal(mixed.summary.removed_duplicates, 0);
  const explicitOrder = merge([{ ...row, source: { ...source(1, 1, null, 'printed-unique-order'), kind: 'receipt' } },
    { ...row, source: { ...source(2, 1, null, 'printed-unique-order'), kind: 'receipt' } }]);
  assert.equal(explicitOrder.summary.removed_duplicates, 1);
});

test('same-image identical transactions are preserved and ambiguous occurrences on an overlap require review', () => {
  const drafts = [{ ...row, source: source(1, 1) }, { ...row, source: source(1, 2) }, { ...row, source: source(2, 1) }];
  const result = merge(drafts);
  assert.equal(result.summary.removed_duplicates, 0);
  assert.equal(result.output.drafts.length, 3);
  assert.equal(result.summary.review_required, true);
  assert.match(result.summary.warnings.join(), /相似交易/);
  assert.equal(imports.mergeAssistantImageImport(plan(drafts.slice(0, 2)), 1).output.drafts.length, 2);
});

test('missing, invalid or reordered source evidence is preserved with a visible review warning', () => {
  for (const patch of [undefined, null, source(3, 1), source(2, 2), source(2, 1, '25:00'), source(2, 1, null, ''),
    { ...source(2, 1), image_index: 1.2 }, { ...source(2, 1), kind: 'invented' }]) {
    const result = merge([{ ...row, source: source(1, 1) }, { ...row, source: patch }]);
    assert.equal(result.output.drafts.length, 2);
    assert.equal(result.summary.removed_duplicates, 0);
    assert.equal(result.summary.review_required, true);
  }
  const reversed = merge([{ ...row, source: source(2, 1) }, { ...row, source: source(1, 1) }]);
  assert.equal(reversed.summary.removed_duplicates, 0);
  assert.equal(reversed.summary.review_required, true);
  const noSource = merge([{ ...row }, { ...row }]);
  assert.equal(noSource.summary.removed_duplicates, 0);
  assert.equal(noSource.summary.retained_count, 2);
  assert.equal(noSource.summary.review_required, true);
});

test('different financial identities never merge even with matching printed time or order', () => {
  for (const patch of [{ type: 'income' }, { amount_cents: 600 }, { transaction_date: '2026-10-04' }, { description: '好友乙' },
    { amount_cents: 0 }, { amount_cents: 12.5 }, { transaction_date: '2026-02-30' }, { description: '' }]) {
    const result = merge([{ ...row, source: source(1, 1) }, { ...row, ...patch, source: source(2, 1) }]);
    assert.equal(result.summary.removed_duplicates, 0);
  }
});

test('20 unique drafts are permitted after boundary join but 21 unique drafts fail instead of being truncated', () => {
  const first = Array.from({ length: 20 }, (_, index) => ({ ...row, description: `交易 ${index}`, source: source(1, index + 1) }));
  const joined = merge([...first, { ...first.at(-1), source: source(2, 1) }]);
  assert.equal(joined.summary.removed_duplicates, 1);
  const accepted = assistant.validatePlan(joined.output, [], [], crypto.randomUUID);
  assert.equal(accepted.drafts.length, 20);
  assert.equal('source' in accepted.drafts[0], false, 'recognition evidence is not stored as financial data');
  const overLimit = merge([...first, { ...row, description: '新交易', source: source(2, 1) }]);
  assert.equal(overLimit.output.drafts.length, 21);
  assert.throws(() => assistant.validatePlan(overLimit.output, [], [], crypto.randomUUID), /最多识别20笔/);
  assert.throws(() => merge(Array(41).fill(row)), /账目过多/);
});

test('all 100 visible rows from five repeated screenshots are read before enforcing the 20 unique draft limit', () => {
  const drafts = Array.from({ length: 5 }, (_, imageIndex) => Array.from({ length: 20 }, (_, index) => ({
    ...row, description: `交易 ${index}`, source: source(imageIndex + 1, index + 1),
  }))).flat();
  const result = imports.mergeAssistantImageImport(plan(drafts), 5);
  assert.equal(result.summary.extracted_count, 100);
  assert.equal(result.summary.removed_duplicates, 80);
  assert.equal(result.summary.retained_count, 20);
  assert.equal(assistant.validatePlan(result.output, [], [], crypto.randomUUID).drafts.length, 20);
});

test('text plans, queries and separate sends never share a global deduplication state', () => {
  const text = plan([{ ...row }, { ...row }]);
  assert.equal(imports.mergeAssistantImageImport(text, 0).output, text);
  const query = { ...text, action: 'query', drafts: [] };
  assert.equal(imports.mergeAssistantImageImport(query, 2).output, query);
  const drafts = [{ ...row, source: source(1, 1) }, { ...row, source: source(2, 1) }];
  assert.equal(merge(drafts).summary.removed_duplicates, 1);
  assert.equal(merge(drafts).summary.removed_duplicates, 1);
  const wrapped = imports.mergeAssistantImageImport([plan(drafts)], 2);
  assert.equal(wrapped.output.drafts.length, 1);
});

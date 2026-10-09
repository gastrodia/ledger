/* eslint-disable @typescript-eslint/no-require-imports -- isolated screenshot schema and import contracts. */
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
const recognition = load('lib/assistant-image-recognition.ts', {
  ai: require('ai'), zod: require('zod'), '@/lib/assistant': assistant, '@/lib/assistant-images': images,
});
const standardOutput = load('lib/assistant-output.ts', { ai: require('ai'), zod: require('zod') });
const plain = value => JSON.parse(JSON.stringify(value));
const image = 'data:image/png;base64,YWJj';
const categories = [
  { id: '00000000-0000-4000-8000-000000000001', name: '餐饮', type: 'expense', icon: 'PRIVATE_ICON' },
  { id: '00000000-0000-4000-8000-000000000002', name: '工资', type: 'income' },
];
const members = [{ id: '00000000-0000-4000-8000-000000000003', name: '本人', avatar: 'PRIVATE_AVATAR' }];
const source = (image_index = 1, row_index = 1, time = '11:47') => ({ image_index, row_index, time, transaction_id: null, kind: 'statement' });
const row = { type: 'expense', amount_cents: 1200, category: 1, member: null, date: '2026-10-03',
  description: '早餐店', payment_method: null, note: '', source: source() };
const plan = drafts => ({ action: 'record', reply: '请核对后确认入账。', drafts });
const build = (patch = {}) => recognition.buildAssistantImageRecognition({
  today: '2026-10-09', message: '识别截图账单', images: [image, image], categories, members, ...patch,
});
const finalPlan = (request, raw, count = 2) => {
  const merged = imports.mergeAssistantImageImport(request.expandOutput(raw), count);
  return { ...merged, plan: assistant.validatePlan(merged.output, categories, members, crypto.randomUUID) };
};

test('image context contains only current instructions, ordered images and local option references', () => {
  const request = build({
    history: [{ role: 'user', content: 'HISTORICAL_TRANSACTION' }],
    draftBatch: { batch_id: 'PREVIOUS_PENDING_BATCH' }, savedBatch: { batch_id: 'PREVIOUS_SAVED_BATCH' },
  });
  const context = JSON.stringify(request.messages);
  for (const marker of ['HISTORICAL_TRANSACTION', 'PREVIOUS_PENDING_BATCH', 'PREVIOUS_SAVED_BATCH',
    'PRIVATE_ICON', 'PRIVATE_AVATAR', ...categories.map(value => value.id), ...members.map(value => value.id)]) {
    assert.equal(context.includes(marker), false, `unrelated or private context ${marker}`);
  }
  assert.equal(request.messages.length, 2);
  const options = JSON.parse(request.messages[0].content.split('\n可用数据：')[1]);
  assert.deepEqual(options.categories, [{ ref: 1, name: '餐饮', type: 'expense' }, { ref: 2, name: '工资', type: 'income' }]);
  assert.deepEqual(options.members, [{ ref: 1, name: '本人' }]);
  assert.equal(options.today, '2026-10-09');
  const content = request.messages[1].content;
  assert.equal(content[0].text, '识别截图账单');
  assert.deepEqual(Array.from(content.filter(part => part.type === 'file'), part => part.data), [image, image]);
  assert.match(content[1].text, /image_index=1/);
  assert.match(content[3].text, /image_index=2/);
  assert.match(request.messages[0].content, /不可信数据/);
});

test('compact references expand into the standard schema without changing financial evidence', async () => {
  const request = build();
  const wire = plan([{ ...row, member: 1 }, { ...row, type: 'income', amount_cents: 500000, category: 2,
    date: '2026-09-30', description: '工资', source: source(2, 1) }]);
  const parsed = await request.schema.validate(wire);
  assert.equal(parsed.success, true);
  const expanded = request.expandOutput(parsed.value);
  assert.deepEqual(plain(expanded.drafts[0]), {
    type: 'expense', amount_cents: 1200, category_id: categories[0].id, member_id: members[0].id,
    transaction_date: '2026-10-03', description: '早餐店', payment_method: null, note: '', source: source(),
  });
  assert.equal(expanded.drafts[1].category_id, categories[1].id);
  assert.equal(expanded.drafts[1].member_id, null);
  assert.equal(expanded.query, null);
  assert.equal(expanded.update, null);
  assert.equal(expanded.undo, null);
  assert.equal((await standardOutput.ASSISTANT_OUTPUT_SCHEMA.validate(expanded)).success, true);
  assert.equal(wire.drafts[0].category, 1, 'expansion must not mutate the provider response');
  assert.equal('category_id' in wire.drafts[0], false);
});

test('unknown, foreign, non-integer or string references fail instead of mapping to another account', async () => {
  const request = build();
  for (const patch of [{ category: 0 }, { category: 3 }, { category: -1 }, { category: 1.5 },
    { category: categories[0].id }, { category: '1' }, { member: 2 }, { member: 'foreign-member-id' },
    { member: '1' }, { member: undefined }]) {
    const raw = plan([{ ...row, ...patch }]);
    assert.equal((await request.schema.validate(raw)).success, false);
    assert.throws(() => request.expandOutput(raw), /引用无效/);
  }
  const empty = build({ categories: [], members: [] });
  assert.equal((await empty.schema.validate(plan([{ ...row, category: null }]))).success, true);
  assert.equal((await empty.schema.validate(plan([row]))).success, false);
});

test('reference snapshots do not change when caller option arrays change during generation', () => {
  const categoryOptions = categories.map(value => ({ ...value }));
  const memberOptions = members.map(value => ({ ...value }));
  const request = build({ categories: categoryOptions, members: memberOptions });
  categoryOptions[0].id = 'later-category';
  categoryOptions.reverse();
  memberOptions[0].id = 'later-member';
  const expanded = request.expandOutput(plan([{ ...row, member: 1 }]));
  assert.equal(expanded.drafts[0].category_id, categories[0].id);
  assert.equal(expanded.drafts[0].member_id, members[0].id);
});

test('unassigned members stay unassigned and type-incompatible categories still need review', () => {
  const request = build();
  const result = finalPlan(request, plan([{ ...row, category: 2 }]));
  assert.equal(result.plan.drafts[0].member_id, null);
  assert.equal(result.plan.drafts[0].category_id, null);
  assert.match(result.plan.drafts[0].note, /请选择家庭成员/);
  assert.match(result.plan.drafts[0].note, /请选择分类/);
  assert.equal(result.plan.action, 'record');
  assert.match(result.plan.reply, /确认/);
});

test('missing commentary and malformed provenance preserve complete rows without enabling a false merge', async () => {
  const request = build();
  for (const badSource of [undefined, null, 'bad', {}, source(3, 1), source(2, 0), source(2, 1, '25:00'),
    { ...source(2, 1), kind: 'invented' }, { ...source(2, 1), transaction_id: '   ' }]) {
    const raw = plan([row, { ...row, note: null, source: badSource }]);
    const parsed = await request.schema.validate(raw);
    assert.equal(parsed.success, true);
    const expanded = request.expandOutput(parsed.value);
    assert.equal(expanded.drafts[1].source, null);
    assert.equal(expanded.drafts[1].note, '');
    const result = finalPlan(request, raw);
    assert.equal(result.plan.drafts.length, 2);
    assert.equal(result.summary.removed_duplicates, 0);
    assert.equal(result.summary.review_required, true);
  }
  const noNote = { ...row };
  delete noNote.note;
  assert.equal(request.expandOutput(plan([noNote])).drafts[0].note, '');
});

test('financial corruption fails schema or final validation and is never rounded or defaulted', async () => {
  const request = build();
  for (const patch of [{ amount_cents: 1.5 }, { amount_cents: Infinity }, { amount_cents: '1200' },
    { date: null }, { description: null }, { note: 1 }]) {
    assert.equal((await request.schema.validate(plan([{ ...row, ...patch }]))).success, false);
  }
  for (const patch of [{ amount_cents: -1 }, { amount_cents: assistant.MAX_AMOUNT_CENTS + 1 },
    { date: '2026-02-30' }, { date: '' }, { description: 'a'.repeat(501) }]) {
    assert.throws(() => finalPlan(request, plan([{ ...row, ...patch }])), /金额或日期无效/);
  }
});

test('expansion keeps one-cent payments and delegates zero omission and adjacent overlap to existing rules', () => {
  const request = build();
  const result = finalPlan(request, plan([
    { ...row, amount_cents: 1, note: '已支付，等待确认收货', source: source(1, 1) },
    { ...row, source: source(1, 2) },
    { ...row, amount_cents: 0, source: source(1, 3) },
    { ...row, amount_cents: -0, source: source(2, 1) },
    { ...row, source: source(2, 2) },
    { ...row, description: '晚餐店', source: source(2, 3) },
  ]));
  assert.equal(result.summary.skipped_zero_amounts, 2);
  assert.equal(result.summary.removed_duplicates, 1);
  assert.equal(result.plan.drafts.length, 3);
  assert.deepEqual(Array.from(result.plan.drafts, draft => draft.amount_cents), [1, 1200, 1200]);
  assert.match(result.plan.reply, /待确认草稿/);
  const zeros = finalPlan(request, plan([{ ...row, amount_cents: 0, date: '', source: source(1, 1) }]));
  assert.equal(zeros.plan.action, 'chat');
  assert.equal(zeros.plan.drafts.length, 0);
});

test('all visible rows reach overlap processing before the unique draft limit and are never silently truncated', async () => {
  const request = build({ images: Array(5).fill(image) });
  const drafts = Array.from({ length: 5 }, (_, imageIndex) => Array.from({ length: 20 }, (_, rowIndex) => ({
    ...row, description: `交易${rowIndex}`, source: source(imageIndex + 1, rowIndex + 1),
  }))).flat();
  assert.equal((await request.schema.validate(plan(drafts))).success, true);
  const result = finalPlan(request, plan(drafts), 5);
  assert.equal(result.summary.extracted_count, 100);
  assert.equal(result.summary.removed_duplicates, 80);
  assert.equal(result.plan.drafts.length, 20);
  const tooMany = plan([...drafts.slice(0, 20), { ...row, description: '新的独立交易', source: source(2, 1) }]);
  const expanded = request.expandOutput(tooMany);
  assert.equal(expanded.drafts.length, 21);
  assert.throws(() => finalPlan(request, tooMany, 5), /最多识别20笔/);
  assert.equal((await request.schema.validate(plan([...drafts, row]))).success, false);
});

test('the image workflow only accepts record or empty chat and cannot smuggle other commands', async () => {
  const request = build();
  for (const action of ['query', 'update', 'undo']) {
    assert.equal((await request.schema.validate({ action, reply: '执行', drafts: [] })).success, false);
  }
  for (const extra of [{ query: null }, { undo: { batch_id: 'other' } }, { update: {} }, { id: 'another-batch' }]) {
    assert.throws(() => request.expandOutput({ ...plan([row]), ...extra }));
  }
  assert.equal((await request.schema.validate({ action: 'chat', reply: '请使用原卡片。', drafts: [row] })).success, false);
  const chat = request.expandOutput([{ action: 'chat', reply: '尚未执行，请使用原卡片。', drafts: [] }]);
  assert.equal(chat.action, 'chat');
  assert.equal(chat.drafts.length, 0);
  assert.equal(chat.update, null);
  assert.equal(chat.undo, null);
  assert.throws(() => request.expandOutput([plan([row]), plan([row])]));
});

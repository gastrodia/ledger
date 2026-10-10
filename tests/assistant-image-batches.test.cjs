/* eslint-disable @typescript-eslint/no-require-imports -- isolated image batch boundary and merge contracts. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');

function fixture(provider = async () => { throw new Error('Unexpected provider request'); }, { realSdk = false, env = {} } = {}) {
  const cache = new Map();
  const calls = [];
  const bailian = {
    BAILIAN_ASSISTANT_MODEL: 'test-vision-model',
    bailianObjectStream: async (...args) => { calls.push(args); return provider(...args); },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, {
      exports, Date, JSON, Number, Error, TypeError, AbortSignal, AbortController, Buffer,
      URL, Headers, Request, Response, ReadableStream, TransformStream, TextEncoder, TextDecoder,
      Uint8Array, setTimeout, clearTimeout,
      fetch: async (url, init) => {
        const call = { url: String(url), init, body: JSON.parse(init.body) };
        calls.push(call);
        return provider(call);
      },
      process: { env: { DASHSCOPE_API_KEY: 'batch-sdk-fixture-secret', ...env } }, console: { info() {}, error() {}, warn() {} },
      require: id => {
        if (id === '@/lib/bailian' && !realSdk) return bailian;
        if (id.startsWith('@/')) return load(path.join(process.cwd(), `${id.slice(2)}.ts`));
        if (id === 'node:crypto' || id === 'crypto') return crypto;
        if (id === 'ai' || id === 'zod' || id === '@ai-sdk/openai-compatible') return require(id);
        throw new Error(`Unexpected dependency ${id}`);
      },
    }, { filename: file });
    return exports;
  }
  return { ...load(path.resolve('lib/assistant-image-batches.ts')), calls,
    ...(realSdk ? { adapter: load(path.resolve('lib/bailian.ts')) } : {}),
  };
}

const plain = value => JSON.parse(JSON.stringify(value));
const images = Array.from({ length: 5 }, (_, index) => `data:image/png;base64,${Buffer.from(`image-${index + 1}`).toString('base64')}`);
const categories = [
  { id: '00000000-0000-4000-8000-000000000001', name: '餐饮', type: 'expense', icon: 'PRIVATE_ICON' },
  { id: '00000000-0000-4000-8000-000000000002', name: '工资', type: 'income' },
];
const members = [{ id: '00000000-0000-4000-8000-000000000003', name: '本人', avatar: 'PRIVATE_AVATAR' }];
const input = {
  today: '2026-10-09', message: '识别截图账单', images,
  history: [{ role: 'user', content: 'PRIVATE_OLD_CHAT' }],
  draftBatch: { batch_id: 'PRIVATE_PENDING_BATCH' }, savedBatch: { batch_id: 'PRIVATE_SAVED_BATCH' },
};
const source = (image_index = 1, row_index = 1, time = '11:47', transaction_id = null) => ({
  image_index, row_index, time, transaction_id, kind: 'statement',
});
const row = { type: 'expense', amount_cents: 1200, category: 1, member: null, date: '2026-10-03',
  description: '早餐店', payment_method: null, note: '', source: source() };
const wire = (drafts, patch = {}) => ({ action: 'record', outcome: 'complete', date_context: null, reply: '请核对后确认入账。', drafts, ...patch });
const args = (imageIndex = 0, patch = {}) => ({ input, categories, members, imageIndex, ...patch });
const completed = (api, index, drafts) => api.buildAssistantImageBatch(args(index)).expandOutput(wire(drafts));
const empty = (api, index, outcome = 'empty', reply = '本图没有收支交易。') => api.buildAssistantImageBatch(args(index))
  .expandOutput({ action: 'chat', outcome, date_context: null, reply, drafts: [] });
const finalize = (api, results, imageCount) => api.finalizeAssistantImageBatches(results, imageCount, categories, members);

test('a batch includes only its target and previous image, with no historical account context', () => {
  const api = fixture();
  for (let index = 0; index < images.length; index++) {
    const request = api.buildAssistantImageBatch(args(index));
    const serialized = JSON.stringify(request.messages);
    for (const marker of ['PRIVATE_OLD_CHAT', 'PRIVATE_PENDING_BATCH', 'PRIVATE_SAVED_BATCH', 'PRIVATE_ICON',
      'PRIVATE_AVATAR', ...categories.map(value => value.id), ...members.map(value => value.id)]) {
      assert.equal(serialized.includes(marker), false, `unexpected account context: ${marker}`);
    }
    const files = request.messages.flatMap(message => Array.isArray(message.content)
      ? message.content.filter(part => part.type === 'file').map(part => part.data) : []);
    assert.deepEqual(Array.from(files), index === 0 ? [images[0]] : [images[index - 1], images[index]]);
    assert.ok(serialized.includes(input.message));
    assert.ok(serialized.includes(input.today));
  }
});

test('batch instructions constrain preceding-image context and require evidence for cross-image dates', () => {
  const request = fixture().buildAssistantImageBatch(args(2));
  const text = request.messages.map(message => typeof message.content === 'string' ? message.content
    : message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')).join('\n');
  assert.match(text, /(?:上下文|参考)/);
  assert.match(text, /(?:目标|当前)/);
  assert.match(text, /(?:日期|月份)/);
  assert.match(text, /(?:可靠证据|明确证据|证据明确)/);
  assert.match(text, /needs_clarification/);
  assert.match(text, /(?:不能|不得).{0,12}(?:猜|编造|推断)/);
});

test('batch image indexes must be valid integers within the uploaded image set', () => {
  const api = fixture();
  for (const imageIndex of [-1, 5, 1.5, NaN, undefined]) {
    assert.throws(() => api.buildAssistantImageBatch({ ...args(), imageIndex }));
  }
  assert.throws(() => api.buildAssistantImageBatch(args(0, { input: { ...input, images: [] } })));
});

test('compact output references expand to known IDs and local target provenance maps to global image index', async () => {
  const request = fixture().buildAssistantImageBatch(args(3));
  const raw = wire([{ ...row, member: 1, source: source(2, 1) }]);
  assert.equal((await request.schema.validate(raw)).success, true);
  const result = request.expandOutput(raw);
  assert.equal(result.image_index, 4);
  assert.equal(result.outcome, 'complete');
  assert.equal(result.output.drafts[0].source.image_index, 4);
  assert.equal(result.output.drafts[0].source.row_index, 1);
  assert.equal(result.output.drafts[0].category_id, categories[0].id);
  assert.equal(result.output.drafts[0].member_id, members[0].id);
  assert.equal(result.output.drafts[0].transaction_date, row.date);
  assert.equal(result.output.query, null);
  assert.equal(result.output.update, null);
  assert.equal(result.output.undo, null);
  assert.equal(raw.drafts[0].source.image_index, 2, 'expansion must not mutate provider data');
});

test('batch output cannot silently retain missing, malformed, context-only or non-contiguous provenance', async () => {
  const request = fixture().buildAssistantImageBatch(args(1));
  for (const badSource of [undefined, null, {}, 'invalid', source(1, 1), source(3, 1), source(2, 0),
    source(2, 2), source(2, 1, '25:00'), { ...source(2, 1), transaction_id: '   ' }]) {
    const raw = wire([{ ...row, source: badSource }]);
    assert.equal((await request.schema.validate(raw)).success, false, `invalid source: ${JSON.stringify(badSource)}`);
    assert.throws(() => request.expandOutput(raw));
  }
  for (const rowIndexes of [[1, 1], [1, 3], [2, 1]]) {
    const raw = wire(rowIndexes.map(index => ({ ...row, source: source(2, index) })));
    assert.equal((await request.schema.validate(raw)).success, false);
    assert.throws(() => request.expandOutput(raw));
  }
});

test('outcome agrees with record/chat shape and never accepts foreign references or extra commands', async () => {
  const request = fixture().buildAssistantImageBatch(args());
  for (const raw of [
    wire([]), wire([row], { outcome: 'empty' }), wire([row], { outcome: 'needs_clarification' }),
    wire([row], { action: 'chat' }), wire([], { action: 'chat', outcome: 'complete' }),
    wire([row], { outcome: 'unknown' }), wire([row], { query: {} }),
    wire([{ ...row, category: categories[0].id }]), wire([{ ...row, category: 3 }]),
    wire([{ ...row, member: 'foreign-member' }]), wire([{ ...row, member: 2 }]),
  ]) {
    assert.equal((await request.schema.validate(raw)).success, false);
    assert.throws(() => request.expandOutput(raw));
  }
  assert.equal((await request.schema.validate({ action: 'chat', outcome: 'empty', date_context: null, reply: '只有零金额记录。', drafts: [] })).success, true);
});

test('an explicit earlier header can continue unchanged into later batches without adding older image payloads', () => {
  const api = fixture();
  const dateContext = { year: 2026, month: 10, source_image_index: 1, evidence: '2026年10月' };
  const request = api.buildAssistantImageBatch(args(2, { dateContext }));
  const result = request.expandOutput(wire([{ ...row, source: source(2, 1) }], { date_context: dateContext }));
  assert.deepEqual(plain(result.date_context), dateContext);
  assert.ok(JSON.stringify(request.messages).includes('2026年10月'));
  const files = request.messages.flatMap(message => Array.isArray(message.content)
    ? message.content.filter(part => part.type === 'file').map(part => part.data) : []);
  assert.deepEqual(Array.from(files), [images[1], images[2]]);
  const newHeader = { year: 2026, month: 9, source_image_index: 3, evidence: '2026年9月' };
  const changed = request.expandOutput(wire([{ ...row, date: '2026-09-30', source: source(2, 1) }], { date_context: newHeader }));
  assert.deepEqual(plain(changed.date_context), newHeader, 'a visible target header supersedes the carried month');
});

test('date context cannot invent unseen headers, alter earlier quotations, or survive an uncertain target', async () => {
  const api = fixture();
  const dateContext = { year: 2026, month: 10, source_image_index: 1, evidence: '2026年10月' };
  const request = api.buildAssistantImageBatch(args(2, { dateContext }));
  const target = [{ ...row, source: source(2, 1) }];
  for (const context of [undefined, {}, { ...dateContext, evidence: '2026年10月（推测）' },
    { ...dateContext, source_image_index: 4 }, { ...dateContext, month: 11 },
    { ...dateContext, evidence: '2026年11月' }, { ...dateContext, year: 2025 },
    { ...dateContext, evidence: '2026-02-30', month: 2 },
    { ...dateContext, month: 13 }, { ...dateContext, year: 999 },
    { ...dateContext, year: null, evidence: '沿用月份' },
    { ...dateContext, source_image_index: 0 }, { ...dateContext, extra: 'unexpected' }]) {
    const raw = wire(target, { date_context: context });
    assert.equal((await request.schema.validate(raw)).success, false, `invalid date context: ${JSON.stringify(context)}`);
    assert.throws(() => request.expandOutput(raw));
  }
  assert.throws(() => api.buildAssistantImageBatch(args(2)).expandOutput(wire(target, { date_context: dateContext })));
  assert.throws(() => api.buildAssistantImageBatch(args(0, { dateContext })));
  assert.throws(() => request.expandOutput(wire([], {
    action: 'chat', outcome: 'needs_clarification', date_context: dateContext,
  })));
});

test('a bare month quotation drops only an inferred context year and preserves reviewed transaction dates', async () => {
  const request = fixture().buildAssistantImageBatch(args(0));
  const raw = wire([row], { date_context: { year: 2026, month: 10, source_image_index: 1, evidence: '10月' } });
  assert.equal((await request.schema.validate(raw)).success, true);
  const result = request.expandOutput(raw);
  assert.equal(result.date_context.year, null);
  assert.equal(result.date_context.month, 10);
  assert.equal(result.output.drafts[0].transaction_date, '2026-10-03');
  assert.equal(result.output.drafts[0].amount_cents, 1200);
  assert.match(result.output.drafts[0].note, /核对交易年份/);
  assert.equal(raw.date_context.year, 2026, 'do not mutate provider data');
  assert.equal(raw.drafts[0].note, '');
  for (const patch of [{ year: '2026' }, { year: 999 }, { month: 9 },
    { year: 2025, evidence: '2026年10月' }, { evidence: '10月（推测）' }, { evidence: '昨天' }]) {
    assert.equal((await request.schema.validate({ ...raw, date_context: { ...raw.date_context, ...patch } })).success, false);
  }
});

test('unordered completed batches merge in original screenshot order and deduplicate only an evidenced boundary', () => {
  const api = fixture();
  const first = completed(api, 0, [
    { ...row, description: '首笔', source: source(1, 1, '09:00') },
    { ...row, description: '重叠交易', source: source(1, 2, '10:00') },
  ]);
  const second = completed(api, 1, [
    { ...row, description: '重叠交易', source: source(2, 1, '10:00') },
    { ...row, description: '末笔', source: source(2, 2, '11:00') },
  ]);
  const before = JSON.stringify([second, first]);
  const result = finalize(api, [second, first], 2);
  assert.equal(result.action, 'record');
  assert.deepEqual(Array.from(result.drafts, value => value.description), ['首笔', '重叠交易', '末笔']);
  assert.equal(result.import_summary.removed_duplicates, 1);
  assert.match(result.reply, /确认/);
  assert.equal(new Set(result.drafts.map(value => value.id)).size, 3);
  result.drafts.forEach(value => assert.match(value.id, /^[\da-f]{8}-[\da-f-]{27}$/i));
  assert.equal(JSON.stringify([second, first]), before, 'finalization must preserve saved checkpoints');
});

test('same-image repeated payments and conflicting printed times or transaction IDs are retained', () => {
  const api = fixture();
  const first = completed(api, 0, [row, { ...row, source: source(1, 2) }]);
  const second = completed(api, 1, [{ ...row, source: source(2, 1) }]);
  const repeated = finalize(api, [first, second], 2);
  assert.equal(repeated.drafts.length, 3);
  assert.equal(repeated.import_summary.removed_duplicates, 0);
  for (const right of [source(2, 1, '11:48', 'tx-1'), source(2, 1, '11:47', 'tx-2')]) {
    const result = finalize(api, [completed(api, 0, [{ ...row, source: source(1, 1, '11:47', 'tx-1') }]),
      completed(api, 1, [{ ...row, source: right }])], 2);
    assert.equal(result.drafts.length, 2);
    assert.equal(result.import_summary.removed_duplicates, 0);
  }
});

test('dates from each target survive cross-month finalization without inheriting the previous image month', () => {
  const api = fixture();
  const result = finalize(api, [
    completed(api, 1, [{ ...row, date: '2026-09-30', source: source(2, 1) }]),
    completed(api, 0, [{ ...row, date: '2026-10-01', source: source(1, 1) }]),
  ], 2);
  assert.deepEqual(Array.from(result.drafts, value => value.transaction_date), ['2026-10-01', '2026-09-30']);
  assert.equal(result.import_summary.removed_duplicates, 0);
});

test('zero rows are omitted without losing one-cent payments or corrupting boundary row indexes', () => {
  const api = fixture();
  const result = finalize(api, [completed(api, 0, [
    { ...row, amount_cents: 1, source: source(1, 1) },
    { ...row, amount_cents: 0, source: source(1, 2) },
  ]), completed(api, 1, [
    { ...row, amount_cents: -0, source: source(2, 1) },
    { ...row, amount_cents: 500, description: '午餐店', source: source(2, 2) },
  ])], 2);
  assert.deepEqual(Array.from(result.drafts, value => value.amount_cents), [1, 500]);
  assert.equal(result.import_summary.skipped_zero_amounts, 2);
});

test('safe empty results allow other images to produce drafts and all-empty batches produce chat', () => {
  const api = fixture();
  const mixed = finalize(api, [empty(api, 0), completed(api, 1, [{ ...row, source: source(2, 1) }])], 2);
  assert.equal(mixed.action, 'record');
  assert.equal(mixed.drafts.length, 1);
  const allEmpty = finalize(api, [empty(api, 1), empty(api, 0)], 2);
  assert.equal(allEmpty.action, 'chat');
  assert.equal(allEmpty.drafts.length, 0);
});

test('one clarification blocks a partial financial plan while leaving completed checkpoints reusable', () => {
  const api = fixture();
  const first = completed(api, 0, [row]);
  const saved = JSON.stringify(first);
  const result = finalize(api, [first, empty(api, 1, 'needs_clarification', '请确认这笔转账的实际收支。')], 2);
  assert.equal(result.action, 'chat');
  assert.equal(result.drafts.length, 0);
  assert.match(result.reply, /2/);
  assert.match(result.reply, /转账/);
  assert.equal(JSON.stringify(first), saved);
});

test('finalization requires exactly one checkpoint per original image and rejects foreign IDs', () => {
  const api = fixture();
  const first = completed(api, 0, [row]);
  const second = completed(api, 1, [{ ...row, source: source(2, 1) }]);
  for (const checkpoints of [[], [first], [first, first], [first, second, second], [{ ...first, image_index: 3 }, second]]) {
    assert.throws(() => finalize(api, checkpoints, 2));
  }
  for (const field of ['category_id', 'member_id']) {
    const corrupted = plain(first);
    corrupted.output.drafts[0][field] = '00000000-0000-4000-8000-000000000999';
    assert.throws(() => finalize(api, [corrupted, second], 2));
  }
});

test('a clarification never masks financial corruption in another stored checkpoint', () => {
  const api = fixture();
  const first = completed(api, 0, [row]);
  for (const patch of [{ amount_cents: -1 }, { amount_cents: 1.5 }, { transaction_date: '2026-02-30' },
    { description: 'x'.repeat(501) }]) {
    const corrupted = plain(first);
    Object.assign(corrupted.output.drafts[0], patch);
    assert.throws(() => finalize(api, [corrupted, empty(api, 1, 'needs_clarification', '请确认日期。')], 2));
  }
});

test('checkpoint reuse validates its original slot and preserves raw zero rows and provenance for the final merge', () => {
  const api = fixture();
  const checkpoint = completed(api, 2, [
    { ...row, amount_cents: 0, source: source(2, 1) },
    { ...row, amount_cents: 1, source: source(2, 2) },
  ]);
  const validated = api.validateAssistantImageBatchResult(checkpoint, 2, 5, categories, members);
  assert.deepEqual(plain(validated), plain(checkpoint));
  assert.deepEqual(Array.from(validated.output.drafts, value => value.amount_cents), [0, 1]);
  assert.deepEqual(Array.from(validated.output.drafts, value => value.source.row_index), [1, 2]);
  assert.equal('id' in validated.output.drafts[0], false, 'checkpoint validation must not prematurely assign draft IDs');
  for (const [imageIndex, imageCount] of [[0, 5], [3, 5], [2, 2], [2, 6], [-1, 5], [1.5, 5]]) {
    assert.throws(() => api.validateAssistantImageBatchResult(checkpoint, imageIndex, imageCount, categories, members));
  }
  for (const mutate of [
    value => { value.output.drafts[0].source = null; },
    value => { value.output.drafts[1].source.row_index = 3; },
    value => { value.output.drafts[0].source.image_index = 2; },
    value => { value.output.drafts[0].category_id = 'foreign-category'; },
    value => { value.output.drafts[0].member_id = 'foreign-member'; },
    value => { value.date_context = { year: 2026, month: 10, source_image_index: 4, evidence: '2026年10月' }; },
  ]) {
    const corrupted = plain(checkpoint);
    mutate(corrupted);
    assert.throws(() => api.validateAssistantImageBatchResult(corrupted, 2, 5, categories, members));
  }
});

test('all rows reach the final unique-draft limit; batches cannot silently truncate extra transactions', async () => {
  const api = fixture();
  const firstRows = Array.from({ length: 20 }, (_, index) => ({ ...row, description: `交易${index + 1}`, source: source(1, index + 1) }));
  const first = completed(api, 0, firstRows);
  const second = completed(api, 1, [{ ...row, description: '第21笔独立交易', source: source(2, 1) }]);
  assert.throws(() => finalize(api, [first, second], 2), /20/);
  assert.equal(first.output.drafts.length, 20);
  const request = api.buildAssistantImageBatch(args());
  assert.equal((await request.schema.validate(wire([...firstRows, { ...row, source: source(1, 21) }]))).success, false);
});

test('five full batches retain all one hundred raw rows until adjacent overlap produces twenty unique drafts', () => {
  const api = fixture();
  const results = images.map((_, imageIndex) => completed(api, imageIndex, Array.from({ length: 20 }, (_, rowIndex) => ({
    ...row, description: `交易${rowIndex + 1}`, source: source(imageIndex === 0 ? 1 : 2, rowIndex + 1),
  }))));
  const plan = finalize(api, results.slice().reverse(), 5);
  assert.equal(plan.drafts.length, 20);
  assert.equal(plan.import_summary.image_count, 5);
  assert.equal(plan.import_summary.extracted_count, 100);
  assert.equal(plan.import_summary.removed_duplicates, 80);
  assert.equal(results.reduce((count, result) => count + result.output.drafts.length, 0), 100);
});

test('batch generation uses a bounded single-image output budget and returns only completed validated output', async () => {
  const api = fixture(async (_request, onPartial, signal) => {
    assert.equal(signal.aborted, false);
    onPartial({ action: 'record', reply: '未验证', drafts: [{ amount_cents: 999999 }] });
    return wire([{ ...row, source: source(2, 1) }]);
  });
  const controller = new AbortController();
  const result = await api.generateAssistantImageBatch(args(2), controller.signal);
  assert.equal(result.image_index, 3);
  assert.equal(result.output.drafts.length, 1);
  assert.equal(result.output.drafts[0].amount_cents, 1200);
  assert.equal(api.calls.length, 1);
  const [request, , signal] = api.calls[0];
  assert.equal(request.timeoutMs, 90000);
  assert.equal(request.maxOutputTokens, 5000);
  assert.equal(request.thinking, false);
  assert.equal(signal, controller.signal);
});

test('cancellation discards even a provider result which arrives after the abort', async () => {
  const controller = new AbortController();
  const cancelled = new Error('Cancelled');
  const api = fixture(async () => {
    controller.abort(cancelled);
    return wire([row]);
  });
  await assert.rejects(api.generateAssistantImageBatch(args(), controller.signal), error => error === cancelled);
});

test('invalid amounts or calendar dates fail before a completed batch can be checkpointed', async () => {
  for (const patch of [{ amount_cents: -1 }, { amount_cents: 1.5 }, { amount_cents: 1000000000000 },
    { date: '2026-02-30' }, { description: 'x'.repeat(501) }]) {
    const api = fixture(async () => wire([{ ...row, ...patch }]));
    await assert.rejects(api.generateAssistantImageBatch(args(), new AbortController().signal));
  }
});

test('an already cancelled batch never starts a provider request', async () => {
  const controller = new AbortController();
  const cancelled = new Error('Cancelled before start');
  controller.abort(cancelled);
  const api = fixture();
  await assert.rejects(api.generateAssistantImageBatch(args(), controller.signal), error => error === cancelled);
  assert.equal(api.calls.length, 0);
});

function streamedObject(raw) {
  const json = JSON.stringify(raw);
  const events = [];
  // Real SDK parsing sees fragmented JSON and split UTF-8 bytes, including
  // incomplete provenance/date context; only its validated final object wins.
  for (let offset = 0; offset < json.length; offset += 23) {
    events.push({ choices: [{ delta: { content: json.slice(offset, offset + 23) } }] });
  }
  events.push({ choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 } });
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('')
    + 'data: [DONE]\r\n\r\n');
  return new Response(new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}

test('real Bailian SDK streams the batch schema and expands verified target rows with their date context', async () => {
  const dateContext = { year: 2026, month: 10, source_image_index: 2, evidence: '2026年10月' };
  const api = fixture(async () => streamedObject(wire([{ ...row, member: 1, source: source(2, 1) }],
    { date_context: dateContext })), { realSdk: true });
  const result = await api.generateAssistantImageBatch(args(2), new AbortController().signal);
  assert.equal(result.image_index, 3);
  assert.equal(result.outcome, 'complete');
  assert.deepEqual(plain(result.date_context), dateContext);
  assert.equal(result.output.drafts[0].source.image_index, 3);
  assert.equal(result.output.drafts[0].category_id, categories[0].id);
  assert.equal(result.output.drafts[0].member_id, members[0].id);
  assert.equal(result.output.drafts[0].transaction_date, '2026-10-03');
  assert.equal(api.calls.length, 1);
  const { body, init } = api.calls[0];
  assert.equal(body.stream, true);
  assert.equal(body.enable_thinking, false);
  assert.equal(body.max_completion_tokens, 5000);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.match(body.messages[0].content, /ledger_image_batch/);
  const format = { schema: JSON.parse(body.messages[0].content.split('\nJSON Schema:\n')[1]) };
  assert.ok(format.schema.required.includes('outcome'));
  assert.ok(format.schema.required.includes('date_context'));
  assert.deepEqual(format.schema.properties.outcome.enum, ['complete', 'empty', 'needs_clarification']);
  assert.equal(format.schema.properties.drafts.maxItems, 20);
  const draftFields = format.schema.properties.drafts.items.properties;
  assert.ok(draftFields.category);
  assert.ok(draftFields.member);
  assert.equal(draftFields.category_id, undefined);
  assert.equal(draftFields.member_id, undefined);
  const files = body.messages.flatMap(message => Array.isArray(message.content)
    ? message.content.filter(part => part.type === 'image_url').map(part => part.image_url.url) : []);
  assert.deepEqual(files, [images[1], images[2]]);
  assert.equal(init.cache, 'no-store');
  for (const marker of ['batch-sdk-fixture-secret', categories[0].id, members[0].id, 'PRIVATE_OLD_CHAT']) {
    assert.equal(init.body.includes(marker), false);
  }
});

test('real Bailian SDK rejects wrong-image or missing-date-context batch output before returning a checkpoint', async () => {
  const missingContext = wire([{ ...row, source: source(2, 1) }]);
  delete missingContext.date_context;
  for (const invalid of [wire([{ ...row, source: source(1, 1) }]), missingContext]) {
    const api = fixture(async () => streamedObject(invalid), { realSdk: true });
    let checkpointAccepted = false;
    await assert.rejects(api.generateAssistantImageBatch(args(2), new AbortController().signal)
      .then(result => { checkpointAccepted = true; return result; }), error => {
      assert.equal(api.adapter.bailianFailure(error).status, 422);
      assert.equal(error.code, 'invalid_output');
      assert.equal(error.message.includes('batch-sdk-fixture-secret'), false);
      return true;
    });
    assert.equal(checkpointAccepted, false);
    assert.equal(api.calls.length, 1);
  }
});

test('image batches on an arbitrary model retain strict financial and source checks without native Schema support', async () => {
  const env = { BAILIAN_ASSISTANT_MODEL: 'future-vision-model' };
  const raw = wire([{ ...row, source: source(2, 1) }]);
  const api = fixture(async () => streamedObject(raw), { realSdk: true, env });
  const result = await api.generateAssistantImageBatch(args(2), new AbortController().signal);
  assert.equal(result.output.drafts[0].amount_cents, 1200);
  assert.deepEqual(api.calls[0].body.response_format, { type: 'json_object' });
  const instructions = api.calls[0].body.messages[0].content;
  for (const field of ['type', 'amount_cents', 'category', 'member', 'date_context', 'outcome', 'source']) {
    assert.ok(instructions.includes(`"${field}"`));
  }
  assert.equal(api.calls[0].body.enable_thinking, false);
  assert.equal(api.calls.length, 1);
  for (const invalid of [[], wire([{ ...row, source: source(1, 1) }]),
    wire([{ ...row, source: source(2, 1), category: 3 }]),
    wire([{ ...row, source: source(2, 1), amount_cents: -980 }]),
    wire([{ ...row, source: source(2, 1), date: '2026-02-30' }]),
    wire([{ ...row, source: source(2, 1), type: undefined, direction: 'expense' }]),
    wire([{ ...row, source: source(2, 1) }], { command: {} })]) {
    const rejected = fixture(async () => streamedObject(invalid), { realSdk: true, env });
    await assert.rejects(rejected.generateAssistantImageBatch(args(2), new AbortController().signal));
    assert.equal(rejected.calls.length, 1);
  }
});

test('a complete target batch can include unknown transfer purpose and refund category without asking for clarification', () => {
  const f=fixture();
  const request=f.buildAssistantImageBatch({input:{...input,images:[images[0]]},categories,members,imageIndex:0});
  const data=[['income',10000,'转账-来自测试成员'],['expense',30000,'转账-转给测试成员'],['income',14,'测试商户-退...']];
  const raw={action:'record',reply:'请核对草稿。',outcome:'complete',date_context:{year:2026,month:10,source_image_index:1,evidence:'2026年10月'},drafts:data.map(([type,amount_cents,description],i)=>({type,amount_cents,category:null,member:null,date:'2026-10-08',description,payment_method:null,note:'具体用途和分类待核对',source:{image_index:1,row_index:i+1,time:'14:15',transaction_id:null,kind:'statement'}}))};
  const expanded=request.expandOutput(raw);
  const checked=f.validateAssistantImageBatchResult(expanded,0,1,categories,members);
  assert.equal(checked.outcome,'complete');assert.equal(checked.output.drafts.length,3);
  const final=f.finalizeAssistantImageBatches([checked],1,categories,members);
  assert.equal(final.action,'record');assert.equal(final.drafts.length,3);
  assert.ok(final.drafts.every(d=>d.category_id===null&&d.member_id===null));
});

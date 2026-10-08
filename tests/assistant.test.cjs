/* eslint-disable @typescript-eslint/no-require-imports -- isolated route and provider fixtures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const { NextResponse } = require('next/server');
function load(file, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: id => { assert.ok(id in deps, id); return deps[id]; },
    Date, JSON, URL, Number, ArrayBuffer, DataView, Float32Array, Uint8Array, TextEncoder, TextDecoder, Response,
    ReadableStream, AbortController, AbortSignal, Buffer, SyntaxError, ...globals });
  return exports;
}
const helper = load('lib/assistant.ts');
const output = load('lib/assistant-output.ts', { ai: require('ai'), zod: require('zod'), '@/lib/assistant': helper });
const audio = load('lib/assistant-audio.ts');
const images = load('lib/assistant-images.ts');
const imageImport = load('lib/assistant-image-import.ts', { '@/lib/assistant': helper, '@/lib/assistant-images': images });
const categoryId = '00000000-0000-4000-8000-000000000001';
const memberId = '00000000-0000-4000-8000-000000000002';
const batchId = '00000000-0000-4000-8000-000000000003';
const categories = [{ id: categoryId, type: 'expense', name: '餐饮' }];
const members = [{ id: memberId, name: '本人' }];
const row = { type: 'expense', amount_cents: 6800, category_id: categoryId, member_id: memberId, transaction_date: '2026-09-30', description: '买菜', payment_method: null, note: '' };
const plan = { action: 'record', reply: '待确认', drafts: [row], query: null };

test('image paste takes binary clipboard files, leaves plain text alone, and supports the file-list fallback', () => {
  const file = { type: 'image/png', name: 'screenshot.png' };
  assert.equal(images.clipboardImage({ items: [
    { kind: 'string', type: 'text/html', getAsFile: () => assert.fail('must not fetch a pasted HTML image') },
    { kind: 'file', type: 'image/png', getAsFile: () => file },
  ], files: [] }), file);
  assert.equal(images.clipboardImage({ items: [{ kind: 'file', type: 'image/png', getAsFile: () => null }], files: [file] }), file);
  assert.equal(images.clipboardImage({ items: [{ kind: 'string', type: 'text/plain', getAsFile: () => assert.fail('plain text stays native') }], files: [] }), undefined);
});

test('multi-image paste preserves every binary item in order without repeating the fallback list', () => {
  const a = { type: 'image/png', name: 'a.png' }, b = { type: 'image/jpeg', name: 'b.jpg' };
  const items = [a, b, a].map(file => ({ kind: 'file', type: file.type, getAsFile: () => file }));
  assert.deepEqual(Array.from(images.clipboardImages({ items, files: [a, b] })), [a, b]);
  assert.deepEqual(Array.from(images.clipboardImages({ items: [], files: [a, { type: 'text/plain' }, b] })), [a, b]);
});

test('multi-image append and restore enforce count, aggregate size and legacy migration without dropping existing images', () => {
  const a = { data: 'data:image/png;base64,YWJj', name: 'a' }, b = { data: 'data:image/jpeg;base64,YWJk', name: 'b' };
  const current = [a];
  assert.deepEqual(Array.from(images.appendAssistantImages(current, [b, a])), [a, b]);
  assert.deepEqual(current, [a]);
  assert.deepEqual(Array.from(images.restoreAssistantImages(undefined, a)), [a]);
  assert.deepEqual(Array.from(images.restoreAssistantImages([a, b], a)), [a, b]);
  assert.equal(images.restoreAssistantImages([], a).length, 0);
  assert.equal(images.restoreAssistantImages(Array(6).fill(a)).length, 0);
  assert.equal(images.restoreAssistantImages([a, { ...b, data: 'https://private.example/image' }]).length, 0);
  const prefix = 'data:image/png;base64,';
  const large = { data: prefix + 'A'.repeat(images.MAX_ASSISTANT_IMAGE_LENGTH - prefix.length), name: 'large' };
  assert.equal(images.restoreAssistantImages([large, large, a, b]).length, 0);
  assert.throws(() => images.appendAssistantImages([large], [{ ...large, data: large.data.replace(/A$/, 'B') }, { ...a, data: a.data + 'AAAA' }]), /总大小/);
  const distinct = Array.from({ length: 6 }, (_, i) => ({ ...a, data: a.data + 'AAAA'.repeat(i) }));
  assert.throws(() => images.appendAssistantImages([], distinct), /最多选择/);
  const display = { ...a, data: 'data:image/png;base64,' + 'A'.repeat(250_000) };
  assert.equal(images.restoreAssistantImages([display, display], undefined, true).length, 0);
});

test('malformed persisted import summaries do not crash the restored conversation', () => {
  const summary = { image_count: 2, extracted_count: 15, removed_duplicates: 1, retained_count: 14, review_required: false, warnings: [] };
  assert.equal(images.restoreAssistantImportSummary(summary), summary);
  for (const invalid of [null, { ...summary, warnings: 'bad' }, { ...summary, image_count: 6 }, { ...summary, retained_count: 15 }]) assert.equal(images.restoreAssistantImportSummary(invalid), undefined);
});

test('restored screenshot previews accept bounded raster data and reject remote or executable sources', () => {
  const image = { data: 'data:image/jpeg;base64,YWJj', name: '粘贴的图片' };
  assert.equal(images.isAssistantImage(image), true);
  for (const invalid of [null, { ...image, data: 'https://private.example/receipt.png' }, { ...image, data: 'data:image/svg+xml;base64,YWJj' },
    { ...image, data: 'data:image/png;base64,' + 'A'.repeat(2_000_000) }, { ...image, name: 'A'.repeat(256) }]) assert.equal(images.isAssistantImage(invalid), false);
});

test('sent-message display images have a smaller persistence limit than recognition sources', () => {
  const prefix = 'data:image/jpeg;base64,';
  const image = { data: prefix + 'A'.repeat(images.MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH - prefix.length), name: '账单截图' };
  assert.equal(images.isAssistantMessageImage(image), true);
  const source = { ...image, data: image.data + 'AAAA' };
  assert.equal(images.isAssistantImage(source), true);
  assert.equal(images.isAssistantMessageImage(source), false);
  for (const invalid of [undefined, null, { ...image, data: 'blob:temporary-preview' },
    { ...image, data: 'https://private.example/receipt.png' },
    { ...image, data: 'data:image/svg+xml;base64,YWJj' }, { ...image, name: 'A'.repeat(256) }]) {
    assert.equal(images.isAssistantMessageImage(invalid), false);
  }
});

test('small sent images preserve their source and never invoke a decoder or remote fetch', async () => {
  const image = { data: 'data:image/jpeg;base64,YWJj', name: '粘贴的图片' };
  const local = load('lib/assistant-images.ts', {}, { Image: class { constructor() { assert.fail('small display copy needs no decoding'); } } });
  assert.equal(await local.prepareAssistantMessageImage(image), image);
  for (const data of ['https://private.example/receipt.png', 'blob:temporary', 'data:image/svg+xml;base64,YWJj']) {
    await assert.rejects(local.prepareAssistantMessageImage({ ...image, data }), /截图格式无效/);
  }
});

test('large sent images keep their complete aspect ratio and name while preserving the recognition source', async () => {
  const prefix = 'data:image/jpeg;base64,';
  const source = { data: prefix + 'A'.repeat(500_000), name: '长账单截图' };
  const original = { ...source };
  const decodedSources = [];
  const drawn = [];
  let encodings = 0;
  const local = load('lib/assistant-images.ts', {}, {
    Image: class {
      naturalWidth = 6000; naturalHeight = 4000;
      set src(value) { decodedSources.push(value); this.onload(); }
    },
    document: { createElement: element => {
      assert.equal(element, 'canvas');
      return { width: 0, height: 0,
        getContext: type => { assert.equal(type, '2d'); return { drawImage: (...args) => drawn.push(args.slice(1)) }; },
        toDataURL: (type, quality) => {
          assert.equal(type, 'image/jpeg'); assert.ok([0.8, 0.65].includes(quality));
          return prefix + 'A'.repeat(++encodings < 3 ? 500_000 : 100_000);
        },
      };
    } },
  });
  const display = await local.prepareAssistantMessageImage(source);
  assert.equal(display.name, source.name);
  assert.equal(local.isAssistantMessageImage(display), true);
  assert.equal(decodedSources.length, 1);
  assert.equal(decodedSources[0], source.data);
  assert.deepEqual(drawn.at(-1), [0, 0, 1200, 800]);
  assert.deepEqual(source, original);
});

test('display image decoding and unavailable canvas fail visibly without retaining an oversized message', async () => {
  const source = { data: 'data:image/jpeg;base64,' + 'A'.repeat(500_000), name: '账单' };
  const broken = load('lib/assistant-images.ts', {}, {
    Image: class { set src(value) { assert.equal(value, source.data); this.onerror(); } }, document: {},
  });
  await assert.rejects(broken.prepareAssistantMessageImage(source), /图片读取失败/);
  const unavailable = load('lib/assistant-images.ts', {}, {
    Image: class { naturalWidth = 2000; naturalHeight = 1000; set src(value) { assert.equal(value, source.data); this.onload(); } },
    document: { createElement: () => ({ getContext: () => null }) },
  });
  await assert.rejects(unavailable.prepareAssistantMessageImage(source), /图片预览生成失败/);
});

test('single-plan multimodal wrappers are normalized but multiple plans are rejected', () => {
  assert.equal(helper.validatePlan([plan], categories, members, crypto.randomUUID).drafts[0].amount_cents, 6800);
  assert.throws(() => helper.validatePlan([plan, plan], categories, members, crypto.randomUUID));
});

test('SDK schema keeps valid financial rows when optional image provenance is malformed, so merger can warn without deleting', async () => {
  for (const source of [{ image_index: 0, row_index: 1, time: '11:47', transaction_id: null, kind: 'statement' },
    { image_index: 1, row_index: 1.2, time: '11:47', transaction_id: null, kind: 'statement' },
    { image_index: 1, row_index: 1, time: '11:47', transaction_id: null, kind: 'invented' }]) {
    const parsed = await output.ASSISTANT_OUTPUT_SCHEMA.validate({ ...plan, update: null, drafts: [{ ...row, source }, { ...row, source }] });
    assert.equal(parsed.success, true);
    assert.equal(parsed.value.drafts[0].source, null);
    const merged = imageImport.mergeAssistantImageImport(parsed.value, 2);
    assert.equal(merged.summary.removed_duplicates, 0);
    assert.equal(merged.summary.retained_count, 2);
    assert.equal(merged.summary.review_required, true);
  }
  const invalidMoney = await output.ASSISTANT_OUTPUT_SCHEMA.validate({ ...plan, drafts: [{ ...row, amount_cents: 12.5, source: 'bad' }] });
  assert.equal(invalidMoney.success, false);
});

test('draft validation preserves cents and date, and refuses malformed amounts before confirmation', () => {
  const result = helper.validatePlan({ ...plan, drafts: [row, { ...row, amount_cents: 2450 }] }, categories, members, crypto.randomUUID);
  assert.equal(result.drafts[1].amount_cents, 2450);
  assert.notEqual(result.drafts[0].id, result.drafts[1].id);
  for (const patch of [{ amount_cents: -1 }, { amount_cents: 12.2 }, { amount_cents: Infinity }, { transaction_date: '2026-02-30' }]) {
    assert.throws(() => helper.validatePlan({ ...plan, drafts: [{ ...row, ...patch }] }, categories, members, crypto.randomUUID));
    assert.throws(() => helper.confirmationRows([{ ...row, ...patch }]));
  }
  assert.throws(() => helper.confirmationRows(Array(21).fill(row)));
});

test('unknown, foreign and wrong-type IDs stay unresolved and cannot be confirmed', () => {
  for (const patch of [{ category_id: 'foreign' }, { category_id: null, description: '不明用途' }, { type: 'income' }, { member_id: 'foreign' }]) {
    const result = helper.validatePlan({ ...plan, drafts: [{ ...row, ...patch }] }, categories, members, crypto.randomUUID);
    assert.ok(!result.drafts[0].category_id || !result.drafts[0].member_id);
    assert.throws(() => helper.confirmationRows(result.drafts));
  }
  assert.equal(helper.confirmationRows([{ ...row, payment_method: '支付宝' }])[0].description, '买菜 · 支付方式：支付宝');
  const common = helper.validatePlan({ ...plan, drafts: [{ ...row, category_id: null }] }, categories, members, crypto.randomUUID);
  assert.equal(common.drafts[0].category_id, categoryId);
});

test('queries reject foreign filters, impossible dates and excessively broad periods', () => {
  const query = { start_date: '2026-09-01', end_date: '2026-09-30', type: null, category_id: null, member_id: null, keyword: null };
  for (const patch of [{ start_date: '2026-09-31' }, { end_date: '2026-08-01' }, { start_date: '2000-01-01' }, { category_id: 'foreign' }, { member_id: 'foreign' }]) {
    assert.throws(() => helper.validatePlan({ action: 'query', reply: '', drafts: [], query: { ...query, ...patch } }, categories, members, crypto.randomUUID));
  }
});

test('PCM upload validation enforces mono 16kHz, exact header lengths and the 60 second limit', () => {
  const valid = audio.encodePcmWav(new Float32Array(16000));
  assert.equal(audio.validatePcmWav(valid), true);
  assert.equal(new DataView(valid).getUint32(24, true), 16000);
  assert.equal(audio.validatePcmWav(audio.encodePcmWav(new Float32Array(16000 * 61))), false);
  assert.equal(audio.validatePcmWav(audio.encodePcmWav(new Float32Array(16000), 48000)), false);
  new DataView(valid).setUint16(22, 2, true);
  assert.equal(audio.validatePcmWav(valid), false);
});

function routes({ session = { userId: 'owner' }, provider = JSON.stringify(plan), textProvider = provider, providerError, result = [] } = {}) {
  const calls = [], queries = [], transactions = [];
  const sql = async (parts, ...values) => { queries.push({ text: parts.join('?'), values }); return parts.join('').includes('FROM categories') ? categories : members; };
  sql.query = async (text, values) => { queries.push({ text, values }); return []; };
  sql.transaction = async statements => { transactions.push(statements); return [[], [], result]; };
  const deps = {
    'next/server': { NextResponse }, 'node:crypto': crypto,
    '@/lib/auth': { getSession: async () => session }, '@/lib/db': { sql }, '@/lib/assistant': helper,
    '@/lib/assistant-output': output,
    '@/lib/assistant-image-import': imageImport,
    '@/lib/assistant-schema': { ensureAssistantSchema: async () => {} }, '@/lib/assistant-audio': audio,
    '@/lib/bailian': { BAILIAN_ASSISTANT_MODEL: 'qwen3.7-plus', BAILIAN_SUMMARY_MODEL: 'qwen3.8-max', BAILIAN_ASR_MODEL: 'qwen3-asr-flash',
      bailianConfig: () => {}, bailianFailure: () => ({ status: 502, message: '服务暂不可用' }),
      bailianObject: async (...args) => { calls.push(args); if (providerError) throw providerError; return JSON.parse(provider); },
      bailianText: async (...args) => { calls.push(args); if (providerError) throw providerError; return textProvider; } },
  };
  const globals = { process: { env: {} } };
  deps['@/lib/assistant-generation'] = load('lib/assistant-generation.ts', deps, globals);
  return { assistant: load('app/api/assistant/route.ts', deps, globals), confirm: load('app/api/assistant/confirm/route.ts', deps, globals),
    transcribe: load('app/api/assistant/transcribe/route.ts', deps, globals), calls, queries, transactions };
}
const request = body => ({ json: async () => body, signal: new AbortController().signal });

test('all assistant endpoints authenticate before parsing, querying or paid calls', async () => {
  const f = routes({ session: null });
  const unreadable = { json: () => assert.fail('must not read body'), formData: () => assert.fail('must not read audio') };
  assert.equal((await f.assistant.GET()).status, 401);
  assert.equal((await f.assistant.POST(unreadable)).status, 401);
  assert.equal((await f.confirm.POST(unreadable)).status, 401);
  assert.equal((await f.transcribe.POST(unreadable)).status, 401);
  assert.equal(f.calls.length + f.queries.length + f.transactions.length, 0);
});

test('draft recognition leaves an unspecified member unresolved, even after earlier member replies', async () => {
  const f = routes({ provider: JSON.stringify({ ...plan, drafts: [{ ...row, member_id: null }] }) });
  const response = await f.assistant.POST(request({ message: '买菜68元', today: '2026-09-30', history: [{ role: 'user', content: '上笔支出人是本人' }] }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.drafts[0].amount_cents, 6800);
  assert.equal(body.drafts[0].member_id, null);
  assert.equal(f.transactions.length, 0);
  assert.equal(f.calls[0][0].schemaName, 'ledger_plan');
  assert.equal(f.calls[0][0].schema.jsonSchema.type, 'object');
  assert.equal(f.calls[0][0].thinking, false);
  assert.match(f.calls[0][0].messages[0].content, /不要沿用历史账单中的成员/);
  assert.ok(!f.calls[0][0].messages[0].content.includes('default_member_id'));
});

test('malformed requests and arbitrary image URLs never call a provider', async () => {
  const image = 'data:image/png;base64,YWJj';
  for (const body of [{}, { message: 'x', today: '2026-02-30' }, { message: 'x', today: '2026-09-30', image: 'https://internal/' },
    ...[{ images: 'bad' }, { images: [null] }, { images: ['data:image/svg+xml;base64,YWJj'] }, { images: Array(6).fill(image) },
      { image, images: [image] }, { images: ['data:image/png;base64,' + 'A'.repeat(2_000_000)] },
      { images: Array(3).fill('data:image/png;base64,' + 'A'.repeat(1_400_000)) }].map(patch => ({ message: 'x', today: '2026-09-30', ...patch }))]) {
    const f = routes(); assert.equal((await f.assistant.POST(request(body))).status, 400); assert.equal(f.calls.length, 0);
  }
});

test('multiple screenshots are sent as numbered original files in one paid request and keep unresolved members', async () => {
  const f = routes({ provider: JSON.stringify({ ...plan, drafts: [{ ...row, member_id: null }] }) });
  const images = ['data:image/png;base64,YWJj', 'data:image/jpeg;base64,YWJk'];
  const response = await f.assistant.POST(request({ message: '请合并截图', today: '2026-09-30', images }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.drafts[0].member_id, null);
  assert.equal(body.import_summary.image_count, 2);
  assert.equal(body.import_summary.removed_duplicates, 0);
  assert.equal(body.import_summary.review_required, true);
  const content = f.calls[0][0].messages.at(-1).content;
  assert.match(content[1].text, /第 1 张截图（共 2 张）/);
  assert.equal(content[2].data, images[0]);
  assert.match(content[3].text, /第 2 张截图（共 2 张）/);
  assert.equal(content[4].data, images[1]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.transactions.length, 0);
});

test('a statement containing a zero-value refunded order retains five pending expenses without posting', async () => {
  const drafts = [2000, 1, 0, 33150, 1000, 980].map((amount_cents, index) => ({ ...row, amount_cents,
    description: `截图交易 ${index + 1}`, member_id: null, transaction_date: '2026-10-02',
    note: index === 2 ? '有退款' : index === 1 ? '等待确认收货' : '' }));
  const f = routes({ provider: JSON.stringify({ ...plan, reply: '识别到6笔支出', drafts }) });
  const response = await f.assistant.POST(request({ message: '识别这张截图', today: '2026-10-08', image: 'data:image/jpeg;base64,YWJj' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.action, 'record');
  assert.deepEqual(body.drafts.map(d => d.amount_cents), [2000, 1, 33150, 1000, 980]);
  assert.equal(body.drafts.reduce((sum, d) => sum + d.amount_cents, 0), 37131);
  assert.ok(body.drafts.every(d => d.member_id === null));
  assert.equal(body.import_summary.skipped_zero_amounts, 1);
  assert.equal(body.import_summary.retained_count, 5);
  assert.match(body.reply, /零金额/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.transactions.length, 0);
});

test('recognition uses typed image parts, retains bounded history and propagates request cancellation', async () => {
  const f = routes();
  const image = 'data:image/png;base64,YWJj';
  const controller = new AbortController();
  const body = { message: '请识别截图', today: '2026-09-30', image,
    history: Array.from({ length: 10 }, (_, index) => ({ role: 'user', content: `历史 ${index}` })) };
  const response = await f.assistant.POST({ ...request(body), signal: controller.signal });
  assert.equal(response.status, 200);
  const [options, signal] = f.calls[0];
  assert.equal(signal, controller.signal);
  assert.equal(options.maxOutputTokens, 5000);
  assert.equal(options.messages.length, 10);
  assert.equal(options.messages[1].content, '历史 2');
  assert.equal(options.messages.at(-1).content[0].type, 'text');
  assert.equal(options.messages.at(-1).content[1].type, 'file');
  assert.equal(options.messages.at(-1).content[1].mediaType, 'image/png');
  assert.equal(options.messages.at(-1).content[1].data, image);
  assert.equal(f.transactions.length, 0);
});

test('query orchestration parses once, scopes facts to the owner and then asks the summary model with real query results', async () => {
  const query = { start_date: '2026-09-01', end_date: '2026-09-30', type: 'expense', category_id: null, member_id: null, keyword: null };
  const f = routes({ provider: JSON.stringify({ action: 'query', reply: '', drafts: [], query, update: null }), textProvider: '该期间暂无支出记录。' });
  const controller = new AbortController();
  const response = await f.assistant.POST({ ...request({ message: '这个月花了多少', today: '2026-09-30' }), signal: controller.signal });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reply, '该期间暂无支出记录。');
  assert.equal(f.calls.length, 2);
  const [analysis, signal] = f.calls[1];
  assert.equal(analysis.model, 'qwen3.8-max');
  assert.equal(analysis.reasoningEffort, 'low');
  assert.equal(analysis.maxOutputTokens, 8192);
  assert.equal(signal, controller.signal);
  const facts = JSON.parse(analysis.messages[1].content);
  assert.equal(facts.question, '这个月花了多少');
  assert.deepEqual(facts.filters, query);
  assert.ok(facts.facts);
  assert.equal(f.queries.length, 5);
  assert.ok(f.queries.every(call => call.values[0] === 'owner'));
  assert.equal(f.transactions.length, 0);
});

test('cancelled assistant work returns 499 rather than a misleading successful plan', async () => {
  const controller = new AbortController();
  controller.abort();
  const f = routes({ providerError: new Error('cancelled upstream work') });
  const response = await f.assistant.POST({ ...request({ message: '吃饭3元', today: '2026-09-30' }), signal: controller.signal });
  assert.equal(response.status, 499);
  assert.equal(f.transactions.length, 0);
});

test('member questions advance per draft and choices preserve explicit members and financial fields', () => {
  const other = { id: '00000000-0000-4000-8000-000000000004', name: '家人' };
  const available = [...members, other];
  const drafts = [
    { ...row, id: 'a' },
    { ...row, id: 'b', member_id: null, amount_cents: 300, description: '吃饭' },
    { ...row, id: 'c', type: 'income', member_id: null, amount_cents: 10000 },
  ];
  assert.equal(helper.missingMemberDraft(drafts, available).id, 'b');
  assert.equal(helper.memberQuestionText(drafts[1]), '支出人是谁？');
  const selected = helper.assignDraftMember(drafts, 'b', other.id, available);
  assert.equal(selected[0].member_id, memberId);
  assert.deepEqual({ ...selected[1], member_id: null }, drafts[1]);
  assert.equal(drafts[1].member_id, null);
  assert.equal(helper.missingMemberDraft(selected, available).id, 'c');
  assert.equal(helper.memberQuestionText(selected[2]), '这笔收入属于谁？');
  const complete = helper.assignDraftMember(selected, 'c', memberId, available);
  assert.equal(helper.missingMemberDraft(complete, available), undefined);
  assert.throws(() => helper.assignDraftMember(complete, 'a', other.id, available));
  assert.throws(() => helper.assignDraftMember(drafts, 'b', 'foreign', available));
});

test('one member choice completes all six transit screenshot drafts without changing their financial fields', () => {
  const amounts = [697, 298, 297, 294, 298, 298];
  const dates = ['2026-09-30', '2026-09-30', '2026-09-29', '2026-09-29', '2026-09-28', '2026-09-28'];
  const drafts = amounts.map((amount_cents, index) => ({
    ...row, id: `transit-${index}`, member_id: null, amount_cents, transaction_date: dates[index],
    description: '深圳通乘车', payment_method: '深圳通', note: `截图第 ${index + 1} 笔`,
    amount: (amount_cents / 100).toFixed(2),
  }));
  const before = structuredClone(drafts);
  assert.equal(helper.unassignedMemberDrafts(drafts, members).length, 6);
  assert.equal(helper.memberBatchQuestionText(drafts), '这 6 笔支出的支出人是谁？');
  const complete = helper.assignMissingDraftMembers(drafts, memberId, members);
  assert.equal(helper.unassignedMemberDrafts(complete, members).length, 0);
  assert.equal(helper.missingMemberDraft(complete, members), undefined);
  for (let index = 0; index < complete.length; index++) {
    assert.equal(complete[index].member_id, memberId);
    assert.deepEqual({ ...complete[index], member_id: null }, before[index]);
  }
  assert.deepEqual(drafts, before);
  assert.equal(complete.reduce((sum, draft) => sum + draft.amount_cents, 0), 2182);
  assert.throws(() => helper.assignMissingDraftMembers(complete, memberId, members));
});

test('batch member selection preserves explicit members, repairs stale members and rejects foreign choices', () => {
  const other = { id: '00000000-0000-4000-8000-000000000004', name: '家人' };
  const available = [...members, other];
  const drafts = [
    { ...row, id: 'explicit', member_id: other.id },
    { ...row, id: 'missing', member_id: null, amount_cents: 300 },
    { ...row, id: 'stale', member_id: 'removed-member', type: 'income', amount_cents: 10000 },
  ];
  const unresolved = helper.unassignedMemberDrafts(drafts, available);
  assert.deepEqual(Array.from(unresolved, draft => draft.id), ['missing', 'stale']);
  assert.equal(helper.memberBatchQuestionText(unresolved), '这 2 笔账目属于谁？');
  assert.throws(() => helper.assignMissingDraftMembers(drafts, 'foreign', available));
  const complete = helper.assignMissingDraftMembers(drafts, memberId, available);
  assert.equal(complete[0], drafts[0]);
  assert.equal(complete[1].member_id, memberId);
  assert.equal(complete[2].member_id, memberId);
  for (let index = 0; index < drafts.length; index++) {
    assert.deepEqual({ ...complete[index], member_id: drafts[index].member_id }, drafts[index]);
  }
  assert.equal(drafts[1].member_id, null);
  assert.equal(drafts[2].member_id, 'removed-member');
  assert.equal(helper.memberBatchQuestionText([drafts[1]]), '支出人是谁？');
  assert.equal(helper.memberBatchQuestionText([drafts[2]]), '这笔收入属于谁？');
  assert.equal(helper.memberBatchQuestionText([drafts[2], { ...drafts[2], id: 'income-2' }]), '这 2 笔收入属于谁？');
});

test('editable batch context accepts stale member IDs but rejects invalid, saved, committed and duplicate rows', () => {
  const draft = { id: crypto.randomUUID(), type: 'expense', description: '深圳通乘车', member_id: crypto.randomUUID() };
  const batch = { batch_id: batchId, status: 'pending', drafts: [draft] };
  assert.equal(helper.validateDraftBatch(undefined), null);
  assert.equal(helper.validateDraftBatch(null), null);
  const result = helper.validateDraftBatch(batch);
  assert.equal(result.batch_id, batchId);
  assert.deepEqual({ ...result.drafts[0] }, draft);
  for (const invalid of [[], {}, { ...batch, batch_id: 'foreign' }, { ...batch, status: 'saved' },
    { ...batch, commit: [row] }, { ...batch, drafts: [] }, { ...batch, drafts: Array(21).fill(draft) },
    { ...batch, drafts: [draft, draft] }, ...[
      { id: 'foreign' }, { type: 'transfer' }, { description: 'x'.repeat(501) }, { member_id: 'foreign' }, { member_id: undefined },
    ].map(patch => ({ ...batch, drafts: [{ ...draft, ...patch }] }))]) assert.throws(() => helper.validateDraftBatch(invalid));
  assert.equal(helper.validateDraftBatch({ ...batch, drafts: [{ ...draft, member_id: null }] }).drafts[0].member_id, null);
});

test('structured member update changes all six existing transit drafts once without recreating or changing financial data', () => {
  const other = { id: crypto.randomUUID(), name: '家人' };
  const available = [...members, other];
  const amounts = [697, 298, 297, 294, 298, 298];
  const dates = ['2026-09-30', '2026-09-30', '2026-09-29', '2026-09-29', '2026-09-28', '2026-09-28'];
  const drafts = amounts.map((amount_cents, index) => ({ ...row, id: crypto.randomUUID(), amount_cents,
    amount: (amount_cents / 100).toFixed(2), transaction_date: dates[index], description: '深圳通乘车',
    note: `截图第 ${index + 1} 笔`, payment_method: '深圳通' }));
  const batch = helper.validateDraftBatch({ batch_id: batchId, status: 'pending', drafts });
  const before = structuredClone(drafts);
  const update = { batch_id: batchId, draft_ids: drafts.map(draft => draft.id), member_id: other.id };
  const result = helper.validatePlan({ action: 'update', reply: '已入账', drafts: [], query: null, update }, categories, available,
    () => assert.fail('member update must not generate any row IDs'), batch);
  assert.equal(result.action, 'update');
  assert.equal(result.drafts.length, 0);
  assert.equal(result.query, null);
  assert.equal(result.reply, '已将本组 6 笔账目的成员改为「家人」，请核对后确认入账。');
  const changed = helper.applyDraftMemberUpdate(drafts, result.update, available);
  for (let index = 0; index < drafts.length; index++) {
    assert.equal(changed[index].member_id, other.id);
    assert.deepEqual({ ...changed[index], member_id: memberId }, before[index]);
  }
  assert.equal(changed.reduce((sum, draft) => sum + draft.amount_cents, 0), 2182);
  assert.deepEqual(drafts, before);
});

test('member update only changes the explicit subset, including already assigned rows', () => {
  const other = { id: crypto.randomUUID(), name: '家人' };
  const available = [...members, other];
  const drafts = [0, 1, 2].map(index => ({ ...row, id: crypto.randomUUID(), amount_cents: 300 + index, amount: `3.0${index}` }));
  const update = { batch_id: batchId, draft_ids: [drafts[1].id], member_id: other.id };
  const changed = helper.applyDraftMemberUpdate(drafts, update, available);
  assert.equal(changed[0], drafts[0]);
  assert.equal(changed[2], drafts[2]);
  assert.equal(changed[1].member_id, other.id);
  assert.deepEqual({ ...changed[1], member_id: memberId }, drafts[1]);
  const stale = [{ ...drafts[1], member_id: crypto.randomUUID() }];
  assert.equal(helper.applyDraftMemberUpdate(stale, update, available)[0].member_id, other.id);
});

test('member selection requests preserve an already assigned single draft until a person is chosen', () => {
  const other = { id: crypto.randomUUID(), name: '家人' };
  const available = [...members, other];
  const drafts = [{ ...row, id: crypto.randomUUID(), amount: '68.00', description: '域名续费' }];
  const before = structuredClone(drafts);
  const batch = helper.validateDraftBatch({ batch_id: batchId, status: 'pending', drafts });
  const choice = { batch_id: batchId, draft_ids: [drafts[0].id], member_id: null };
  const result = helper.validatePlan({ action: 'update', reply: '已更新成员', drafts: [], query: null, update: choice },
    categories, available, () => assert.fail('opening member choices must not create rows'), batch);
  assert.equal(result.action, 'update');
  assert.deepEqual({ ...result.update, draft_ids: [...result.update.draft_ids] }, choice);
  assert.equal(result.reply, '请选择这笔账目的支出人。');
  assert.equal(result.drafts.length, 0);
  assert.deepEqual(drafts, before);
  assert.throws(() => helper.applyDraftMemberUpdate(drafts, result.update, available));
  const changed = helper.applyDraftMemberUpdate(drafts, { ...result.update, member_id: other.id }, available);
  assert.equal(changed[0].member_id, other.id);
  assert.deepEqual({ ...changed[0], member_id: memberId }, before[0]);
});

test('member selection requests identify a full group or explicit subset without clearing existing members', () => {
  const drafts = [0, 1, 2].map(index => ({ ...row, id: crypto.randomUUID(), amount_cents: 300 + index, amount: `3.0${index}` }));
  const before = structuredClone(drafts);
  const batch = helper.validateDraftBatch({ batch_id: batchId, status: 'pending', drafts });
  for (const ids of [drafts.map(draft => draft.id), [drafts[0].id, drafts[2].id]]) {
    const choice = { batch_id: batchId, draft_ids: ids, member_id: null };
    const result = helper.validatePlan({ action: 'update', reply: '已经改好了', drafts: [], query: null, update: choice },
      categories, members, crypto.randomUUID, batch);
    assert.deepEqual([...result.update.draft_ids], ids);
    assert.equal(result.update.member_id, null);
    assert.equal(result.reply, `请选择这 ${ids.length} 笔账目的支出人。`);
    assert.deepEqual(drafts, before);
  }
  const income = helper.validateDraftBatch({ batch_id: batchId, status: 'pending', drafts: [{ ...drafts[0], type: 'income' }] });
  const incomeChoice = helper.validatePlan({ action: 'update', reply: '', drafts: [], query: null,
    update: { batch_id: batchId, draft_ids: [drafts[0].id], member_id: null } }, categories, members, crypto.randomUUID, income);
  assert.equal(incomeChoice.reply, '请选择这笔账目的所属成员。');
});

test('member selection requests reject unavailable, committed or mismatched targets even without a selected member', () => {
  const drafts = [{ ...row, id: crypto.randomUUID() }];
  const batch = helper.validateDraftBatch({ batch_id: batchId, status: 'pending', drafts });
  const choice = { batch_id: batchId, draft_ids: [drafts[0].id], member_id: null };
  const candidate = { action: 'update', reply: '请选人员', drafts: [], query: null, update: choice };
  for (const context of [null, { ...batch, status: 'saved' }, { ...batch, commit: [row] }, { ...batch, drafts: [] }]) {
    assert.throws(() => helper.validatePlan(candidate, categories, members, crypto.randomUUID, context));
  }
  for (const patch of [{ batch_id: crypto.randomUUID() }, { draft_ids: [crypto.randomUUID()] },
    { draft_ids: [] }, { draft_ids: [drafts[0].id, drafts[0].id] }, { member_id: undefined }, { member_id: 42 }]) {
    assert.throws(() => helper.validatePlan({ ...candidate, update: { ...choice, ...patch } }, categories, members, crypto.randomUUID, batch));
  }
  for (const patch of [{ action: 'chat' }, { drafts: [row] }, { query: {} }]) {
    assert.throws(() => helper.validatePlan({ ...candidate, ...patch }, categories, members, crypto.randomUUID, batch));
  }
});

test('member updates reject missing context, foreign groups or rows, duplicate targets and inconsistent actions', () => {
  const drafts = [{ ...row, id: crypto.randomUUID() }];
  const batch = helper.validateDraftBatch({ batch_id: batchId, status: 'pending', drafts });
  const update = { batch_id: batchId, draft_ids: [drafts[0].id], member_id: memberId };
  const updatePlan = { action: 'update', reply: '已更新', drafts: [], query: null, update };
  assert.throws(() => helper.validatePlan(updatePlan, categories, members, crypto.randomUUID));
  assert.throws(() => helper.validatePlan(updatePlan, categories, members, crypto.randomUUID, { ...batch, status: 'saved' }));
  for (const patch of [{ batch_id: crypto.randomUUID() }, { batch_id: 'foreign' }, { member_id: categoryId },
    { draft_ids: [] }, { draft_ids: [crypto.randomUUID()] }, { draft_ids: [drafts[0].id, drafts[0].id] }, { draft_ids: ['foreign'] }]) {
    assert.throws(() => helper.validatePlan({ ...updatePlan, update: { ...update, ...patch } }, categories, members, crypto.randomUUID, batch));
  }
  for (const patch of [{ update: null }, { drafts: [row] }, { query: {} }, { query: undefined }]) {
    assert.throws(() => helper.validatePlan({ ...updatePlan, ...patch }, categories, members, crypto.randomUUID, batch));
  }
  for (const action of ['record', 'query', 'chat']) {
    assert.throws(() => helper.validatePlan({ ...plan, action, update }, categories, members, crypto.randomUUID, batch));
  }
  assert.equal(helper.validatePlan(plan, categories, members, crypto.randomUUID).update, null);
  assert.equal(helper.validatePlan({ action: 'chat', reply: '请编辑卡片', drafts: [], query: null }, categories, members, crypto.randomUUID).update, null);
  assert.throws(() => helper.applyDraftMemberUpdate([], update, members));
  assert.throws(() => helper.applyDraftMemberUpdate(drafts, { ...update, member_id: categoryId }, members));
  assert.throws(() => helper.applyDraftMemberUpdate(drafts, { ...update, draft_ids: [drafts[0].id, drafts[0].id] }, members));
  assert.throws(() => helper.applyDraftMemberUpdate([drafts[0], drafts[0]], update, members));
});

test('chat replies cannot claim a member update occurred without a structured update action', () => {
  for (const reply of ['成员已更新，请核对账目后确认入账。', '已将本组 6 笔账目的成员改为「本人」。', '好的，成员已改为本人。',
    '**成员已更新**，请核对账目后确认入账。', '已成功将本组 6 笔账目的成员改为「本人」。',
    '### **成员已成功更新**，请核对后确认入账。', '__成员已更新__，请核对。', '已成功更新，请核对卡片。']) {
    const result = helper.validatePlan({ action: 'chat', reply, drafts: [], query: null }, categories, members, crypto.randomUUID);
    assert.equal(result.reply, '尚未修改草稿，请明确指定本组成员，或直接在卡片中选择。');
    assert.equal(result.update, null);
    assert.equal(result.drafts.length, 0);
  }
  for (const reply of ['使用时点击成员姓名，页面会显示“成员已更新”。', '“成员已更新”是修改完成后的提示。',
    '使用时点击成员姓名，页面会显示“**成员已更新**”。', '### 使用说明\n“成员已更新”是修改完成后的提示。',
    '成员已更新后仍需点击确认入账。', '请直接编辑卡片修改金额。']) {
    assert.equal(helper.validatePlan({ action: 'chat', reply, drafts: [], query: null }, categories, members, crypto.randomUUID).reply, reply);
  }
});

test('natural-language member updates return the validated target group and never write or regenerate drafts', async () => {
  const drafts = [0, 1, 2, 3, 4, 5].map(index => ({ ...row, id: crypto.randomUUID(), description: '深圳通乘车', amount_cents: [697, 298, 297, 294, 298, 298][index] }));
  const draft_batch = helper.validateDraftBatch({ batch_id: batchId, status: 'pending', drafts });
  const update = { batch_id: batchId, draft_ids: drafts.map(draft => draft.id), member_id: memberId };
  const f = routes({ provider: JSON.stringify({ action: 'update', reply: '已入账', drafts: [], query: null, update }) });
  const response = await f.assistant.POST(request({ message: '把这个全改成本人', today: '2026-09-30', draft_batch }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.update, update);
  assert.deepEqual(body.drafts, []);
  assert.equal(body.reply, '已将本组 6 笔账目的成员改为「本人」，请核对后确认入账。');
  assert.equal(f.calls.length, 1);
  assert.equal(f.transactions.length, 0);
  assert.ok(f.queries.every(query => query.values[0] === 'owner'));
  assert.ok(f.calls[0][0].messages[0].content.includes('draft_batch'));
  assert.ok(f.calls[0][0].messages[0].content.includes(drafts[5].id));
});

test('asking to change a draft member returns a structured picker target without claiming success or writing finances', async () => {
  const draft = { ...row, id: crypto.randomUUID(), description: '域名续费' };
  const draft_batch = helper.validateDraftBatch({ batch_id: batchId, status: 'pending', drafts: [draft] });
  const update = { batch_id: batchId, draft_ids: [draft.id], member_id: null };
  const f = routes({ provider: JSON.stringify({ action: 'update', reply: '成员已更新', drafts: [], query: null, update }) });
  const response = await f.assistant.POST(request({ message: '我要修改这笔账的支出人', today: '2026-09-30', draft_batch }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.action, 'update');
  assert.deepEqual(body.update, update);
  assert.equal(body.reply, '请选择这笔账目的支出人。');
  assert.deepEqual(body.drafts, []);
  assert.equal(body.query, null);
  assert.equal(f.calls.length, 1);
  assert.equal(f.transactions.length, 0);
  assert.match(f.calls[0][0].messages[0].content, /已有成员的账单也允许重新选择/);
  assert.match(f.calls[0][0].messages[0].content, /多笔时只说“这笔”/);
});

test('invalid editable contexts and out-of-batch model updates fail without financial writes', async () => {
  const draft = { ...row, id: crypto.randomUUID() };
  const draft_batch = helper.validateDraftBatch({ batch_id: batchId, status: 'pending', drafts: [draft] });
  for (const invalid of [{ ...draft_batch, status: 'saved' }, { ...draft_batch, commit: [row] }, { ...draft_batch, drafts: [] }]) {
    const f = routes();
    assert.equal((await f.assistant.POST(request({ message: '全部改成本人', today: '2026-09-30', draft_batch: invalid }))).status, 400);
    assert.equal(f.calls.length + f.transactions.length, 0);
  }
  const update = { batch_id: batchId, draft_ids: [draft.id], member_id: memberId };
  for (const patch of [{ batch_id: crypto.randomUUID() }, { draft_ids: [crypto.randomUUID()] }, { member_id: categoryId }]) {
    const f = routes({ provider: JSON.stringify({ action: 'update', reply: '已修改', drafts: [], query: null, update: { ...update, ...patch } }) });
    assert.equal((await f.assistant.POST(request({ message: '全部改成本人', today: '2026-09-30', draft_batch }))).status, 422);
    assert.equal(f.calls.length, 1);
    assert.equal(f.transactions.length, 0);
  }
  const f = routes({ provider: JSON.stringify({ action: 'chat', reply: '成员已更新，请核对账目后确认入账。', drafts: [], query: null }) });
  const response = await f.assistant.POST(request({ message: '全部改成本人', today: '2026-09-30', draft_batch }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reply, '尚未修改草稿，请明确指定本组成员，或直接在卡片中选择。');
  assert.equal(f.transactions.length, 0);
});

test('saved batch context preserves displayed row order and rejects non-saved, committed or malformed targets', () => {
  const first = { id: crypto.randomUUID(), type: 'expense', description: '域名续费', member_id: memberId };
  const second = { ...first, id: crypto.randomUUID(), description: '交通费' };
  const saved = { batch_id: batchId, status: 'saved', drafts: [second, first] };
  assert.equal(helper.validateSavedBatch(undefined), null);
  assert.equal(helper.validateSavedBatch(null), null);
  const result = helper.validateSavedBatch(saved);
  assert.equal(result.status, 'saved');
  assert.deepEqual(Array.from(result.drafts, draft => draft.id), [second.id, first.id]);
  for (const invalid of [[], {}, { ...saved, status: 'pending' }, { ...saved, status: 'deleted' },
    { ...saved, batch_id: 'foreign' }, { ...saved, commit: [row] }, { ...saved, drafts: [] },
    { ...saved, drafts: [first, first] }, { ...saved, drafts: [{ ...first, id: 'invalid' }] }]) {
    assert.throws(() => helper.validateSavedBatch(invalid), /已入账账单上下文无效/);
  }
});

test('structured undo targets saved rows without recreating drafts or claiming the operation already completed', () => {
  const drafts = [0, 1, 2].map(() => ({ ...row, id: crypto.randomUUID() }));
  const saved = helper.validateSavedBatch({ batch_id: batchId, status: 'saved', drafts });
  for (const draft_ids of [[drafts[0].id], [drafts[2].id], drafts.map(draft => draft.id)]) {
    const undo = { batch_id: batchId, draft_ids };
    const result = helper.validatePlan({ action: 'undo', reply: '已撤销，未入账。', drafts: [], query: null, update: null, undo },
      categories, members, () => assert.fail('undo cannot generate new draft IDs'), null, saved);
    assert.equal(result.action, 'undo');
    assert.deepEqual(JSON.parse(JSON.stringify(result.undo)), undo);
    assert.equal(result.drafts.length, 0);
    assert.equal(result.query, null);
    assert.equal(result.update, null);
    assert.equal(result.reply, `正在撤销这 ${draft_ids.length} 笔入账，成功后将恢复为待确认草稿。`);
    assert.doesNotMatch(result.reply, /已撤销|未入账/);
  }
});

test('undo validation rejects missing context, foreign groups or rows, duplicate IDs and mixed actions', () => {
  const draft = { ...row, id: crypto.randomUUID() };
  const saved = helper.validateSavedBatch({ batch_id: batchId, status: 'saved', drafts: [draft] });
  const undo = { batch_id: batchId, draft_ids: [draft.id] };
  const candidate = { action: 'undo', reply: '', drafts: [], query: null, undo };
  for (const context of [null, { ...saved, status: 'pending' }, { ...saved, drafts: [] }]) {
    assert.throws(() => helper.validatePlan(candidate, categories, members, crypto.randomUUID, null, context));
  }
  for (const patch of [{ batch_id: crypto.randomUUID() }, { draft_ids: [] }, { draft_ids: [crypto.randomUUID()] },
    { draft_ids: [draft.id, draft.id] }, { draft_ids: [1] }, { draft_ids: 'all' }]) {
    assert.throws(() => helper.validatePlan({ ...candidate, undo: { ...undo, ...patch } }, categories, members, crypto.randomUUID, null, saved));
  }
  for (const patch of [{ undo: null }, { drafts: [row] }, { query: {} }, { query: undefined },
    { update: { batch_id: batchId, draft_ids: [draft.id], member_id: memberId } }]) {
    assert.throws(() => helper.validatePlan({ ...candidate, ...patch }, categories, members, crypto.randomUUID, null, saved));
  }
  for (const action of ['record', 'query', 'chat', 'update']) {
    assert.throws(() => helper.validatePlan({ ...candidate, action }, categories, members, crypto.randomUUID, null, saved));
  }
  assert.equal(helper.validatePlan(plan, categories, members, crypto.randomUUID).undo, null);
});

test('unsupported chat cannot report that undo, cancellation or deletion succeeded', () => {
  for (const reply of ['已撤销，未入账。', '已取消这笔账。', '已删除这笔交易。', '好的，已成功撤销。',
    '**这笔账单已经撤销**。', '### 本组账目已全部撤销。', '撤销成功。', '已将这笔记录删除。',
    '好的，我已经为您撤销了这笔。', '撤销操作已完成。', '这笔账已经撤销。', '系统已替你取消这笔记录。']) {
    const result = helper.validatePlan({ action: 'chat', reply, drafts: [], query: null }, categories, members, crypto.randomUUID);
    assert.equal(result.reply, '尚未撤销，请使用账单卡片中的撤销入账。');
    assert.equal(result.undo, null);
  }
  for (const reply of ['尚未撤销，请使用卡片。', '撤销失败，请重试。', '这笔账尚未撤销。', '无法撤销这笔已修改的账。',
    '撤销操作未完成。', '点击撤销入账，成功后会恢复草稿。', '“已撤销”是撤销完成后的提示。',
    '使用时页面会显示“已撤销”。', '没有可撤销的已入账记录。', '如何撤销？请点击卡片上的撤销入账。']) {
    assert.equal(helper.validatePlan({ action: 'chat', reply, drafts: [], query: null }, categories, members, crypto.randomUUID).reply, reply);
  }
});

test('non-undo record and query plans cannot claim undo execution while their intended data stays intact', () => {
  const recording = helper.validatePlan({ ...plan, reply: '好的，我已经为您撤销了这笔。' }, categories, members, crypto.randomUUID);
  assert.equal(recording.action, 'record');
  assert.equal(recording.reply, '尚未撤销，请使用账单卡片中的撤销入账。');
  assert.equal(recording.drafts.length, 1);
  assert.equal(recording.drafts[0].amount_cents, row.amount_cents);
  const query = { start_date: '2026-09-01', end_date: '2026-09-30', type: null, category_id: null, member_id: null, keyword: null };
  const querying = helper.validatePlan({ action: 'query', reply: '撤销操作已完成。', drafts: [], query }, categories, members, crypto.randomUUID);
  assert.equal(querying.action, 'query');
  assert.equal(querying.reply, '尚未撤销，请使用账单卡片中的撤销入账。');
  assert.deepEqual(JSON.parse(JSON.stringify(querying.query)), query);
  assert.equal(querying.undo, null);
});

test('undo prompt requires an explicit operation request and distinguishes capability questions from execution', () => {
  assert.match(helper.ASSISTANT_SYSTEM_PROMPT, /用户必须明确要求现在执行撤销/);
  assert.match(helper.ASSISTANT_SYSTEM_PROMPT, /“能撤销吗”“如何撤销”“撤销会怎样”.*应action=chat解释，不执行撤销，不生成undo目标/);
});

test('natural-language saved undo returns only a validated operation for the client to execute', async () => {
  const draft = { ...row, id: crypto.randomUUID(), description: '.top域名续费' };
  const saved_batch = helper.validateSavedBatch({ batch_id: batchId, status: 'saved', drafts: [draft] });
  const undo = { batch_id: batchId, draft_ids: [draft.id] };
  const f = routes({ provider: JSON.stringify({ action: 'undo', reply: '已撤销，未入账。', drafts: [], query: null, undo }) });
  const response = await f.assistant.POST(request({ message: '撤销这笔', today: '2026-09-30', saved_batch }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.action, 'undo');
  assert.deepEqual(body.undo, undo);
  assert.equal(body.reply, '正在撤销这 1 笔入账，成功后将恢复为待确认草稿。');
  assert.deepEqual(body.drafts, []);
  assert.equal(f.calls.length, 1);
  assert.equal(f.transactions.length, 0);
  assert.ok(f.queries.every(query => query.values[0] === 'owner'));
  assert.match(f.calls[0][0].messages[0].content, /saved_batch/);
  assert.match(f.calls[0][0].messages[0].content, /只有一笔时“撤销这笔”选择该行/);
  assert.match(f.calls[0][0].messages[0].content, /多笔时只说“这笔”/);
  assert.ok(f.calls[0][0].messages[0].content.includes(draft.id));
});

test('invalid saved contexts fail before paid calls, while stale or foreign model undo targets are rejected without writes', async () => {
  const draft = { ...row, id: crypto.randomUUID() };
  const saved_batch = helper.validateSavedBatch({ batch_id: batchId, status: 'saved', drafts: [draft] });
  for (const invalid of [{ ...saved_batch, status: 'pending' }, { ...saved_batch, commit: [row] },
    { ...saved_batch, drafts: [] }, { ...saved_batch, drafts: [draft, draft] }]) {
    const f = routes();
    assert.equal((await f.assistant.POST(request({ message: '撤销这笔', today: '2026-09-30', saved_batch: invalid }))).status, 400);
    assert.equal(f.calls.length + f.queries.length + f.transactions.length, 0);
  }
  const undo = { batch_id: batchId, draft_ids: [draft.id] };
  for (const patch of [{ batch_id: crypto.randomUUID() }, { draft_ids: [crypto.randomUUID()] }, { draft_ids: [draft.id, draft.id] }]) {
    const f = routes({ provider: JSON.stringify({ action: 'undo', reply: '', drafts: [], query: null, undo: { ...undo, ...patch } }) });
    assert.equal((await f.assistant.POST(request({ message: '撤销这笔', today: '2026-09-30', saved_batch }))).status, 422);
    assert.equal(f.calls.length, 1);
    assert.equal(f.transactions.length, 0);
  }
  const f = routes({ provider: JSON.stringify({ action: 'chat', reply: '已撤销，未入账。', drafts: [], query: null }) });
  const response = await f.assistant.POST(request({ message: '撤销这笔', today: '2026-09-30', saved_batch }));
  assert.equal((await response.json()).reply, '尚未撤销，请使用账单卡片中的撤销入账。');
  assert.equal(f.transactions.length, 0);
});

test('member replies verify account ownership without generating duplicate drafts, paid calls or writes', async () => {
  const f = routes();
  const response = await f.assistant.POST(request({ operation: 'select_member', draft_id: batchId, member_id: memberId }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { draft_id: batchId, member: members[0] });
  assert.equal(f.calls.length, 0);
  assert.equal(f.transactions.length, 0);
  assert.ok(f.queries.every(q => q.values[0] === 'owner'));
  for (const patch of [{ member_id: 'foreign' }, { draft_id: 'invalid' }, { member_id: categoryId }]) {
    const invalid = routes();
    assert.equal((await invalid.assistant.POST(request({ operation: 'select_member', draft_id: batchId, member_id: memberId, ...patch }))).status, 400);
    assert.equal(invalid.calls.length + invalid.transactions.length, 0);
  }
});

test('ledger queries parameterize literal search terms and scope all aggregates to the current account', async () => {
  const f = routes();
  const keyword = "%' OR 1=1 --";
  await f.assistant.queryLedger('owner', { start_date: '2026-09-01', end_date: '2026-09-30', type: 'expense', category_id: null, member_id: memberId, keyword });
  assert.equal(f.queries.length, 3);
  for (const q of f.queries) { assert.equal(q.values[0], 'owner'); assert.ok(q.values.includes(keyword)); assert.ok(!q.text.includes(keyword)); assert.match(q.text, /t.user_id = \$1/); }
});

test('batch validation rejects incomplete drafts before starting a transaction; stale ownership is an explicit unsaved rejection', async () => {
  const malformed = routes();
  assert.equal((await malformed.confirm.POST(request({ batch_id: batchId, drafts: [{ ...row, member_id: null }] }))).status, 400);
  assert.equal(malformed.transactions.length, 0);
  const stale = routes();
  const response = await stale.confirm.POST(request({ batch_id: batchId, drafts: [row] }));
  assert.equal(response.status, 409); assert.equal((await response.json()).notSaved, true);
});

test('batch replays return the original IDs and reject reused IDs with changed payloads', async () => {
  const hash = crypto.createHash('sha256').update(JSON.stringify(helper.confirmationRows([row]))).digest('hex');
  const f = routes({ result: [{ payload_hash: hash, transaction_ids: ['original'], created: false }] });
  const result = await f.confirm.POST(request({ batch_id: batchId, drafts: [row] }));
  assert.equal(result.status, 200); assert.equal((await result.json()).replayed, true);
  assert.equal((await f.confirm.POST(request({ batch_id: batchId, drafts: [{ ...row, amount_cents: 9900 }] }))).status, 409);
});

test('invalid audio never causes a paid call; valid WAV uses the documented audio input and Chinese normalization', async () => {
  const f = routes({ provider: '今天买菜68元' });
  const makeRequest = buffer => ({ signal: new AbortController().signal, headers: new Headers(), formData: async () => {
    const form = new FormData(); form.set('audio', new Blob([buffer]), 'recording.wav'); return form;
  } });
  assert.equal((await f.transcribe.POST(makeRequest(new ArrayBuffer(50)))).status, 400);
  assert.equal(f.calls.length, 0);
  const response = await f.transcribe.POST(makeRequest(audio.encodePcmWav(new Float32Array(16000))));
  assert.equal(response.status, 200); assert.equal((await response.json()).text, '今天买菜68元');
  const part = f.calls[0][0].messages[0].content[0];
  assert.equal(part.type, 'file');
  assert.equal(part.mediaType, 'audio/wav');
  assert.equal(audio.validatePcmWav(part.data.buffer.slice(part.data.byteOffset, part.data.byteOffset + part.data.byteLength)), true);
  assert.equal(f.calls[0][0].asrOptions.language, 'zh');
  assert.equal(f.calls[0][0].asrOptions.enable_itn, true);
});

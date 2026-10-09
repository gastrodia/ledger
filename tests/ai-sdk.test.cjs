/* eslint-disable @typescript-eslint/no-require-imports -- run the real SDK against isolated HTTP fixtures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const ai = require('ai');
const compatible = require('@ai-sdk/openai-compatible');

function loadModule(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Date, Number, JSON, Error,
    require: id => { assert.ok(id in dependencies, `Unexpected module dependency ${id}`); return dependencies[id]; },
  });
  return exports;
}
const assistant = loadModule('lib/assistant.ts');
const assistantOutput = loadModule('lib/assistant-output.ts', { ai, zod: require('zod'), '@/lib/assistant': assistant });
const assistantImages = loadModule('lib/assistant-images.ts');
const assistantImageImport = loadModule('lib/assistant-image-import.ts', {
  '@/lib/assistant': assistant, '@/lib/assistant-images': assistantImages,
});

function loadAdapter(fetchImpl, env = {}, logs = [], globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('lib/bailian.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, {
    exports, process: { env: { DASHSCOPE_API_KEY: 'secret-fixture', ...env } }, fetch: fetchImpl,
    URL, Headers, Request, Response, ReadableStream, TransformStream, TextEncoder, TextDecoder,
    AbortController, AbortSignal, Buffer, Uint8Array, Error, TypeError, setTimeout, clearTimeout, ...globals,
    console: { error() {}, warn() {}, log() {}, info: (...args) => logs.push(args) },
    require: id => {
      if (id === 'ai') return ai;
      if (id === '@ai-sdk/openai-compatible') return compatible;
      assert.fail(`Unexpected adapter dependency ${id}`);
    },
  });
  return exports;
}

const prompt = [{ role: 'system', content: '只根据提供的账本数据回答。' }, { role: 'user', content: '今天花了多少？' }];
function completion(content = '可读回答', finish_reason = 'stop', extra = {}) {
  return Response.json({ id: 'fixture-completion', model: 'fixture-model', created: 1,
    choices: [{ message: { role: 'assistant', content, reasoning_content: 'hidden reasoning' }, finish_reason }],
    usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 }, ...extra });
}
function fixture(reply, env, globals) {
  const calls = [], logs = [];
  const adapter = loadAdapter(async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return typeof reply === 'function' ? reply(calls.at(-1)) : reply;
  }, env, logs, globals);
  return { adapter, calls, logs };
}
function sse(events, { done = true, bytewise = false } = {}) {
  const payload = events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\r\n\r\n`).join('')
    + (done ? 'data: [DONE]\r\n\r\n' : '');
  const bytes = new TextEncoder().encode(payload);
  return new Response(new ReadableStream({ start(controller) {
    if (bytewise) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const textChunk = text => ({ choices: [{ delta: { content: text } }] });
const finishChunk = finish_reason => ({ choices: [{ delta: {}, finish_reason }] });
async function collect(result) {
  const chunks = [];
  for await (const chunk of result) chunks.push(chunk);
  return chunks;
}
function safeValidationFailure(adapter, error) {
  const failure = adapter.bailianFailure(error);
  assert.equal(failure.status, 422);
  assert.match(failure.message, /格式异常.*重试/);
  for (const sensitive of ['secret-fixture', 'private-response-secret', 'raw action']) {
    assert.ok(!failure.message.includes(sensitive));
    assert.ok(!error.message.includes(sensitive));
  }
  return true;
}

test('SDK configuration rejects missing credentials and unsafe endpoints before any HTTP request', async () => {
  for (const env of [{ DASHSCOPE_API_KEY: '' }, { DASHSCOPE_BASE_URL: 'http://dashscope.aliyuncs.com/v1' },
    { DASHSCOPE_BASE_URL: 'https://private.example/v1' }]) {
    const f = fixture(() => assert.fail('invalid configuration must not make a request'), env);
    await assert.rejects(f.adapter.bailianText({ model: 'fixture-model', messages: prompt }));
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(completion(), { DASHSCOPE_WORKSPACE_ID: 'workspace-fixture' });
  assert.equal(await f.adapter.bailianText({ model: 'fixture-model', messages: prompt }), '可读回答');
  assert.equal(f.calls[0].url, 'https://workspace-fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
});

test('SDK request budgets default to 90 seconds, allow bounded overrides and never enter the provider body', async () => {
  for (const [timeoutMs, expected] of [[undefined, 90_000], [180_000, 180_000], [1, 1]]) {
    const budgets = [];
    const f = fixture(completion(), {}, { AbortSignal: {
      any: signals => AbortSignal.any(signals),
      timeout: ms => { budgets.push(ms); return new AbortController().signal; },
    } });
    await f.adapter.bailianText({ model: 'fixture-model', messages: prompt, timeoutMs });
    assert.deepEqual(budgets, [expected]);
    assert.equal(f.calls[0].body.timeoutMs, undefined);
    assert.equal(f.calls[0].body.timeout_ms, undefined);
    assert.equal(f.logs.at(-1)[1].timeoutMs, expected);
  }
  for (const timeoutMs of [0, -1, NaN, Infinity, 180_001, 1.5]) {
    const f = fixture(() => assert.fail('invalid timeout must not incur an HTTP request'));
    await assert.rejects(f.adapter.bailianText({ model: 'fixture-model', messages: prompt, timeoutMs }), error => {
      assert.equal(error.code, 'invalid_timeout');
      assert.equal(f.adapter.bailianFailure(error).status, 503);
      return true;
    });
    assert.equal(f.calls.length, 0);
  }
});

test('SDK telemetry accepts only UUID correlation IDs and never sends them to the provider', async () => {
  for (const telemetryId of ['00000000-0000-4000-8000-000000000001', 'private-response-secret https://private.example/secret-fixture']) {
    const f = fixture(completion());
    await f.adapter.bailianText({ model: 'fixture-model', messages: prompt, telemetryId });
    assert.equal(f.logs[0][1].telemetryId, telemetryId.startsWith('00000000-') ? telemetryId : undefined);
    assert.ok(!JSON.stringify(f.calls[0].body).includes(telemetryId));
    assert.ok(!JSON.stringify(f.logs).includes('private-response-secret'));
    assert.ok(!JSON.stringify(f.logs).includes('https://'));
  }
});

test('an expired custom budget aborts actual SDK work and records a single safe timeout', async () => {
  const deadline = new AbortController();
  let started;
  const requested = new Promise(resolve => { started = resolve; });
  const f = fixture(({ init }) => new Promise((resolve, reject) => {
    void resolve;
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    started();
  }), {}, { AbortSignal: {
    any: signals => AbortSignal.any(signals),
    timeout: ms => { assert.equal(ms, 180_000); return deadline.signal; },
  } });
  const pending = f.adapter.bailianText({ model: 'fixture-model', messages: prompt, timeoutMs: 180_000 });
  const rejected = assert.rejects(pending, error => {
    assert.equal(f.adapter.bailianFailure(error).status, 504);
    assert.equal(error.code, 'timeout');
    return true;
  });
  await requested;
  deadline.abort(new DOMException('private-response-secret secret-fixture', 'TimeoutError'));
  await rejected;
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.signal.aborted, true);
  assert.equal(f.logs.length, 1);
  assert.equal(f.logs[0][0], 'AI request failed');
  assert.equal(f.logs[0][1].failure, 'timeout');
  assert.equal(f.logs[0][1].status, 504);
  assert.equal(f.logs[0][1].timeoutMs, 180_000);
  assert.equal(f.logs[0][1].firstOutputMs, undefined);
  assert.ok(!JSON.stringify(f.logs).includes('private-response-secret'));
  assert.ok(!JSON.stringify(f.logs).includes('secret-fixture'));
});

test('real SDK sends structured schema and image content while preserving Bailian thinking and token settings', async () => {
  const schema = ai.jsonSchema({ type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false });
  const image = 'data:image/png;base64,YWJj';
  const secondImage = 'data:image/jpeg;base64,YWJk';
  const f = fixture(completion(JSON.stringify({ answer: '待确认' })));
  assert.deepEqual(await f.adapter.bailianObject({ model: 'fixture-model', schema, schemaName: 'ledger_plan',
    thinking: false, temperature: 0.2, maxOutputTokens: 5000,
    messages: [{ role: 'system', content: '识别账目' }, { role: 'user', content: [
      { type: 'text', text: '请识别截图' }, { type: 'file', mediaType: 'image/png', data: image },
      { type: 'text', text: '截图 2 / 2' }, { type: 'file', mediaType: 'image/jpeg', data: secondImage },
    ] }],
  }), { answer: '待确认' });
  const { body, init, url } = f.calls[0];
  assert.match(url, /^https:\/\/dashscope\.aliyuncs\.com\/compatible-mode\/v1\/chat\/completions$/);
  assert.equal(new Headers(init.headers).get('authorization'), 'Bearer secret-fixture');
  assert.equal(init.cache, 'no-store');
  assert.ok(!init.body.includes('secret-fixture'));
  assert.equal(body.model, 'fixture-model');
  assert.equal(body.enable_thinking, false);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_completion_tokens, 5000);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.name, 'ledger_plan');
  assert.equal(body.response_format.json_schema.schema.type, 'object');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.messages[1].content[1].type, 'image_url');
  assert.equal(body.messages[1].content[1].image_url.url, image);
  assert.equal(body.messages[1].content[3].image_url.url, secondImage);
  assert.equal(f.calls.length, 1);
});

test('SDK text generation exposes only the final answer and retains summary reasoning effort', async () => {
  const f = fixture(completion('  账本支出为10元。  '));
  assert.equal(await f.adapter.bailianText({ model: 'fixture-model', messages: prompt,
    reasoningEffort: 'low', maxOutputTokens: 8192 }), '账本支出为10元。');
  assert.equal(f.calls[0].body.reasoning_effort, 'low');
  assert.equal(f.calls[0].body.max_completion_tokens, 8192);
  assert.equal(f.calls[0].body.enable_thinking, undefined);
  assert.equal(f.calls.length, 1);
  assert.equal(f.logs.length, 1);
  const metadata = f.logs[0][1];
  assert.equal(metadata.model, 'fixture-model');
  assert.equal(metadata.operation, 'text');
  assert.equal(metadata.inputTokens, 12);
  assert.equal(metadata.outputTokens, 6);
  assert.equal(metadata.totalTokens, 18);
  assert.ok(metadata.durationMs >= 0);
  assert.equal(metadata.timeoutMs, 90_000);
  const logged = JSON.stringify(f.logs);
  for (const sensitive of ['secret-fixture', '今天花了多少', '账本支出为10元', 'hidden reasoning']) assert.ok(!logged.includes(sensitive));
});

test('SDK text and object results reject truncation, empty answers and malformed JSON', async () => {
  for (const response of [completion('部分回答', 'length'), completion('   '), completion(null)]) {
    const f = fixture(response);
    await assert.rejects(f.adapter.bailianText({ model: 'fixture-model', messages: prompt }));
    assert.equal(f.calls.length, 1);
    assert.equal(f.logs.length, 1);
    assert.equal(f.logs[0][0], 'AI request failed', 'validation failures must not be logged as completed');
  }
  const schema = ai.jsonSchema({ type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] });
  for (const [response, status] of [
    [completion('{broken private-response-secret secret-fixture'), 422],
    [completion('{"answer":"partial"}', 'length'), 502],
  ]) {
    const f = fixture(response);
    await assert.rejects(f.adapter.bailianObject({ model: 'fixture-model', messages: prompt, schema }), error => {
      if (status === 422) return safeValidationFailure(f.adapter, error);
      assert.equal(f.adapter.bailianFailure(error).status, status);
      return true;
    });
    assert.equal(f.calls.length, 1);
    assert.equal(f.logs.length, 1);
    assert.equal(f.logs[0][0], 'AI request failed');
    assert.equal(f.logs[0][1].failure, status === 422 ? 'invalid_output' : 'truncated');
    assert.ok(!JSON.stringify(f.logs).includes('private-response-secret'));
  }
});

test('real SDK validates the ledger schema, normalizes a single multimodal plan wrapper and rejects malformed actions', async () => {
  const valid = { action: 'record', reply: '待确认', drafts: [{ type: 'expense', amount_cents: 298, category_id: null,
    member_id: null, transaction_date: '2026-09-30', description: '地铁乘车', payment_method: null, note: '' }], query: null };
  const f = fixture(completion(JSON.stringify([valid])));
  const value = await f.adapter.bailianObject({ model: 'fixture-model', messages: prompt,
    schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA, schemaName: 'ledger_plan' });
  assert.equal(value.action, 'record');
  assert.equal(value.drafts[0].amount_cents, 298);
  assert.equal(value.update, null);
  assert.equal(value.undo, null);
  const malformed = [
    [valid, valid], { ...valid, action: 'execute_sql' }, { ...valid, unexpected: 'raw action private-response-secret secret-fixture' },
    { ...valid, drafts: [{ ...valid.drafts[0], amount_cents: 2.98 }] },
    { ...valid, drafts: [{ ...valid.drafts[0], member_id: 42 }] },
    { ...valid, query: { start_date: '2026-09-01', end_date: '2026-09-30' } },
  ];
  for (const invalid of malformed) {
    const rejected = fixture(completion(JSON.stringify(invalid)));
    await assert.rejects(rejected.adapter.bailianObject({ model: 'fixture-model', messages: prompt,
      schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA, schemaName: 'ledger_plan' }), error => safeValidationFailure(rejected.adapter, error));
    assert.equal(rejected.calls.length, 1);
  }
});

test('real SDK object and stream results preserve statement amounts when empty notes are null or omitted', async () => {
  const amounts = [1300, 1800, 43832, 3300, 2000];
  const descriptions = ['车辆服务商户', '服务区小吃店', '95号车用汽油', '旅行服务商户', '数字服务商户'];
  const validSource = { image_index: 1, row_index: 1, time: '15:33', transaction_id: null, kind: 'statement' };
  const sources = [validSource, undefined, null, { ...validSource, row_index: 0 }, { ...validSource, row_index: 5 }];
  const paidRows = amounts.map((amount_cents, index) => ({ type: 'expense', amount_cents,
    category_id: null, member_id: null, transaction_date: '2026-10-04', description: descriptions[index],
    payment_method: null, ...(index % 2 === 0 ? { note: null } : {}),
    ...(sources[index] === undefined ? {} : { source: sources[index] }),
  }));
  const original = { action: 'record', reply: '请核对年份后确认入账。', drafts: paidRows, query: null };
  const text = JSON.stringify(original);
  const parsed = await assistantOutput.ASSISTANT_OUTPUT_SCHEMA.validate(original);
  assert.equal(parsed.success, true);
  assert.ok(parsed.value.drafts.every(draft => draft.note === ''));
  assert.equal(JSON.stringify(original), text, 'normalization must not modify the input plan');
  for (const streaming of [false, true]) {
    const f = fixture(streaming ? () => sse([textChunk(text), finishChunk('stop')], { bytewise: true }) : completion(text));
    const request = { model: 'fixture-model', messages: prompt,
      schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA, schemaName: 'ledger_plan' };
    const value = streaming ? await f.adapter.bailianObjectStream(request, () => {}) : await f.adapter.bailianObject(request);
    assert.deepEqual(Array.from(value.drafts, draft => draft.amount_cents), amounts);
    assert.deepEqual(Array.from(value.drafts, draft => draft.description), descriptions);
    assert.ok(value.drafts.every(draft => draft.note === ''));
    assert.ok(value.drafts.every(draft => draft.transaction_date === '2026-10-04' && draft.member_id === null));
    assert.equal(value.drafts[0].source.row_index, 1);
    assert.equal(value.drafts[1].source, undefined);
    assert.equal(value.drafts[2].source, null);
    assert.equal(value.drafts[3].source, null);
    const refund = { ...value.drafts[0], amount_cents: -0, description: '退款商品', note: '有退款' };
    const imported = assistantImageImport.mergeAssistantImageImport({ ...value, drafts: [refund, ...value.drafts] }, 1);
    let nextId = 0;
    const accepted = assistant.validatePlan(imported.output, [], [], () => `draft-${++nextId}`);
    assert.deepEqual(Array.from(accepted.drafts, draft => draft.amount_cents), amounts);
    assert.equal(accepted.drafts.reduce((sum, draft) => sum + draft.amount_cents, 0), 52232);
    assert.equal(imported.summary.skipped_zero_amounts, 1);
    assert.equal(imported.summary.retained_count, 5);
    assert.equal(refund.note, '有退款');
    assert.equal(f.calls.length, 1, 'empty notes must not trigger another paid recognition');
    const draftSchema = f.calls[0].body.response_format.json_schema.schema.properties.drafts.items;
    assert.deepEqual(draftSchema.properties.note, { type: 'string' });
    assert.ok(draftSchema.required.includes('note'), 'the provider must still be asked for a string note');
  }
});

test('empty-note compatibility still rejects other note types and malformed financial fields in real SDK results', async () => {
  const row = { type: 'expense', amount_cents: 1300, category_id: null, member_id: null,
    transaction_date: '2026-10-04', description: 'C3', payment_method: null, note: null };
  for (const streaming of [false, true]) {
    for (const patch of [
      { note: 0 }, { note: [] }, { note: {} }, { note: false },
      { amount_cents: '1300' }, { amount_cents: 13.5 }, { transaction_date: null }, { member_id: 42 },
    ]) {
      const text = JSON.stringify({ action: 'record', reply: '待确认', drafts: [{ ...row, ...patch }], query: null });
      const f = fixture(streaming ? () => sse([textChunk(text), finishChunk('stop')]) : completion(text));
      const request = { model: 'fixture-model', messages: prompt, schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA };
      await assert.rejects(streaming ? f.adapter.bailianObjectStream(request, () => {}) : f.adapter.bailianObject(request),
        error => safeValidationFailure(f.adapter, error));
      assert.equal(f.calls.length, 1);
    }
  }
});

test('real SDK preserves a structured member choice with a null member without inventing a person or another action', async () => {
  const valid = { action: 'update', reply: '请选择成员', drafts: [], query: null,
    update: { batch_id: '00000000-0000-4000-8000-000000000003',
      draft_ids: ['00000000-0000-4000-8000-000000000004'], member_id: null } };
  const f = fixture(completion(JSON.stringify(valid)));
  const value = await f.adapter.bailianObject({ model: 'fixture-model', messages: prompt,
    schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA, schemaName: 'ledger_plan' });
  assert.deepEqual(Object.keys(value).sort(), ['action', 'drafts', 'query', 'reply', 'undo', 'update']);
  assert.equal(value.action, 'update');
  assert.deepEqual(value.update, valid.update);
  assert.equal(value.undo, null);
  assert.equal(value.drafts.length, 0);
  assert.equal(f.calls.length, 1);
  for (const member_id of [42, {}, undefined]) {
    const rejected = fixture(completion(JSON.stringify({ ...valid, update: { ...valid.update, member_id } })));
    await assert.rejects(rejected.adapter.bailianObject({ model: 'fixture-model', messages: prompt,
      schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA, schemaName: 'ledger_plan' }), error => safeValidationFailure(rejected.adapter, error));
  }
});

test('real SDK transports structured undo targets without asserting a successful database mutation', async () => {
  const valid = { action: 'undo', reply: '准备撤销入账', drafts: [], query: null,
    undo: { batch_id: '00000000-0000-4000-8000-000000000003',
      draft_ids: ['00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000005'] } };
  const f = fixture(completion(JSON.stringify(valid)));
  const value = await f.adapter.bailianObject({ model: 'fixture-model', messages: prompt,
    schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA, schemaName: 'ledger_plan' });
  assert.deepEqual(Object.keys(value).sort(), ['action', 'drafts', 'query', 'reply', 'undo', 'update']);
  assert.equal(value.action, 'undo');
  assert.equal(value.reply, '准备撤销入账');
  assert.deepEqual(value.undo, valid.undo);
  assert.equal(value.update, null);
  assert.equal(value.query, null);
  assert.equal(value.drafts.length, 0);
  const schema = f.calls[0].body.response_format.json_schema.schema;
  assert.ok(schema.properties.action.enum.includes('undo'));
  assert.ok('undo' in schema.properties);
  assert.equal(schema.additionalProperties, false);
  assert.equal(f.calls.length, 1);
});

test('real SDK rejects malformed undo targets and unknown fields with safe validation errors', async () => {
  const valid = { action: 'undo', reply: '准备撤销入账', drafts: [], query: null, update: null,
    undo: { batch_id: '00000000-0000-4000-8000-000000000003',
      draft_ids: ['00000000-0000-4000-8000-000000000004'] } };
  for (const undo of [
    { ...valid.undo, batch_id: 42 }, { ...valid.undo, draft_ids: null },
    { ...valid.undo, draft_ids: [42] }, { ...valid.undo, draft_ids: undefined },
    { ...valid.undo, transaction_id: 'private-response-secret secret-fixture' },
    { ...valid.undo, user_id: 'private-response-secret secret-fixture' },
    'raw action private-response-secret secret-fixture',
  ]) {
    const f = fixture(completion(JSON.stringify({ ...valid, undo })));
    await assert.rejects(f.adapter.bailianObject({ model: 'fixture-model', messages: prompt,
      schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA, schemaName: 'ledger_plan' }), error => safeValidationFailure(f.adapter, error));
    assert.equal(f.calls.length, 1);
  }
  const extra = fixture(completion(JSON.stringify({ ...valid, transaction_ids: ['private-response-secret secret-fixture'] })));
  await assert.rejects(extra.adapter.bailianObject({ model: 'fixture-model', messages: prompt,
    schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA, schemaName: 'ledger_plan' }), error => safeValidationFailure(extra.adapter, error));
  assert.equal(extra.calls.length, 1);
});

test('real SDK ASR uses input_audio data URLs and Chinese normalization through the common provider', async () => {
  const wav = Buffer.from('RIFF-fixture-WAVE-audio');
  const f = fixture(completion('今天吃饭2.98元'));
  assert.equal(await f.adapter.bailianText({ model: 'qwen3-asr-flash', messages: [{ role: 'user', content: [
    { type: 'file', mediaType: 'audio/wav', data: wav },
  ] }], asrOptions: { language: 'zh', enable_itn: true } }), '今天吃饭2.98元');
  const { body } = f.calls[0];
  assert.equal(body.messages[0].content[0].type, 'input_audio');
  assert.equal(body.messages[0].content[0].input_audio.data, `data:audio/wav;base64,${wav.toString('base64')}`);
  assert.deepEqual(body.asr_options, { language: 'zh', enable_itn: true });
  assert.equal(body.messages[0].content[0].input_audio.format, undefined);
  assert.equal(body.stream, false);
});

test('SDK upstream failures preserve safe status mapping, hide response payloads and never retry paid calls', async () => {
  for (const [status, code, expectedStatus, expectedMessage] of [
    [401, 'InvalidApiKey', 503, /API Key/], [403, 'AccessDenied', 503, /权限/],
    [403, 'Arrearage', 503, /余额/], [402, 'InsufficientBalance', 503, /余额/],
    [429, 'RateLimit', 429, /频繁|额度/], [404, 'ModelNotFound', 503, /模型/], [500, 'InternalError', 502, /稍后重试/],
  ]) {
    const f = fixture(() => Response.json({ error: { code, message: 'raw upstream secret-fixture financial data' } }, { status }));
    await assert.rejects(f.adapter.bailianText({ model: 'fixture-model', messages: prompt }), error => {
      const publicFailure = f.adapter.bailianFailure(error);
      assert.equal(publicFailure.status, expectedStatus);
      assert.match(publicFailure.message, expectedMessage);
      assert.ok(!publicFailure.message.includes('secret-fixture'));
      assert.ok(!publicFailure.message.includes('financial data'));
      assert.ok(!error.message.includes('raw upstream'));
      return true;
    });
    assert.equal(f.calls.length, 1);
  }
});

test('real SDK streaming handles split UTF-8 and CRLF, hides reasoning, and preserves completion state', async () => {
  const f = fixture(() => sse([
    textChunk(' \n'), { choices: [{ delta: { reasoning_content: 'hidden reasoning' } }] }, textChunk('中文总结'), finishChunk('stop'),
  ], { bytewise: true }));
  const chunks = await collect(await f.adapter.bailianStream({ model: 'fixture-model', messages: prompt, reasoningEffort: 'low' }));
  assert.equal(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), ' \n中文总结');
  assert.ok(chunks.some(chunk => chunk.type === 'finish' && chunk.finishReason === 'stop'));
  assert.ok(!JSON.stringify(chunks).includes('hidden reasoning'));
  assert.equal(f.calls[0].body.stream, true);
  assert.equal(f.calls[0].body.reasoning_effort, 'low');
});

test('SDK stream EOF without DONE, invalid events and upstream error events cannot look complete', async () => {
  for (const response of [
    () => sse([textChunk('部分总结'), finishChunk('stop')], { done: false }),
    () => sse([textChunk('部分总结'), '{broken']),
    () => sse([textChunk('部分总结'), { error: { code: 'Arrearage', message: 'raw upstream secret-fixture' } }]),
  ]) {
    const f = fixture(response);
    await assert.rejects(async () => collect(await f.adapter.bailianStream({ model: 'fixture-model', messages: prompt })));
    assert.equal(f.calls.length, 1);
  }
});

test('SDK streams retain token-limit finish reasons so route callers can label partial summaries', async () => {
  const f = fixture(() => sse([textChunk('部分总结'), finishChunk('length')]));
  const chunks = await collect(await f.adapter.bailianStream({ model: 'fixture-model', messages: prompt }));
  assert.equal(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), '部分总结');
  assert.ok(chunks.some(chunk => chunk.type === 'finish' && chunk.finishReason === 'length'));
  assert.equal(f.logs.length, 2);
  assert.equal(f.logs[0][0], 'AI request first output');
  assert.equal(f.logs[1][0], 'AI request failed');
  assert.equal(f.logs[1][1].failure, 'truncated');
});

test('SDK failure telemetry records one allowlisted terminal classification without raw provider errors', async t => {
  const rawLogs = [];
  t.mock.method(console, 'error', (...args) => rawLogs.push(args));
  const providerError = { code: 'private-response-secret', message: 'secret-fixture financial data https://private.example' };
  for (const operation of ['text', 'stream', 'object-stream']) {
    const f = fixture(() => operation === 'text'
      ? Response.json({ error: providerError }, { status: 500 })
      : sse([...(operation === 'stream' ? [textChunk('sensitive partial text')] : []), { error: providerError }]));
    const request = { model: 'fixture-model', messages: prompt };
    await assert.rejects(async () => {
      if (operation === 'text') return f.adapter.bailianText(request);
      if (operation === 'stream') return collect(await f.adapter.bailianStream(request));
      return f.adapter.bailianObjectStream({ ...request, schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA }, () => {});
    });
    const failures = f.logs.filter(([event]) => event === 'AI request failed');
    assert.equal(failures.length, 1);
    assert.equal(failures[0][1].operation, operation);
    assert.equal(failures[0][1].failure, 'unavailable');
    assert.equal(f.logs.filter(([event]) => event === 'AI request completed').length, 0);
    for (const sensitive of ['private-response-secret', 'secret-fixture', 'financial data', 'https://', 'sensitive partial text', '今天花了多少']) {
      assert.ok(!JSON.stringify(f.logs).includes(sensitive));
    }
  }
  assert.equal(rawLogs.length, 0, 'SDK default logging must not expose raw provider errors');
});

test('unsupported workspace models surface a deployment-range error without exposing provider details', async () => {
  const f = fixture(() => Response.json({ error: { code: 'Model.Unsupported', message: 'private-response-secret secret-fixture' } }, { status: 400 }));
  await assert.rejects(f.adapter.bailianObjectStream({ model: 'fixture-model', messages: prompt, schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA }, () => {}), error => {
    const failure = f.adapter.bailianFailure(error);
    assert.equal(failure.status, 503);
    assert.match(failure.message, /部署范围不支持/);
    assert.ok(!failure.message.includes('private-response-secret'));
    assert.ok(!failure.message.includes('secret-fixture'));
    return true;
  });
  assert.equal(f.calls.length, 1, 'configuration failures must not be retried automatically');
  assert.equal(f.logs.at(-1)[1].failure, 'configuration');
});

test('SDK streaming HTTP failures remain errors before a successful response is returned', async () => {
  const f = fixture(() => Response.json({ error: { code: 'RateLimit', message: 'raw upstream secret-fixture' } }, { status: 429 }));
  await assert.rejects(f.adapter.bailianStream({ model: 'fixture-model', messages: prompt }), error => {
    assert.equal(f.adapter.bailianFailure(error).status, 429);
    assert.ok(!error.message.includes('secret-fixture'));
    return true;
  });
  assert.equal(f.calls.length, 1);
});

test('an initial SDK SSE error rejects before starting a public stream and preserves safe balance errors', async () => {
  const f = fixture(() => sse([{ error: { code: 'Arrearage', message: 'private-response-secret secret-fixture' } }]));
  await assert.rejects(f.adapter.bailianStream({ model: 'fixture-model', messages: prompt }), error => {
    const failure = f.adapter.bailianFailure(error);
    assert.equal(failure.status, 503);
    assert.match(failure.message, /余额/);
    assert.ok(!failure.message.includes('private-response-secret'));
    assert.ok(!failure.message.includes('secret-fixture'));
    assert.ok(!error.message.includes('private-response-secret'));
    return true;
  });
  assert.equal(f.calls.length, 1);
});

test('reasoning-only and empty SDK SSE responses reject before starting a public stream', async () => {
  for (const events of [
    [{ choices: [{ delta: { reasoning_content: 'private-response-secret hidden reasoning' } }] }, finishChunk('stop')],
    [finishChunk('stop')],
  ]) {
    const f = fixture(() => sse(events));
    await assert.rejects(f.adapter.bailianStream({ model: 'fixture-model', messages: prompt }), error => {
      const failure = f.adapter.bailianFailure(error);
      assert.equal(failure.status, 502);
      assert.ok(!failure.message.includes('hidden reasoning'));
      assert.ok(!failure.message.includes('private-response-secret'));
      assert.ok(!error.message.includes('private-response-secret'));
      return true;
    });
    assert.equal(f.calls.length, 1);
  }
});

test('an SDK SSE error after visible text preserves the partial answer and then rejects safely', async () => {
  const f = fixture(() => sse([textChunk('部分总结'), { error: { code: 'Arrearage', message: 'private-response-secret secret-fixture' } }]));
  const stream = await f.adapter.bailianStream({ model: 'fixture-model', messages: prompt });
  assert.equal((await stream.next()).value.text, '部分总结');
  await assert.rejects(collect(stream), error => {
    const failure = f.adapter.bailianFailure(error);
    assert.equal(failure.status, 503);
    assert.match(failure.message, /余额/);
    assert.ok(!failure.message.includes('private-response-secret'));
    assert.ok(!error.message.includes('private-response-secret'));
    return true;
  });
  assert.equal(f.calls.length, 1);
});

test('SDK requests propagate caller cancellation to the actual provider fetch without retrying', async () => {
  const controller = new AbortController();
  const f = fixture(({ init }) => new Promise((resolve, reject) => {
    void resolve;
    if (init.signal.aborted) reject(init.signal.reason);
    else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }));
  const pending = f.adapter.bailianText({ model: 'fixture-model', messages: prompt, timeoutMs: 180_000 }, controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.signal.aborted, true);
  assert.equal(f.logs.length, 1);
  assert.equal(f.logs[0][0], 'AI request failed');
  assert.equal(f.logs[0][1].failure, 'cancelled');
  assert.equal(f.logs[0][1].timeoutMs, 180_000);
});

test('structured SDK streaming delivers reply snapshots before completion, then validates the final ledger plan', async () => {
  const partials = [];
  let send, complete;
  const firstReply = new Promise(resolve => { complete = resolve; });
  const f = fixture(({ init }) => new Response(new ReadableStream({ start(body) {
    send = (event, end = false) => {
      const bytes = new TextEncoder().encode(`data: ${typeof event === 'string' ? event : JSON.stringify(event)}\r\n\r\n`);
      // UTF-8 and SSE boundaries must not affect partial Chinese replies.
      for (const byte of bytes) body.enqueue(new Uint8Array([byte]));
      if (end) body.close();
    };
    init.signal.addEventListener('abort', () => { try { body.error(init.signal.reason); } catch {} }, { once: true });
    send({ choices: [{ delta: { reasoning_content: 'private-response-secret hidden reasoning' } }] });
    send(textChunk('{"action":"chat","reply":"你好'));
  } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  let settled = false;
  const pending = f.adapter.bailianObjectStream({ model: 'fixture-model', messages: prompt,
    schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA, schemaName: 'ledger_plan', thinking: false,
  }, partial => {
    partials.push(partial);
    if (partial.reply === '你好') complete();
  }).finally(() => { settled = true; });
  await firstReply;
  assert.equal(settled, false, 'partial replies must arrive while provider generation is still pending');
  assert.equal(partials.at(-1).reply, '你好');
  assert.equal(partials.at(-1).drafts, undefined, 'partial fields must not be invented');
  assert.equal(f.logs.length, 1, 'first partial timing is recorded while generation is pending');
  assert.equal(f.logs[0][0], 'AI request first output');
  assert.equal(f.logs[0][1].outputKind, 'partial');
  assert.ok(f.logs[0][1].firstOutputMs >= 0);
  send(textChunk('，可以帮你记账。","drafts":[],"query":null}'));
  send(finishChunk('stop'));
  send('[DONE]', true);
  const value = await pending;
  assert.equal(value.reply, '你好，可以帮你记账。');
  assert.equal(value.action, 'chat');
  assert.equal(value.update, null, 'schema defaults are applied only to the final result');
  assert.equal(value.undo, null);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.stream, true);
  assert.equal(f.calls[0].body.enable_thinking, false);
  assert.equal(f.calls[0].body.response_format.json_schema.name, 'ledger_plan');
  assert.equal(f.logs.length, 2);
  assert.equal(f.logs[1][0], 'AI request completed');
  assert.equal(f.logs[1][1].operation, 'object-stream');
  assert.equal(f.logs[1][1].firstOutputMs, f.logs[0][1].firstOutputMs);
  assert.ok(f.logs[1][1].durationMs >= f.logs[0][1].firstOutputMs);
  for (const sensitive of ['secret-fixture', 'private-response-secret', 'hidden reasoning']) {
    assert.ok(!JSON.stringify(partials).includes(sensitive));
    assert.ok(!JSON.stringify(f.logs).includes(sensitive));
  }
});

test('structured SDK streams reject malformed or schema-invalid final JSON after provisional output', async () => {
  for (const text of [
    '{"action":"chat","reply":"partial",broken private-response-secret secret-fixture',
    JSON.stringify({ action: 'execute_sql', reply: 'partial', drafts: [], query: null }),
    JSON.stringify({ action: 'record', reply: 'partial', drafts: [{ amount_cents: 2.98 }], query: null }),
  ]) {
    const f = fixture(() => sse([textChunk(text), finishChunk('stop')]));
    const partials = [];
    await assert.rejects(f.adapter.bailianObjectStream({ model: 'fixture-model', messages: prompt,
      schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA,
    }, partial => partials.push(partial)), error => safeValidationFailure(f.adapter, error));
    assert.ok(partials.length > 0);
    assert.equal(f.calls.length, 1);
  }
});

test('structured SDK streams reject truncation, incomplete transport, missing finish and empty output', async () => {
  const content = '{"action":"chat","reply":"partial","drafts":[],"query":null}';
  for (const [events, options, expectedCode] of [
    [[textChunk(content), finishChunk('length')], {}, 'truncated'],
    [[textChunk(content), finishChunk('stop')], { done: false }, 'incomplete_stream'],
    [[textChunk(content)], {}, ''],
    [[finishChunk('stop')], {}, 'empty'],
    [[{ choices: [{ delta: { reasoning_content: 'hidden reasoning' } }] }, finishChunk('stop')], {}, 'empty'],
  ]) {
    const f = fixture(() => sse(events, options));
    const partials = [];
    await assert.rejects(f.adapter.bailianObjectStream({ model: 'fixture-model', messages: prompt,
      schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA,
    }, partial => partials.push(partial)), error => {
      assert.equal(error.code, expectedCode);
      assert.equal(f.adapter.bailianFailure(error).status, 502);
      return true;
    });
    assert.ok(!JSON.stringify(partials).includes('hidden reasoning'));
    assert.equal(f.calls.length, 1);
  }
});

test('structured SDK streams preserve safe provider errors before and after partial replies', async () => {
  for (const reply of [
    () => Response.json({ error: { code: 'Arrearage', message: 'private-response-secret secret-fixture' } }, { status: 403 }),
    () => sse([{ error: { code: 'Arrearage', message: 'private-response-secret secret-fixture' } }]),
    () => sse([textChunk('{"action":"chat","reply":"partial'),
      { error: { code: 'Arrearage', message: 'private-response-secret secret-fixture' } }]),
  ]) {
    const f = fixture(reply);
    await assert.rejects(f.adapter.bailianObjectStream({ model: 'fixture-model', messages: prompt,
      schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA,
    }, () => {}), error => {
      const failure = f.adapter.bailianFailure(error);
      assert.equal(failure.status, 503);
      assert.match(failure.message, /余额/);
      assert.ok(!failure.message.includes('private-response-secret'));
      assert.ok(!error.message.includes('private-response-secret'));
      return true;
    });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].init.signal.aborted, true);
  }
});

test('cancelling a structured SDK stream or rejecting its callback aborts unfinished provider work', async () => {
  for (const cancelViaCallback of [false, true]) {
    const caller = new AbortController();
    let firstPartial;
    const arrived = new Promise(resolve => { firstPartial = resolve; });
    const f = fixture(({ init }) => new Response(new ReadableStream({ start(body) {
      body.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(textChunk('{"action":"chat","reply":"partial'))}\n\n`));
      init.signal.addEventListener('abort', () => body.error(init.signal.reason), { once: true });
    } }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const pending = f.adapter.bailianObjectStream({ model: 'fixture-model', messages: prompt,
      schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA,
    }, () => {
      firstPartial();
      if (cancelViaCallback) throw new Error('private-response-secret callback failed');
    }, caller.signal);
    const rejected = assert.rejects(pending, error => {
      assert.ok(!error.message.includes('private-response-secret'));
      return true;
    });
    await arrived;
    if (!cancelViaCallback) caller.abort();
    await rejected;
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].init.signal.aborted, true);
  }
});

test('caller cancellation interrupts structured generation before its first output', async () => {
  const caller = new AbortController();
  let started;
  const requested = new Promise(resolve => { started = resolve; });
  const f = fixture(({ init }) => new Response(new ReadableStream({ start(body) {
    init.signal.addEventListener('abort', () => body.error(init.signal.reason), { once: true });
    started();
  } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const pending = f.adapter.bailianObjectStream({ model: 'fixture-model', messages: prompt,
    schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA,
  }, () => assert.fail('cancelled generation must not publish any output'), caller.signal);
  const rejected = assert.rejects(pending);
  await requested;
  caller.abort();
  await rejected;
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.signal.aborted, true);
});

test('ending a streaming consumer aborts the actual SDK fetch and releases the unfinished response', async () => {
  const f = fixture(({ init }) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(textChunk('部分总结'))}\n\n`));
    init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
  } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const stream = await f.adapter.bailianStream({ model: 'fixture-model', messages: prompt });
  assert.equal((await stream.next()).value.text, '部分总结');
  await stream.return();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.signal.aborted, true);
  assert.equal(f.logs.length, 2);
  assert.equal(f.logs[0][0], 'AI request first output');
  assert.equal(f.logs[1][0], 'AI request failed');
  assert.equal(f.logs[1][1].failure, 'cancelled');
});

test('caller cancellation interrupts a pending SDK stream rather than completing partial text', async () => {
  const controller = new AbortController();
  const f = fixture(({ init }) => new Response(new ReadableStream({ start(body) {
    body.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(textChunk('部分总结'))}\n\n`));
    init.signal.addEventListener('abort', () => body.error(init.signal.reason), { once: true });
  } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const stream = await f.adapter.bailianStream({ model: 'fixture-model', messages: prompt }, controller.signal);
  assert.equal((await stream.next()).value.text, '部分总结');
  const next = stream.next();
  controller.abort();
  await assert.rejects(next);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.signal.aborted, true);
});

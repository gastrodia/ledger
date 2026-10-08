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

function loadAdapter(fetchImpl, env = {}, logs = []) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('lib/bailian.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, {
    exports, process: { env: { DASHSCOPE_API_KEY: 'secret-fixture', ...env } }, fetch: fetchImpl,
    URL, Headers, Request, Response, ReadableStream, TransformStream, TextEncoder, TextDecoder,
    AbortController, AbortSignal, Buffer, Uint8Array, Error, TypeError, setTimeout, clearTimeout,
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
function fixture(reply, env) {
  const calls = [], logs = [];
  const adapter = loadAdapter(async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return typeof reply === 'function' ? reply(calls.at(-1)) : reply;
  }, env, logs);
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

test('real SDK sends structured schema and image content while preserving Bailian thinking and token settings', async () => {
  const schema = ai.jsonSchema({ type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false });
  const image = 'data:image/png;base64,YWJj';
  const f = fixture(completion(JSON.stringify({ answer: '待确认' })));
  assert.deepEqual(await f.adapter.bailianObject({ model: 'fixture-model', schema, schemaName: 'ledger_plan',
    thinking: false, temperature: 0.2, maxOutputTokens: 5000,
    messages: [{ role: 'system', content: '识别账目' }, { role: 'user', content: [
      { type: 'text', text: '请识别截图' }, { type: 'file', mediaType: 'image/png', data: image },
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
  const logged = JSON.stringify(f.logs);
  for (const sensitive of ['secret-fixture', '今天花了多少', '账本支出为10元', 'hidden reasoning']) assert.ok(!logged.includes(sensitive));
});

test('SDK text and object results reject truncation, empty answers and malformed JSON', async () => {
  for (const response of [completion('部分回答', 'length'), completion('   '), completion(null)]) {
    const f = fixture(response);
    await assert.rejects(f.adapter.bailianText({ model: 'fixture-model', messages: prompt }));
    assert.equal(f.calls.length, 1);
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

test('real SDK preserves a structured member choice with a null member without inventing a person or another action', async () => {
  const valid = { action: 'update', reply: '请选择成员', drafts: [], query: null,
    update: { batch_id: '00000000-0000-4000-8000-000000000003',
      draft_ids: ['00000000-0000-4000-8000-000000000004'], member_id: null } };
  const f = fixture(completion(JSON.stringify(valid)));
  const value = await f.adapter.bailianObject({ model: 'fixture-model', messages: prompt,
    schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA, schemaName: 'ledger_plan' });
  assert.deepEqual(Object.keys(value).sort(), ['action', 'drafts', 'query', 'reply', 'update']);
  assert.equal(value.action, 'update');
  assert.deepEqual(value.update, valid.update);
  assert.equal(value.drafts.length, 0);
  assert.equal(f.calls.length, 1);
  for (const member_id of [42, {}, undefined]) {
    const rejected = fixture(completion(JSON.stringify({ ...valid, update: { ...valid.update, member_id } })));
    await assert.rejects(rejected.adapter.bailianObject({ model: 'fixture-model', messages: prompt,
      schema: assistantOutput.ASSISTANT_OUTPUT_SCHEMA, schemaName: 'ledger_plan' }), error => safeValidationFailure(rejected.adapter, error));
  }
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
  const pending = f.adapter.bailianText({ model: 'fixture-model', messages: prompt }, controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending);
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

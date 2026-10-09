/* eslint-disable @typescript-eslint/no-require-imports -- isolate the provider-independent contract. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exports_ = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/structured-output.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exports_, JSON });
const { structuredOutputMiddleware } = exports_;

test('text and schema-free JSON calls keep their original prompt and provider parameters', async () => {
  for (const responseFormat of [undefined, { type: 'text' }, { type: 'json' }]) {
    const params = { responseFormat, prompt: [{ role: 'user', content: 'hello' }],
      providerOptions: { unrelated: { option: true } } };
    assert.equal(await structuredOutputMiddleware.transformParams({ params }), params);
  }
});

test('the output contract is preserved across providers without changing tools, original messages or caller schema', async () => {
  const schema = { type: 'object', properties: { cents: { type: 'integer', minimum: 1 } },
    required: ['cents'], additionalProperties: false };
  const params = { responseFormat: { type: 'json', name: 'contract', schema },
    prompt: [{ role: 'system', content: 'Read only' }, { role: 'user', content: 'Request data' }],
    tools: [{ name: 'read', inputSchema: schema }], temperature: 0.2,
    providerOptions: { anyProvider: { option: true } } };
  const snapshot = JSON.stringify(params);
  const transformed = await structuredOutputMiddleware.transformParams({ params });
  assert.equal(JSON.stringify(params), snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(transformed.responseFormat)), { type: 'json' });
  assert.deepEqual(JSON.parse(transformed.prompt[0].content.split('\nJSON Schema:\n')[1]), schema);
  assert.equal(transformed.prompt[1], params.prompt[0]);
  assert.equal(transformed.prompt[2], params.prompt[1]);
  assert.equal(transformed.tools, params.tools);
  assert.equal(transformed.providerOptions, params.providerOptions);
  assert.equal(transformed.temperature, params.temperature);
  assert.equal(await structuredOutputMiddleware.transformParams({ params: transformed }), transformed,
    'the same call cannot accumulate repeated schema instructions');
});

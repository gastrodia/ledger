/* eslint-disable @typescript-eslint/no-require-imports -- node:test CommonJS harness for TypeScript UI modules. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function effect(file, endpoint) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let match;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0].getText(source).includes(endpoint)) match = node.getText(source);
    if (!match) ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(match);
  return ts.transpileModule(match, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
for (const [file, endpoint] of [
  ['app/dashboard/categories/page.tsx', '/api/categories?'],
  ['app/dashboard/members/page.tsx', '/api/members'],
  ['app/dashboard/stats/page.tsx', '/api/stats?'],
]) {
  test(`${endpoint}: failed reads become recoverable errors rather than empty data`, async () => {
    const errors = [], data = [];
    const bindings = {
      query: 'month=2026-09', requestKey: 'month=2026-09:0', validPeriod: true, reload: 0, filterType: 'all',
      router: { push: () => assert.fail('unexpected redirect') }, AbortController, URLSearchParams,
      console: { error() {} }, fetch: async () => ({ ok: false, status: 500 }),
      setLoadError: value => errors.push(value), setCategories: value => data.push(value),
      setMembers: value => data.push(value), setStatsData: value => data.push(value),
      setIsLoading() {}, setLoadedQuery() {},
    };
    let cleanup;
    Function(...Object.keys(bindings), 'useEffect', effect(file, endpoint))(...Object.values(bindings), callback => { cleanup = callback(); });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(data.length, 0);
    assert.ok(errors.some(value => typeof value === 'string' && value.includes('重试')));
    cleanup();
  });
}

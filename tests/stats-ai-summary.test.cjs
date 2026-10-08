/* eslint-disable @typescript-eslint/no-require-imports -- isolate provider calls and database fixtures. */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { NextResponse } = require('next/server');

function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, {
    exports, Date, Response, ReadableStream, TextEncoder, AbortController,
    console: { error() {} }, ...globals,
    require: id => { assert.ok(id in dependencies, `Unexpected dependency ${id}`); return dependencies[id]; },
  });
  return exports;
}
const periods = load('lib/stats-period.ts');
const helper = load('lib/stats-ai-summary.ts');
const fixture = {
  label: '2026-09', period: periods.getStatsPeriod('month', '2026-09', '2026-09-07'),
  summary: { totalIncome: 200, totalExpense: 100, count: 5 },
  elapsed: { totalIncome: 200, totalExpense: 70, count: 4 },
  previous: { totalIncome: 100, totalExpense: 100, count: 4 },
  expenseCategories: [{ name: '餐饮', total: 50, count: 2 }],
  incomeCategories: [], expenseMembers: [], incomeMembers: [], trend: [],
  expenseChanges: [{ name: '餐饮', currentTotal: 50, previousTotal: 30, previousCount: 2 }],
};
function payload(input) { return JSON.parse(helper.buildSummaryPrompt(input).split('\n')[1]); }

test('AI comparisons use elapsed dates, stop at a shorter previous month and retain full past periods', () => {
  assert.equal(helper.summaryComparisonEnd(fixture.period), '2026-08-08');
  assert.equal(helper.summaryComparisonEnd(periods.getStatsPeriod('month', '2026-03', '2026-03-30')), '2026-03-01');
  assert.equal(helper.summaryComparisonEnd(periods.getStatsPeriod('year', '2024', '2024-12-30')), '2024-01-01');
  assert.equal(helper.summaryComparisonEnd(periods.getStatsPeriod('month', '2026-08', '2026-09-07')), '2026-08-01');
  assert.equal(helper.summaryComparisonEnd(periods.getStatsPeriod('month', '2026-10', '2026-09-07')), '2026-09-01');
});

test('prompt percentages are computed from the correct totals and exclude future records from comparisons', () => {
  const data = payload(fixture);
  assert.match(data.期间状态, /尚未结束/);
  assert.equal(data.未来日期记录笔数, 1);
  assert.equal(data.整个期间已录入记录.支出, '¥100.00');
  assert.equal(data.同期对比.支出变化.金额变化, '¥-30.00');
  assert.equal(data.同期对比.支出变化.百分比变化, '-30.0%');
  assert.equal(data.支出分类Top5[0].占本期全部支出比例, '50.0%');
  assert.equal(data.支出分类Top5[0].笔均金额, '¥25.00');
  assert.equal(data.支出分类同期变化[0].金额变化, '¥20.00');
  assert.equal(data.支出分类同期变化[0].百分比变化, '66.7%');
});

test('missing or zero baselines never produce fictitious growth and future periods have no comparison', () => {
  const data = payload({ ...fixture, previous: { totalIncome: 0, totalExpense: 0, count: 0 }, summary: { totalIncome: 0, totalExpense: 100, count: 1 } });
  assert.equal(data.同期对比.上期有记录, false);
  assert.match(data.同期对比.支出变化.百分比变化, /不计算/);
  assert.match(data.整个期间已录入记录.结余占收入比例, /不计算/);
  const future = payload({ ...fixture, period: periods.getStatsPeriod('month', '2026-10', '2026-09-07') });
  assert.match(future.同期对比, /尚未开始/);
});

test('JSON failures become readable errors and non-JSON gateway failures get a safe fallback', async () => {
  assert.equal(await helper.readSummaryError(Response.json({ error: 'AI 服务暂时无法连接，请稍后重试。' })), 'AI 服务暂时无法连接，请稍后重试。');
  assert.match(await helper.readSummaryError(new Response('<html>proxy failure</html>')), /稍后重试/);
  assert.match(await helper.readSummaryError(Response.json({ error: { message: 'secret' } })), /稍后重试/);
});

test('stats page displays the JSON error message without braces or quotes and stops loading', async () => {
  const source = ts.createSourceFile('page.tsx', fs.readFileSync('app/dashboard/stats/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'generateAiSummary') declaration = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(declaration);
  const state = { error: null, summary: '', loading: false };
  const code = ts.transpileModule(`const ${declaration}; generateAiSummary();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  await vm.runInNewContext(code, {
    aiAbortRef: { current: null }, AbortController, DOMException, TextDecoder,
    viewMode: 'month', selectedMonth: '2026-09', selectedYear: '2026', asOfDate: '2026-09-07',
    isValidMonth: () => true, isValidYear: () => true,
    setAiError: value => { state.error = value; }, setAiSummary: value => { state.summary = value; },
    setIsAiLoading: value => { state.loading = value; },
    readSummaryError: helper.readSummaryError, getErrorMessage: error => error.message,
    console: { error() {} }, router: { push: () => assert.fail('provider failure must not redirect to login') },
    fetch: async () => Response.json({ error: 'AI 模型暂不可用，请稍后重试。' }, { status: 503 }),
  });
  assert.equal(state.error, 'AI 模型暂不可用，请稍后重试。');
  assert.equal(state.summary, '');
  assert.equal(state.loading, false);
});

function api({ authenticated = true, key = 'fixture-key', model, create, count = 5 } = {}) {
  const queries = [];
  const completions = [];
  const bailian = {
    BAILIAN_SUMMARY_MODEL: 'qwen3.8-max',
    bailianConfig: () => { if (!key) throw { status: 503, code: 'missing_key' }; },
    bailianFailure: error => {
      if (error.code === 'missing_key') return { status: 503, message: '请配置 API Key' };
      if (error.status === 401) return { status: 503, message: '请检查 API Key' };
      if (error.status === 404) return { status: 503, message: '请检查模型配置' };
      if (error.status === 429) return { status: 429, message: '额度受限，请稍后重试' };
      if (error.name === 'TimeoutError') return { status: 504, message: '响应超时' };
      return { status: 502, message: '请稍后重试' };
    },
    bailianStream: async (body, signal) => {
      completions.push([body, { signal }]);
      if (create) return create(body, { signal });
      return (async function* () {
        yield { type: 'text-delta', text: '## 收支概况\n可读总结' };
        yield { type: 'finish', finishReason: 'stop' };
      })();
    },
  };
  const route = load('app/api/stats/ai-summary/route.ts', {
    'next/server': { NextResponse }, '@/lib/bailian': bailian,
    '@/lib/auth': { getSession: async () => authenticated ? { userId: 'owner' } : null },
    '@/lib/stats-period': periods, '@/lib/stats-ai-summary': helper,
    '@/lib/db': { sql: async (strings, ...params) => {
      const text = strings.join('?'); queries.push({ text, params });
      if (text.includes('"elapsedIncome"')) return [{ totalIncome: '200', totalExpense: '100', count, elapsedIncome: '200', elapsedExpense: '70', elapsedCount: 4 }];
      if (text.includes('"totalIncome"')) return [{ totalIncome: '100', totalExpense: '100', count: 4 }];
      return [];
    } },
  }, { process: { env: { BAILIAN_SUMMARY_MODEL: model } } });
  return { ...route, queries, completions, bailian };
}
function request(params = { month: '2026-09', asOf: '2026-09-07' }, controller = new AbortController()) {
  return { nextUrl: { searchParams: new URLSearchParams(params) }, signal: controller.signal };
}

test('summary route uses a current model, streams only answer text and scopes all queries to the owner', async () => {
  const route = api();
  const response = await route.GET(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/plain/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), '## 收支概况\n可读总结');
  const [call] = route.completions[0];
  assert.equal(call.model, 'qwen3.8-max');
  assert.equal(call.reasoningEffort, 'low');
  assert.equal(call.maxOutputTokens, 8192);
  assert.equal(route.queries.length, 8);
  assert.ok(route.queries.every(query => query.params.includes('owner')));
  const prior = route.queries.find(query => query.text.includes('"totalIncome"') && !query.text.includes('"elapsedIncome"'));
  assert.deepEqual(prior.params, ['owner', '2026-08-01', '2026-08-08']);
});

test('model configuration supports replacement without changes to code', async () => {
  const route = api({ model: 'qwen3.7-max' });
  await (await route.GET(request({ year: '2026', asOf: '2026-09-07' }))).text();
  assert.equal(route.completions[0][0].model, 'qwen3.7-max');
  assert.equal(route.completions[0][0].reasoningEffort, 'low');
  assert.ok(route.queries.find(query => query.text.includes('TO_CHAR')).params.includes('YYYY-MM'));
});

test('authentication, missing configuration and malformed dates never call a provider or database', async () => {
  for (const [settings, params, status] of [
    [{ authenticated: false }, {}, 401], [{ key: '' }, {}, 503],
    [{}, {}, 400], [{}, { year: '2026', month: '2026-09' }, 400],
    [{}, { month: '2026-09', asOf: '2026-02-30' }, 400],
  ]) {
    const route = api(settings);
    assert.equal((await route.GET(request(params))).status, status);
    assert.equal(route.queries.length, 0);
    assert.equal(route.completions.length, 0);
  }
});

test('empty periods avoid model calls and token usage', async () => {
  const route = api({ count: 0 });
  const response = await route.GET(request());
  assert.match(await response.text(), /还没有收支记录/);
  assert.equal(route.completions.length, 0);
});

test('upstream auth, unavailable models, limits and timeouts keep readable errors without leaking raw messages', async () => {
  for (const [error, status, message] of [
    [{ status: 401 }, 503, /API Key/], [{ status: 404 }, 503, /模型配置/],
    [{ status: 429 }, 429, /额度受限/], [{ name: 'TimeoutError' }, 504, /超时/],
    [{ status: 500 }, 502, /稍后重试/],
  ]) {
    const route = api({ create: async () => { throw { ...error, message: 'raw upstream secret' }; } });
    const response = await route.GET(request());
    assert.equal(response.status, status);
    const body = await response.json();
    assert.match(body.error, message);
    assert.ok(!body.error.includes('secret'));
  }
});

test('partial stream failures and token truncation cannot be mistaken for complete summaries', async () => {
  const failure = api({ create: async () => (async function* () {
    yield { type: 'text-delta', text: '部分总结' };
    throw { status: 429, message: 'raw upstream secret' };
  })() });
  const text = await (await failure.GET(request())).text();
  assert.match(text, /部分总结/);
  assert.match(text, /生成中断/);
  assert.ok(!text.includes('secret'));
  const truncated = api({ create: async () => (async function* () {
    yield { type: 'text-delta', text: '部分总结' };
    yield { type: 'finish', finishReason: 'length' };
  })() });
  assert.match(await (await truncated.GET(request())).text(), /未生成完整/);
});

test('cancelling the response aborts provider work and ignores late chunks', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const route = api({ create: async () => (async function* () {
    await pending;
    yield { type: 'text-delta', text: 'late' };
  })() });
  const response = await route.GET(request());
  await response.body.cancel();
  assert.equal(route.completions[0][1].signal.aborted, true);
  resolve();
  await new Promise(done => setImmediate(done));
});

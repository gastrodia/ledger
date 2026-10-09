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
const helper = load('lib/stats-ai-summary.ts', { '@/lib/stats-period': periods });
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

function analysisClient(fetch) {
  const source = ts.createSourceFile('ai-analysis.tsx', fs.readFileSync('components/stats/ai-analysis.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = [];
  let cleanupEffect;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ['generate', 'stop'].includes(node.name.getText(source))) declarations.push(node.getText(source));
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect') cleanupEffect = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(declarations.length, 2, 'exercise the actual component request and stop handlers');
  assert.ok(cleanupEffect);
  const state = { error: null, summary: '', loading: false, reveals: 0, unauthorized: 0 };
  const writes = [];
  const requests = [];
  const controllerRef = { current: null };
  let unmount;
  const code = ts.transpileModule(`${declarations.map(text => `const ${text};`).join('\n')}\n${cleanupEffect};\n({ generate, stop });`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const handlers = vm.runInNewContext(code, {
    controllerRef, AbortController, TextDecoder, Error,
    query: 'month=2026-10&asOf=2026-10-08',
    setError: value => { state.error = value; writes.push(['error', value]); },
    setSummary: value => { state.summary = value; writes.push(['summary', value]); },
    setLoading: value => { state.loading = value; writes.push(['loading', value]); },
    onReveal: () => { state.reveals++; }, onUnauthorized: () => { state.unauthorized++; },
    readSummaryError: helper.readSummaryError,
    useEffect: callback => { unmount = callback(); },
    fetch: (url, options) => { requests.push({ url, signal: options.signal }); return fetch(url, options); },
  });
  return { ...handlers, state, writes, requests, controllerRef, unmount };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('AI analysis displays readable JSON errors, preserves the requested period and stops loading', async () => {
  const client = analysisClient(async () => Response.json({ error: 'AI 模型暂不可用，请稍后重试。' }, { status: 503 }));
  await client.generate();
  assert.equal(client.state.error, 'AI 模型暂不可用，请稍后重试。');
  assert.equal(client.state.summary, '');
  assert.equal(client.state.loading, false);
  assert.equal(client.state.reveals, 1);
  assert.equal(client.state.unauthorized, 0);
  assert.equal(client.requests[0].url, '/api/stats/ai-summary?month=2026-10&asOf=2026-10-08');
});

test('AI analysis updates partial output while streaming and decodes split Chinese characters', async () => {
  let stream;
  const response = new Response(new ReadableStream({ start(controller) { stream = controller; } }));
  const client = analysisClient(async () => response);
  const pending = client.generate();
  await settle();
  assert.equal(client.state.loading, true);
  const bytes = new TextEncoder().encode('餐饮支出 ¥12.50');
  stream.enqueue(bytes.slice(0, 1));
  await settle();
  assert.equal(client.state.summary, '', 'incomplete UTF-8 sequences wait for their remaining bytes');
  stream.enqueue(bytes.slice(1));
  await settle();
  assert.equal(client.state.summary, '餐饮支出 ¥12.50');
  assert.equal(client.state.loading, true);
  stream.enqueue(new TextEncoder().encode('，可查看分类明细。'));
  stream.close();
  await pending;
  assert.equal(client.state.summary, '餐饮支出 ¥12.50，可查看分类明细。');
  assert.equal(client.state.error, null);
  assert.equal(client.state.loading, false);
  assert.equal(client.controllerRef.current, null);
});

test('stopping AI analysis aborts work and retains accepted text without accepting late chunks', async () => {
  let stream;
  const client = analysisClient(async () => new Response(new ReadableStream({ start(controller) { stream = controller; } })));
  const pending = client.generate();
  await settle();
  stream.enqueue(new TextEncoder().encode('已生成的分析'));
  await settle();
  client.stop();
  assert.equal(client.requests[0].signal.aborted, true);
  assert.equal(client.state.loading, false);
  stream.enqueue(new TextEncoder().encode('不应显示的迟到内容'));
  stream.close();
  await pending;
  assert.equal(client.state.summary, '已生成的分析');
  assert.equal(client.state.error, null);
});

test('unmounting AI analysis aborts the period request and ignores a response that arrives later', async () => {
  let respond;
  const client = analysisClient(() => new Promise(resolve => { respond = resolve; }));
  const pending = client.generate();
  client.unmount();
  const writesAtUnmount = client.writes.length;
  assert.equal(client.requests[0].signal.aborted, true);
  respond(new Response('旧期间的迟到分析'));
  await pending;
  assert.equal(client.state.summary, '');
  assert.equal(client.state.error, null);
  assert.equal(client.writes.length, writesAtUnmount, 'unmount must not produce state updates');
});

test('AI analysis redirects expired sessions and treats an empty stream as a retryable failure', async () => {
  const unauthorized = analysisClient(async () => new Response('', { status: 401 }));
  await unauthorized.generate();
  assert.equal(unauthorized.state.unauthorized, 1);
  assert.equal(unauthorized.state.loading, false);
  assert.equal(unauthorized.state.error, null);
  const empty = analysisClient(async () => new Response('  '));
  await empty.generate();
  assert.match(empty.state.error, /暂未生成.*重试/);
  assert.equal(empty.state.loading, false);
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
    '@/lib/ledger-event-schema': { ensureCashflowSchema: async () => {} },
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

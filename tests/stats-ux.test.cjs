(async () => {
  const [{ default: assert }, { default: test }, { default: fs }, { default: vm }, { default: ts }, { NextResponse }] = await Promise.all([
    import('node:assert/strict'), import('node:test'), import('node:fs'), import('node:vm'), import('typescript'), import('next/server.js'),
  ]);
  function load(file, dependencies = {}) {
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports = {};
    vm.runInNewContext(source, { exports, Date, URLSearchParams, console, require: (id) => {
      assert.ok(id in dependencies, `Unexpected dependency ${id}`);
      return dependencies[id];
    } });
    return exports;
  }
  const helper = load('lib/stats-period.ts');

  test('calendar periods cross year and leap month boundaries without DST-dependent day counts', () => {
    const january = helper.getStatsPeriod('month', '2026-01', '2026-01-07');
    assert.equal(january.previousStartDate, '2025-12-01');
    assert.equal(january.previousEndDate, '2025-12-31');
    assert.equal(january.endDate, '2026-01-31');
    assert.equal(january.elapsedDays, 7);
    assert.equal(january.dailyEndExclusive, '2026-01-08');
    const leap = helper.getStatsPeriod('month', '2024-02', '2026-09-07');
    assert.equal(leap.totalDays, 29);
    assert.equal(leap.elapsedDays, 29);
    assert.equal(leap.endDate, '2024-02-29');
    assert.equal(leap.state, 'past');
    assert.equal(helper.getStatsPeriod('month', '2026-03', '2026-04-01').totalDays, 31);
    const year = helper.getStatsPeriod('year', '2024', '2024-12-31');
    assert.equal(year.totalDays, 366);
    assert.equal(year.elapsedDays, 366);
    assert.equal(year.previousStartDate, '2023-01-01');
    assert.equal(year.previousEndDate, '2023-12-31');
  });

  test('future periods have no elapsed days and invalid calendar inputs are rejected', () => {
    const future = helper.getStatsPeriod('month', '2026-10', '2026-09-07');
    assert.equal(future.state, 'future');
    assert.equal(future.elapsedDays, 0);
    assert.equal(future.dailyEndExclusive, future.startDate);
    for (const value of ['2026-13', '2026-00', '2026-9', '0000-01', '9999-01']) {
      assert.equal(helper.getStatsPeriod('month', value, '2026-09-07'), null);
    }
    assert.equal(helper.getStatsPeriod('month', '2026-02', '2026-02-29'), null);
  });

  test('statistics drill-down preserves inclusive dates, type and dimension including unassigned rows', () => {
    const period = helper.getStatsPeriod('year', '2024', '2026-09-07');
    const href = helper.statsDetailHref(period, 'expense', 'categoryId', 'food & drink');
    const url = new URL(href, 'https://ledger.test');
    assert.equal(url.pathname, '/dashboard');
    assert.equal(url.searchParams.get('startDate'), '2024-01-01');
    assert.equal(url.searchParams.get('endDate'), '2024-12-31');
    assert.equal(url.searchParams.get('type'), 'expense');
    assert.equal(url.searchParams.get('categoryId'), 'food & drink');
    assert.equal(new URL(helper.statsDetailHref(period, 'income', 'memberId', null), url).searchParams.get('memberId'), 'none');
  });

  test('comparison describes zero baselines without infinite or misleading percentages', () => {
    assert.equal(helper.describeAmountChange(0, 0), '与上期持平');
    assert.match(helper.describeAmountChange(10, 0), /暂无可比比例/);
    assert.equal(helper.describeAmountChange(150, 100), '较上期增加 50.0%');
    assert.equal(helper.describeAmountChange(0, 100), '较上期减少 100.0%');
  });

  function route({ authenticated = true } = {}) {
    const queries = [];
    const api = load('app/api/stats/route.ts', {
      'next/server': { NextResponse },
      '@/lib/auth': { getSession: async () => authenticated ? { userId: 'owner' } : null },
      '@/lib/stats-period': helper,
      '@/lib/db': { sql: async (strings, ...params) => {
        const sql = strings.join('?'); queries.push({ sql, params });
        if (sql.includes('"elapsedExpense"')) return [{ totalIncome: '200', totalExpense: '100', elapsedExpense: '70' }];
        if (sql.includes('"totalIncome"')) return [{ totalIncome: '100', totalExpense: '200' }];
        return [];
      } },
    });
    return { ...api, queries };
  }
  function request(params) { return { nextUrl: { searchParams: new URLSearchParams(params) } }; }

  test('stats API scopes both calendar periods to the owner and divides only elapsed-date expenses', async () => {
    const api = route();
    const response = await api.GET(request({ month: '2026-09', asOf: '2026-09-07' }));
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.summary.totalExpense, 100, 'full-period totals include all recorded dates');
    assert.equal(data.dailyExpense, 10, 'future-dated expense is excluded from the numerator');
    assert.deepEqual(data.comparison, { totalIncome: 100, totalExpense: 200 });
    assert.equal(data.period.elapsedDays, 7);
    const current = api.queries.find(q => q.sql.includes('"elapsedExpense"'));
    assert.deepEqual(current.params, ['2026-09-08', 'owner', '2026-09-01', '2026-10-01']);
    const previous = api.queries.find(q => q.sql.includes('"totalIncome"') && !q.sql.includes('"elapsedExpense"'));
    assert.deepEqual(previous.params, ['owner', '2026-08-01', '2026-09-01']);
    assert.ok(api.queries.every(q => q.params.includes('owner')), 'all aggregates retain account scope');
  });

  test('future stats report unavailable daily average and invalid/unauthorized requests never query data', async () => {
    const api = route();
    const { data } = await (await api.GET(request({ month: '2026-10', asOf: '2026-09-07' }))).json();
    assert.equal(data.dailyExpense, null);
    for (const params of [{}, { month: '2026-01', year: '2026' }, { month: '2026-02', asOf: '2026-02-30' }]) {
      const invalid = route();
      assert.equal((await invalid.GET(request(params))).status, 400);
      assert.equal(invalid.queries.length, 0);
    }
    const unauthorized = route({ authenticated: false });
    assert.equal((await unauthorized.GET(request({ year: '2026' }))).status, 401);
    assert.equal(unauthorized.queries.length, 0);
  });
})();

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

  test('comparison cutoffs preserve elapsed progress across short months, leap years and future periods', () => {
    for (const [mode, value, asOf, expected] of [
      ['month', '2026-09', '2026-09-07', '2026-08-08'],
      ['month', '2026-01', '2026-01-07', '2025-12-08'],
      ['month', '2026-03', '2026-03-30', '2026-03-01'],
      ['month', '2024-03', '2024-03-29', '2024-03-01'],
      ['year', '2024', '2024-12-30', '2024-01-01'],
      ['month', '2026-08', '2026-09-07', '2026-08-01'],
      ['year', '2024', '2026-09-07', '2024-01-01'],
      ['month', '2026-10', '2026-09-07', '2026-09-01'],
    ]) {
      assert.equal(helper.getComparisonEnd(helper.getStatsPeriod(mode, value, asOf)), expected);
    }
  });

  function route({
    authenticated = true,
    summary = { totalIncome: '200', totalExpense: '100', count: '5', elapsedIncome: '180', elapsedExpense: '70', elapsedCount: '3' },
    previous = { totalIncome: '100', totalExpense: '200', count: '4' },
    daily = [], monthly = [],
  } = {}) {
    const queries = [];
    const api = load('app/api/stats/route.ts', {
      'next/server': { NextResponse },
      '@/lib/auth': { getSession: async () => authenticated ? { userId: 'owner' } : null },
      '@/lib/stats-period': helper,
      '@/lib/db': { sql: async (strings, ...params) => {
        const sql = strings.join('?'); queries.push({ sql, params });
        if (sql.includes('"elapsedExpense"')) return [summary];
        if (sql.includes('"totalIncome"')) return [previous];
        if (sql.includes('EXTRACT(DAY')) return daily;
        if (sql.includes('EXTRACT(MONTH')) return monthly;
        return [];
      } },
    });
    return { ...api, queries };
  }
  function request(params) { return { nextUrl: { searchParams: new URLSearchParams(params) } }; }

  test('stats API separates full totals from same-progress comparisons and excludes future records from averages', async () => {
    const api = route();
    const response = await api.GET(request({ month: '2026-09', asOf: '2026-09-07' }));
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.deepEqual(data.summary, { totalIncome: 200, totalExpense: 100, balance: 100, count: 5, futureCount: 2 });
    assert.equal(data.dailyExpense, 10, 'future-dated expense is excluded from the numerator');
    assert.deepEqual(data.comparison, {
      totalIncome: 100, totalExpense: 200, currentIncome: 180, currentExpense: 70,
      previousCount: 4, currentCount: 3, previousEndExclusive: '2026-08-08',
    });
    assert.equal(data.period.elapsedDays, 7);
    const current = api.queries.find(q => q.sql.includes('"elapsedExpense"'));
    assert.deepEqual(current.params, ['2026-09-08', '2026-09-08', '2026-09-08', 'owner', '2026-09-01', '2026-10-01']);
    assert.match(current.sql, /type = 'income' AND transaction_date < \?/);
    assert.match(current.sql, /type = 'expense' AND transaction_date < \?/);
    assert.match(current.sql, /COUNT\(id\) FILTER \(WHERE transaction_date < \?\)/);
    const previous = api.queries.find(q => q.sql.includes('"totalIncome"') && !q.sql.includes('"elapsedExpense"'));
    assert.deepEqual(previous.params, ['owner', '2026-08-01', '2026-08-08']);
    assert.ok(api.queries.every(q => q.params.includes('owner') && /(?:t\.)?user_id = \?/.test(q.sql)), 'all aggregates retain account scope');
  });

  test('past periods retain complete comparisons and expose missing prior records separately from zero totals', async () => {
    const summary = { totalIncome: '200', totalExpense: '100', count: '5', elapsedIncome: '200', elapsedExpense: '100', elapsedCount: '5' };
    const api = route({ summary, previous: { totalIncome: '0', totalExpense: '0', count: '0' } });
    const { data } = await (await api.GET(request({ month: '2026-08', asOf: '2026-09-07' }))).json();
    assert.equal(data.comparison.currentIncome, data.summary.totalIncome);
    assert.equal(data.comparison.currentExpense, data.summary.totalExpense);
    assert.equal(data.comparison.currentCount, data.summary.count);
    assert.equal(data.comparison.previousCount, 0);
    assert.equal(data.comparison.previousEndExclusive, '2026-08-01');
    assert.equal(data.summary.futureCount, 0);
    assert.equal(data.dailyExpense, 100 / 31);

    const zero = route({ summary, previous: { totalIncome: '0', totalExpense: '0', count: '2' } });
    const { data: withZeroRecords } = await (await zero.GET(request({ month: '2026-08', asOf: '2026-09-07' }))).json();
    assert.equal(withZeroRecords.comparison.previousCount, 2);
    assert.equal(withZeroRecords.comparison.totalExpense, 0);
  });

  test('monthly daily trends fill missing leap-month days and preserve future-dated amounts', async () => {
    const api = route({ daily: [{ day: '1', income: '100', expense: '5' }, { day: '29', income: '0', expense: '40' }] });
    const { data } = await (await api.GET(request({ month: '2024-02', asOf: '2024-02-07' }))).json();
    assert.equal(data.dailyStats.length, 29);
    assert.deepEqual(data.dailyStats[0], { day: 1, income: 100, expense: 5 });
    assert.deepEqual(data.dailyStats[1], { day: 2, income: 0, expense: 0 });
    assert.deepEqual(data.dailyStats[28], { day: 29, income: 0, expense: 40 });
    assert.deepEqual(data.monthlyStats, []);
    const dailyQuery = api.queries.find(q => q.sql.includes('EXTRACT(DAY'));
    assert.deepEqual(dailyQuery.params, ['owner', '2024-02-01', '2024-03-01']);
  });

  test('yearly trends retain twelve complete months and share the year comparison cutoff', async () => {
    const api = route({ monthly: [{ month: '1', income: '100', expense: '5' }, { month: '12', income: '0', expense: '40' }] });
    const { data } = await (await api.GET(request({ year: '2024', asOf: '2024-12-30' }))).json();
    assert.equal(data.monthlyStats.length, 12);
    assert.deepEqual(data.monthlyStats[0], { month: 1, income: 100, expense: 5 });
    assert.deepEqual(data.monthlyStats[1], { month: 2, income: 0, expense: 0 });
    assert.deepEqual(data.monthlyStats[11], { month: 12, income: 0, expense: 40 });
    assert.deepEqual(data.dailyStats, []);
    assert.equal(data.comparison.previousEndExclusive, '2024-01-01');
    const monthlyQuery = api.queries.find(q => q.sql.includes('EXTRACT(MONTH'));
    assert.deepEqual(monthlyQuery.params, ['owner', '2024-01-01', '2025-01-01']);
  });

  test('future stats report unavailable comparison and daily average without removing recorded totals', async () => {
    const api = route({ summary: { totalIncome: '200', totalExpense: '100', count: '5', elapsedIncome: '0', elapsedExpense: '0', elapsedCount: '0' } });
    const { data } = await (await api.GET(request({ month: '2026-10', asOf: '2026-09-07' }))).json();
    assert.equal(data.dailyExpense, null);
    assert.equal(data.comparison, null);
    assert.equal(data.summary.totalExpense, 100);
    assert.equal(data.summary.futureCount, 5);
    assert.equal(data.dailyStats.length, 31);
  });

  test('invalid and unauthorized requests never query data', async () => {
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

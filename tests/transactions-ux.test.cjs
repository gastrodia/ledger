(async () => {
  const [{ default: assert }, { default: test }, { default: fs }, { default: vm }, { default: ts }, { NextResponse }] = await Promise.all([
    import('node:assert/strict'), import('node:test'), import('node:fs'), import('node:vm'), import('typescript'), import('next/server.js'),
  ]);
  const page = 'app/dashboard/page.tsx';
  function sourceNode(predicate) {
    const source = ts.createSourceFile(page, fs.readFileSync(page, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let result;
    function walk(node) {
      if (predicate(node, source)) { result = node; return; }
      if (!result) ts.forEachChild(node, walk);
    }
    walk(source);
    assert.ok(result, 'Expected implementation node');
    return result.getText(source);
  }
  function evaluate(code, bindings, returned) {
    const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return Function(...Object.keys(bindings), `${js};return ${returned};`)(...Object.values(bindings));
  }
  function getRoute(hasAny = true) {
    const queries = [];
    const source = ts.transpileModule(fs.readFileSync('app/api/transactions/route.ts', 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const dependencies = {
      'next/server': { NextResponse },
      '@/lib/auth': { getSession: async () => ({ userId: 'user-a' }) },
      '@/lib/attachments': {}, uuid: {},
      '@/lib/db': { sql: { query: async (sql, params) => {
        queries.push({ sql, params: [...params] });
        return sql.includes('has_any_transactions') ? [{ total_income: null, total_expense: null, has_any_transactions: hasAny }] : [];
      } } },
    };
    const exports = {};
    vm.runInNewContext(source, { exports, require: (id) => {
      assert.ok(id in dependencies, `Unexpected dependency ${id}`);
      return dependencies[id];
    }, console, Date });
    return { queries, GET: exports.GET };
  }

  test('legacy transaction drafts are removed without writing drafts or deleting other storage', () => {
    const call = sourceNode((node, source) => ts.isCallExpression(node)
      && node.expression.getText(source) === 'useEffect'
      && node.arguments[0].getText(source).includes('Remove legacy transaction drafts'));
    const data = new Map([
      ['ledger:draft:v1:user-a:transaction%3Anew', 'old'],
      ['ledger:draft:v1:user-b:transaction%3A123', 'old'],
      ['ledger:draft:v1:user-a:budget%3Anew', 'keep'],
      ['ledger:preferences', 'keep'],
    ]);
    evaluate(call, {
      useEffect: (effect) => effect(),
      window: { localStorage: {
        get length() { return data.size; },
        key: (index) => [...data.keys()][index],
        removeItem: (key) => data.delete(key),
        setItem: () => assert.fail('Transaction forms must not persist drafts'),
      } },
    }, 'undefined');
    assert.deepEqual([...data.keys()], ['ledger:draft:v1:user-a:budget%3Anew', 'ledger:preferences']);
  });

  test('keyword search uses the same parameterized literal matching in list and totals', async () => {
    const { GET, queries } = getRoute(true);
    const keyword = "50%_off\\cash' OR true --";
    const params = new URLSearchParams({ q: keyword, type: 'expense', memberId: 'member', categoryId: 'category', startDate: '2026-01-01', endDate: '2026-01-31' });
    const response = await GET({ nextUrl: { searchParams: params } });
    assert.equal(response.status, 200);
    assert.equal(queries.length, 2);
    for (const { sql, params } of queries) {
      assert.ok(sql.includes('STRPOS(LOWER(COALESCE(t.description'));
      assert.ok(!sql.includes(keyword));
      assert.equal(params.at(-1), keyword);
      assert.equal(params[0], 'user-a');
      assert.match(sql, /transaction_date < \(\$\d+::date \+ INTERVAL '1 day'\)/);
    }
    assert.deepEqual(queries[0].params, queries[1].params);
    const where = (sql) => sql.slice(sql.lastIndexOf('WHERE t.user_id')).split('ORDER BY')[0].trim();
    assert.equal(where(queries[0].sql), where(queries[1].sql));
    const result = await response.json();
    assert.deepEqual(result.data, []);
    assert.equal(result.hasAnyTransactions, true, 'An empty filtered month is not a new ledger');
    assert.deepEqual(result.summary, { totalIncome: 0, totalExpense: 0, balance: 0 });
  });

  test('only a confirmed whole-ledger absence returns the first-entry signal', async () => {
    const { GET } = getRoute(false);
    const response = await GET({ nextUrl: { searchParams: new URLSearchParams({ startDate: '2026-09-01' }) } });
    assert.equal((await response.json()).hasAnyTransactions, false);
    const condition = sourceNode((node, source) => ts.isBinaryExpression(node)
      && node.getText(source) === 'filteredTransactions.length === 0 && hasAnyTransactions === false');
    const isFirstEntry = Function('filteredTransactions', 'hasAnyTransactions', `return ${condition};`);
    assert.equal(isFirstEntry([], false), true);
    assert.equal(isFirstEntry([], true), false);
    assert.equal(isFirstEntry([], null), false);
    assert.equal(isFirstEntry([{}], false), false);
  });

  test('unclassified and unassigned drill-down sentinels apply IS NULL to list and totals', async () => {
    const { GET, queries } = getRoute();
    const response = await GET({ nextUrl: { searchParams: new URLSearchParams({ categoryId: 'none', memberId: 'none', type: 'expense' }) } });
    assert.equal(response.status, 200);
    for (const query of queries) {
      assert.match(query.sql, /t.category_id IS NULL/);
      assert.match(query.sql, /t.member_id IS NULL/);
      assert.deepEqual(query.params, ['user-a', 'expense']);
    }
  });

  test('reversed or invalid calendar dates return a clear 400 before SQL', async () => {
    for (const dates of [
      { startDate: '2026-09-20', endDate: '2026-09-01' },
      { startDate: '2026-02-30' },
      { endDate: 'not-a-date' },
    ]) {
      const { GET, queries } = getRoute();
      const response = await GET({ nextUrl: { searchParams: new URLSearchParams(dates) } });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /日期/);
      assert.equal(queries.length, 0);
    }
  });

  test('quick date ranges cross year and leap-month boundaries using local dates', () => {
    const helper = sourceNode((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'getTransactionDateRange');
    const ranges = evaluate(helper, {}, 'getTransactionDateRange');
    assert.deepEqual(ranges('lastMonth', new Date(2026, 0, 7, 12)), { start: '2025-12-01', end: '2025-12-31' });
    assert.deepEqual(ranges('lastMonth', new Date(2024, 2, 7, 12)), { start: '2024-02-01', end: '2024-02-29' });
    assert.deepEqual(ranges('today', new Date(2026, 8, 7, 12)), { start: '2026-09-07', end: '2026-09-07' });
    assert.deepEqual(ranges('month', new Date(2026, 8, 7, 12)), { start: '2026-09-01', end: '2026-09-30' });
  });

  test('incomplete date filters block reads and reset uses a bounded month in one update', () => {
    const guard = sourceNode((node) => ts.isVariableDeclaration(node) && node.name.getText() === 'dateRangeError');
    for (const [startDate, endDate] of [['', ''], ['2026-09-01', ''], ['', '2026-09-30'], ['2026-09-30', '2026-09-01']]) {
      assert.ok(evaluate(`const ${guard};`, { startDate, endDate }, 'dateRangeError'));
    }
    assert.equal(evaluate(`const ${guard};`, { startDate: '2026-09-01', endDate: '2026-09-30' }, 'dateRangeError'), null);
    const updates = [];
    const reset = sourceNode((node) => ts.isVariableDeclaration(node) && node.name.getText() === 'clearFilters');
    evaluate(`const ${reset};`, {
      navigation: { setFilters: (value) => updates.push(value) },
      getTransactionDateRange: (preset) => { assert.equal(preset, 'month'); return { start: '2026-09-01', end: '2026-09-30' }; },
    }, 'clearFilters')();
    assert.deepEqual(updates, [{ q: '', type: 'all', categoryId: '__all__', memberId: '__all__', startDate: '2026-09-01', endDate: '2026-09-30' }]);
  });

  test('a failed read has an independent retryable error and retry success clears it', async () => {
    const call = sourceNode((node, source) => ts.isCallExpression(node)
      && node.expression.getText(source) === 'useEffect'
      && node.arguments[0].getText(source).includes('/api/transactions?'));
    const state = { error: null, loaded: null, hasAny: null, data: null };
    let attempts = 0;
    const run = (key) => evaluate(call, {
      useEffect: (effect) => effect(), query: '', requestKey: key, dateRangeError: null,
      router: { push: () => assert.fail('unexpected navigation') }, AbortController,
      console: { error: () => {} },
      fetch: async () => ++attempts === 1
        ? { ok: false, json: async () => ({ error: '服务暂不可用' }) }
        : { ok: true, json: async () => ({ data: [], hasAnyTransactions: true, summary: {} }) },
      setLoadError: (error) => { state.error = error; },
      setHasAnyTransactions: (value) => { state.hasAny = value; },
      setLoadedQuery: (value) => { state.loaded = value; },
      setTransactions: (value) => { state.data = value; }, setSummary: () => {},
    }, 'undefined');
    run('first');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(state.error, { key: 'first', message: '服务暂不可用' });
    assert.equal(state.loaded, 'first');
    assert.equal(state.hasAny, null, 'Failure must not classify the account as new');
    run('retry');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.error, null);
    assert.equal(state.loaded, 'retry');
    assert.equal(state.hasAny, true);
    assert.deepEqual(state.data, []);
  });

  function submitHarness({ mode = 'add', ok = true, memberId = 'member', membersStatus = 'ready', categoryId = 'food' } = {}) {
    const code = sourceNode((node) => ts.isVariableDeclaration(node) && node.name.getText() === 'handleSubmit');
    const initial = { type: 'expense', category_id: categoryId, member_id: memberId, transaction_date: '2026-09-07', amount: '12.34', description: 'lunch' };
    const state = { value: initial, attachment: 'selected', refreshes: 0, closes: [], focus: 0, payload: null, errors: [] };
    const bindings = {
      needsCategory: evaluate(`const ${sourceNode((node) => ts.isVariableDeclaration(node) && node.name.getText() === 'needsCategory')};`,
        { categories: [{ id: 'food', type: 'expense' }], formData: initial }, 'needsCategory'),
      needsMember: evaluate(`const ${sourceNode((node) => ts.isVariableDeclaration(node) && node.name.getText() === 'needsMember')};`,
        { mode, membersStatus, members: [{ id: 'member' }], formData: initial }, 'needsMember'),
      mode, formData: initial, transaction: { id: 'transaction' }, attachment: null,
      removeExistingAttachment: false, submittingRef: { current: false },
      setIsSubmitting: () => {}, setIsUploading: () => {}, setUploadProgress: () => {},
      setFormData: (value) => { state.value = value; },
      setAttachment: (value) => { state.attachment = value; }, setRemoveExistingAttachment: () => {},
      attachmentRef: { current: { value: 'previous.pdf' } }, amountRef: { current: { focus: () => { state.focus++; } } },
      onSaved: () => { state.refreshes++; }, onClose: (value) => { state.closes.push(value); },
      toast: { success: () => {}, error: (error) => { state.errors.push(error); } },
      console: { error: () => {} },
      fetch: async (_url, options) => { state.payload = JSON.parse(options.body); return { ok, json: async () => ({ error: 'save failed' }) }; },
    };
    return { state, bindings, submit: evaluate(`const ${code};`, bindings, 'handleSubmit') };
  }

  test('new and edited entries require a valid category before saving', async () => {
    for (const mode of ['add', 'edit']) {
      for (const categoryId of ['', 'deleted']) {
        const { state, submit } = submitHarness({ mode, categoryId });
        await submit({ preventDefault() {} });
        assert.equal(state.payload, null);
        assert.deepEqual(state.errors, ['请选择有效的分类后再保存']);
      }
    }
  });

  test('new entries reject missing, stale, or unavailable members before any side effect', async () => {
    for (const options of [{ memberId: '' }, { memberId: 'deleted' }, { membersStatus: 'loading' }, { membersStatus: 'error' }]) {
      const { state, submit } = submitHarness(options);
      await submit({ preventDefault() {} });
      assert.equal(state.payload, null);
      assert.deepEqual(state.closes, []);
      assert.deepEqual(state.errors, ['请选择有效的家庭成员后再保存']);
    }
  });

  test('editing a historical entry still permits an unassigned member', async () => {
    const { state, submit } = submitHarness({ mode: 'edit', memberId: '' });
    await submit({ preventDefault() {}, nativeEvent: {} });
    assert.equal(state.payload.member_id, null);
    assert.deepEqual(state.closes, [true]);
  });

  test('both transaction dialog close events delegate to the shared close guard', async () => {
    for (const refName of ['addCloseRef', 'editCloseRef']) {
      const attribute = sourceNode((node, source) => ts.isJsxAttribute(node)
        && node.name.getText(source) === 'onOpenChange'
        && node.initializer?.getText(source).includes(`${refName}.current`));
      const expression = attribute.slice(attribute.indexOf('{') + 1, -1);
      let guarded = 0;
      const changes = [];
      const handler = evaluate(`const handler = ${expression};`, {
        [refName]: { current: async () => { guarded++; return false; } },
        setIsAddModalOpen: (open) => changes.push(open),
        setIsEditModalOpen: (open) => changes.push(open),
        setSelectedTransaction: () => assert.fail('Cancelling close must retain the edit record'),
      }, 'handler');
      handler(false);
      await Promise.resolve();
      assert.equal(guarded, 1);
      assert.deepEqual(changes, [], 'A declined confirmation must keep the dialog open');
      handler(true);
      assert.deepEqual(changes, [true]);
    }
  });

  test('save and continue clears one-entry fields but keeps reusable choices', async () => {
    const { state, bindings, submit } = submitHarness();
    await submit({ preventDefault() {}, nativeEvent: { submitter: { getAttribute: () => 'continue' } } });
    assert.deepEqual(state.value, { type: 'expense', category_id: 'food', member_id: 'member', transaction_date: '2026-09-07', amount: '', description: '' });
    assert.equal(state.attachment, null);
    assert.equal(bindings.attachmentRef.current.value, '');
    assert.equal(state.refreshes, 1);
    assert.deepEqual(state.closes, []);
    assert.equal(state.focus, 1);
    assert.equal(state.payload.amount, 12.34);
  });

  test('failed save retains form; normal save closes after success', async () => {
    const failed = submitHarness({ ok: false });
    await failed.submit({ preventDefault() {}, nativeEvent: { submitter: { getAttribute: () => 'continue' } } });
    assert.equal(failed.state.value.amount, '12.34');
    assert.equal(failed.state.refreshes, 0);
    assert.deepEqual(failed.state.closes, []);
    assert.deepEqual(failed.state.errors, ['save failed']);
    const saved = submitHarness();
    await saved.submit({ preventDefault() {}, nativeEvent: { submitter: { getAttribute: () => 'save' } } });
    assert.deepEqual(saved.state.closes, [true]);
  });
})().catch((error) => { console.error(error); process.exitCode = 1; });

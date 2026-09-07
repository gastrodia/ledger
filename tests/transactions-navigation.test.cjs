(async () => {
  const [{ default: test }, { default: assert }, { default: fs }, { default: vm }, { default: ts }] = await Promise.all([
    import('node:test'), import('node:assert/strict'), import('node:fs'), import('node:vm'), import('typescript'),
  ]);
  function load(file) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(code, { exports, URLSearchParams, Date, fetch: () => assert.fail('Unmocked fetch') });
    return exports;
  }
  const { TransactionNavigationSession, parseTransactionFilters, serializeTransactionFilters } = load('lib/transaction-navigation.ts');
  const { groupTransactionsByDay } = load('lib/transaction-days.ts');
  const defaults = { startDate: '2026-09-01', endDate: '2026-09-30', type: 'all', categoryId: '__all__', memberId: '__all__', q: '' };
  function memoryStorage() {
    const data = new Map();
    return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
  }
  const plain = (value) => JSON.parse(JSON.stringify(value));

  test('URL filters are complete drill-down state, preserving none and literal q=all', () => {
    const filters = parseTransactionFilters('startDate=2025-01-01&endDate=2025-12-31&type=expense&categoryId=none&memberId=none&q=all', defaults);
    assert.deepEqual(plain(filters), { startDate: '2025-01-01', endDate: '2025-12-31', type: 'expense', categoryId: 'none', memberId: 'none', q: 'all' });
    assert.match(serializeTransactionFilters(filters), /q=all/);
    const categoryOnly = parseTransactionFilters('categoryId=cat-a', defaults);
    assert.equal(categoryOnly.categoryId, 'cat-a');
    assert.equal(categoryOnly.startDate, defaults.startDate, 'Undated links must use a bounded default month');
    assert.equal(categoryOnly.endDate, defaults.endDate);
    assert.equal(categoryOnly.type, 'all');
  });

  test('returning restores account-owned filters and scroll only after the list is ready', () => {
    const storage = memoryStorage();
    const first = new TransactionNavigationSession(defaults);
    first.initialize('user-a', storage);
    first.finishScrollRestore();
    first.updateFilters({ ...defaults, q: 'lunch', type: 'expense' });
    first.saveScroll(640);
    const returned = new TransactionNavigationSession(defaults);
    returned.initialize('user-a', storage);
    assert.equal(returned.getSnapshot().filters.q, 'lunch');
    assert.equal(returned.getSnapshot().restoreScroll, 640);
    returned.saveScroll(0); // Initial short loading skeleton must not destroy saved position.
    assert.equal(returned.getSnapshot().restoreScroll, 640);
    returned.finishScrollRestore();
    returned.saveScroll(700);
    const later = new TransactionNavigationSession(defaults);
    later.initialize('user-a', storage);
    assert.equal(later.getSnapshot().restoreScroll, 700);
    const otherAccount = new TransactionNavigationSession(defaults);
    otherAccount.initialize('user-b', storage);
    assert.equal(otherAccount.getSnapshot().filters.q, '');
    assert.equal(otherAccount.getSnapshot().restoreScroll, 0);
  });

  test('explicit URL wins over storage and late identity resolution uses the latest URL', () => {
    const storage = memoryStorage();
    const previous = new TransactionNavigationSession(defaults);
    previous.initialize('user-a', storage); previous.finishScrollRestore();
    previous.updateFilters({ ...defaults, q: 'old', memberId: 'old-member' }); previous.saveScroll(900);
    const arrival = new TransactionNavigationSession(defaults);
    arrival.setLocation('type=expense&categoryId=food');
    arrival.setLocation('startDate=2026-02-01&endDate=2026-02-28&type=income&memberId=none');
    arrival.initialize('user-a', storage);
    const snapshot = arrival.getSnapshot();
    assert.equal(snapshot.filters.type, 'income');
    assert.equal(snapshot.filters.memberId, 'none');
    assert.equal(snapshot.filters.categoryId, '__all__');
    assert.equal(snapshot.filters.q, '');
    assert.equal(snapshot.filters.startDate, '2026-02-01');
    assert.equal(snapshot.restoreScroll, 0);
    arrival.updateFilters((current) => ({ ...current, q: 'new' }));
    const before = arrival.getSnapshot();
    arrival.setLocation(serializeTransactionFilters(before.filters));
    assert.equal(arrival.getSnapshot(), before, 'Own replaceState must not reapply restored filters');
    arrival.setLocation('');
    assert.equal(arrival.getSnapshot().filters.q, 'new', 'Returning through a bare ledger URL keeps the saved filters');
  });

  test('legacy unbounded filters restore the default month; logout invalidates delayed restoration', () => {
    const storage = memoryStorage();
    const first = new TransactionNavigationSession(defaults);
    first.initialize('user-a', storage); first.finishScrollRestore();
    first.updateFilters({ ...defaults, startDate: '', endDate: '' });
    const next = new TransactionNavigationSession(defaults);
    next.initialize('user-a', storage);
    assert.equal(next.getSnapshot().filters.startDate, defaults.startDate);
    assert.equal(next.getSnapshot().filters.endDate, defaults.endDate);
    next.stop();
    next.initialize('user-b', storage);
    next.updateFilters({ ...defaults, q: 'stale' });
    assert.equal(next.getSnapshot().ready, false);
    assert.equal(next.getSnapshot().filters.q, '');
    const unavailable = new TransactionNavigationSession(defaults);
    unavailable.initialize('user-a', { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
    unavailable.finishScrollRestore();
    unavailable.updateFilters({ ...defaults, q: 'still works' });
    assert.equal(unavailable.getSnapshot().filters.q, 'still works');
  });

  test('daily groups use the displayed local date, newest day first and cent-accurate subtotals', () => {
    const rows = [
      { id: 'a', transaction_date: new Date(2026, 8, 6, 9).toISOString(), type: 'expense', amount: 0.1 },
      { id: 'b', transaction_date: new Date(2026, 8, 7, 0).toISOString(), type: 'income', amount: 123.45 },
      { id: 'c', transaction_date: new Date(2026, 8, 6, 23).toISOString(), type: 'expense', amount: 0.2 },
      { id: 'd', transaction_date: new Date(2026, 8, 6, 12).toISOString(), type: 'income', amount: 3 },
    ];
    const groups = groupTransactionsByDay(rows);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].date, '2026-09-07');
    assert.equal(groups[0].income, 123.45);
    assert.equal(groups[1].expense, 0.3);
    assert.equal(groups[1].income, 3);
    assert.deepEqual(Array.from(groups[1].transactions, (row) => row.id), ['a', 'c', 'd']);
  });

})().catch((error) => { console.error(error); process.exitCode = 1; });

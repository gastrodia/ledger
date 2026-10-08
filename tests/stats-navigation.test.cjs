(async () => {
const [{ test }, { default: assert }, { default: fs }, { default: vm }, { default: ts }] = await Promise.all([
  import('node:test'), import('node:assert/strict'), import('node:fs'), import('node:vm'), import('typescript'),
]);
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/stats-navigation.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject, URLSearchParams });
const { readStatsNavigation, statsNavigationHref, stepStatsDate } = exportsObject;

test('period and selected month survive a URL round-trip and year/month changes', () => {
  const current = readStatsNavigation(new URLSearchParams('view=year&date=2025-12'), '2026-10-08');
  assert.equal(current.date, '2025-12');
  assert.equal(current.view, 'year');
  const monthView = { ...current, view: 'month' };
  const href = new URL(statsNavigationHref(monthView), 'https://ledger.test');
  const restored = readStatsNavigation(href.searchParams, '2027-01-01');
  assert.equal(restored.date, '2025-12');
  assert.equal(restored.view, 'month');
});

test('month/year stepping crosses boundaries and preserves month in annual mode', () => {
  assert.equal(stepStatsDate('2026-01', 'month', -1), '2025-12');
  assert.equal(stepStatsDate('2025-12', 'month', 1), '2026-01');
  assert.equal(stepStatsDate('2024-02', 'year', 1), '2025-02');
  assert.equal(stepStatsDate('0002-01', 'month', -1), null);
  assert.equal(stepStatsDate('9998-12', 'month', 1), null);
  assert.equal(stepStatsDate('2026-13', 'month', 1), null);
});

test('malformed URLs use a valid default without leaking arbitrary query values into controls', () => {
  for (const date of ['', '2025-13', '2025-1', '0000-01', '9999-12', '<script>']) {
    const result = readStatsNavigation(new URLSearchParams({ date, view: 'invalid', type: 'invalid', group: 'invalid' }), '2026-10-08');
    assert.equal(result.date, '2026-10');
    assert.equal(result.view, 'month');
  }
});

})();

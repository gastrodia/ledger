/* eslint-disable @typescript-eslint/no-require-imports -- node:test harness for pure TypeScript navigation rules. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const moduleExports = {};
const javascript = ts.transpileModule(fs.readFileSync('lib/dashboard-navigation.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
Function('exports', javascript)(moduleExports);
const { dashboardNavigationGroups, isDashboardRouteActive, getMobileNavigationSection } = moduleExports;

test('mobile navigation gives transaction, statistics, and secondary pages one stable active section', () => {
  for (const [path, section] of [
    ['/dashboard', 'transactions'],
    ['/dashboard/stats', 'stats'],
    ['/dashboard/stats/month', 'stats'],
    ['/dashboard/giftbooks', 'more'],
    ['/dashboard/giftbooks/book-1', 'more'],
    ['/dashboard/notes/new', 'more'],
    ['/dashboard/categories', 'more'],
    ['/dashboard/statsettings', 'more'],
  ]) assert.equal(getMobileNavigationSection(path), section);
});

test('sidebar active routes respect path boundaries and nested detail pages', () => {
  assert.equal(isDashboardRouteActive('/dashboard/notes/note-1', '/dashboard/notes'), true);
  assert.equal(isDashboardRouteActive('/dashboard/notes-old', '/dashboard/notes'), false);
  assert.equal(isDashboardRouteActive('/dashboard/stats', '/dashboard'), false);
  assert.equal(isDashboardRouteActive('/dashboard/giftbooks/book-1', '/dashboard/giftbooks'), true);
});

test('grouped navigation keeps all eight destinations and puts gifts and settings together', () => {
  const routes = dashboardNavigationGroups.flatMap(group => group.items.map(item => item.href));
  assert.equal(routes.length, 8);
  assert.equal(new Set(routes).size, 8);
  assert.deepEqual(dashboardNavigationGroups.find(group => group.label === '人情往来').items.map(item => item.href), [
    '/dashboard/giftbooks', '/dashboard/gifts-given',
  ]);
  assert.deepEqual(dashboardNavigationGroups.find(group => group.label === '设置').items.map(item => item.href), [
    '/dashboard/categories', '/dashboard/members',
  ]);
});

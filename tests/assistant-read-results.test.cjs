/* eslint-disable @typescript-eslint/no-require-imports -- real result projection and card rendering. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { withAssistantReadResults } = require('./helpers/assistant-contracts.cjs')('@/lib/assistant-read-results');
const plain = value => JSON.parse(JSON.stringify(value));
const view = { title: '资金流水统计', metrics: [], sections: [], notices: [] };
const plan = { action: 'chat', reply: '全部查询结果', drafts: [], query: null, reply_view: view };
const resources = ['loans', 'gifts_given', 'gift_records', 'notes'];
function checkpoint() {
  return {
    operations: resources.concat('transactions').map(id => ({ id, effect: 'read' })),
    tool_results: resources.map((resource, index) => ({ call_id: `read-${index}`, operation_id: resource, name: 'records', result: {
      reply: resource, record_context: { resource, rows: resource === 'gift_records' ? [] : [{ id: resource, title: '测试便利贴', content: '完整内容', counterparty_name: '测试对象', recipient_name: '测试送礼', direction: 'lent', subject_type: 'money', amount: 100, repaid_total: 40, cash_amount: 25 }] },
    } })).concat({ call_id: 'statistics', operation_id: 'transactions', name: 'query', result: { reply: '统计结果', reply_view: view } }),
  };
}

test('all database results survive the final statistical card, including empty results and stable read IDs', () => {
  const c = checkpoint();
  const result = withAssistantReadResults(plan, c);
  assert.equal(result.reply_view, undefined);
  assert.equal(result.read_results.length, 5);
  assert.deepEqual(plain(result.read_results.map(result => result.id)), ['read-0', 'read-1', 'read-2', 'read-3', 'statistics']);
  assert.equal(result.read_results[2].record_context.rows.length, 0);
  assert.equal(result.read_results[4].reply_view.title, view.title);
  assert.equal(withAssistantReadResults(result, c), result, 'projection is idempotent');
  assert.equal(plan.reply_view, view, 'stored plans are never mutated');
  const comparison = { ...view, kind: 'draft_matches' };
  assert.equal(withAssistantReadResults({ ...plan, reply_view: comparison }, c).reply_view, comparison, 'draft comparison controls retain their own card');
  assert.equal(withAssistantReadResults(plan, { ...c, awaiting_answer: true }), plan);
  assert.equal(withAssistantReadResults({ ...plan, action: 'record' }, c).read_results, undefined);
  c.operations[0].effect = 'write';
  assert.equal(withAssistantReadResults(plan, c).read_results.length, 4, 'verification reads for writes are not query results');
});

test('single query presentation stays intact and repeated query filters retain one authoritative result', () => {
  const c = checkpoint();
  c.tool_results = [c.tool_results.at(-1)];
  assert.equal(withAssistantReadResults(plan, c), plan);
  c.tool_results[0].result.filters = { start_date: '2026-10-01', end_date: '2026-10-31' };
  c.tool_results.push({ ...c.tool_results[0], call_id: 'newer', result: { ...c.tool_results[0].result, reply: '最新结果' } });
  c.tool_results.unshift(checkpoint().tool_results[0]);
  const result = withAssistantReadResults(plan, c);
  assert.equal(result.read_results.length, 2);
  assert.equal(result.read_results[1].id, 'newer');
});

function loadComponent(file, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, { exports, Date, JSON, Error, require: name => {
    if (!name.startsWith('@/')) return require(name);
    const base = name.slice(2);
    return loadComponent(fs.existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`, cache);
  } });
  return exports;
}

test('actual reply cards render every query and the empty gift result without falling back to hidden text', () => {
  const { AssistantReadResultCards } = loadComponent('components/assistant/read-result-cards.tsx');
  const result = withAssistantReadResults(plan, checkpoint());
  const html = renderToStaticMarkup(React.createElement(AssistantReadResultCards, { results: result.read_results, members: [], categories: [] }));
  assert.equal((html.match(/data-read-result-id=/g) || []).length, 5);
  for (const title of ['借还记录查询', '送礼记录查询', '收礼记录查询', '便利贴查询', '资金流水统计']) assert.ok(html.includes(title), title);
  assert.ok(html.includes('没有找到符合条件的收礼记录'));
  assert.ok(html.includes('完整内容'));
});

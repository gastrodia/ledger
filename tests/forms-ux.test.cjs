/* eslint-disable @typescript-eslint/no-require-imports -- node:test CommonJS harness for real TypeScript page and form functions. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');

const root = path.resolve(__dirname, '..');
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
function nodes(tree) {
  if (tree == null || typeof tree === 'boolean') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(text).join('');
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}
// Render the real page/form functions with deterministic hook state. No DOM,
// account, Blob or database calls are made; requests and draft storage are doubles.
function harness(file, { fetch: fetchImpl, upload, component, props = {}, confirm, guardDecision = true } = {}) {
  const slots = [];
  let cursor = 0;
  let pending = [];
  let draftConfig;
  let clears = 0;
  const route = { push() {} };
  let guardConfig;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(fn) { cursor++; return fn(); },
    useCallback(fn) { cursor++; return fn; },
    useEffect(fn, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        previous?.cleanup?.();
        slots[index] = { deps };
        pending.push(() => { slots[index].cleanup = fn(); });
      }
    },
  };
  const modules = {
    react,
    'react/jsx-runtime': jsx,
    'next/navigation': { useRouter: () => route, useParams: () => ({ id: 'book-1' }) },
    'next/link': { __esModule: true, default: 'Link' },
    '@/hooks/use-confirm': { useConfirm: () => ({ confirm: confirm || (async () => true) }) },
    '@/hooks/use-toast': { toast: { success() {}, error() {} } },
    '@/lib/utils': { formatCurrency: String, formatDate: value => String(value).slice(0, 10) },
    '@/lib/upload': { upload: upload || (async () => assert.fail('Unexpected upload')) },
    '@/hooks/use-form-leave-guard': { useFormLeaveGuard(config) {
      guardConfig = config;
      return { requestClose: async close => { if (config.isBusy || !guardDecision) return false; close(); return true; } };
    } },
    '@/hooks/use-form-draft': { useFormDraft(config) {
      draftConfig = config;
      return { hasDraft: false, status: 'ready', error: null, needsProtection: config.dirty, clear: () => { clears++; }, restore() {}, discard() {} };
    } },
  };
  const evaluatedModule = { exports: {} };
  const source = fs.readFileSync(path.join(root, file), 'utf8') + (component ? `\nexport { ${component} };` : '');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(compiled, {
    exports: evaluatedModule.exports, module: evaluatedModule, URLSearchParams,
    console: { error() {}, log() {} },
    fetch: fetchImpl || (async () => response({ data: [] })),
    require(name) {
      if (name in modules) return modules[name];
      if (name.startsWith('@/components/') || name === 'lucide-react') return new Proxy({}, { get: (_, key) => key });
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const View = evaluatedModule.exports[component || 'default'];
  let tree;
  return {
    render() { cursor = 0; tree = View({ registerCloseGuard: () => () => {}, ...props }); return tree; },
    async flush() {
      const effects = pending; pending = []; effects.forEach(fn => fn());
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
    },
    find(predicate) { const found = nodes(tree).find(predicate); assert.ok(found, 'Expected rendered element'); return found; },
    get text() { return text(tree); },
    get draft() { return draftConfig; },
    get clears() { return clears; },
    get guard() { return guardConfig; },
  };
}

for (const [page, emptyText] of [
  ['app/dashboard/giftbooks/page.tsx', '还没有礼簿'],
  ['app/dashboard/gifts-given/page.tsx', '还没有送礼记录'],
  ['app/dashboard/loans/page.tsx', '暂无未结清记录'],
  ['app/dashboard/giftbooks/[id]/page.tsx', '还没有礼簿记录'],
]) {
  test(`${page}: failure is distinct from empty data and can retry`, async () => {
    let fail = true;
    const h = harness(page, { fetch: async (url) => {
      if (fail) throw new Error('Network unavailable');
      if (String(url) === '/api/giftbooks/book-1') return response({ data: { name: 'Wedding' } });
      return response({ data: [] });
    } });
    h.render(); await h.flush(); h.render();
    assert.match(h.text, /重新加载/);
    assert.ok(!h.text.includes(emptyText));
    assert.ok(h.find(node => node.props?.role === 'alert'));
    fail = false;
    await h.find(node => typeof node.props?.onClick === 'function' && text(node) === '重新加载').props.onClick();
    await h.flush(); h.render();
    assert.ok(h.text.includes(emptyText));
    assert.ok(!h.text.includes('重新加载'));
  });
}

for (const [page, placeholder] of [
  ['app/dashboard/gifts-given/page.tsx', '收礼人 / 事由 / 备注'],
  ['app/dashboard/giftbooks/[id]/page.tsx', '按姓名/备注搜索'],
]) {
  test(`${page}: unmatched search offers clearing filters`, async () => {
    const requests = [];
    const h = harness(page, { fetch: async url => {
      requests.push(String(url));
      if (String(url) === '/api/giftbooks/book-1') return response({ data: { name: 'Wedding' } });
      return response({ data: [] });
    } });
    h.render(); await h.flush(); h.render();
    h.find(node => node.props?.placeholder === placeholder).props.onChange({ target: { value: 'No match' } });
    h.render(); await h.flush(); h.render();
    assert.match(h.text, /没有符合筛选条件/);
    assert.ok(requests.some(url => url.includes('q=No+match')));
    h.find(node => typeof node.props?.onClick === 'function' && text(node) === '清除筛选').props.onClick();
    h.render(); await h.flush(); h.render();
    assert.equal(h.find(node => node.props?.placeholder === placeholder).props.value, '');
    assert.doesNotMatch(h.text, /没有符合筛选条件/);
  });
}

test('a stale gift search response cannot replace the current query result', async () => {
  let finishOld;
  const h = harness('app/dashboard/gifts-given/page.tsx', { fetch: url => {
    if (String(url).includes('q=old')) return new Promise(resolve => { finishOld = resolve; });
    return Promise.resolve(response({ data: [] }));
  } });
  h.render(); await h.flush(); h.render();
  const search = () => h.find(node => node.props?.placeholder === '收礼人 / 事由 / 备注');
  search().props.onChange({ target: { value: 'old' } });
  h.render(); await h.flush(); h.render();
  search().props.onChange({ target: { value: 'new' } });
  h.render(); await h.flush(); h.render();
  finishOld(response({ data: [{ id: 'old', recipient_name: 'Stale recipient', gift_date: '2026-09-07', items_count: 0 }] }));
  await h.flush(); h.render();
  assert.doesNotMatch(h.text, /Stale recipient/);
  assert.match(h.text, /没有符合筛选条件/);
});

test('giftbook form retains failed input, restores a draft and clears only after success', async () => {
  let fail = true;
  let closed = false;
  const h = harness('app/dashboard/giftbooks/page.tsx', {
    component: 'CreateGiftBookModal', props: { enabled: true, onClose: () => { closed = true; } },
    fetch: async () => fail ? response({ error: 'Please retry' }, 500) : response({ data: { id: 'new' } }),
  });
  h.render();
  assert.equal(h.draft.scope, 'giftbooks:new');
  assert.equal(h.draft.dirty, false);
  h.draft.onRestore({ ...h.draft.value, name: 'Recovered wedding' });
  h.render();
  assert.equal(h.find(node => node.props?.id === 'gb-name').props.value, 'Recovered wedding');
  assert.equal(h.draft.dirty, true);
  await h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  h.render();
  assert.match(h.text, /Please retry/);
  assert.equal(h.find(node => node.props?.id === 'gb-name').props.value, 'Recovered wedding');
  assert.equal(h.clears, 0);
  assert.equal(closed, false);
  fail = false;
  await h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(h.clears, 1);
  assert.equal(closed, true);
});

test('closed and loading forms disable drafts; edit scopes include their entity', () => {
  const cases = [
    ['app/dashboard/giftbooks/page.tsx', 'CreateGiftBookModal', { enabled: false }, 'giftbooks:new'],
    ['app/dashboard/gifts-given/page.tsx', 'GiftsGivenModal', { enabled: false, mode: 'add', gift: null, loading: false }, 'gifts-given:new'],
    ['app/dashboard/giftbooks/[id]/page.tsx', 'GiftBookRecordModal', { enabled: true, giftbookId: 'b2', mode: 'edit', group: null, loading: true }, 'giftbook-records:b2:undefined'],
  ];
  for (const [page, component, props, scope] of cases) {
    const h = harness(page, { component, props: { ...props, onClose() {} } });
    h.render(); assert.equal(h.draft.enabled, false); assert.equal(h.draft.scope, scope);
  }
  const edit = harness('app/dashboard/gifts-given/page.tsx', {
    component: 'GiftsGivenModal', props: { enabled: true, mode: 'edit', gift: { id: 'gift-42', recipient_name: 'Friend', items: [] }, loading: false, onClose() {} },
  });
  edit.render(); assert.equal(edit.draft.scope, 'gifts-given:gift-42'); assert.equal(edit.draft.enabled, true);
});

test('loan upload shows SDK progress, keeps File outside drafts, and preserves input on failure', async () => {
  let finishUpload;
  const file = { name: 'receipt.pdf', type: 'application/pdf', size: 100 };
  const h = harness('app/dashboard/loans/page.tsx', {
    component: 'LoanModal', props: { mode: 'add', defaultDirection: 'lent', onClose() {} },
    upload: (_path, attachment, options) => {
      assert.equal(attachment, file);
      options.onUploadProgress({ percentage: 37 });
      return new Promise(resolve => { finishUpload = resolve; });
    },
    fetch: async () => response({ error: 'Could not save' }, 500),
  });
  h.render();
  h.draft.onRestore({ ...h.draft.value, counterparty_name: 'Friend', amount: '100' });
  h.render();
  h.find(node => node.props?.type === 'file').props.onChange({ target: { files: [file] } });
  h.render();
  assert.ok(!Object.values(h.draft.value).includes(file));
  assert.equal(h.draft.scope, 'loans:new:lent');
  const submit = h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await h.flush(); h.render();
  assert.equal(h.find(node => node.type === 'progress').props.value, 37);
  assert.match(h.text, /附件上传\s+37\s*%/);
  finishUpload({ url: 'https://example.invalid/receipt.pdf', contentType: file.type });
  await submit; h.render();
  assert.match(h.text, /Could not save/);
  assert.equal(h.find(node => node.props?.id === 'amount').props.value, '100');
  assert.equal(h.clears, 0);
  assert.match(h.text, /草稿不保存附件/);
});

const loanFixture = {
  id: 'loan-1', direction: 'lent', subject_type: 'money', counterparty_name: 'Friend',
  amount: 100, item_quantity: null, item_unit: null, occurred_at: '2026-09-07',
  repaid_amount_total: 70, repaid_quantity_total: 0, remaining_amount: 30,
  remaining_quantity: null, repayment_count: 2, status: 'partial',
};

test('loans default to unfinished records and preserve explicit all/settled views', async () => {
  const h = harness('app/dashboard/loans/page.tsx', { fetch: async () => response({ data: [
    { ...loanFixture, counterparty_name: 'Unfinished person' },
    { ...loanFixture, id: 'closed', status: 'settled', counterparty_name: 'Settled person', remaining_amount: 0 },
  ] }) });
  h.render(); await h.flush(); h.render();
  assert.match(h.text, /Unfinished person/);
  assert.doesNotMatch(h.text, /Settled person/);
  assert.match(h.text, /不自动进入收支统计/);
  h.find(node => node.props?.onClick && text(node).startsWith('全部（')).props.onClick();
  h.render(); assert.match(h.text, /Unfinished person/); assert.match(h.text, /Settled person/);
  h.find(node => node.props?.onClick && text(node).startsWith('已结清（')).props.onClick();
  h.render(); assert.doesNotMatch(h.text, /Unfinished person/); assert.match(h.text, /Settled person/);
});

test('money remaining shortcut uses exact cents and prevents overpayment before any request', async () => {
  let writes = 0;
  const h = harness('app/dashboard/loans/page.tsx', {
    component: 'RepaymentModal', props: { mode: 'add', loan: { ...loanFixture, amount: 0.3, repaid_amount_total: 0.1, remaining_amount: 0.2 }, onClose() {}, onPreviewAttachment() {} },
    fetch: async () => { writes++; return response({}); },
  });
  h.render();
  const input = () => h.find(node => node.props?.id === 'repayment-repaid_value');
  assert.equal(input().props.max, 0.2);
  h.find(node => node.props?.onClick && text(node) === '填入剩余金额').props.onClick();
  h.render(); assert.equal(input().props.value, '0.2');
  assert.match(h.text, /本次归还后剩余：\s*0 元/);
  input().props.onChange({ target: { value: '0.21' } }); h.render();
  assert.match(h.text, /超出可归还余额/);
  assert.equal(h.find(node => node.props?.type === 'submit').props.disabled, true);
  await h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(writes, 0); assert.equal(h.clears, 0);
});

test('editing a repayment excludes its old value before calculating the allowed balance', () => {
  const h = harness('app/dashboard/loans/page.tsx', {
    component: 'RepaymentModal', props: {
      mode: 'edit', loan: loanFixture,
      repayment: { id: 'r-1', repaid_at: '2026-09-07', repaid_amount: 40 },
      onClose() {}, onPreviewAttachment() {},
    },
  });
  h.render();
  const input = () => h.find(node => node.props?.id === 'edit-repayment-repaid_value');
  assert.equal(input().props.max, 70);
  assert.match(h.text, /本次归还后剩余：\s*30 元/);
  input().props.onChange({ target: { value: '50' } }); h.render();
  assert.match(h.text, /本次归还后剩余：\s*20 元/);
  h.find(node => node.props?.onClick && text(node) === '填入剩余金额').props.onClick();
  h.render(); assert.equal(input().props.value, '70'); assert.match(h.text, /本次归还后剩余：\s*0 元/);
});

test('item repayment preview honors thousandths and excludes the edited item quantity', () => {
  const h = harness('app/dashboard/loans/page.tsx', {
    component: 'RepaymentModal', props: {
      mode: 'edit', loan: { ...loanFixture, subject_type: 'item', item_quantity: 2.5, item_unit: '千克', repaid_quantity_total: 1.2, remaining_quantity: 1.3 },
      repayment: { id: 'r-2', repaid_at: '2026-09-07', repaid_quantity: 0.7 },
      onClose() {}, onPreviewAttachment() {},
    },
  });
  h.render();
  const input = () => h.find(node => node.props?.id === 'edit-repayment-repaid_value');
  assert.equal(input().props.max, 2);
  assert.match(h.text, /本次归还后剩余：\s*1.3千克/);
  input().props.onChange({ target: { value: '1.999' } }); h.render();
  assert.match(h.text, /本次归还后剩余：\s*0.001千克/);
  input().props.onChange({ target: { value: '2.001' } }); h.render(); assert.match(h.text, /超出可归还余额/);
});

test('deleting a giftbook states verified detail count and retains linked transactions', async () => {
  const prompts = [];
  const h = harness('app/dashboard/giftbooks/page.tsx', {
    fetch: async () => response({ data: [{ id: 'book-1', name: 'Wedding', summary: { recordCount: 7 } }] }),
    confirm: async prompt => { prompts.push(prompt); return false; },
  });
  h.render(); await h.flush(); h.render();
  await h.find(node => node.props?.['aria-label'] === '删除礼簿').props.onClick();
  assert.match(prompts[0].description, /7 条礼金\/礼品明细/);
  assert.match(prompts[0].description, /已关联收支会保留，仅解除关联/);
});

for (const available of [true, false]) {
  test(`missing giftbook count ${available ? 'is loaded before confirmation' : 'blocks deletion when it cannot be verified'}`, async () => {
    const prompts = [];
    let deletes = 0;
    const h = harness('app/dashboard/giftbooks/page.tsx', {
      fetch: async (url, options) => {
        if (options?.method === 'DELETE') { deletes++; return response({}); }
        if (url === '/api/giftbooks/book-1') return available ? response({ data: { summary: { recordCount: 4 } } }) : response({ error: 'unavailable' }, 500);
        return response({ data: [{ id: 'book-1', name: 'Wedding' }] });
      },
      confirm: async prompt => { prompts.push(prompt); return false; },
    });
    h.render(); await h.flush(); h.render();
    await h.find(node => node.props?.['aria-label'] === '删除礼簿').props.onClick();
    assert.equal(deletes, 0);
    if (available) assert.match(prompts[0].description, /4 条礼金\/礼品明细/);
    else assert.equal(prompts.length, 0);
  });
}

test('dialog close bridge delegates outside-close events and only cleans its own registration', () => {
  const h = harness('app/dashboard/loans/page.tsx', { component: 'useFormCloseBridge' });
  const bridge = h.render();
  let closed = 0;
  let blocked = 0;
  const removeOld = bridge.register(async () => { blocked++; return false; });
  bridge.close(() => { closed++; });
  assert.equal(closed, 0); assert.equal(blocked, 1);
  bridge.register(async close => { close(); return true; });
  removeOld();
  bridge.close(() => { closed++; });
  assert.equal(closed, 1);
});

test('form cancel uses the shared guard and selected files mark pending content', async () => {
  let closed = 0;
  const h = harness('app/dashboard/loans/page.tsx', {
    component: 'LoanModal', props: { mode: 'add', defaultDirection: 'lent', onClose: () => { closed++; } },
    guardDecision: false,
  });
  h.render();
  h.find(node => node.props?.type === 'file').props.onChange({ target: { files: [{ name: 'receipt.pdf', type: 'application/pdf', size: 1 }] } });
  h.render(); assert.equal(h.guard.hasPendingFiles, true);
  await h.find(node => node.props?.onClick && text(node) === '取消').props.onClick();
  assert.equal(closed, 0);
});

/* eslint-disable @typescript-eslint/no-require-imports -- This node:test harness intentionally runs as CommonJS. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function load(file, dependencies) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) {
    if (name.endsWith('.css')) return {};
    if (!(name in dependencies)) throw new Error(`Unmocked dependency ${name}`);
    return dependencies[name];
  }, console: { error() {} }, setTimeout });
  return exports;
}

const base = { user_id: 'user', giftbook_id: 'book', group_id: 'group', direction: 'received', counterparty_name: '小王', gift_date: '2026-09-07T04:00:00Z', notes: null, created_at: '2026-09-07', updated_at: '2026-09-07', unit: '件' };
const cash = { ...base, id: 'cash', gift_type: 'cash', amount: 100, currency: 'CNY', attachment_key: 'https://example.invalid/receipt.png', attachment_name: '收据', attachment_type: 'image/png' };
const item = { ...base, id: 'item', gift_type: 'item', item_name: '茶叶', quantity: 1, estimated_value: 10, attachment_key: null };
const payload = { counterparty_name: '小王', gift_date: base.gift_date, hasCash: false, hasItems: true, items: [{ id: item.id, item_name: item.item_name, quantity: 1, unit: '件', estimated_value: 10 }] };

function fixture(initial = []) {
  let rows = structuredClone(initial);
  let sequence = 0;
  let transactionCount = 0;
  let outsideWrites = 0;
  function execute(query, inTransaction = false) {
    const { text, values } = query;
    const valueOf = (token) => {
      token = token.trim();
      if (/^\$\d+$/.test(token)) return values[Number(token.slice(1)) - 1];
      if (token === 'NULL') return null;
      if (token === 'NOW()') return base.updated_at;
      if (token.startsWith("'")) return token.slice(1, -1);
      throw Error(`Unexpected SQL token ${token}`);
    };
    if (text.includes('FROM giftbooks')) return [{ id: 'book' }];
    if (/^\s*SELECT/.test(text)) return structuredClone(rows);
    if (!inTransaction) outsideWrites++;
    if (values.some((v) => typeof v === 'string' && v.length > 255)) throw Error('value too long for type character varying(255)');
    if (/^\s*DELETE/.test(text)) { rows = rows.filter((r) => r.id !== values[0]); return []; }
    if (/^\s*INSERT/.test(text)) {
      const match = text.match(/INSERT INTO gift_records\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]+?)\)\s*(?:RETURNING \*|$)/);
      const names = match[1].split(',').map((v) => v.trim());
      const vals = match[2].split(',').map(valueOf);
      const row = Object.fromEntries(names.map((name, i) => [name, vals[i]]));
      rows.push(row);
      return [structuredClone(row)];
    }
    if (/^\s*UPDATE/.test(text)) {
      const set = text.match(/\bSET\s+([\s\S]+?)\s+WHERE/)[1];
      const assignments = set.split(',').map((assignment) => {
        const match = assignment.match(/^\s*(\w+)\s*=\s*([\s\S]+)$/);
        return [match[1], valueOf(match[2])];
      });
      const idMatch = text.match(/WHERE id = (\$\d+)/);
      for (const row of rows) if (!idMatch || row.id === valueOf(idMatch[1])) Object.assign(row, Object.fromEntries(assignments));
      return [];
    }
    throw Error(`Unexpected SQL: ${text}`);
  }
  const sql = (strings, ...values) => {
    const query = { text: strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), ''), values };
    query.then = (resolve, reject) => Promise.resolve().then(() => execute(query)).then(resolve, reject);
    return query;
  };
  sql.transaction = async (queries) => {
    transactionCount++;
    const snapshot = structuredClone(rows);
    try { return queries.map((query) => execute(query, true)); }
    catch (error) { rows = snapshot; throw error; }
  };
  const dependencies = {
    'next/server': { NextResponse: { json: (body, init) => ({ status: init?.status || 200, body }) } },
    '@/lib/db': { sql },
    '@/lib/auth': { getSession: async () => ({ userId: 'user' }) },
    '@/lib/attachments': { validateAttachment: async () => null },
    '@/lib/giftbooks-schema': { ensureGiftBooksSchema: async () => {} },
    uuid: { v4: () => `new-${++sequence}` },
  };
  return {
    route: load('app/api/gift-record-groups/[id]/route.ts', dependencies),
    create: load('app/api/giftbooks/[id]/records/route.ts', dependencies),
    rows: () => structuredClone(rows),
    counts: () => ({ transactionCount, outsideWrites }),
  };
}
const request = (body) => ({ json: async () => body });
const context = (id = 'group') => ({ params: Promise.resolve({ id }) });

test('combined creation returns every record and runs writes in one transaction', async () => {
  const f = fixture();
  const response = await f.create.POST(request({ ...payload, hasCash: true, amount: 100, items: [...payload.items, { ...payload.items[0], item_name: '水果' }] }), context('book'));
  assert.equal(response.status, 201);
  assert.equal(response.body.data.length, 3);
  assert.equal(new Set(f.rows().map((r) => r.group_id)).size, 1);
  assert.deepEqual(f.counts(), { transactionCount: 1, outsideWrites: 0 });
});

test('later insert failure rolls back earlier cash insert', async () => {
  const f = fixture();
  const response = await f.create.POST(request({ ...payload, hasCash: true, amount: 100, items: [{ ...payload.items[0], item_name: '茶'.repeat(256) }] }), context('book'));
  assert.equal(response.status, 500);
  assert.equal(f.rows().length, 0);
  assert.deepEqual(f.counts(), { transactionCount: 1, outsideWrites: 0 });
});

test('later item failure rolls back deletion of existing cash and attachment', async () => {
  const f = fixture([cash, item]);
  const response = await f.route.PATCH(request({ ...payload, items: [{ ...payload.items[0], item_name: '茶'.repeat(256) }] }), context());
  assert.equal(response.status, 500);
  assert.deepEqual(f.rows(), [cash, item]);
  assert.deepEqual(f.counts(), { transactionCount: 1, outsideWrites: 0 });
});

test('removing cash migrates untouched attachment onto remaining item', async () => {
  const f = fixture([cash, item]);
  const response = await f.route.PATCH(request(payload), context());
  assert.equal(response.status, 200);
  assert.equal(response.body.data.attachment_key, cash.attachment_key);
  assert.equal(f.rows().length, 1);
  assert.equal(f.rows()[0].id, 'item');
  assert.equal(f.rows()[0].attachment_name, cash.attachment_name);
});

test('removing first item migrates attachment onto the next item', async () => {
  const first = { ...item, id: 'first', attachment_key: cash.attachment_key, attachment_name: cash.attachment_name };
  const f = fixture([first, item]);
  const response = await f.route.PATCH(request(payload), context());
  assert.equal(response.status, 200);
  assert.equal(response.body.data.attachment_key, cash.attachment_key);
  assert.equal(f.rows()[0].id, 'item');
});

test('explicit attachment removal survives row migration', async () => {
  const f = fixture([cash, item]);
  const response = await f.route.PATCH(request({ ...payload, attachment_key: null, attachment_name: null, attachment_type: null }), context());
  assert.equal(response.status, 200);
  assert.equal(response.body.data.attachment_key, null);
});

test('image completion appends to edits made while upload was pending', async () => {
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  let content = '原正文';
  const uploading = [];
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: { useMemo: (fn) => fn(), useRef: () => ({ current: null }), useSyncExternalStore: () => false, useState: (initial) => [initial, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/dynamic': { default: () => 'editor' },
    '@/lib/upload': { upload: () => pending },
    '@/components/ui/button': { Button: 'button' },
    'lucide-react': { Image: 'icon' },
    '@/hooks/use-toast': { toast: { error: assert.fail } },
    '@uiw/react-md-editor': { commands: { group: () => ({}) } },
  };
  const { NoteEditor } = load('components/notes/note-editor.tsx', dependencies);
  const tree = NoteEditor({ value: content, onUploadingChange: (value) => uploading.push(value), onChange: (next) => { content = typeof next === 'function' ? next(content) : next; } });
  const find = (node, type) => {
    if (node?.type === type) return node;
    for (const child of [node?.props?.children].flat()) { const found = child && find(child, type); if (found) return found; }
  };
  find(tree, 'input').props.onChange({ target: { files: [{ type: 'image/png', size: 10, name: 'test.png' }] }, currentTarget: { value: '' } });
  assert.deepEqual(uploading, [true]);
  content += '上传期间新增';
  complete({ url: 'https://example.invalid/image.png' });
  await new Promise(setImmediate);
  assert.equal(content, '原正文上传期间新增\n![](https://example.invalid/image.png)\n');
  assert.deepEqual(uploading, [true, false]);
});

test('editing a giftbook submits null for cleared optional fields', async () => {
  const filename = path.join(root, 'app/dashboard/giftbooks/page.tsx');
  const sourceFile = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'EditGiftBookModal');
  const source = ts.transpileModule(`${component.getText(sourceFile)}\nexports.EditGiftBookModal = EditGiftBookModal;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  let submitted;
  const jsx = (type, props) => ({ type, props });
  const controls = Object.fromEntries(['DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogBody', 'DialogFooter', 'Label', 'Input', 'Button'].map((name) => [name, name]));
  vm.runInNewContext(source, {
    exports, ...controls, DraftNotice: "DraftNotice", useFormDraft: () => ({ clear() {} }), useFormLeaveGuard: () => ({ requestClose: async close => { close(); return true; } }), useEffect() {}, require: () => ({ jsx, jsxs: jsx }),
    useState: (initial) => [initial && typeof initial === 'object' ? { name: '礼簿', event_type: '', event_date: '', location: '', description: '' } : initial, () => {}],
    fetch: async (_url, options) => { submitted = JSON.parse(options.body); return { ok: true }; },
    toast: { success() {}, error: assert.fail }, console,
  });
  const tree = exports.EditGiftBookModal({ giftbook: { id: 'book', name: '礼簿', event_type: '婚礼', event_date: '2026-09-07', location: '大厅', description: '备注' }, onClose() {} });
  const form = tree.props.children.find((child) => child.type === 'form');
  await form.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(submitted, { name: '礼簿', event_type: null, event_date: null, location: null, description: null });
});

test('narrow note editor defaults to a single edit pane and offers preview; desktop retains live view', () => {
  let narrow = true;
  let index = 0;
  const state = [];
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: {
      useMemo: (fn) => fn(), useRef: () => ({ current: null }), useSyncExternalStore: () => narrow,
      useState: (initial) => { const key = index++; if (!(key in state)) state[key] = initial; return [state[key], (value) => { state[key] = value; }]; },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/dynamic': { default: () => 'editor' },
    '@/lib/upload': { upload() {} },
    '@/components/ui/button': { Button: 'button' },
    'lucide-react': { Image: 'icon' },
    '@/hooks/use-toast': { toast: { error: assert.fail } },
    '@uiw/react-md-editor': { commands: { group: () => ({}) } },
  };
  const { NoteEditor } = load('components/notes/note-editor.tsx', dependencies);
  const render = () => { index = 0; return NoteEditor({ value: 'content', onChange() {} }); };
  const find = (node, predicate) => {
    if (predicate(node)) return node;
    for (const child of [node?.props?.children].flat()) { const found = child && find(child, predicate); if (found) return found; }
  };
  let tree = render();
  assert.equal(find(tree, (node) => node?.type === 'editor').props.preview, 'edit');
  find(tree, (node) => node?.type === 'button' && node.props.children === '预览').props.onClick();
  tree = render();
  assert.equal(find(tree, (node) => node?.type === 'editor').props.preview, 'preview');
  narrow = false;
  tree = render();
  assert.equal(find(tree, (node) => node?.type === 'editor').props.preview, 'live');
});

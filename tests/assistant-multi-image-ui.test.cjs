/* eslint-disable @typescript-eslint/no-require-imports -- isolated hooks exercise the real assistant page without a browser or account. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const jsx = require('react/jsx-runtime');

const root = path.resolve(__dirname, '..');
const category = { id: '00000000-0000-4000-8000-000000000001', name: '餐饮', type: 'expense' };
const member = { id: '00000000-0000-4000-8000-000000000002', name: '本人' };
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const image = name => ({ name, data: `data:image/jpeg;base64,${Buffer.from(name).toString('base64')}` });
const normalized = value => JSON.parse(JSON.stringify(value));
const response = (value, status = 200) => Response.json(value, { status });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree?.props?.['aria-hidden'] === 'true' || tree?.props?.['aria-hidden'] === true) return '';
  // The page's pure member label is a real child component rather than an icon
  // fixture; render it so assertions still exercise the displayed member name.
  if (typeof tree?.type === 'function' && tree.type.name === 'AssistantMemberLabel') return text(tree.type(tree.props));
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}

// State slots and effects run the actual TSX function. Network, storage identity,
// image decoding and canvas encoding are fixtures; no account or database exists.
function memoryStorage() {
  const entries = new Map(), writes = [];
  return {
    writes, get length() { return entries.size; }, key(index) { return [...entries.keys()][index] ?? null; },
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key, value) { writes.push({ key, value }); entries.set(key, value); },
    removeItem(key) { entries.delete(key); },
  };
}

function harness({ post, decode, taskStore = new Map(), persist = () => true, speechStart, realDraft = false, storage = memoryStorage() } = {}) {
  const slots = [], calls = [], notices = [], revoked = [], scrolls = [], blobs = new Map(), listeners = new Map();
  let cursor = 0, pending = [], layoutPending = [], tree, config, epoch = 0, logout, blobId = 0;
  const feed = { scrollHeight: 1600, clientHeight: 500, scrollTop: 0,
    scrollTo(options) { this.scrollTop = Math.max(0, options.top - this.clientHeight); scrolls.push(options); } };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
    useEffectEvent(fn) { const ref = react.useRef(fn); ref.current = fn; return (...args) => ref.current(...args); },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(fn, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        previous?.cleanup?.();
        slots[index] = { deps };
        pending.push(() => { slots[index].cleanup = fn(); });
      }
    },
    useLayoutEffect(fn, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        previous?.cleanup?.();
        slots[index] = { deps };
        layoutPending.push(() => { slots[index].cleanup = fn(); });
      }
    },
  };
  class FixtureImage {
    width = 1200; height = 2400; naturalWidth = 1200; naturalHeight = 2400;
    set src(value) { this.source = value; this.file = blobs.get(value); this.onload?.(); }
    async decode() { await decode?.(this.file); }
  }
  const globals = {
    exports: {}, module: {}, Date, JSON, URL: {
      createObjectURL(file) { const url = `blob:fixture-${++blobId}`; blobs.set(url, file); return url; },
      revokeObjectURL(url) { revoked.push(url); blobs.delete(url); },
    },
    Image: FixtureImage, navigator: { mediaDevices: { getUserMedia() {} } }, AudioContext: class {}, AudioWorkletNode: class {},
    window: { localStorage: storage, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {}, createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = { width: 0, height: 0, picture: null,
        getContext(kind) { assert.equal(kind, '2d'); return { fillRect() {}, drawImage(picture) { canvas.picture = picture; } }; },
        toDataURL() { return canvas.picture.file?.data || canvas.picture.source; },
      };
      return canvas;
    } },
    URLSearchParams, crypto, AbortController, AbortSignal, Error, DOMException, Response, ReadableStream, TextDecoder, TextEncoder, setInterval, clearInterval, queueMicrotask, setTimeout: (...args) => { const timer = setTimeout(...args); timer.unref(); return timer; }, clearTimeout,
    console: { error() {}, log() {} },
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : undefined;
      calls.push({ url, body, options });
      if (!options.method && url === '/api/auth/me') return response({ user: { id: uuid(900) } });
      if (!options.method && url === '/api/assistant') return response({ categories: [category], members: [member], configured: true });
      if (url.startsWith('/api/assistant/tasks')) {
        const id = url.split('/')[4]?.split('?')[0];
        if (!options.method) {
          if (id) return taskStore.has(id) ? response({ task: taskStore.get(id) }) : response({ error: '任务不存在' }, 404);
          const conversation = new URLSearchParams(url.split('?')[1]).get('conversation_id');
          return response({ tasks: [...taskStore.values()].filter(task => task.conversation_id === conversation).map(task => ({ ...task, input: undefined })) });
        }
        if (options.method === 'DELETE') {
          for (const [key, task] of taskStore) if (['running', 'queued'].includes(task.status)) taskStore.set(key, { ...task, status: 'cancelled' });
          return response({ cancelled: true });
        }
        if (options.method === 'PATCH') {
          const task = taskStore.get(id);
          assert.ok(task, 'Only a server-accepted task can be retried or cancelled');
          assert.equal(body.attempt, task.attempt);
          const next = body.action === 'cancel' ? { ...task, status: 'cancelled', error: '已停止处理，可以重新识别。' }
            : { ...task, status: 'running', error: null, text: '', result: null, attempt: task.attempt + 1 };
          taskStore.set(id, next);
          return response({ task: next });
        }
        const supplied = post ? await post(url, body, options) : response({ status: 'running' });
        if (!supplied.ok) return supplied;
        const value = await supplied.json();
        const task = value.task || { id: body.id, user_message_id: body.user_message_id, conversation_id: body.conversation_id,
          status: value.action ? 'succeeded' : value.status || 'running', phase: body.images?.length ? 'images' : 'thinking',
          text: '', result: value.action ? value : null, error: null, attempt: 1, created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z',
          input: { message: body.message, display_text: body.display_text, display_images: body.display_images || [] }, request: body };
        taskStore.set(task.id, task);
        return response({ task });
      }
      if (post) return post(url, body, options);
      assert.fail(`Unexpected request: ${url}`);
    },
  };
  const modules = {
    react, 'react/jsx-runtime': jsx,
    'next/link': { __esModule: true, default: 'Link' },
    'next/image': { __esModule: true, default: 'Image' },
    'react-markdown': { __esModule: true, default: 'Markdown' },
    'remark-gfm': { __esModule: true, default: () => {} },
    'rehype-sanitize': { __esModule: true, default: () => {} },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/lib/form-drafts': { getDraftEpoch: () => epoch, subscribeDraftLogout(fn) { logout = fn; return () => { logout = undefined; }; } },
    '@/hooks/use-toast': { toast: Object.fromEntries(['error', 'info', 'success'].map(kind => [kind, value => notices.push({ kind, value })])) },
    '@/hooks/use-form-draft': { useFormDraft(next) {
      config = next;
      return { hasDraft: false, status: 'ready', error: null, persist(value) { if (!persist(value)) return false; config.value = value; return true; }, clear(replacement) {
        config.value = typeof replacement === 'function' ? replacement(config.value) : replacement;
      } };
    } },
  };
  if (speechStart) modules['@/lib/assistant-speech'] = { startSpeechRecording: speechStart };
  function load(filename) {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(source, { ...globals, exports, require(name) {
      if (name in modules) return modules[name];
      if (name.startsWith('@/components/') || name === 'lucide-react') return new Proxy({}, { get: (_, key) => key });
      if (name.startsWith('@/lib/')) return modules[name] = load(`${name.slice(2)}.ts`);
      throw Error(`Unexpected import: ${name}`);
    } });
    return exports;
  }
  if (realDraft) {
    delete modules['@/lib/form-drafts'];
    const { useFormDraft } = load('hooks/use-form-draft.ts');
    modules['@/hooks/use-form-draft'] = { useFormDraft(next) { config = next; return useFormDraft(next); } };
  }
  modules['@/components/ui/draft-notice'] = load('components/ui/draft-notice.tsx');
  const Page = load('app/dashboard/assistant/page.tsx').default;
  const h = {
    calls, notices, revoked, taskStore, storage, feed, scrolls,
    async poll() { listeners.get("focus")?.(); await h.flush(); },
    patchTask(update) { const current = [...taskStore.values()].at(-1); assert.ok(current); taskStore.set(current.id, { ...current, ...update, updated_at: new Date(Date.parse(current.updated_at) + 1000).toISOString() }); },
    render() {
      cursor = 0; tree = Page();
      nodes(tree).find(node => node.props?.['aria-live'] === 'polite').props.ref.current = feed;
      const effects = layoutPending; layoutPending = []; effects.forEach(fn => fn());
      return tree;
    },
    scrollFeed(top) { feed.scrollTop = top; h.find(node => node.props?.['aria-live'] === 'polite').props.onScroll({ currentTarget: feed }); },
    draftNotice() { const node = h.find(node => node.type?.name === 'DraftNotice'); return node.type(node.props); },
    async flush() {
      const effects = pending; pending = []; effects.forEach(fn => fn());
      // Handler wrappers intentionally return void; drain their promise chain.
      for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
      h.render();
    },
    find(predicate) { const found = nodes(tree).find(predicate); assert.ok(found, 'Expected rendered element'); return found; },
    all(predicate) { return nodes(tree).filter(predicate); },
    control(label) { return h.find(node => node.props?.['aria-label'] === label); },
    click(label) { const button = h.control(label); assert.equal(!!button.props.disabled, false, `${label} is available`); button.props.onClick(); h.render(); },
    restore(value) { const restored = config.onRestore(value); h.render(); return normalized(restored); },
    choose(files) { const input = h.control('选择账单截图'); assert.equal(input.props.multiple, true); const target = { files, value: 'selected' }; input.props.onChange({ target }); assert.equal(target.value, ''); h.render(); },
    paste(files) { let prevented = false; h.control('记一笔，或问问账本').props.onPaste({ clipboardData: { items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })), files }, preventDefault() { prevented = true; } }); h.render(); return prevented; },
    logout() { epoch++; logout?.(); h.render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    get value() { return normalized(config.value); },
    get text() { return text(tree); },
  };
  h.render();
  return h;
}
async function ready(options) { const h = harness(options); for (let i = 0; i < (options?.realDraft ? 6 : 3); i++) await h.flush(); return h; }
function file(name) { return { ...image(name), type: 'image/jpeg', size: 1000 }; }
function row(n, amount, memberId = null) { return { id: uuid(n), type: 'expense', amount_cents: amount, category_id: category.id, member_id: memberId,
  transaction_date: '2026-10-03', description: `交易${n}`, payment_method: '微信', note: '' }; }
const summary = { image_count: 2, extracted_count: 3, removed_duplicates: 1, retained_count: 2, review_required: false, warnings: [] };
const record = { action: 'record', reply: '请核对账目', drafts: [row(10, 600), row(11, 1200)], query: null, update: null, import_summary: summary };

test('assistant UI migrates legacy images and restores ordered multi-image composer and messages', async () => {
  const h = await ready();
  const a = image('旧截图'), b = image('后一张');
  const legacy = h.restore({ messages: [{ id: uuid(9), role: 'user', text: '旧消息', image: a }], input: '说明', image: a });
  assert.deepEqual(legacy.images, [a]);
  assert.deepEqual(legacy.messages[0].images, [a]);
  assert.equal(legacy.messages[0].image, undefined);
  h.restore({ messages: [{ id: uuid(9), role: 'user', text: '两张', images: [b, a] }], input: '', images: [a, b] });
  assert.deepEqual(h.value.images, [a, b]);
  assert.deepEqual(h.value.messages[0].images, [b, a]);
  assert.equal(h.all(node => /^查看第 \d 张图片/.test(node.props?.['aria-label'] || '')).length, 2);
  h.restore({ messages: [], input: '', images: [{ ...a, data: 'https://private.invalid/image' }], image: a });
  assert.deepEqual(h.value.images, []);
  h.unmount();
});

test('assistant UI connects gallery preview, reorder and removal without dropping companion images', async () => {
  const h = await ready(), a = image('一'), b = image('二'), c = image('三');
  h.restore({ messages: [], input: '', images: [a, b, c] });
  const gallery = () => h.find(node => node.type === 'SortableAssistantImages');
  gallery().props.onPreview(b); h.render();
  assert.equal(h.find(node => node.type === 'Dialog').props.open, true);
  assert.ok(h.all(node => node.type === 'Image').some(node => node.props.src === b.data && node.props.width === 1600));
  gallery().props.onReorder([a, c, b]); h.render();
  assert.deepEqual(h.value.images, [a, c, b]);
  gallery().props.onReorder([c, a, b]); h.render();
  assert.deepEqual(h.value.images, [c, a, b]);
  gallery().props.onRemove(a); h.render();
  assert.deepEqual(h.value.images, [c, b]);
  h.unmount();
});

test('assistant UI appends file batches atomically, retains earlier images on failure and pastes multiple images', async () => {
  const h = await ready({ decode: async chosen => { if (chosen.name === '损坏') throw Error('损坏图片'); } });
  const original = image('已选'), a = file('新一'), b = file('新二');
  h.restore({ messages: [], input: '', images: [original] });
  h.choose([a, b]); await h.flush();
  assert.deepEqual(h.value.images, [original, image('新一'), image('新二')]);
  h.choose([file('可解码'), file('损坏')]); await h.flush();
  assert.deepEqual(h.value.images, [original, image('新一'), image('新二')]);
  assert.ok(h.notices.some(notice => notice.kind === 'error' && /损坏/.test(notice.value)));
  assert.equal(h.paste([file('粘贴一'), file('粘贴二')]), true); await h.flush();
  assert.deepEqual(h.value.images.map(value => value.name), ['已选', '新一', '新二', '粘贴一', '粘贴二']);
  h.choose([file('超限')]); await h.flush();
  assert.equal(h.value.images.length, 5);
  assert.ok(h.notices.some(notice => /最多选择 5 张/.test(notice.value)));
  assert.equal(h.revoked.length, 6);
  h.unmount();
});

test('assistant UI sends image order once, displays merge results and waits for member choice and explicit confirmation', async () => {
  const h = await ready({ post: async (url, body) => {
    assert.equal(url, body.operation === 'select_member' ? '/api/assistant' : '/api/assistant/tasks');
    return body.operation === 'select_member' ? response({ draft_id: body.draft_id, member }) : response(record);
  } });
  const a = image('第二'), b = image('第一');
  h.restore({ messages: [], input: '', images: [a, b] });
  h.click('发送'); await h.flush();
  const requests = h.calls.filter(call => call.body);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body.images, [a.data, b.data]);
  assert.equal(requests[0].body.image, undefined);
  assert.deepEqual(h.value.images, []);
  assert.deepEqual(h.value.messages[0].images, [a, b]);
  assert.equal(h.all(node => node.props?.['aria-label'] === '已发送的截图').length, 1);
  assert.match(h.text, /已联合识别 2 张截图，衔接去重 1 笔，保留 2 笔/);
  const before = h.value.messages.find(message => message.drafts)?.drafts;
  const chooser = h.control('选择记账成员');
  nodes(chooser).find(node => node.type === 'Button' && text(node) === member.name).props.onClick();
  await h.flush();
  const after = h.value.messages.find(message => message.drafts)?.drafts;
  assert.deepEqual(after.map(draft => ({ ...draft, member_id: null })), before);
  assert.ok(after.every(draft => draft.member_id === member.id));
  assert.equal(h.calls.filter(call => call.body?.operation === 'select_member').length, 1);
  assert.equal(h.calls.filter(call => call.url === '/api/assistant/confirm').length, 0);
  assert.ok(h.all(node => node.type === 'Button').some(node => text(node) === '确认 2 笔'));
  h.unmount();
});

test('assistant UI keeps the original caption and every image in its retry outbox after submission failure', async () => {
  const h = await ready({ post: async () => response({ error: '模型暂时不可用' }, 503) });
  const a = image('甲'), b = image('乙');
  h.restore({ messages: [], input: ' 按这两张识别 ', images: [a, b] });
  h.click('发送'); await h.flush();
  assert.equal(h.value.outbox.message, '按这两张识别');
  assert.deepEqual(h.value.outbox.images, [a.data, b.data]);
  assert.equal(h.value.messages[0].taskStatus, 'missing');
  assert.match(h.text, /未发送完成|模型暂时不可用/);
  assert.equal(h.control('发送').props.disabled, true, 'A second send cannot replace an unresolved original upload');
  clickTextButton(h, '重试发送'); await h.flush();
  const requests = h.calls.filter(call => call.options.method === 'POST');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].body, requests[0].body, 'Retry preserves the original ID and full images');
  h.unmount();
});

test('screenshot caveats and zero omission stay visible while choosing a member and after restoration', async () => {
  for (const mode of ['model-skipped', 'server-skipped', 'member-specified']) {
    const serverSkippedZero = mode === 'server-skipped';
    const result = { ...record, reply: '已跳过零金额订单；截图年份需要核对。',
      drafts: mode === 'member-specified' ? record.drafts.map(draft => ({ ...draft, member_id: member.id })) : record.drafts,
      import_summary: serverSkippedZero ? { image_count: 1, extracted_count: 3, removed_duplicates: 0,
        skipped_zero_amounts: 1, retained_count: 2, review_required: true, warnings: [] } : undefined };
    const h = await ready({ post: async (_url, body) => body.operation === 'select_member'
      ? response({ draft_id: body.draft_id, member }) : response(result) });
    h.restore({ messages: [], input: '', images: [image('含零金额的截图')] });
    h.click('发送'); await h.flush();
    assert.match(h.text, /已跳过零金额订单；截图年份需要核对/);
    if (mode !== 'member-specified') assert.match(h.text, /这 2 笔支出的支出人是谁/);
    if (serverSkippedZero) assert.match(h.text, /已识别 1 张截图，跳过 1 行零金额，保留 2 笔/);
    h.restore(h.value);
    assert.match(h.text, /已跳过零金额订单；截图年份需要核对/);
    if (mode !== 'member-specified') {
      const chooser = h.control('选择记账成员');
      nodes(chooser).find(node => node.type === 'Button' && text(node) === member.name).props.onClick();
      await h.flush();
    }
    assert.match(h.text, /已跳过零金额订单；截图年份需要核对/);
    h.all(node => node.props?.['aria-label'] === '删除这笔草稿')[0].props.onClick(); h.render();
    assert.match(h.text, /已跳过零金额订单；截图年份需要核对/);
    assert.ok(h.all(node => node.type === 'Button').some(node => text(node) === '确认 1 笔'));
    h.restore(h.value);
    assert.match(h.text, /已跳过零金额订单；截图年份需要核对/);
    assert.equal(h.calls.filter(call => call.url === '/api/assistant/confirm').length, 0);
    h.unmount();
  }
});

test('clearing assistant UI aborts recognition and prevents a late response from restoring images or drafts', async () => {
  const wait = deferred();
  const h = await ready({ post: () => wait.promise });
  h.restore({ messages: [], input: '', images: [image('甲'), image('乙')] });
  h.click('发送'); await h.flush();
  const call = h.calls.find(item => item.body?.images);
  assert.ok(call);
  h.click('清空对话');
  assert.equal(call.options.signal.aborted, true);
  wait.resolve(response(record)); await h.flush();
  assert.deepEqual(h.value.images, []);
  assert.deepEqual(h.value.messages, []);
  assert.equal(h.value.input, '');
  assert.equal(h.control('发送').props.disabled, true);
  h.unmount();
});

test('clearing or logging out during image decoding prevents late batch append and releases object URLs', async () => {
  for (const stop of ['clear', 'logout', 'unmount']) {
    const wait = deferred();
    const h = await ready({ decode: () => wait.promise });
    h.restore({ messages: [], input: '', images: [image('原图')] });
    h.choose([file('未完成一'), file('未完成二')]);
    await h.flush();
    if (stop === 'clear') h.click('清空对话');
    else h[stop]();
    wait.resolve(); await h.flush();
    assert.deepEqual(h.value.images, stop === 'unmount' ? [image('原图')] : []);
    assert.equal(h.revoked.length, 1);
    assert.equal(h.calls.filter(call => call.body).length, 0);
    h.unmount();
  }
});

function datedDraft(n, date, memberId = member.id) {
  return { ...row(n, n * 100, memberId), transaction_date: date, amount: `${n}.00` };
}
function draftGroup(id, drafts, extra = {}) {
  return { id: uuid(id), role: 'assistant', text: '请核对账目。', drafts, status: 'pending', ...extra };
}
function visibleDraftNames(h) { return h.all(node => node.type === 'summary').map(node => text(node).match(/交易\d+/)?.[0]); }
function sortGroup(h, index = 0) {
  const button = h.all(node => /^账目排序：/.test(node.props?.['aria-label'] || ''))[index];
  assert.ok(button, 'The group has a sort control');
  assert.equal(!!button.props.disabled, false);
  button.props.onClick(); h.render();
}
function clickTextButton(h, caption) {
  const button = h.find(node => node.type === 'Button' && text(node) === caption);
  assert.equal(!!button.props.disabled, false);
  button.props.onClick(); h.render();
}

test('draft date sort cycles stably, survives restore, and keeps group order after editing and deleting', async () => {
  const h = await ready();
  const drafts = [datedDraft(10, '2026-10-08'), datedDraft(11, '2026-10-01'), datedDraft(12, '2026-10-01'), datedDraft(13, '2026-10-03'), datedDraft(14, '')];
  h.restore({ messages: [draftGroup(90, drafts)], input: '' });
  assert.deepEqual(visibleDraftNames(h), ['交易10', '交易11', '交易12', '交易13', '交易14']);
  sortGroup(h);
  assert.deepEqual(visibleDraftNames(h), ['交易11', '交易12', '交易13', '交易10', '交易14']);
  assert.equal(h.value.messages[0].draftSort, 'date-asc');
  assert.deepEqual(h.value.messages[0].drafts, drafts);
  h.restore(h.value);
  assert.deepEqual(visibleDraftNames(h), ['交易11', '交易12', '交易13', '交易10', '交易14']);
  sortGroup(h);
  assert.deepEqual(visibleDraftNames(h), ['交易10', '交易13', '交易11', '交易12', '交易14']);
  sortGroup(h);
  assert.deepEqual(visibleDraftNames(h), ['交易10', '交易11', '交易12', '交易13', '交易14']);
  sortGroup(h);
  h.find(node => node.props?.id === `${uuid(11)}-date`).props.onChange({ target: { value: '2026-10-09' } }); h.render();
  assert.deepEqual(visibleDraftNames(h), ['交易12', '交易13', '交易10', '交易11', '交易14']);
  const container = h.find(node => node.type === 'div' && node.props.className === 'relative border-b border-border'
    && nodes(node).some(child => child.props?.id === `${uuid(12)}-date`));
  nodes(container).find(node => node.props?.['aria-label'] === '删除这笔草稿').props.onClick(); h.render();
  sortGroup(h); sortGroup(h);
  assert.deepEqual(visibleDraftNames(h), ['交易10', '交易11', '交易13', '交易14']);
  assert.deepEqual(h.value.messages[0].drafts.map(draft => draft.id), [uuid(10), uuid(11), uuid(13), uuid(14)]);
  assert.equal(h.value.messages[0].drafts[1].transaction_date, '2026-10-09');
  assert.equal(h.calls.filter(call => call.body).length, 0);
  const restored = h.restore({ messages: [draftGroup(90, drafts, { draftSort: 'corrupt' }), draftGroup(91, [drafts[0], drafts[1]])], input: '' });
  assert.equal(restored.messages[0].draftSort, 'original');
  sortGroup(h, 0);
  assert.equal(h.value.messages[0].draftSort, 'date-asc');
  assert.equal(h.value.messages[1].draftSort, 'original');
  assert.deepEqual(visibleDraftNames(h), ['交易11', '交易12', '交易13', '交易10', '交易14', '交易10', '交易11']);
  h.unmount();
});

test('draft date sort supplies displayed ordinal context and applies member selection to the displayed third row', async () => {
  const drafts = [datedDraft(20, '2026-10-08'), datedDraft(21, '2026-10-01'), datedDraft(22, '2026-10-01'), datedDraft(23, '2026-10-03', null)];
  const h = await ready({ post: async (url, body) => {
    assert.equal(url, body.operation === 'select_member' ? '/api/assistant' : '/api/assistant/tasks');
    if (body.operation === 'select_member') {
      assert.equal(body.draft_id, uuid(23));
      return response({ draft_id: body.draft_id, member });
    }
    assert.equal(body.message, '把第三笔的支出人重新选择');
    assert.deepEqual(body.draft_batch.drafts.map(draft => draft.id), [uuid(21), uuid(22), uuid(23), uuid(20)]);
    const serializedRows = JSON.parse(body.history[0].content.split('\n').at(-1));
    assert.deepEqual(serializedRows.map(draft => draft.description), ['交易21', '交易22', '交易23', '交易20']);
    return response({ action: 'update', reply: '请选择这笔账目的支出人。', drafts: [], query: null,
      update: { batch_id: uuid(92), draft_ids: [body.draft_batch.drafts[2].id], member_id: null } });
  } });
  h.restore({ messages: [draftGroup(92, drafts, { draftSort: 'date-asc' })], input: '把第三笔的支出人重新选择' });
  assert.deepEqual(visibleDraftNames(h), ['交易21', '交易22', '交易23', '交易20']);
  h.click('发送'); await h.flush();
  const chooser = h.control('修改记账成员');
  assert.match(text(chooser), /交易23/);
  nodes(chooser).find(node => node.type === 'Button' && text(node) === member.name).props.onClick(); await h.flush();
  const group = h.value.messages.find(message => message.id === uuid(92));
  assert.deepEqual(group.drafts.map(draft => draft.id), drafts.map(draft => draft.id));
  assert.deepEqual(group.drafts, drafts.map(draft => draft.id === uuid(23) ? { ...draft, member_id: member.id } : draft));
  assert.equal(group.draftSort, 'date-asc');
  assert.deepEqual(visibleDraftNames(h), ['交易21', '交易22', '交易23', '交易20']);
  assert.equal(h.calls.filter(call => call.body).length, 2);
  assert.equal(h.calls.filter(call => call.url === '/api/assistant/confirm').length, 0);
  h.unmount();
});

test('draft date sort preserves the original confirmation batch and exact payload across failure and retry', async () => {
  const drafts = [datedDraft(30, '2026-10-08'), datedDraft(31, '2026-10-01'), datedDraft(32, '2026-10-03')];
  let attempts = 0;
  const h = await ready({ post: async (url, body) => {
    assert.equal(url, '/api/assistant/confirm');
    assert.equal(body.batch_id, uuid(93));
    if (++attempts === 1) throw Error('connection lost');
    return response({ count: 3, replayed: true });
  } });
  h.restore({ messages: [draftGroup(93, drafts)], input: '' });
  sortGroup(h);
  assert.deepEqual(visibleDraftNames(h), ['交易31', '交易32', '交易30']);
  clickTextButton(h, '确认 3 笔'); await h.flush();
  const first = h.calls.find(call => call.url === '/api/assistant/confirm').body;
  assert.deepEqual(first.drafts.map(draft => draft.id), [uuid(30), uuid(31), uuid(32)]);
  assert.deepEqual(h.value.messages[0].commit, first.drafts);
  sortGroup(h);
  assert.deepEqual(visibleDraftNames(h), ['交易30', '交易32', '交易31']);
  assert.deepEqual(h.value.messages[0].commit, first.drafts);
  clickTextButton(h, '重试确认'); await h.flush();
  const requests = h.calls.filter(call => call.body);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].body, first);
  assert.equal(h.value.messages[0].status, 'saved');
  assert.deepEqual(h.value.messages[0].drafts, drafts);
  assert.deepEqual(h.value.confirmations, []);
  sortGroup(h);
  assert.deepEqual(visibleDraftNames(h), ['交易30', '交易31', '交易32']);
  h.unmount();
});

test('draft date sort remains selected when missing members are filled and the review group is recreated', async () => {
  const drafts = [datedDraft(40, '2026-10-08', null), datedDraft(41, '2026-10-01', null)];
  const h = await ready({ post: async (url, body) => {
    assert.equal(url, '/api/assistant');
    assert.equal(body.operation, 'select_member');
    return response({ draft_id: body.draft_id, member });
  } });
  h.restore({ messages: [draftGroup(94, drafts, { memberFlow: true, draftSort: 'date-asc' })], input: '' });
  const awaiting = h.control('待选成员的账目');
  assert.deepEqual(nodes(awaiting).filter(node => node.type === 'li').map(node => node.props.children[0].props.children[0]), ['交易41', '交易40']);
  nodes(h.control('选择记账成员')).find(node => node.type === 'Button' && text(node) === member.name).props.onClick(); await h.flush();
  const group = h.value.messages.find(message => message.drafts?.length);
  assert.equal(group.draftSort, 'date-asc');
  assert.deepEqual(group.drafts, drafts.map(draft => ({ ...draft, member_id: member.id })));
  assert.deepEqual(visibleDraftNames(h), ['交易41', '交易40']);
  assert.equal(h.calls.filter(call => call.body).length, 1);
  h.unmount();
});

function canonicalDrafts(drafts) { return drafts.map(draft => { const canonical = { ...draft }; delete canonical.amount; return canonical; }); }
function savedGroup(id, drafts, extra = {}) {
  return draftGroup(id, drafts, { status: 'saved', savedDrafts: canonicalDrafts(drafts), ...extra });
}
function undoneResult(body, newBatch = 200, firstDraft = 300, extra = {}) {
  return { batch_id: uuid(newBatch), drafts: body.drafts.filter(draft => body.draft_ids.includes(draft.id))
    .map((draft, index) => ({ ...draft, id: uuid(firstDraft + index) })),
  undone_draft_ids: body.draft_ids, replayed: false, ...extra };
}

test('real assistant page confirms, undoes the saved entry, restores an editable draft and reconfirms a fresh batch', async () => {
  const drafts = [datedDraft(50, '2026-10-08')];
  let ledgerCount = 0;
  const h = await ready({ post: async (url, body) => {
    if (url === '/api/assistant/confirm') {
      ledgerCount += body.drafts.length;
      return response({ count: body.drafts.length, ids: [uuid(800 + ledgerCount)], replayed: false });
    }
    assert.equal(url, '/api/assistant/undo');
    ledgerCount -= body.draft_ids.length;
    return response(undoneResult(body));
  } });
  h.restore({ messages: [draftGroup(100, drafts)], input: '' });
  clickTextButton(h, '确认 1 笔'); await h.flush();
  assert.equal(ledgerCount, 1);
  const confirmed = h.value.messages[0];
  assert.equal(confirmed.status, 'saved');
  assert.deepEqual(confirmed.savedDrafts, canonicalDrafts(drafts));
  assert.deepEqual(h.value.confirmations, []);
  h.click('撤销入账'); await h.flush();
  assert.equal(ledgerCount, 0);
  const undoCall = h.calls.find(call => call.url === '/api/assistant/undo');
  assert.equal(undoCall.body.batch_id, uuid(100));
  assert.deepEqual(undoCall.body.drafts, canonicalDrafts(drafts));
  assert.deepEqual(undoCall.body.draft_ids, [uuid(50)]);
  assert.match(undoCall.body.undo_id, /^[0-9a-f-]{36}$/);
  assert.equal(h.value.messages[0].status, 'undone');
  assert.deepEqual(h.value.messages[0].drafts, []);
  const restored = h.value.messages.find(message => message.status === 'pending');
  assert.equal(restored.id, uuid(200));
  assert.equal(restored.drafts[0].id, uuid(300));
  assert.deepEqual({ ...restored.drafts[0], id: drafts[0].id }, drafts[0]);
  assert.equal(restored.commit, undefined);
  assert.equal(restored.error, undefined);
  assert.deepEqual(h.value.undos, []);
  const amount = h.find(node => node.props?.id === `${uuid(300)}-amount`);
  assert.equal(amount.props.disabled, false);
  amount.props.onChange({ target: { value: '39.00' } }); h.render();
  clickTextButton(h, '确认 1 笔'); await h.flush();
  assert.equal(ledgerCount, 1);
  const confirmations = h.calls.filter(call => call.url === '/api/assistant/confirm');
  assert.equal(confirmations.length, 2);
  assert.equal(confirmations[0].body.batch_id, uuid(100));
  assert.equal(confirmations[1].body.batch_id, uuid(200));
  assert.equal(confirmations[1].body.drafts[0].id, uuid(300));
  assert.equal(confirmations[1].body.drafts[0].amount_cents, 3900);
  assert.equal(h.value.messages.find(message => message.id === uuid(200)).status, 'saved');
  h.unmount();
});

test('chat undo validates the displayed sorted row and preserves the full immutable original snapshot for a second undo', async () => {
  const drafts = [datedDraft(60, '2026-10-08'), datedDraft(61, '2026-10-01'), datedDraft(62, '2026-10-03')];
  const original = canonicalDrafts(drafts);
  let attempts = 0;
  const h = await ready({ post: async (url, body) => {
    if (url === '/api/assistant/tasks') {
      assert.equal(body.draft_batch, null);
      assert.equal(body.saved_batch.batch_id, uuid(101));
      assert.equal(body.saved_batch.status, 'saved');
      assert.deepEqual(body.saved_batch.drafts.map(draft => draft.id), [uuid(61), uuid(62), uuid(60)]);
      return response({ action: 'undo', reply: '模型声称已经撤销', drafts: [], query: null, update: null,
        undo: { batch_id: body.saved_batch.batch_id, draft_ids: [body.saved_batch.drafts[1].id] } });
    }
    assert.equal(url, '/api/assistant/undo');
    assert.deepEqual(body.drafts, original);
    return response(undoneResult(body, 210 + attempts, 310 + attempts++ * 10));
  } });
  h.restore({ messages: [savedGroup(101, drafts, { draftSort: 'date-asc' })], input: '撤销第二笔' });
  h.click('发送'); await h.flush();
  assert.equal(h.calls.filter(call => call.url === '/api/assistant/undo').length, 0);
  clickTextButton(h, '确认撤销 1 笔'); await h.flush();
  const firstUndo = h.calls.find(call => call.url === '/api/assistant/undo');
  assert.deepEqual(firstUndo.body.draft_ids, [uuid(62)]);
  assert.equal(attempts, 1);
  const remaining = h.value.messages.find(message => message.id === uuid(101));
  assert.equal(remaining.status, 'saved');
  assert.deepEqual(remaining.drafts, [drafts[0], drafts[1]]);
  assert.deepEqual(remaining.savedDrafts, original);
  assert.equal(h.value.messages.find(message => message.id === uuid(210)).draftSort, 'date-asc');
  assert.equal(h.text.includes('模型声称已经撤销'), false);
  assert.equal(h.control('发送').props.disabled, true);
  h.click('撤销入账'); await h.flush();
  const undoCalls = h.calls.filter(call => call.url === '/api/assistant/undo');
  assert.equal(undoCalls.length, 2);
  assert.deepEqual(undoCalls[1].body.drafts, original);
  assert.deepEqual(undoCalls[1].body.draft_ids, [uuid(60), uuid(61)]);
  assert.notEqual(undoCalls[1].body.undo_id, undoCalls[0].body.undo_id);
  assert.equal(h.value.messages.find(message => message.id === uuid(101)).status, 'undone');
  assert.equal(h.value.messages.filter(message => message.status === 'pending').flatMap(message => message.drafts).length, 3);
  assert.deepEqual(h.value.undos, []);
  h.unmount();
});

test('invalid or stale chat undo targets never send a financial request or display model success', async () => {
  const drafts = [datedDraft(70, '2026-10-08')];
  for (const target of [
    { batch_id: uuid(999), draft_ids: [uuid(70)] },
    { batch_id: uuid(102), draft_ids: [uuid(999)] },
    { batch_id: uuid(102), draft_ids: [uuid(70), uuid(70)] },
    null,
  ]) {
    const h = await ready({ post: async (url) => {
      assert.equal(url, '/api/assistant/tasks');
      return response({ action: 'undo', reply: '已经撤销成功', drafts: [], query: null, update: null, undo: target });
    } });
    h.restore({ messages: [savedGroup(102, drafts)], input: '撤销这笔' });
    h.click('发送'); await h.flush();
    assert.equal(h.calls.filter(call => call.url === '/api/assistant/undo').length, 0);
    assert.deepEqual(h.value.messages[0].drafts, drafts);
    assert.equal(h.value.messages[0].status, 'saved');
    assert.equal(h.value.input, '');
    assert.equal(h.text.includes('已经撤销成功'), false);
    assert.match(h.text, /原账单状态已变化/);
    h.unmount();
  }
  const h = await ready({ post: async (url, body) => {
    assert.equal(url, '/api/assistant/tasks');
    assert.equal(body.saved_batch, null);
    return response({ action: 'undo', reply: '已经撤销成功', drafts: [], query: null,
      undo: { batch_id: uuid(102), draft_ids: [uuid(70)] } });
  } });
  h.restore({ messages: [savedGroup(102, drafts), draftGroup(103, [datedDraft(71, '2026-10-08')])], input: '撤销这笔' });
  h.click('发送'); await h.flush();
  assert.equal(h.calls.filter(call => call.url === '/api/assistant/undo').length, 0);
  assert.equal(h.value.messages.find(message => message.id === uuid(102)).status, 'saved');
  h.unmount();
});

test('a lost undo response persists the exact operation across restore and retries once with the same undo ID', async () => {
  const drafts = [datedDraft(80, '2026-10-08')];
  const h = await ready({ post: async () => { throw Error('response lost after server commit'); } });
  h.restore({ messages: [savedGroup(104, drafts, { draftSort: 'date-desc' })], input: '' });
  h.click('撤销入账'); await h.flush();
  const request = h.calls.find(call => call.url === '/api/assistant/undo').body;
  assert.equal(h.value.messages[0].status, 'saved');
  assert.deepEqual(h.value.messages[0].drafts, drafts);
  assert.equal(h.value.undos.length, 1);
  assert.equal(h.value.undos[0].id, request.undo_id);
  assert.deepEqual(h.value.undos[0].drafts, request.drafts);
  assert.deepEqual(h.value.undos[0].draft_ids, request.draft_ids);
  assert.equal(h.control('撤销入账').props.disabled, true);
  assert.equal(h.notices.some(notice => notice.kind === 'success'), false);
  const persisted = h.value;
  h.unmount();
  const retry = await ready({ post: async (url, body) => {
    assert.equal(url, '/api/assistant/undo');
    assert.deepEqual(body, request);
    return response(undoneResult(body, 220, 320, { replayed: true }));
  } });
  retry.restore(persisted);
  retry.click('核对撤销结果'); await retry.flush();
  assert.equal(retry.calls.filter(call => call.body).length, 1);
  assert.deepEqual(retry.value.undos, []);
  const restored = retry.value.messages.filter(message => message.status === 'pending');
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, uuid(220));
  assert.equal(restored[0].draftSort, 'date-desc');
  assert.equal(restored[0].drafts[0].id, uuid(320));
  assert.equal(retry.value.messages.find(message => message.id === uuid(104)).status, 'undone');
  retry.unmount();
});

test('clearing twice during financial undo retains the exact recovery and late completion restores only the fresh draft', async () => {
  const wait = deferred();
  const drafts = [datedDraft(90, '2026-10-08')];
  const h = await ready({ post: () => wait.promise });
  h.restore({ messages: [
    { id: uuid(109), role: 'user', text: '旧截图消息', images: [image('旧截图')] },
    savedGroup(105, drafts, { draftSort: 'date-asc' }),
  ], input: '原来的输入', images: [image('未发送图片')] });
  h.click('撤销入账'); await h.flush();
  const undoCall = h.calls.find(call => call.url === '/api/assistant/undo');
  const retained = h.value.undos;
  assert.equal(retained.length, 1);
  h.click('清空对话');
  assert.equal(undoCall.options.signal.aborted, false);
  assert.deepEqual(h.value.messages, []);
  assert.equal(h.value.input, '');
  assert.deepEqual(h.value.images, []);
  assert.deepEqual(h.value.undos, retained);
  h.click('清空对话');
  assert.deepEqual(h.value.undos, retained);
  assert.equal(h.control('核对撤销结果').props.disabled, true);
  wait.resolve(response(undoneResult(undoCall.body, 230, 330))); await h.flush();
  assert.deepEqual(h.value.undos, []);
  assert.equal(h.value.messages.length, 1);
  const restored = h.value.messages[0];
  assert.equal(restored.id, uuid(230));
  assert.equal(restored.status, 'pending');
  assert.equal(restored.draftSort, 'date-asc');
  assert.equal(restored.images, undefined);
  assert.equal(restored.drafts[0].id, uuid(330));
  assert.equal(h.value.input, '');
  assert.deepEqual(h.value.images, []);
  assert.equal(h.text.includes('旧截图消息'), false);
  assert.equal(h.find(node => node.props?.id === `${uuid(330)}-amount`).props.disabled, false);
  const stored = h.value;
  const recovered = h.restore(stored).messages;
  assert.deepEqual(recovered, [{ ...stored.messages[0], images: [] }]);
  assert.equal(h.value.messages.length, 1);
  h.unmount();
});

test('logout and unmount fence late financial undo replies and never restore drafts into the revoked page', async () => {
  for (const stop of ['logout', 'unmount']) {
    const wait = deferred();
    const drafts = [datedDraft(100, '2026-10-08')];
    const h = await ready({ post: () => wait.promise });
    h.restore({ messages: [savedGroup(106, drafts)], input: '' });
    h.click('撤销入账'); await h.flush();
    const undoCall = h.calls.find(call => call.url === '/api/assistant/undo');
    h[stop]();
    const stopped = h.value;
    assert.equal(undoCall.options.signal.aborted, true);
    wait.resolve(response(undoneResult(undoCall.body, 240, 340))); await h.flush();
    assert.deepEqual(h.value, stopped);
    assert.equal(h.value.messages.some(message => message.id === uuid(240)), false);
    assert.equal(h.notices.some(notice => notice.kind === 'success'), false);
    if (stop === 'logout') {
      assert.deepEqual(h.value.messages, []);
      assert.deepEqual(h.value.undos, []);
      h.unmount();
    }
  }
});

test('definitive undo rejection keeps the saved card intact while unknown failure preserves financial recovery', async () => {
  const drafts = [datedDraft(110, '2026-10-08')];
  for (const failure of [
    { status: 400, value: { error: '撤销参数无效' }, retained: false },
    { status: 409, value: { error: '记录已修改，请核对记录', notUndone: true }, retained: false },
    { status: 503, value: { error: '撤销结果未知' }, retained: true },
  ]) {
    const h = await ready({ post: async () => response(failure.value, failure.status) });
    h.restore({ messages: [savedGroup(107, drafts)], input: '' });
    h.click('撤销入账'); await h.flush();
    const message = h.value.messages[0];
    assert.equal(message.status, 'saved');
    assert.deepEqual(message.drafts, drafts);
    assert.equal(message.error, failure.value.error);
    assert.equal(h.value.messages.some(item => item.status === 'pending'), false);
    assert.equal(h.value.undos.length, failure.retained ? 1 : 0);
    assert.equal(!!h.control('撤销入账').props.disabled, failure.retained);
    assert.equal(h.notices.some(notice => notice.kind === 'success'), false);
    h.unmount();
  }
});

test('malformed undo success never changes saved cards or displays success and retains the original recovery payload', async () => {
  const drafts = [datedDraft(120, '2026-10-08')];
  for (const malformed of [
    body => undoneResult(body, 108, 350),
    body => undoneResult(body, 250, 120),
    body => ({ ...undoneResult(body, 250, 350), undone_draft_ids: [uuid(999)] }),
    body => ({ ...undoneResult(body, 250, 350), drafts: [{ ...body.drafts[0], id: uuid(350), amount_cents: 999 }] }),
    body => ({ ...undoneResult(body, 250, 350), drafts: [] }),
    () => ({ reply: '已撤销，未入账。' }),
  ]) {
    const h = await ready({ post: async (url, body) => response(malformed(body)) });
    h.restore({ messages: [savedGroup(108, drafts)], input: '' });
    h.click('撤销入账'); await h.flush();
    const request = h.calls.find(call => call.url === '/api/assistant/undo').body;
    assert.equal(h.value.messages.length, 1);
    assert.equal(h.value.messages[0].status, 'saved');
    assert.deepEqual(h.value.messages[0].drafts, drafts);
    assert.equal(h.value.undos.length, 1);
    assert.equal(h.value.undos[0].id, request.undo_id);
    assert.deepEqual(h.value.undos[0].drafts, request.drafts);
    assert.equal(h.notices.some(notice => notice.kind === 'success'), false);
    h.unmount();
  }
});

const chat = reply => ({ action: 'chat', reply, drafts: [], query: null, update: null, undo: null });

test('assistant UI displays incremental task text before completion and applies one final reply', async () => {
  const h = await ready();
  h.restore({ messages: [], input: '怎么记账？' });
  h.click('发送'); await h.flush();
  assert.equal(h.value.messages.length, 1);
  h.patchTask({ phase: 'query', text: '可以先' }); await h.poll();
  assert.equal(text(h.find(node => node.props?.['data-streaming-reply'])), '可以先');
  assert.equal(h.value.messages.length, 1, 'Provisional text is not persisted as a completed message');
  h.patchTask({ text: '可以先描述一笔收支。' }); await h.poll();
  assert.equal(text(h.find(node => node.props?.['data-streaming-reply'])), '可以先描述一笔收支。');
  assert.equal(h.control('停止生成').props.disabled, undefined);
  h.patchTask({ status: 'succeeded', result: chat('描述收支后，请核对草稿再确认。') }); await h.poll();
  assert.equal(h.all(node => node.props?.['data-streaming-reply']).length, 0);
  assert.deepEqual(h.value.messages.map(message => [message.role, message.text]), [['user', '怎么记账？'], ['assistant', '描述收支后，请核对草稿再确认。']]);
  assert.equal(h.value.messages.some(message => message.incomplete), false);
  await h.poll();
  assert.equal(h.value.messages.length, 2, 'Repeated snapshots do not duplicate replies');
  h.unmount();
});

test('reply updates follow before paint, retain the reply container, and leave history readers in place', async () => {
  const h = await ready();
  h.restore({ messages: [], input: '看看本月支出' });
  h.click('发送'); await h.flush();
  h.patchTask({ phase: 'query', text: '本月支出' }); await h.poll();
  const provisional = h.find(node => node.props?.['data-streaming-reply']);
  const containerClass = provisional.props.className;
  assert.equal(h.feed.scrollTop, h.feed.scrollHeight - h.feed.clientHeight, 'The layout effect follows before passive effects run');
  const before = h.scrolls.length;
  h.feed.scrollHeight += 400;
  h.patchTask({ text: '本月支出继续增加的统计详情' }); await h.poll();
  assert.equal(h.scrolls.length, before + 1);
  assert.equal(h.feed.scrollTop, h.feed.scrollHeight - h.feed.clientHeight);
  await h.poll();
  assert.equal(h.scrolls.length, before + 1, 'An unchanged poll must not move the viewport');

  h.scrollFeed(100);
  h.feed.scrollHeight += 400;
  h.patchTask({ text: '本月支出继续增加的统计详情和说明' }); await h.poll();
  assert.equal(h.feed.scrollTop, 100, 'A reader browsing earlier messages is not pulled back down');
  h.patchTask({ status: 'succeeded', result: chat('本月支出继续增加的统计详情和说明') }); await h.poll();
  const final = h.find(node => node.props?.['data-message-id'] === provisional.props['data-message-id']);
  assert.equal(final.key, provisional.key);
  assert.equal(final.type, provisional.type);
  assert.equal(final.props.className, containerClass);
  assert.equal(final.props.children.type, provisional.props.children.type);
  assert.equal(final.props.children.props.className, provisional.props.children.props.className);
  assert.equal(h.feed.scrollTop, 100, 'Completion also respects the reader position');
  assert.equal(h.all(node => node.props?.['data-reply-status'] !== undefined).length, 1);
  h.unmount();
});

test('automatic draft saves never insert transient notices but actual storage failures remain visible', async () => {
  const storage = memoryStorage();
  const h = await ready({ realDraft: true, storage });
  writeComposer(h, '午饭 12 元');
  const notice = () => h.find(node => node.type?.name === 'DraftNotice');
  assert.equal(notice().props.draft.needsProtection, true, 'The changed value is still awaiting its save effect');
  assert.equal(h.draftNotice(), null, 'No temporary paragraph changes the height of the conversation');
  await settleDraft(h);
  assert.equal(h.draftNotice(), null);
  h.click('发送'); await h.flush();
  assert.equal(h.draftNotice(), null);
  h.patchTask({ status: 'succeeded', result: chat('请核对草稿后确认。') }); await h.poll();
  assert.equal(h.draftNotice(), null);
  await settleDraft(h);
  storage.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  writeComposer(h, '继续输入'); await settleDraft(h);
  assert.ok(notice().props.draft.error);
  assert.match(text(h.draftNotice()), /空间不足|存储|保存/);
  assert.equal(notice().props.draft.needsProtection, true, 'Real unsaved data still retains unload protection');
  h.unmount();
});

test('assistant UI displays cards only after task success and still requires explicit confirmation', async () => {
  const h = await ready();
  h.restore({ messages: [], input: '午饭 12 元，支出人是本人' });
  h.click('发送'); await h.flush();
  assert.equal(h.value.messages.some(message => message.drafts?.length), false);
  h.patchTask({ status: 'succeeded', result: { ...record, drafts: [row(130, 1200, member.id)] } }); await h.poll();
  assert.equal(h.value.messages.filter(message => message.drafts?.length).length, 1);
  assert.deepEqual(visibleDraftNames(h), ['交易130']);
  assert.equal(h.value.messages.at(-1).status, 'pending');
  assert.equal(h.calls.filter(call => call.url === '/api/assistant/confirm').length, 0);
  assert.ok(h.all(node => node.type === 'Button').some(node => text(node) === '确认 1 笔'));
  h.unmount();
});

test('image task UI displays real progress, retains completed images on retry and waits for merged final cards', async () => {
  const h = await ready();
  const progress = extra => ({ total: 5, completed: 0, failed: [], active: [1, 2], stage: 'recognizing', ...extra });
  try {
    h.restore({ messages: [], input: '识别这些账单', images: Array.from({ length: 5 }, (_, index) => image(`截图${index + 1}`)) });
    h.click('发送'); await h.flush();
    h.patchTask({ image_progress: progress() }); await h.poll();
    assert.match(text(h.find(node => node.props?.['data-reply-status'] !== undefined)), /已完成 0\/5 张，正在识别第 1、2 张/);
    h.patchTask({ image_progress: progress({ completed: 2, active: [3, 4] }) }); await h.poll();
    assert.match(h.text, /已完成 2\/5 张，正在识别第 3、4 张/);
    assert.equal(h.value.messages.some(message => message.drafts?.length), false);
    h.patchTask({ status: 'failed', error: '识别超时，请重试。', image_progress: progress({ completed: 4, active: [], failed: [3] }) }); await h.poll();
    assert.match(h.text, /第 3 张识别失败；已完成 4\/5 张，结果已保留/);
    assert.equal(h.value.messages.at(-1).drafts, undefined);
    h.restore(h.value);
    clickTextButton(h, '继续识别'); await h.flush();
    const retry = h.calls.find(call => call.body?.action === 'retry');
    assert.equal(retry.body.attempt, 1);
    assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 1, 'Retry uses the accepted task without another image upload');
    h.patchTask({ image_progress: progress({ completed: 4, active: [3] }) }); await h.poll();
    assert.match(h.text, /已完成 4\/5 张，正在识别第 3 张/);
    h.patchTask({ image_progress: progress({ completed: 5, active: [], stage: 'merging' }) }); await h.poll();
    assert.match(h.text, /已完成 5\/5 张，正在整理账目/);
    assert.equal(h.value.messages.some(message => message.drafts?.length), false, 'Recognized image results alone never become confirmable cards');
    h.patchTask({ status: 'succeeded', result: { ...record, drafts: [row(130, 1200, member.id)], import_summary: { ...summary, image_count: 5 } } }); await h.poll();
    assert.deepEqual(visibleDraftNames(h), ['交易130']);
    assert.equal(h.value.messages.at(-1).status, 'pending');
    assert.equal(h.calls.filter(call => call.url === '/api/assistant/confirm').length, 0);
    assert.doesNotMatch(text(h.find(node => node.props?.['data-reply-status'] !== undefined)), /已完成|正在整理/);
  } finally { h.unmount(); }
});

test('image task progress survives refresh and invalid remote counts never appear as completed work', async () => {
  const taskStore = new Map();
  const h = await ready({ taskStore });
  h.restore({ messages: [], input: '识别三张', images: [image('一'), image('二'), image('三')] });
  h.click('发送'); await h.flush();
  h.patchTask({ status: 'queued', image_progress: { total: 3, completed: 2, failed: [], active: [], stage: 'recognizing' } }); await h.poll();
  assert.match(h.text, /已完成 2\/3 张，等待继续识别/);
  const stored = h.value;
  h.unmount();
  const restored = await ready({ taskStore });
  try {
    restored.restore(stored); await restored.flush(); await restored.poll();
    assert.match(restored.text, /已完成 2\/3 张/);
    assert.equal(restored.calls.filter(call => call.options.method === 'POST').length, 0);
    restored.patchTask({ status: 'running', image_progress: { total: 3, completed: 99, active: [], failed: [], stage: 'merging' } }); await restored.poll();
    assert.doesNotMatch(restored.text, /99\/3|正在整理账目/);
    assert.match(restored.text, /正在识别截图/);
    assert.equal(restored.value.messages[0].image_progress, null);
    restored.patchTask({ status: 'failed', error: '结果整理未完成。', image_progress: { total: 3, completed: 3, active: [], failed: [], stage: 'merging' } }); await restored.poll();
    assert.ok(restored.all(node => node.type === 'Button').some(node => text(node) === '重新整理结果'));
    assert.equal(restored.value.messages.at(-1).drafts, undefined);
  } finally { restored.unmount(); }
});

test('stopped and failed tasks remain incomplete and retry the same server task without resending images', async () => {
  for (const interruption of ['stop', 'error']) {
    const h = await ready();
    const images = [image('收据一'), image('收据二')];
    h.restore({ messages: [], input: '  帮我核对  ', images });
    h.click('发送'); await h.flush();
    h.patchTask({ text: '还没有生成完的内容' }); await h.poll();
    if (interruption === 'stop') { h.click('停止生成'); await h.flush(); }
    else { h.patchTask({ status: 'failed', error: '连接中断，请重试。' }); await h.poll(); }
    const incomplete = h.value.messages.at(-1);
    assert.equal(incomplete.text, '还没有生成完的内容');
    assert.equal(incomplete.incomplete, interruption === 'stop' ? 'stopped' : 'interrupted');
    assert.equal(h.value.messages[0].incomplete, incomplete.incomplete);
    assert.equal(incomplete.drafts, undefined);
    h.restore(h.value);
    clickTextButton(h, '重新处理'); await h.flush();
    const retry = h.calls.find(call => call.body?.action === 'retry');
    assert.equal(retry.url, `/api/assistant/tasks/${incomplete.id}`);
    assert.deepEqual(retry.body, { action: 'retry', attempt: 1 });
    assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 1);
    h.patchTask({ status: 'succeeded', result: chat('重试完成，请核对。') }); await h.poll();
    assert.equal(h.value.messages.length, 2);
    assert.equal(h.value.messages.at(-1).text, '重试完成，请核对。');
    assert.equal(h.value.messages.at(-1).incomplete, undefined);
    h.unmount();
  }
});

test('stopping a task before first progress keeps the original user turn and stable ID available for retry', async () => {
  const h = await ready();
  h.restore({ messages: [], input: '午饭 12 元，支出人本人' });
  h.click('发送'); await h.flush();
  h.click('停止生成'); await h.flush();
  assert.equal(h.value.messages.at(-1).incomplete, 'stopped');
  assert.equal(h.value.messages.at(-1).text, '');
  assert.equal(h.value.messages[0].incomplete, 'stopped');
  clickTextButton(h, '重新处理'); await h.flush();
  h.patchTask({ status: 'succeeded', result: { ...record, drafts: [row(132, 1200, member.id)] } }); await h.poll();
  assert.deepEqual(visibleDraftNames(h), ['交易132']);
  assert.equal(h.value.messages.length, 2);
  assert.equal(h.value.messages.at(-2).incomplete, undefined);
  assert.equal(h.value.messages.at(-1).status, 'pending');
  h.unmount();
});

test('leaving and returning resumes the accepted task and retrieves completion without another POST', async () => {
  const taskStore = new Map();
  const h = await ready({ taskStore });
  h.restore({ messages: [], input: '晚餐 28 元' });
  h.click('发送'); await h.flush();
  h.patchTask({ text: '正在核对晚餐' }); await h.poll();
  const stored = h.value;
  h.unmount();
  assert.equal(h.calls.filter(call => call.body?.action === 'cancel').length, 0, 'Unmount only detaches polling');
  const refreshed = await ready({ taskStore });
  refreshed.restore(stored); await refreshed.flush(); await refreshed.poll();
  assert.match(refreshed.text, /正在核对晚餐/);
  refreshed.patchTask({ status: 'succeeded', result: { ...record, drafts: [row(134, 2800, member.id)] } }); await refreshed.poll();
  assert.deepEqual(visibleDraftNames(refreshed), ['交易134']);
  assert.equal(refreshed.calls.filter(call => call.options.method === 'POST').length, 0);
  const completed = refreshed.value;
  refreshed.unmount();
  const again = await ready({ taskStore });
  again.restore(completed); await again.flush(); await again.poll();
  assert.equal(again.value.messages.filter(message => message.drafts?.length).length, 1);
  assert.equal(again.value.messages.length, 2);
  again.unmount();
});

test('missing local user messages recover their screenshot preview with a bounded single-task read', async () => {
  const taskStore = new Map();
  const h = await ready({ taskStore });
  h.restore({ messages: [], input: '', images: [image('持久原图')] });
  h.click('发送'); await h.flush();
  const conversationId = h.value.conversationId;
  h.unmount();
  const restored = await ready({ taskStore });
  restored.restore({ conversationId, messages: [], input: '' }); await restored.flush(); await restored.poll();
  assert.deepEqual(restored.value.messages[0].images, [image('持久原图')]);
  assert.ok(restored.calls.some(call => call.url.includes('?include_input=1')));
  restored.unmount();
});

test('quota fallback keeps stable recovery identifiers while a complete persistence failure sends nothing', async () => {
  for (const lightweight of [true, false]) {
    const h = await ready({ persist: snapshot => lightweight && snapshot.outbox === null });
    h.restore({ messages: [], input: '午饭12元', images: [image('原图')] });
    h.click('发送'); await h.flush();
    assert.equal(h.calls.filter(call => call.options.method === 'POST').length, lightweight ? 1 : 0);
    if (lightweight) assert.ok(h.value.conversationId && h.value.messages[0].taskId);
    else { assert.equal(h.value.input, '午饭12元'); assert.deepEqual(h.value.images, [image('原图')]); }
    h.unmount();
  }
});


test('an unacknowledged submission locks existing draft edits but keeps its exact retry available', async () => {
  const h = await ready({ post: async () => { throw Error('Acknowledgement lost'); } });
  h.restore({ messages: [draftGroup(400, [datedDraft(401, '2026-10-08')])], input: '改一下成员' });
  h.click('发送'); await h.flush();
  assert.equal(h.value.messages.at(-1).taskStatus, 'missing');
  assert.equal(h.find(node => node.props?.id === `${uuid(401)}-amount`).props.disabled, true);
  assert.equal(h.control('删除这笔草稿').props.disabled, true);
  assert.equal(h.find(node => node.type === 'Button' && text(node) === '确认 1 笔').props.disabled, true);
  clickTextButton(h, '重试发送'); await h.flush();
  assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 2);
  assert.deepEqual(h.value.messages[0].drafts, [datedDraft(401, '2026-10-08')]);
  h.unmount();
});


test('speech connection cancellation and recording stop remain enabled while their live input stays readable', async () => {
  for (const phase of ['starting', 'recording']) {
    const done = deferred();
    let stops = 0;
    const h = await ready({ speechStart: options => {
      options.onPhase(phase);
      options.onText('午饭十二元');
      return { done: done.promise, stop() { stops++; done.resolve('午饭十二元'); }, cancel() { done.resolve(''); } };
    } });
    h.click('语音输入'); await h.flush();
    assert.equal(h.control('记一笔，或问问账本').props.disabled, false);
    assert.equal(h.control('记一笔，或问问账本').props.readOnly, true);
    assert.equal(h.value.input, '午饭十二元');
    h.click(phase === 'starting' ? '取消语音连接' : '结束录音'); await h.flush();
    assert.equal(stops, 1);
    assert.equal(h.control('语音输入').props.disabled, false);
    h.unmount();
  }
});


async function settleDraft(h) {
  for (let index = 0; index < 3; index++) await h.flush();
}
function writeComposer(h, value) {
  h.control('记一笔，或问问账本').props.onChange({ target: { value } });
  h.render();
}
function savedConversation(storage) {
  const saved = storage.getItem(`ledger:draft:v1:${uuid(900)}:assistant`);
  assert.ok(saved, 'The real form draft session has saved an account-scoped conversation');
  return JSON.parse(saved).value;
}

test('real draft hook restores a saved conversation and accepts text and image messages after a fresh page mount', async () => {
  for (const withImage of [false, true]) {
    const storage = memoryStorage(), taskStore = new Map();
    const options = { realDraft: true, storage, taskStore, post: async () => response(chat('请核对结果。')) };
    const first = await ready(options);
    writeComposer(first, '先保存这条对话'); await settleDraft(first);
    first.click('发送'); await settleDraft(first);
    const saved = savedConversation(storage);
    assert.equal(saved.messages.length, 2);
    assert.equal(saved.messages[0].text, '先保存这条对话');
    first.unmount();

    const refreshed = await ready(options);
    try {
      assert.equal(refreshed.value.conversationId, saved.conversationId);
      assert.equal(refreshed.value.messages[0].text, '先保存这条对话', 'The real hook auto-restores without calling the harness restore stub');
      writeComposer(refreshed, withImage ? '请识别新的截图' : '今天午饭12元');
      if (withImage) refreshed.choose([file('刷新后上传的截图')]);
      await settleDraft(refreshed);
      refreshed.click('发送'); await settleDraft(refreshed);
      const sent = refreshed.calls.filter(call => call.options.method === 'POST' && call.url === '/api/assistant/tasks');
      assert.equal(sent.length, 1, 'Restoration acknowledgement must not permanently block the next persisted request');
      assert.equal(sent[0].body.message, withImage ? '请识别新的截图' : '今天午饭12元');
      if (withImage) assert.deepEqual(sent[0].body.images, [image('刷新后上传的截图').data]);
      assert.equal(savedConversation(storage).messages.length, 4);
      assert.equal(refreshed.notices.some(notice => /本机对话无法保存|释放浏览器存储|空间不足/.test(notice.value)), false, 'Normal in-memory storage never reports a quota failure');
      assert.ok(storage.writes.length >= 3);
    } finally { refreshed.unmount(); }
  }
});

test('real draft hook acknowledges clear normalization and accepts the next message in the new conversation', async () => {
  const storage = memoryStorage(), taskStore = new Map();
  const h = await ready({ realDraft: true, storage, taskStore, post: async () => response(chat('待核对。')) });
  try {
    writeComposer(h, '清空前的消息'); await settleDraft(h);
    h.click('发送'); await settleDraft(h);
    const previousId = savedConversation(storage).conversationId;
    h.click('清空对话'); await settleDraft(h);
    assert.notEqual(h.value.conversationId, previousId);
    assert.deepEqual(savedConversation(storage).messages, []);
    writeComposer(h, '清空后继续记账'); await settleDraft(h);
    h.click('发送'); await settleDraft(h);
    const sent = h.calls.filter(call => call.options.method === 'POST' && call.url === '/api/assistant/tasks');
    assert.equal(sent.length, 2, 'The clear replacement must be acknowledged despite a different object key insertion order');
    assert.equal(sent[1].body.conversation_id, h.value.conversationId);
    assert.equal(sent[1].body.message, '清空后继续记账');
    assert.equal(savedConversation(storage).messages.length, 2);
    assert.equal(h.notices.some(notice => /本机对话无法保存|释放浏览器存储|空间不足/.test(notice.value)), false);
  } finally { h.unmount(); }
});

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
  if (typeof tree?.type === 'function' && ['AssistantDraftCard', 'AssistantDraftRow', 'AssistantReplyBadge', 'AssistantReplyShell', 'AssistantReplyCard', 'AssistantReplyBody', 'AssistantReplyMetrics', 'AssistantReplyNotice', 'AssistantReplyFields', 'AssistantReplyRecords', 'AssistantMemberPicker', 'AssistantActionCard', 'AssistantActionControls', 'AssistantAgentTaskStatus'].includes(tree.type.name)) return [tree, ...nodes(tree.type(tree.props))];
  return Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree?.props?.['aria-hidden'] === 'true' || tree?.props?.['aria-hidden'] === true) return '';
  // The page's pure member label is a real child component rather than an icon
  // fixture; render it so assertions still exercise the displayed member name.
  if (typeof tree?.type === 'function' && ['AssistantDraftCard', 'AssistantDraftRow', 'AssistantReplyBadge', 'AssistantReplyShell', 'AssistantReplyCard', 'AssistantReplyBody', 'AssistantReplyMetrics', 'AssistantReplyNotice', 'AssistantReplyFields', 'AssistantReplyRecords', 'AssistantMemberLabel', 'AssistantMemberPicker', 'AssistantActionCard', 'AssistantActionControls', 'AssistantProcessingDetails', 'AssistantAgentTaskStatus'].includes(tree.type.name)) return text(tree.type(tree.props));
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
    document: { getElementById() { return null; }, visibilityState: "visible", addEventListener() {}, removeEventListener() {}, createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = { width: 0, height: 0, picture: null,
        getContext(kind) { assert.equal(kind, '2d'); return { fillRect() {}, drawImage(picture) { canvas.picture = picture; } }; },
        toDataURL() { return canvas.picture.file?.data || canvas.picture.source; },
      };
      return canvas;
    } },
    requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
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
      if (name === 'zod') return require('zod');
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
  modules['@/components/assistant/processing-details'] = load('components/assistant/processing-details.tsx');
  modules['@/components/assistant/agent-task-status'] = load('components/assistant/agent-task-status.tsx');
  modules['@/components/assistant/reply-primitives'] = load('components/assistant/reply-primitives.tsx');
  modules['@/components/assistant/member-picker'] = load('components/assistant/member-picker.tsx');
  modules['@/components/assistant/draft-card'] = load('components/assistant/draft-card.tsx');
  modules['@/components/assistant/action-card'] = load('components/assistant/action-card.tsx');
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
  assert.match(h.text, /已识别截图2 张待核对账目2 笔整理结果衔接去重1 笔/);
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
    if (serverSkippedZero) assert.match(h.text, /已识别截图1 张待核对账目2 笔整理结果衔接去重0 笔跳过零金额1 行/);
    h.restore(h.value);
    assert.match(h.text, /已跳过零金额订单；截图年份需要核对/);
    if (mode !== 'member-specified') {
      const chooser = h.control('选择记账成员');
      nodes(chooser).find(node => node.type === 'Button' && text(node) === member.name).props.onClick();
      await h.flush();
    }
    assert.match(h.text, /已跳过零金额订单；截图年份需要核对/);
    h.all(node => node.props?.['aria-label'] === '移除这笔草稿')[0].props.onClick(); h.render();
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

test('draft card totals follow edits and do not present invalid amounts as a confirmed total', async () => {
  const h = await ready();
  const expense = datedDraft(50, '2026-10-09');
  const income = { ...datedDraft(51, '2026-10-09'), type: 'income', amount: '5000.00' };
  h.restore({ messages: [draftGroup(95, [expense, income])], input: '' });
  const card = () => h.find(node => node.type?.name === 'AssistantDraftCard');
  assert.match(text(card()), /收入合计¥5000.00/);
  assert.match(text(card()), /支出合计¥50.00/);
  h.find(node => node.props?.id === `${expense.id}-amount`).props.onChange({ target: { value: '30.50' } }); h.render();
  assert.match(text(card()), /支出合计¥30.50/);
  h.find(node => node.props?.id === `${expense.id}-amount`).props.onChange({ target: { value: '30.501' } }); h.render();
  assert.match(text(card()), /支出合计金额待核对/);
  clickTextButton(h, '确认 2 笔'); await h.flush();
  assert.equal(h.calls.filter(call => call.body).length, 0);
  assert.equal(h.find(node => node.props?.id === `${expense.id}-amount`).props['aria-invalid'], true);
  h.unmount();
});

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
  const container = h.find(node => node.type === 'div' && node.props['aria-label'] === '账目：交易12'
    && nodes(node).some(child => child.props?.id === `${uuid(12)}-date`));
  nodes(container).find(node => node.props?.['aria-label'] === '移除这笔草稿').props.onClick(); h.render();
  sortGroup(h); sortGroup(h);
  assert.deepEqual(visibleDraftNames(h), ['交易10', '交易11', '交易12', '交易13', '交易14']);
  assert.deepEqual(h.value.messages[0].drafts.map(draft => draft.id), [uuid(10), uuid(11), uuid(12), uuid(13), uuid(14)]);
  assert.equal(h.value.messages[0].drafts.find(d => d.id === uuid(12)).softRemoved, true);
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
  assert.equal(text(nodes(h.find(node => node.props?.['data-streaming-reply'])).find(node => node.type === 'Markdown')), '可以先');
  assert.equal(h.value.messages.length, 1, 'Provisional text is not persisted as a completed message');
  h.patchTask({ text: '可以先描述一笔收支。' }); await h.poll();
  assert.equal(text(nodes(h.find(node => node.props?.['data-streaming-reply'])).find(node => node.type === 'Markdown')), '可以先描述一笔收支。');
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
    const panel = h.find(node => node.type?.name === 'AssistantProcessingDetails');
    assert.equal(panel.type(panel.props).props.open, undefined, 'Processing details start collapsed');
    assert.match(text(panel), /已完成 0\/5 张 · 正在识别第 1、2 张/);
    h.patchTask({ image_progress: progress({ completed: 2, active: [3, 4] }) }); await h.poll();
    assert.match(h.text, /已完成 2\/5 张 · 正在识别第 3、4 张/);
    assert.equal(h.value.messages.some(message => message.drafts?.length), false);
    h.patchTask({ status: 'failed', error: '识别超时，请重试。', image_progress: progress({ completed: 4, active: [], failed: [3] }) }); await h.poll();
    assert.match(h.text, /第 3 张识别失败；已完成 4\/5 张，识别进度已保存，尚未生成可确认的账单/);
    assert.equal(h.value.messages.at(-1).drafts, undefined);
    h.restore(h.value);
    clickTextButton(h, '继续识别'); await h.flush();
    const retry = h.calls.find(call => call.body?.action === 'retry');
    assert.equal(retry.body.attempt, 1);
    assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 1, 'Retry uses the accepted task without another image upload');
    h.patchTask({ image_progress: progress({ completed: 4, active: [3] }) }); await h.poll();
    assert.match(h.text, /已完成 4\/5 张 · 正在识别第 3 张/);
    h.patchTask({ image_progress: progress({ completed: 5, active: [], stage: 'merging' }) }); await h.poll();
    assert.match(h.text, /已完成 5\/5 张/);
    assert.match(h.text, /整理识别结果进行中/);
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
  assert.match(h.text, /等待处理… · 2\/3 张/);
  const stored = h.value;
  h.unmount();
  const restored = await ready({ taskStore });
  try {
    restored.restore(stored); await restored.flush(); await restored.poll();
    assert.match(restored.text, /已完成 2\/3 张/);
    assert.equal(restored.calls.filter(call => call.options.method === 'POST').length, 0);
    restored.patchTask({ status: 'running', image_progress: { total: 3, completed: 99, active: [], failed: [], stage: 'merging' } }); await restored.poll();
    assert.doesNotMatch(restored.text, /99\/3|正在整理账目/);
    assert.match(restored.text, /截图识别…/);
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
  assert.equal(h.control('移除这笔草稿').props.disabled, true);
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

test('conversational approval executes a saved-data preview only after an explicit yes and cancels without writing', async () => {
  const approval = { id: uuid(70), summary: '将删除 1 条记录：早餐。尚未执行。回复确认执行或取消。', count: 1, expires_at: '2099-10-09T00:00:00Z' };
  for (const decision of ['确认执行', '取消']) {
    const h = await ready({ post: async (url, body) => url.startsWith('/api/assistant/actions/')
      ? response({ id: approval.id, status: body.decision === 'approve' ? 'succeeded' : 'cancelled', text: body.decision === 'approve' ? '已删除 1 条收支记录。' : '已取消本次操作。' })
      : response({ action: 'manage', reply: approval.summary, drafts: [], query: null, approval }) });
    h.control('记一笔，或问问账本').props.onChange({ target: { value: '删除已入账早餐' } }); h.render(); h.click('发送'); await h.flush();
    assert.ok(h.text.includes('尚未执行'));
    assert.equal(h.calls.filter(c => c.url.startsWith('/api/assistant/actions/')).length, 0);
    h.control('记一笔，或问问账本').props.onChange({ target: { value: decision } }); h.render(); h.click('发送'); await h.flush();
    const requests = h.calls.filter(c => c.url.startsWith('/api/assistant/actions/'));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.decision, decision === '取消' ? 'cancel' : 'approve');
    assert.equal(h.value.messages.some(m => m.approval), false);
    assert.equal(h.value.messages.filter(m => m.role === "user").at(-1).localHandled, true);
    const restored = h.restore(h.value);
    assert.equal(restored.messages.at(-1).incomplete, undefined, 'approved and cancelled replies do not become unsent messages after refresh');
  }
});

test('a conversational draft confirmation posts only the reviewed subset and preserves unselected rows', async () => {
  const drafts = [datedDraft(101, '2026-10-09', member.id), datedDraft(102, '2026-10-08', member.id)];
  const batch = draftGroup(60, drafts);
  const h = await ready({ post: async (url, body) => url === '/api/assistant/confirm'
    ? response({ count: body.drafts.length, transaction_ids: [uuid(99)] })
    : response({ action: 'confirm', reply: '', drafts: [], query: null, confirm: { batch_id: batch.id, draft_ids: [drafts[0].id] } }) });
  h.restore({ messages: [batch], input: '', images: [] });
  h.control('记一笔，或问问账本').props.onChange({ target: { value: '只把第一笔入账' } }); h.render(); h.click('发送'); await h.flush();
  assert.equal(h.calls.filter(c => c.url === '/api/assistant/confirm').length, 0);
  assert.ok(h.text.includes('准备将以下 1 笔草稿入账'));
  h.control('记一笔，或问问账本').props.onChange({ target: { value: '确认执行' } }); h.render(); h.click('发送'); await h.flush();
  const posts = h.calls.filter(c => c.url === '/api/assistant/confirm');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body.drafts.map(d => d.id), [drafts[0].id]);
  assert.deepEqual(h.value.messages.find(m => m.id === batch.id).drafts.map(d => d.id), [drafts[1].id]);
  assert.ok(h.value.messages.some(m => m.status === 'saved' && m.drafts[0].id === drafts[0].id));
  assert.ok(h.value.messages.some(m => m.role === 'user' && m.text === '确认执行' && m.localHandled));
});

test('changing a draft after preview invalidates conversational approval; no posting occurs', async () => {
  const drafts = [datedDraft(101, '2026-10-09', member.id)];
  const batch = draftGroup(60, drafts);
  const h = await ready({ post: async () => response({ action: 'confirm', reply: '', drafts: [], query: null, confirm: { batch_id: batch.id, draft_ids: [drafts[0].id] } }) });
  h.restore({ messages: [batch], input: '', images: [] });
  h.control('记一笔，或问问账本').props.onChange({ target: { value: '把这笔入账' } }); h.render(); h.click('发送'); await h.flush();
  const snapshot = h.value;
  snapshot.messages.find(m => m.id === batch.id).drafts[0].amount = '99.00';
  h.restore(snapshot);
  h.control('记一笔，或问问账本').props.onChange({ target: { value: '确认执行' } }); h.render(); h.click('发送'); await h.flush();
  assert.equal(h.calls.filter(c => c.url === '/api/assistant/confirm').length, 0);
  assert.ok(h.text.includes('草稿在确认期间已变化'));
});

test('event choices preserve context, a single approval completes both ledgers, and refresh keeps the saved event for correction', async () => {
  const eventInput = require('./helpers/assistant-contracts.cjs')('@/lib/ledger-event').validateLedgerEvent({ operation:'create',kind:'loan_lent',counterparty:'小王',amount_cents:50000,date:'2026-10-09' });
  const choice = { label:'本人', input:{...eventInput,member_id:member.id} };
  const approval = { id:uuid(710),summary:'准备记录借出500元；台账与流水一起保存。\n尚未执行。',count:1,expires_at:'2099-10-09T00:00:00Z' };
  const storage=memoryStorage(),taskStore=new Map();
  const options={ realDraft:true, storage, taskStore, post:async(url,body)=>{
    if(url.startsWith('/api/assistant/actions/')) return response({id:approval.id,status:'succeeded',text:'台账、流水与关联已一起保存。',event_context:{status:'saved',event_id:uuid(711),input:{...choice.input,event_id:uuid(711)}}});
    if(body.event_selection) return response({action:'event',event:body.event_selection,reply:approval.summary,drafts:[],query:null,approval,event_context:{status:'pending',event_id:null,input:body.event_selection},event_choices:[]});
    return response({action:'event',event:eventInput,reply:'归属哪个成员？',drafts:[],query:null,event_context:{status:'pending',event_id:null,input:eventInput},event_choices:[choice]});
  }};
  const h=await ready(options);
  writeComposer(h,'借给小王500元');h.click('发送');await settleDraft(h);
  clickTextButton(h,'本人');await settleDraft(h);
  const selected=h.calls.filter(c=>c.url==='/api/assistant/tasks').at(-1).body;
  assert.equal(selected.event_selection.member_id,member.id);
  assert.equal(selected.event_context.input.amount_cents,50000);
  assert.equal(h.calls.filter(c=>c.url.startsWith('/api/assistant/actions/')).length,0);
  writeComposer(h,'确认执行');h.click('发送');await settleDraft(h);
  assert.equal(h.calls.filter(c=>c.url.startsWith('/api/assistant/actions/')).length,1);
  assert.equal(h.value.messages.find(m=>m.eventContext?.status==='saved').eventContext.event_id,uuid(711));
  h.unmount();
  const restored=await ready(options);
  assert.equal(restored.calls.filter(c=>c.options.method==='POST').length,0,'refresh must not replay approval');
  writeComposer(restored,'刚才金额错了，改成300');restored.click('发送');await settleDraft(restored);
  const sent=restored.calls.find(c=>c.url==='/api/assistant/tasks'&&c.options.method==='POST').body;
  assert.equal(sent.event_context.event_id,uuid(711));
  assert.equal(sent.event_context.status,'saved');
  restored.unmount();
});

test('saved correction syncs only the original saved card after approval and preserves its immutable undo snapshot', async () => {
  const original = datedDraft(965, '2026-10-09'); original.amount = '20.00'; original.amount_cents = 2000;
  const other = datedDraft(966, '2026-10-09');
  const preview = { title: '修改已入账账目', approveLabel: '确认修改', metrics: [], sections: [], notices: [] };
  const approval = { id: uuid(967), summary: '金额：20 → 22', preview, count: 1, expires_at: null };
  const wait = deferred();
  const h = await ready({ post: async () => wait.promise });
  try {
    h.restore({ messages: [draftGroup(968, [original], { status: 'saved', savedDrafts: [original] }), draftGroup(969, [other], { status: 'saved' }),
      { id: uuid(970), role: 'assistant', text: approval.summary, approval }], input: '' });
    clickTextButton(h, '确认修改'); await h.flush();
    assert.equal(h.value.messages.find(m=>m.id===uuid(968)).drafts[0].amount, '20.00');
    wait.resolve(response({ id: approval.id, status: 'succeeded', text: '已修改', transaction_updates: [{ batch_id: uuid(968), draft_id: original.id, transaction_id: uuid(971),
      type: 'expense', amount_cents: 2200, category_id: category.id, member_id: member.id, transaction_date: '2026-10-09', description: original.description }] }));
    await h.flush();
    assert.equal(h.value.messages.find(m=>m.id===uuid(968)).drafts[0].amount, '22.00');
    assert.equal(h.value.messages.find(m=>m.id===uuid(968)).savedDrafts[0].amount_cents, 2000);
    assert.equal(h.value.messages.find(m=>m.id===uuid(969)).drafts[0].amount, other.amount);
    h.restore(h.value);
    assert.equal(h.value.messages.find(m=>m.id===uuid(968)).drafts[0].amount, '22.00');
    assert.equal(h.calls.filter(call => call.body).length, 1);
  } finally { h.unmount(); }
});

test('stale saved correction replaces the approval with a fresh preview and requires a new click after restore', async () => {
  const preview = value => ({ title: '修改已入账账目', approveLabel: '确认修改', metrics: [], sections: [{ title: '金额', rows: [{ label: '金额', value }] }], notices: [] });
  const approval = { id: uuid(973), summary: '20 → 22', preview: preview('20 → 22'), count: 1, expires_at: null };
  const replacement = { ...approval, id: uuid(974), summary: '21 → 22', preview: preview('21 → 22') };
  const h = await ready({ post: async url => response(url.endsWith(approval.id)
    ? { id: approval.id, status: 'failed', text: '原记录已变化，请重新核对。', replacement_approval: replacement }
    : { id: replacement.id, status: 'succeeded', text: '已修改。' }) });
  try {
    h.restore({ messages: [{ id: uuid(975), role: 'assistant', text: approval.summary, approval }], input: '' });
    clickTextButton(h, '确认修改'); await h.flush();
    assert.equal(h.value.messages[0].approval.id, replacement.id);
    assert.equal(h.value.messages[0].actionResult.status, 'pending');
    assert.ok(h.text.includes('21 → 22'));
    h.restore(h.value); await h.flush();
    assert.equal(h.calls.filter(call => call.body).length, 1);
    clickTextButton(h, '确认修改'); await h.flush();
    const writes = h.calls.filter(call => call.body);
    assert.equal(writes.length, 2);
    assert.ok(writes[1].url.endsWith(replacement.id));
    assert.equal(h.value.messages[0].approval, undefined);
  } finally { h.unmount(); }
});

test('ordinary acknowledgement after a summary or completed operation stays chat; pending approval still accepts it', async () => {
  const approval = { id: uuid(961), summary: '将新增 1 条便利贴', count: 1, expires_at: null };
  for (const status of ['none', 'succeeded', 'cancelled', 'pending']) {
    const h = await ready({ post: async (url, body) => {
      if (status === 'pending') {
        assert.equal(url, `/api/assistant/actions/${approval.id}`);
        assert.equal(body.decision, 'approve');
        return response({ id: approval.id, status: 'succeeded', text: '已创建便利贴。' });
      }
      assert.equal(url, '/api/assistant/tasks');
      assert.equal(body.message, '好的');
      return response(chat('好的，有需要随时告诉我。'));
    } });
    try {
      const previous = { id: uuid(962), role: 'assistant', text: '这些便利贴包括汽车保养安排和心情记录。' };
      if (status === 'pending') previous.approval = approval;
      else if (status !== 'none') previous.actionResult = { id: approval.id, status, text: '此前操作已结束。' };
      h.restore({ messages: [previous], input: '' });
      writeComposer(h, '好的'); h.click('发送'); await h.flush();
      assert.equal(h.calls.filter(call => call.body).length, 1);
      assert.equal(h.text.includes('当前没有待批准的操作'), false);
      assert.ok(h.text.includes(status === 'pending' ? '已创建便利贴' : '有需要随时告诉我'));
      assert.equal(h.calls.filter(call => call.url.startsWith('/api/assistant/actions/')).length, status === 'pending' ? 1 : 0);
    } finally { h.unmount(); }
  }
});

test('conversational removal soft-marks the original card without another approval and can be restored', async () => {
  const drafts = [datedDraft(101, '2026-10-09', null), datedDraft(102, '2026-10-08', member.id)];
  const batch = draftGroup(60, drafts);
  const h = await ready({ post: async () => response({ action: 'remove', reply: '正在处理', drafts: [], query: null, remove: { batch_id: batch.id, draft_ids: [drafts[0].id] } }) });
  try {
    h.restore({ messages: [batch], input: '', images: [] });
    writeComposer(h, '删除第一笔'); h.click('发送'); await h.flush();
    const original = h.value.messages.find(m => m.id === batch.id);
    assert.equal(original.drafts.length, 2);
    assert.equal(original.drafts[0].softRemoved, true);
    assert.equal(original.status, 'pending');
    assert.equal(h.value.messages.some(m => m.removeChoice), false);
    assert.match(h.text, /已将 1 笔草稿标记为移除/);
    h.click('恢复这笔草稿'); await h.flush();
    assert.equal(h.value.messages.find(m => m.id === batch.id).drafts[0].softRemoved, false);
    assert.equal(h.calls.filter(c => c.url === '/api/assistant/confirm' || c.url.startsWith('/api/assistant/actions/')).length, 0);
  } finally { h.unmount(); }
});

test('all-soft-removed cards survive refresh and still offer restore, while confirmation stays disabled', async () => {
  const drafts = [datedDraft(101, '2026-10-09'), datedDraft(102, '2026-10-08')];
  const batch = draftGroup(60, drafts);
  const h = await ready();
  try {
    h.restore({ messages: [batch], input: '' });
    clickTextButton(h, '移除本组'); await h.flush();
    h.restore(h.value); await h.flush();
    const target = h.value.messages.find(m => m.id === batch.id);
    assert.equal(target.status, 'pending');
    assert.equal(target.drafts.length, 2);
    assert.ok(target.drafts.every(d => d.softRemoved));
    assert.equal(h.all(n => n.props?.['aria-label'] === '恢复这笔草稿').length, 2);
    assert.ok(h.all(n => n.type === 'Button' && text(n) === '确认 0 笔')[0].props.disabled);
    clickTextButton(h, '恢复本组'); await h.flush();
    assert.ok(h.value.messages.find(m => m.id === batch.id).drafts.every(d => !d.softRemoved));
  } finally { h.unmount(); }
});

test('only active drafts are posted, soft removal survives replay, and the saved card only shows posted rows', async () => {
  const drafts = [datedDraft(101, '2026-10-09'), datedDraft(102, '2026-10-08')];
  const batch = draftGroup(60, drafts);
  const h = await ready({ post: async (url, body) => {
    if (url === '/api/assistant/tasks') return response({ action:'remove',reply:'',drafts:[],query:null,remove:{batch_id:batch.id,draft_ids:[drafts[0].id]} });
    assert.equal(url, '/api/assistant/confirm');
    assert.deepEqual(body.drafts.map(d => d.id), [drafts[1].id]);
    return response({count:1});
  } });
  try {
    h.restore({messages:[batch],input:''});writeComposer(h,'移除第一笔');h.click('发送');await h.flush();
    const before = h.value;h.restore(before);await h.poll();
    assert.equal(h.value.messages.find(m=>m.id===batch.id).drafts[0].softRemoved,true);
    clickTextButton(h,'确认 1 笔');await h.flush();
    const saved = h.value.messages.find(m=>m.id===batch.id);
    assert.equal(saved.status,'saved');
    assert.deepEqual(saved.drafts.map(d=>d.id),[drafts[1].id]);
    h.restore(h.value);await h.poll();
    assert.deepEqual(h.value.messages.find(m=>m.id===batch.id).drafts.map(d=>d.id),[drafts[1].id]);
  } finally {h.unmount();}
});

test('restored event member choices reuse the draft member card, actual payment and avatars, preserving mixed gift context', async () => {
  const { validateLedgerEvent } = require('./helpers/assistant-contracts.cjs')('@/lib/ledger-event');
  const input = validateLedgerEvent({operation:'create',kind:'gift_given',counterparty:'大伯',amount_cents:50000,transaction_amount_cents:60000,payment_recipient:'妈',occasion:'生日',items:[{item_name:'泡子',quantity:1,unit:'封',estimated_value:50}],date:'2026-10-09'});
  const original = {id:uuid(870),role:'assistant',text:'这笔资金流水归属哪个成员？',eventContext:{status:'pending',event_id:null,input},eventChoices:[{label:member.name,input:{...input,member_id:member.id}}]};
  const h = await ready({ post:async(_url,body)=>response({action:'event',reply:'已补充成员，请核对后确认。',drafts:[],query:null,event_context:{status:'pending',event_id:null,input:body.event_selection},event_choices:[]}) });
  try {
    h.restore({messages:[original],input:'',images:[]});
    const picker=h.control('选择记账成员');
    assert.ok(text(picker).includes('送礼 · 大伯'));
    assert.ok(text(picker).includes('600.00'));
    assert.equal(h.all(n=>n.props?.['aria-label']==='补充事项信息').length,0);
    const option=nodes(picker).find(n=>n.type==='Button'&&text(n)===member.name);
    assert.ok(option.props.className.includes('min-h-11'));
    const label=option.props.children;
    assert.ok(nodes(label.type(label.props)).some(n=>n.type==='MemberAvatar'&&n.props.memberId===member.id));
    option.props.onClick(); h.render(); await h.flush();
    const sent=h.calls.find(c=>c.url==='/api/assistant/tasks'&&c.options.method==='POST').body;
    assert.deepEqual(sent.event_selection,{...input,member_id:member.id});
    assert.equal(sent.message,`支出人是「${member.name}」`);
    assert.equal(h.value.messages.some(m=>m.eventChoices?.length),false);
    assert.equal(h.calls.some(c=>c.url==='/api/assistant/confirm'||c.url.startsWith('/api/assistant/actions/')),false,'choosing a member never approves saving');
  } finally {h.unmount();}
});

test('non-member event choices remain ordinary options even when their input already contains a member',async()=>{
  const {validateLedgerEvent}=require('./helpers/assistant-contracts.cjs')('@/lib/ledger-event');
  const input=validateLedgerEvent({operation:'create',kind:'loan_lent',counterparty:'小王',amount_cents:50000,date:'2026-10-09',member_id:member.id});
  const h=await ready();
  try {
    h.restore({messages:[{id:uuid(871),role:'assistant',text:'关联已有流水？',eventContext:{status:'pending',event_id:null,input},eventChoices:[{label:'新建一笔流水',input:{...input,cashflow:'new'}}]}],input:''});
    assert.equal(h.all(n=>n.props?.['aria-label']==='选择记账成员').length,0);
    assert.ok(text(h.control('补充事项信息')).includes('新建一笔流水'));
  } finally {h.unmount();}
});

test('note creation shortcut survives restore and approves the reviewed operation once with busy feedback', async () => {
  const preview = { title: '创建便利贴', approveLabel: '创建便利贴', metrics: [], sections: [{ title: '便利贴内容', rows: [{ label: '内容', value: '2026-10-10：送车去保养' }] }], notices: [{ text: '不会定时提醒', tone: 'info' }] };
  const approval = { id: uuid(879), summary: '将新增 1 条便利贴', preview, count: 1, expires_at: null };
  const wait = deferred();
  const h = await ready({ post: async (url, body) => {
    assert.equal(url, `/api/assistant/actions/${approval.id}`);
    assert.equal(body.decision, 'approve');
    return wait.promise;
  } });
  try {
    h.restore({ messages: [{ id: uuid(878), role: 'assistant', text: approval.summary, approval }], input: '' });
    h.restore(h.value);
    assert.equal(h.calls.filter(call => call.body).length, 0);
    assert.ok(h.text.includes('2026-10-10：送车去保养'));
    assert.ok(h.text.includes('不会定时提醒'));
    clickTextButton(h, '创建便利贴');
    const loading = h.find(node => node.type === 'Button' && text(node) === '正在执行…');
    assert.equal(loading.props.disabled, true);
    assert.equal(loading.props['aria-busy'], true);
    await h.flush();
    assert.equal(h.calls.filter(call => call.body).length, 1);
    wait.resolve(response({ id: approval.id, status: 'succeeded', text: '已新增 1 条便利贴。', preview }));
    await h.flush();
    assert.ok(h.text.includes('已新增 1 条便利贴'));
    assert.equal(h.all(node => node.type === 'Button' && text(node) === '创建便利贴').length, 0);
  } finally { h.unmount(); }
});

test('approval, cancellation and status checks show distinct busy feedback immediately and reject duplicate clicks', async () => {
  for (const [label, progress, status] of [['确认执行','正在执行…','succeeded'],['取消','正在取消…','cancelled'],['核对执行状态','正在核对…','pending']]) {
    const wait=deferred(), approval={id:uuid(881),summary:'将修改 1 条记录：\n- 早餐：18 → 20\n尚未执行。',count:1,expires_at:null};
    const h=await ready({post:async()=>wait.promise});
    try {
      h.restore({messages:[{id:uuid(880),role:'assistant',text:approval.summary,approval}],input:''});
      const original=h.all(n=>n.type==='Button'&&text(n)===label)[0]; assert.ok(original);
      original.props.onClick(); h.render();
      const current=h.all(n=>n.type==='Button'&&text(n)===progress)[0]; assert.ok(current,progress);
      assert.equal(current.props.disabled,true); assert.equal(current.props['aria-busy'],true);
      assert.ok(nodes(current).some(n=>n.type==='Loader2'&&n.props.className.includes('animate-spin')));
      assert.equal(h.control('记一笔，或问问账本').props.disabled,true);
      original.props.onClick(); await h.flush();
      assert.equal(h.calls.filter(c=>c.url.startsWith('/api/assistant/actions/')).length,1);
      wait.resolve(response({id:approval.id,status,text:status==='pending'?'仍未执行':status==='cancelled'?'已取消本次操作':'已完成修改'})); await h.flush();
      assert.equal(h.all(n=>n.type==='Button'&&n.props['aria-busy']).length,0);
      assert.ok(h.text.includes(status==='pending'?'尚未执行，等待你的确认':status==='cancelled'?'已取消本次操作':'已完成修改'));
      assert.equal(h.control('记一笔，或问问账本').props.disabled,false);
    } finally {h.unmount();}
  }
});

test('failed approval retains its card and retry controls, clearing stale errors when checking status', async()=>{
  const approval={id:uuid(891),summary:'将修改 1 条记录：\n- 早餐：20\n尚未执行。确认有效期为 15 分钟。',count:1,expires_at:'2000-01-01'};
  let attempt=0;const next=deferred();
  const h=await ready({post:async()=>++attempt===1?Promise.reject(new Error('连接断开，结果待核对')):next.promise});
  try {
    h.restore({messages:[{id:uuid(890),role:'assistant',text:approval.summary,approval}],input:''});
    assert.equal(h.text.includes('15 分钟'),false);
    clickTextButton(h,'确认执行');await h.flush();
    assert.ok(h.text.includes('连接断开，结果待核对')); assert.ok(h.value.messages[0].approval);
    clickTextButton(h,'核对执行状态');h.render();
    assert.equal(h.text.includes('连接断开，结果待核对'),false);assert.ok(h.text.includes('正在核对…'));
    next.resolve(response({id:approval.id,status:'succeeded',text:'已完成修改'}));await h.flush();
    assert.equal(h.value.messages[0].approval,undefined);assert.ok(h.text.includes('已完成修改'));
    assert.equal(h.all(n=>n.props?.['aria-label']==='操作确认卡片').length,1);
  } finally {h.unmount();}
});

test('a new meal draft preserves the pending gift approval through restore and only its button executes it', async () => {
  const preview={title:'记录送礼',metrics:[],sections:[],notices:[]};
  const approval={id:uuid(901),summary:'准备记录给大伯送礼',count:1,expires_at:null,preview};
  const h=await ready({post:async url=>url.startsWith('/api/assistant/actions/')
    ? response({id:approval.id,status:'succeeded',text:'送礼已保存'}) : response({...record,drafts:[{...row(903,2000,member.id),description:'吃饭'}],import_summary:null})});
  try {
    h.restore({messages:[{id:uuid(902),role:'assistant',text:approval.summary,approval,actionPreview:preview}],input:''});
    writeComposer(h,'今天吃饭花了20');h.click('发送');await h.flush();
    const old=h.value.messages.find(m=>m.id===uuid(902));
    assert.equal(old.approval.id,approval.id);assert.equal(old.actionResult,undefined);
    assert.equal(h.calls.filter(c=>c.url.startsWith('/api/assistant/actions/')).length,0);
    assert.ok(h.value.messages.some(m=>m.status==='pending'&&m.drafts?.[0].description==='吃饭'));
    h.restore(h.value);
    assert.equal(h.text.includes('由新请求替代'),false);
    assert.equal(h.all(n=>n.type==='Button'&&text(n)==='确认执行').length,1);
    for(const decision of ['确认','确认入账','取消']) {
      writeComposer(h,decision);h.click('发送');await h.flush();
      assert.ok(h.text.includes('当前有多个待处理方案或账单'));
      assert.equal(h.calls.filter(c=>c.url.startsWith('/api/assistant/actions/')||c.url==='/api/assistant/confirm').length,0);
      assert.equal(h.calls.filter(c=>c.url==='/api/assistant/tasks'&&c.options.method==='POST').length,1);
      assert.equal(h.value.messages.find(m=>m.id===uuid(902)).approval.id,approval.id);
    }
    clickTextButton(h,'确认执行');await h.flush();
    const actions=h.calls.filter(c=>c.url.startsWith('/api/assistant/actions/'));
    assert.equal(actions.length,1);assert.equal(actions[0].url,`/api/assistant/actions/${approval.id}`);
    assert.equal(actions[0].body.decision,'approve');
    assert.ok(h.value.messages.some(m=>m.status==='pending'&&m.drafts?.[0].description==='吃饭'));
  } finally {h.unmount();}
});

test('multiple pending approvals survive new requests and cancelling one card preserves the other', async () => {
  const gift={id:uuid(910),summary:'准备记录送礼',count:1,expires_at:null};
  const note={id:uuid(911),summary:'准备创建便利贴',count:1,expires_at:null};
  const h=await ready({post:async url=>url.startsWith('/api/assistant/actions/')
    ? response({id:gift.id,status:'cancelled',text:'已取消送礼'})
    : response({action:'manage',reply:note.summary,drafts:[],query:null,approval:note})});
  try {
    h.restore({messages:[{id:uuid(912),role:'assistant',text:gift.summary,approval:gift}],input:''});
    writeComposer(h,'帮我记下买鸡蛋');h.click('发送');await h.flush();
    h.restore(h.value);
    assert.equal(h.value.messages.filter(m=>m.approval).length,2);
    for(const decision of ['好的','确认执行','取消','核对执行状态']) {
      writeComposer(h,decision);h.click('发送');await h.flush();
      assert.equal(h.calls.filter(c=>c.url.startsWith('/api/assistant/actions/')).length,0);
      assert.equal(h.value.messages.filter(m=>m.approval).length,2);
    }
    const giftCard=h.find(n=>n.props?.['data-message-id']===uuid(912));
    nodes(giftCard).find(n=>n.type==='Button'&&text(n)==='取消').props.onClick();await h.flush();
    const actions=h.calls.filter(c=>c.url.startsWith('/api/assistant/actions/'));
    assert.equal(actions.length,1);assert.equal(actions[0].url,`/api/assistant/actions/${gift.id}`);
    assert.equal(actions[0].body.decision,'cancel');
    assert.deepEqual(h.value.messages.filter(m=>m.approval).map(m=>m.approval.id),[note.id]);
  } finally {h.unmount();}
});

test('an unrelated request retains a reviewed draft confirmation without double-counting its source card', async () => {
  const batch=draftGroup(920,[datedDraft(921,'2026-10-09',member.id)]);
  const choice={batch_id:batch.id,draft_ids:[batch.drafts[0].id],snapshot:JSON.stringify(batch.drafts)};
  const h=await ready({post:async url=>url==='/api/assistant/confirm'
    ? response({count:1,transaction_ids:[uuid(923)]}) : response(chat('你好'))});
  try {
    h.restore({messages:[batch,{id:uuid(922),role:'assistant',text:'请核对后入账',confirmChoice:choice}],input:''});
    writeComposer(h,'你好');h.click('发送');await h.flush();
    h.restore(h.value);
    assert.equal(h.value.messages.find(m=>m.id===uuid(922)).confirmChoice.batch_id,batch.id);
    writeComposer(h,'确认执行');h.click('发送');await h.flush();
    assert.equal(h.calls.filter(c=>c.url==='/api/assistant/confirm').length,1);
    assert.equal(h.value.messages.find(m=>m.id===batch.id).status,'saved');
  } finally {h.unmount();}
});

test('pending approvals and new drafts survive actual local draft persistence and a fresh page mount', async () => {
  const storage=memoryStorage(),taskStore=new Map();
  const approval={id:uuid(930),summary:'准备记录送礼',count:1,expires_at:null};
  const options={realDraft:true,storage,taskStore,post:async()=>response({...record,drafts:[row(931,2000,member.id)],import_summary:null})};
  const h=await ready(options);
  try {
    h.restore({messages:[{id:uuid(932),role:'assistant',text:approval.summary,approval}],input:''});await settleDraft(h);
    writeComposer(h,'今天吃饭花了20');await settleDraft(h);h.click('发送');await settleDraft(h);
    assert.equal(savedConversation(storage).messages.find(m=>m.id===uuid(932)).approval.id,approval.id);
  } finally {h.unmount();}
  const refreshed=await ready(options);
  try {
    await settleDraft(refreshed);
    assert.equal(refreshed.value.messages.find(m=>m.id===uuid(932)).approval.id,approval.id);
    assert.ok(refreshed.value.messages.some(m=>m.status==='pending'&&m.drafts?.[0].amount==='20.00'));
    assert.equal(refreshed.calls.filter(c=>c.url.startsWith('/api/assistant/actions/')&&c.options.method==='POST').length,0);
  } finally {refreshed.unmount();}
});

test('statistics keep structured totals and the original analysis through conversation recovery',async()=>{
  const replyView={title:'日常收支统计',subtitle:'2026-10-01 至 2026-10-09',metrics:[{label:'支出',value:'¥320.00',primary:true}],sections:[],notices:[],analysis:true};
  const h=await ready({post:async()=>response({action:'query',reply:'本期主要用于餐饮。',drafts:[],query:null,reply_view:replyView})});
  try {writeComposer(h,'查本月统计');h.click('发送');await h.flush();
    assert.ok(h.text.includes('支出¥320.00'));assert.ok(h.text.includes('查看分析说明'));assert.ok(h.text.includes('本期主要用于餐饮'));
    h.restore(h.value);assert.ok(h.text.includes('支出¥320.00'));
    assert.equal(h.all(n=>n.type==='Button'&&text(n)==='确认执行').length,0);
  } finally {h.unmount();}
});

test('record replies fold long lists, preserve exports, and recover old structured record contexts',async()=>{
  const rows=Array.from({length:8},(_,i)=>({id:uuid(920+i),type:'expense',description:`测试消费${i}`,amount:'12.50',transaction_date:'2026-10-09'}));
  const h=await ready({post:async()=>response({action:'manage',reply:'旧的长文本',drafts:[],query:null,record_context:{resource:'transactions',rows},export_file:{name:'收支.csv',csv:'日期,金额'}})});
  try {writeComposer(h,'导出本月账目');h.click('发送');await h.flush();
    assert.ok(h.text.includes('展开其余 3 条'));assert.ok(h.text.includes('本次支出¥100.00'));assert.ok(h.text.includes('下载 收支.csv'));
    assert.equal(h.text.includes('旧的长文本'),false);assert.equal(h.text.includes(rows[0].id),false);
    h.restore({messages:[{id:uuid(919),role:'assistant',text:'旧回复',ledgerContext:{resource:'transactions',rows}}],input:''});
    assert.ok(h.text.includes('测试消费0'));assert.ok(h.text.includes('展开其余 3 条'));
  } finally {h.unmount();}
});

test('pure explanation stays prose and structured choices reuse the shared response shell',async()=>{
  const h=await ready();
  try {h.restore({messages:[{id:uuid(931),role:'assistant',text:'这是一段普通解释。'}],input:''});
    assert.equal(h.all(n=>n.props?.['aria-label']==='结构化回复').length,0);assert.ok(h.text.includes('这是一段普通解释'));
    h.restore({messages:[{id:uuid(932),role:'assistant',text:'请选择需要关联的流水',eventChoices:[{label:'关联 10 月 9 日 600 元支出',input:{operation:'create',kind:'gift_given'}}]}],input:''});
    assert.ok(h.text.includes('请选择下一步'));assert.ok(h.text.includes('关联 10 月 9 日 600 元支出'));
    assert.equal(h.all(n=>n.props?.['aria-label']==='补充事项信息').length,1);
  } finally {h.unmount();}
});


test('ordinary agent replies and clarification questions follow a quiet process row before and after restoration', async () => {
  const h = await ready();
  try {
    const messages = [
      { id: uuid(940), role: 'user', text: '你好' },
      { id: uuid(941), role: 'assistant', text: '你好！可以帮你记账或查询收支。',
        agent: { goal_id: uuid(941), goal: '你好', status: 'completed', steps: 1, tool_calls: 0 },
        process: { status: 'succeeded', phase: 'thinking', attempt: 1, hasReply: true, action: 'chat', draftCount: 0,
          execution: [{ id: 'reply', label: '理解请求', kind: 'model', state: 'done', startedAt: 1000, finishedAt: 2000, details: [] }] } },
      { id: uuid(942), role: 'user', text: '送礼500，转给妈600' },
      { id: uuid(943), role: 'assistant', text: '转给妈妈的600元，是代付这次礼金吗？',
        agent: { goal_id: uuid(943), goal: '送礼500，转给妈600', status: 'needs_input', steps: 1, tool_calls: 0 },
        process: { status: 'succeeded', phase: 'thinking', attempt: 1, hasReply: true, action: 'chat', draftCount: 0 } },
    ];
    for (const snapshot of [{ messages, input: '' }, null]) {
      h.restore(snapshot || h.value);
      assert.ok(h.text.includes('转给妈妈的600元，是代付这次礼金吗？'));
      assert.doesNotMatch(h.text, /任务完成|处理完成|重新提出请求|需要补充信息|修改请求/);
      assert.equal(h.all(node => node.props?.['data-assistant-agent-status'] !== undefined).length, 0);
      assert.equal(h.all(node => node.type?.name === 'AssistantProcessingDetails').length, 2);
      const replies = h.all(node => node.props?.['data-message-role'] === 'assistant');
      assert.equal(replies.length, 2);
      assert.ok(text(replies[0]).indexOf('处理过程') < text(replies[0]).indexOf('你好！'));
      assert.ok(text(replies[1]).indexOf('处理过程') < text(replies[1]).indexOf('转给妈妈的600元'));
    }
  } finally { h.unmount(); }
});

test('completed ledger work retains a folded process before its answer without a second completion label', async () => {
  const h = await ready();
  try {
    h.restore({ messages: [{ id: uuid(944), role: 'assistant', text: '本月餐饮支出共52元。',
      agent: { goal_id: uuid(944), goal: '本月餐饮花了多少', status: 'completed', steps: 2, tool_calls: 1 },
      process: { status: 'succeeded', phase: 'query', attempt: 1, hasReply: true, action: 'query', draftCount: 0,
        execution: [{ id: 'read', label: '查询账本记录', kind: 'tool', state: 'done', startedAt: 1000, finishedAt: 2000, details: ['匹配3笔餐饮记录'] }] } }], input: '' });
    assert.ok(h.text.indexOf('处理过程') < h.text.indexOf('本月餐饮支出共52元。'));
    assert.match(h.text, /查询账本记录.*匹配3笔餐饮记录/);
    assert.doesNotMatch(h.text, /任务完成|处理完成/);
    const component = h.find(node => node.type?.name === 'AssistantProcessingDetails');
    const process = component.type(component.props);
    assert.equal(process.type, 'details');
    assert.equal(process.props.open, undefined);
    assert.equal(h.all(node => node.props?.['data-assistant-agent-status'] !== undefined).length, 0);
  } finally { h.unmount(); }
});

test('pending agent approval keeps preview controls and its explicit cancellation without a task stop beside the result after reload', async () => {
  const h = await ready();
  try {
    const approval = { id: uuid(947), summary: '创建测试便利贴', expires_at: null,
      preview: { title: '新建便利贴', metrics: [], sections: [{ title: '内容', rows: [{ label: '正文', value: '测试提醒' }] }], notices: [] } };
    h.restore({ messages: [{ id: uuid(946), role: 'assistant', text: approval.summary, approval,
      agent: { goal_id: uuid(946), goal: '记个测试提醒', status: 'waiting_approval', steps: 1, tool_calls: 1, pending_action_id: approval.id } }], input: '' });
    h.restore(h.value);
    assert.ok(h.text.includes('新建便利贴'));
    assert.ok(h.text.includes('测试提醒'));
    assert.equal(h.all(node => node.props?.['aria-label'] === '停止任务').length, 0);
    assert.equal(h.all(node => node.props?.['data-assistant-agent-status'] !== undefined).length, 1);
    assert.doesNotMatch(h.text, /请核对下方方案|等待你的确认|处理结果见下方/);
    assert.ok(h.all(node => node.props?.onClick && text(node) === '取消').length);
    assert.equal(h.calls.filter(call => call.url.startsWith('/api/assistant/actions/') && call.options?.method === 'POST').length, 0);
  } finally { h.unmount(); }
});

test('member selection places the review after the answer while retaining the exact confirmation batch, including agent drafts', async () => {
  for (const agentFlow of [false, true]) {
    const id = uuid(970), draft = datedDraft(971, '2026-10-09', null);
    const agent = { goal_id: id, goal: '吃饭20', status: 'waiting_approval', steps: 1, tool_calls: 0, pending_batch_id: id };
    const h = await ready({ post: async (url, body) => {
      if (url === '/api/assistant') return response({ draft_id: body.draft_id, member });
      assert.equal(url, '/api/assistant/confirm');
      assert.equal(body.batch_id, id, 'member selection must preserve the confirmation identity');
      assert.equal(body.drafts[0].id, draft.id);
      assert.equal(body.drafts[0].member_id, member.id);
      return response({ count: 1 });
    } });
    h.restore({ messages: [draftGroup(970, [draft], { memberFlow: true, taskApplied: true,
      ...(agentFlow ? { agent, taskId: id, taskStatus: 'succeeded', taskAttempt: 1 } : {}) })], input: '' });
    nodes(h.control('选择记账成员')).find(node => node.type === 'Button' && text(node) === member.name).props.onClick();
    await h.flush();
    const selected = h.value;
    assert.deepEqual(selected.messages.map(m => m.role), ['assistant', 'user', 'assistant']);
    assert.equal(selected.messages[0].drafts, undefined);
    assert.equal(selected.messages[0].draftCardLink, id);
    assert.match(h.text, /已更新查看最新卡片/);
    assert.match(selected.messages[1].text, /支出人是「本人」/);
    assert.equal(selected.messages[2].id, id);
    assert.equal(selected.messages[2].drafts[0].id, draft.id);
    assert.equal(h.calls.filter(call => call.url === '/api/assistant/confirm').length, 0);
    h.restore(selected); await h.flush();
    assert.deepEqual(h.value.messages.map(m => m.id), selected.messages.map(m => m.id), 'restoration retains conversational order');
    clickTextButton(h, '确认 1 笔'); await h.flush();
    assert.equal(h.value.messages[2].status, 'saved');
    assert.equal(h.calls.filter(call => call.url === '/api/assistant/confirm').length, 1);
    h.unmount();
  }
});

test('member preview check shortcut targets its own group, needs no member, preserves the composer and cannot post twice', async () => {
  const pending = deferred();
  const h = await ready({ post: async (url, body) => {
    assert.equal(url, '/api/assistant/tasks');
    assert.equal(body.draft_batch.batch_id, uuid(980), 'an older preview must not check the latest group instead');
    assert.deepEqual(body.draft_batch.drafts.map(d => d.id), [uuid(981), uuid(982)]);
    assert.ok(body.draft_batch.drafts.every(d => d.member_id === null));
    assert.equal(body.images, undefined);
    assert.match(body.message, /是否存在重复记录.*只查询/);
    return pending.promise;
  } });
  try {
    const composerImages = [image('下次再识别')];
    h.restore({ messages: [draftGroup(980, [datedDraft(981, '2026-10-09', null), datedDraft(982, '2026-10-08', null)], { memberFlow: true }),
      draftGroup(983, [datedDraft(984, '2026-10-10', null)], { memberFlow: true })], input: '还没写完的说明', images: composerImages });
    const shortcut = h.all(node => node.type === 'Button' && text(node) === '核对是否存在重复记录')[0];
    assert.ok(shortcut); assert.equal(!!shortcut.props.disabled, false);
    shortcut.props.onClick(); shortcut.props.onClick(); await h.flush();
    assert.equal(h.calls.filter(c => c.url === '/api/assistant/tasks' && c.options.method === 'POST').length, 1);
    assert.equal(h.value.input, '还没写完的说明');
    assert.deepEqual(h.value.images, composerImages);
    pending.resolve(response({ action: 'chat', reply: '已核对，没有修改草稿或账本。', drafts: [], query: null })); await h.flush();
    assert.equal(h.value.messages.find(m => m.id === uuid(980)).drafts.length, 2);
    assert.equal(h.value.messages.find(m => m.id === uuid(983)).drafts.length, 1);
    assert.equal(h.calls.filter(c => ['/api/assistant/confirm', '/api/assistant/actions'].includes(c.url)).length, 0);
  } finally { h.unmount(); }
});

test('legacy removal previews migrate to reversible main-card selections without changing the reviewed scope', async () => {
  const h = await ready();
  try {
    const drafts = ['0.44','0.21','0.02'].map((amount,i)=>({...datedDraft(991+i,'2026-10-04'),type:'income',amount,description:`红包${i}`}));
    const target=draftGroup(990,drafts);
    h.restore({messages:[target,{id:uuid(998),role:'assistant',text:'旧预览',taskApplied:true,
      removeChoice:{batch_id:target.id,draft_ids:drafts.map(d=>d.id),excluded_ids:[drafts[0].id],snapshot:JSON.stringify(drafts)}}],input:''});
    const canonical=()=>h.value.messages.find(m=>m.id===target.id);
    assert.deepEqual(canonical().drafts.map(d=>!!d.softRemoved),[false,true,true]);
    assert.equal(h.value.messages.some(m=>m.removeChoice),false);
    assert.match(h.text,/确认 1 笔/);assert.match(h.text,/¥0.44/);
    assert.equal(h.all(n=>n.props?.['aria-label']==='恢复这笔草稿').length,2);
    h.restore(h.value);await h.flush();
    assert.deepEqual(canonical().drafts.map(d=>!!d.softRemoved),[false,true,true]);
    h.all(n=>n.props?.['aria-label']==='恢复这笔草稿')[0].props.onClick();h.render();
    assert.match(h.text,/确认 2 笔/);
    assert.equal(canonical().drafts.length,3);
    assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0);
  } finally {h.unmount();}
});

test('member selection only fills active rows; restoring an unassigned excluded row requires its own member selection', async () => {
  const drafts=[datedDraft(1101,'2026-10-09',null),datedDraft(1102,'2026-10-08',null)];
  const h=await ready({post:async(url,body)=>{
    assert.equal(url,'/api/assistant');assert.equal(body.operation,'select_member');
    return response({draft_id:body.draft_id,member});
  }});
  try {
    h.restore({messages:[draftGroup(1100,drafts,{memberFlow:true})],input:''});
    h.all(n=>n.props?.['aria-label']==='移除这笔草稿')[0].props.onClick();h.render();
    nodes(h.control('选择记账成员')).find(n=>n.type==='Button'&&text(n)===member.name).props.onClick();await h.flush();
    const target=()=>h.value.messages.find(m=>m.id===uuid(1100));
    assert.equal(target().drafts[0].softRemoved,true);assert.equal(target().drafts[0].member_id,null);
    assert.equal(target().drafts[1].member_id,member.id);
    h.click('恢复这笔草稿');await h.flush();
    assert.equal(target().drafts[0].softRemoved,false);assert.equal(target().drafts[0].member_id,null);
    assert.ok(h.control('选择记账成员'));
    assert.equal(h.calls.filter(c=>c.url==='/api/assistant/confirm').length,0);
  } finally {h.unmount();}
});

test('correcting a pending gift replaces the old card, revokes only that approval and blocks stale clicks and replay', async () => {
  const {validateLedgerEvent}=require('./helpers/assistant-contracts.cjs')('@/lib/ledger-event');
  const gift=amount=>validateLedgerEvent({operation:'create',kind:'gift_given',counterparty:'小李',amount_cents:amount,date:'2026-10-10',member_id:member.id});
  const preview=amount=>({title:'记录送礼 · 小李',metrics:[{label:'实际支出',value:`¥${(amount/100).toFixed(2)}`}],sections:[],notices:[]});
  const firstApproval={id:uuid(1201),summary:'准备记录200',count:1,expires_at:null,preview:preview(20000)};
  const secondApproval={id:uuid(1202),summary:'准备记录300',count:1,expires_at:null,preview:preview(30000)};
  const cancel=deferred();
  const h=await ready({post:async(url,body)=>{
    if(url==='/api/assistant/tasks')return response({action:'event',reply:'准备更正',drafts:[],query:null,event_context:{status:'pending',event_id:null,input:gift(30000)},approval:secondApproval});
    assert.equal(url,`/api/assistant/actions/${firstApproval.id}`);assert.equal(body.decision,'cancel');return cancel.promise;
  }});
  try {
    h.restore({messages:[{id:uuid(1200),role:'assistant',text:firstApproval.summary,approval:firstApproval,eventContext:{status:'pending',event_id:null,input:gift(20000)}}],input:''});
    const stale=h.find(n=>n.type?.name==='AssistantActionControls');
    writeComposer(h,'记错了 是300');h.click('发送');await h.flush();
    assert.equal(h.value.messages[0].cardUpdatedLink,h.value.messages.at(-1).id);
    assert.match(h.text,/已更新查看最新卡片/);assert.match(h.text,/¥300.00/);assert.doesNotMatch(h.text,/¥200.00/);
    const approve=h.all(n=>n.type==='Button'&&text(n)==='确认执行')[0];assert.ok(approve.props.disabled,'wait for old approval revocation');
    stale.props.onDecide('approve');await h.flush();
    assert.equal(h.calls.filter(c=>c.url.startsWith('/api/assistant/actions/')).length,1);
    cancel.resolve(response({id:firstApproval.id,status:'cancelled',text:'已取消旧方案'}));await h.flush();
    assert.equal(h.all(n=>n.type==='Button'&&text(n)==='确认执行')[0].props.disabled,false);
    const saved=h.value;h.restore(saved);await h.poll();
    assert.equal(h.value.messages[0].cardUpdatedLink,h.value.messages.at(-1).id);
    assert.equal(h.value.messages.filter(m=>m.approval).length,1);
    assert.equal(h.calls.filter(c=>c.body?.decision==='approve').length,0);
  } finally {h.unmount();}
});

test('an already-submitted old proposal blocks and cancels the replacement instead of exposing a second approval', async () => {
  const {validateLedgerEvent}=require('./helpers/assistant-contracts.cjs')('@/lib/ledger-event');
  const input=amount=>validateLedgerEvent({operation:'create',kind:'gift_given',counterparty:'小李',amount_cents:amount,date:'2026-10-10',member_id:member.id});
  const preview={title:'送礼更正',metrics:[],sections:[],notices:[]};
  const old={id:uuid(1301),summary:'old',count:1,expires_at:null,preview},fresh={...old,id:uuid(1302),summary:'new'};
  const h=await ready({post:async(url,body)=>{
    if(url==='/api/assistant/tasks')return response({action:'event',reply:'更正',drafts:[],query:null,approval:fresh,event_context:{status:'pending',event_id:null,input:input(30000)}});
    assert.equal(body.decision,'cancel');
    return response(url.endsWith(old.id)?{id:old.id,status:'succeeded',completed:1,text:'原方案已提交',event_context:{status:'saved',event_id:uuid(1399),input:input(20000)}}:{id:fresh.id,status:'cancelled',text:'新方案已取消'});
  }});
  try {
    h.restore({messages:[{id:uuid(1300),role:'assistant',text:'old',approval:old,eventContext:{status:'pending',event_id:null,input:input(20000)}}],input:''});
    writeComposer(h,'记错了 是300');h.click('发送');await h.flush();await h.flush();await h.flush();
    const latest=h.value.messages.find(m=>m.id!==uuid(1300)&&m.role==='assistant'&&!m.cardUpdatedLink);
    assert.equal(latest.approval,undefined);assert.equal(latest.replacementBlocked,true);
    assert.match(h.text,/原方案已提交执行/);
    assert.deepEqual(h.calls.filter(c=>c.body?.decision==='cancel').map(c=>c.url.split('/').at(-1)),[old.id,fresh.id]);
    assert.equal(h.calls.filter(c=>c.body?.decision==='approve').length,0);
  } finally {h.unmount();}
});

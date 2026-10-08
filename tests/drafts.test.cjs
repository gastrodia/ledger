/* eslint-disable @typescript-eslint/no-require-imports -- node:test harness runs as CommonJS. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function load(extra = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/form-drafts.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { exports, ...extra });
  return exports;
}
function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key), key: (index) => [...map.keys()][index] ?? null, get length() { return map.size; } };
}
const { FormDraftSession, draftKey, clearStoredDrafts, clearLegacyFormDrafts } = load();

test('retiring entry drafts preserves every AI conversation and unrelated browser state', () => {
  const storage = memoryStorage();
  const accounts = ['alice', 'bob:other'];
  const scopes = ['transaction:new', 'note:new', 'note:existing', 'giftbooks:new', 'giftbooks:existing',
    'giftbook-records:book:new', 'gifts-given:gift', 'loans:new:lent', 'loan-repayment:loan:entry'];
  for (const account of accounts) {
    for (const scope of scopes) storage.setItem(draftKey(account, scope), 'obsolete');
    storage.setItem(draftKey(account, 'assistant'), JSON.stringify({ version: 1, userId: account, value: {
      input: 'unfinished message', messages: [{ id: 'pending', drafts: [{ amount_cents: 1250 }] }],
      images: ['image-data'], confirmations: [{ id: 'pending-confirm' }], undos: [{ id: 'pending-undo' }],
      outbox: { requestId: 'pending-send' }, conversationId: 'conversation',
    } }));
  }
  storage.setItem('ledger:draft:logout', 'session-event');
  storage.setItem('ledger:transactions:v1:alice', 'filters-and-scroll');
  storage.setItem('unrelated', 'keep');
  const retainedKeys = accounts.map(account => draftKey(account, 'assistant'))
    .concat(['ledger:draft:logout', 'ledger:transactions:v1:alice', 'unrelated']);
  const before = retainedKeys.map(key => [key, storage.getItem(key)]);
  clearLegacyFormDrafts(storage);
  assert.equal(storage.length, retainedKeys.length);
  assert.deepEqual(retainedKeys.map(key => [key, storage.getItem(key)]), before);
  clearLegacyFormDrafts(storage);
  assert.deepEqual(retainedKeys.map(key => [key, storage.getItem(key)]), before);
});

test('drafts are isolated by verified account and form scope', () => {
  const storage = memoryStorage();
  new FormDraftSession(storage, 'alice', 'note:new').save({ content: 'private' }, true);
  assert.equal(new FormDraftSession(storage, 'bob', 'note:new').getSnapshot().hasDraft, false);
  assert.equal(new FormDraftSession(storage, 'alice', 'note:other').getSnapshot().hasDraft, false);
  assert.equal(new FormDraftSession(storage, 'alice', 'note:new').getSnapshot().hasDraft, true);
});

test('initial state and new typing never overwrite an unresolved draft', () => {
  const storage = memoryStorage();
  new FormDraftSession(storage, 'alice', 'note:new').save({ content: 'old draft' }, true);
  const key = draftKey('alice', 'note:new');
  const before = storage.getItem(key);
  const session = new FormDraftSession(storage, 'alice', 'note:new');
  session.save({ content: '' }, false);
  session.save({ content: 'new typing' }, true);
  assert.equal(storage.getItem(key), before);
  assert.equal(session.getSnapshot().hasDraft, true);
});

test('explicit restoration waits for restored form state before accepting edits', () => {
  const storage = memoryStorage();
  new FormDraftSession(storage, 'alice', 'note:new').save({ content: 'saved' }, true);
  const session = new FormDraftSession(storage, 'alice', 'note:new');
  assert.equal(session.restore().content, 'saved');
  session.save({ content: '' }, false);
  assert.equal(JSON.parse(storage.getItem(draftKey('alice', 'note:new'))).value.content, 'saved');
  session.save({ content: 'saved' }, true);
  session.save({ content: 'continued' }, true);
  assert.equal(JSON.parse(storage.getItem(draftKey('alice', 'note:new'))).value.content, 'continued');
});

test('restoration can normalize legacy drafts without losing an unresolved confirmation payload', () => {
  const { draftProtection } = load();
  const storage = memoryStorage();
  const commit = [{ id: 'same-batch', amount_cents: 300, member_id: 'alice' }];
  const saved = { messages: [{ status: 'pending', commit }], input: 'continue', legacy: true };
  new FormDraftSession(storage, 'alice', 'assistant').save(saved, true);
  const key = draftKey('alice', 'assistant');
  const before = storage.getItem(key);
  const session = new FormDraftSession(storage, 'alice', 'assistant');
  const restored = session.restore(value => ({ messages: value.messages, input: value.input, image: null }));
  assert.deepEqual(JSON.parse(JSON.stringify(restored.messages[0].commit)), commit);
  assert.equal(draftProtection(session.getSnapshot(), restored, true).isPersisted, false);
  session.save({ messages: [], input: '', image: null }, false);
  assert.equal(storage.getItem(key), before);
  session.save(restored, true);
  assert.equal(draftProtection(session.getSnapshot(), restored, true).isPersisted, true);
  assert.deepEqual(JSON.parse(storage.getItem(key)).value.messages[0].commit, commit);
  session.save({ ...restored, input: 'new input' }, true);
  assert.equal(JSON.parse(storage.getItem(key)).value.input, 'new input');
});

test('discarding the old draft allows current new input to be protected', () => {
  const storage = memoryStorage();
  new FormDraftSession(storage, 'alice', 'note:new').save({ content: 'old' }, true);
  const session = new FormDraftSession(storage, 'alice', 'note:new');
  session.discard();
  session.save({ content: 'new' }, true);
  assert.equal(JSON.parse(storage.getItem(draftKey('alice', 'note:new'))).value.content, 'new');
});

test('successful save clears the draft and suppresses effect rewriting the same value', () => {
  const storage = memoryStorage();
  const session = new FormDraftSession(storage, 'alice', 'note:new');
  const value = { content: 'submitted' };
  session.save(value, true);
  session.clear(value);
  session.save({ ...value }, true);
  assert.equal(storage.getItem(draftKey('alice', 'note:new')), null);
  session.save({ content: 'a later edit' }, true);
  assert.equal(session.getSnapshot().status, 'saved');
});

test('clearing a conversation can immediately preserve only unresolved confirmations', () => {
  const storage = memoryStorage();
  const key = draftKey('alice', 'assistant');
  const session = new FormDraftSession(storage, 'alice', 'assistant');
  const old = { messages: [{ text: 'old chat' }], input: 'old input', confirmations: [] };
  const commit = [{ id: 'original-row', amount_cents: 300, member_id: 'alice' }];
  const replacement = { messages: [], input: '', confirmations: [{ batch_id: 'original-batch', drafts: commit }] };
  session.save(old, true);
  session.clear(old, replacement, true);
  assert.deepEqual(JSON.parse(storage.getItem(key)).value, replacement);
  // A stale render, including its non-dirty variation, cannot overwrite or
  // remove the already-persisted reconciliation payload.
  session.save(old, true);
  session.save({ messages: [], input: '', confirmations: [] }, false);
  assert.deepEqual(JSON.parse(storage.getItem(key)).value, replacement);
  session.stop();
  const reopened = new FormDraftSession(storage, 'alice', 'assistant');
  assert.deepEqual(JSON.parse(JSON.stringify(reopened.restore())), replacement);
  reopened.save(replacement, true);
  reopened.save({ ...replacement, input: 'new conversation' }, true);
  assert.deepEqual(JSON.parse(storage.getItem(key)).value.confirmations, replacement.confirmations);
  assert.equal(JSON.parse(storage.getItem(key)).value.input, 'new conversation');
});

test('explicit clear repairs malformed storage without reviving stopped or revoked sessions', () => {
  const storage = memoryStorage();
  const key = draftKey('alice', 'assistant');
  const otherKey = draftKey('bob', 'assistant');
  storage.setItem(key, '{bad-json');
  storage.setItem(otherKey, 'untouched');
  const session = new FormDraftSession(storage, 'alice', 'assistant');
  assert.equal(session.getSnapshot().status, 'error');
  session.clear({ input: '' });
  assert.equal(storage.getItem(key), null);
  assert.equal(storage.getItem(otherKey), 'untouched');
  assert.equal(session.getSnapshot().status, 'ready');
  session.save({ input: 'new draft' }, true);
  assert.equal(JSON.parse(storage.getItem(key)).value.input, 'new draft');
  for (const stop of ['stop', 'revoke']) {
    storage.setItem(key, '{bad-json');
    const inactive = new FormDraftSession(storage, 'alice', 'assistant');
    inactive[stop]();
    inactive.clear({ input: '' }, { input: 'must not write' }, true);
    assert.equal(storage.getItem(key), '{bad-json');
  }
});

test('returning edited or restored content to the original state removes the draft', () => {
  const storage = memoryStorage();
  const session = new FormDraftSession(storage, 'alice', 'note:new');
  session.save({ content: 'typed' }, true);
  session.save({ content: '' }, false);
  assert.equal(storage.getItem(draftKey('alice', 'note:new')), null);
  session.save({ content: 'restorable' }, true);
  const restored = new FormDraftSession(storage, 'alice', 'note:new');
  const value = restored.restore();
  restored.save(value, true);
  restored.save({ content: '' }, false);
  assert.equal(storage.getItem(draftKey('alice', 'note:new')), null);
});

test('storage read, write and removal failures are reported without throwing', () => {
  const readFailure = new FormDraftSession({ getItem() { throw Error('denied'); } }, 'alice', 'note:new');
  assert.equal(readFailure.getSnapshot().status, 'error');
  assert.doesNotThrow(() => readFailure.save({ content: 'still editable' }, true));
  const storage = memoryStorage();
  storage.setItem = () => { throw Error('quota'); };
  const session = new FormDraftSession(storage, 'alice', 'note:new');
  session.save({ content: 'text' }, true);
  assert.equal(session.getSnapshot().status, 'error');
  storage.removeItem = () => { throw Error('denied'); };
  assert.doesNotThrow(() => session.clear({ content: 'text' }));
  assert.equal(session.getSnapshot().status, 'error');
});

test('logout clears application drafts and stops active and cross-tab sessions from rewriting', () => {
  const storage = memoryStorage();
  const events = {};
  const browser = load({ window: { localStorage: storage, addEventListener: (name, fn) => { events[name] = fn; } } });
  const session = new browser.FormDraftSession(storage, 'alice', 'note:new');
  session.save({ content: 'private' }, true);
  storage.setItem('unrelated', 'keep');
  browser.subscribeDraftLogout(() => session.revoke());
  const epoch = browser.getDraftEpoch();
  assert.equal(browser.clearDraftsOnLogout(), true);
  assert.ok(browser.getDraftEpoch() > epoch);
  session.save({ content: 'stale effect' }, true);
  assert.equal(storage.getItem(browser.draftKey('alice', 'note:new')), null);
  assert.equal(storage.getItem('unrelated'), 'keep');
  const otherSession = new browser.FormDraftSession(storage, 'bob', 'note:new');
  otherSession.save({ content: 'tab' }, true);
  browser.subscribeDraftLogout(() => otherSession.revoke());
  events.storage({ key: 'ledger:draft:logout' });
  otherSession.save({ content: 'late effect' }, true);
  assert.equal(storage.getItem(browser.draftKey('bob', 'note:new')), null);
});

test('bulk cleanup does not skip keys as storage indices shrink', () => {
  const storage = memoryStorage();
  ['one', 'two', 'three'].forEach((scope) => new FormDraftSession(storage, 'alice', scope).save({ text: scope }, true));
  clearStoredDrafts(storage);
  assert.equal(storage.length, 0);
});


test('a fresh form can save a new entry identical to the previously submitted entry', () => {
  const storage = memoryStorage();
  const session = new FormDraftSession(storage, 'alice', 'transaction:new');
  const value = { amount: '100', description: '午餐' };
  session.save(value, true);
  session.clear(value);
  session.save(value, true);
  assert.equal(storage.getItem(draftKey('alice', 'transaction:new')), null);
  session.save({ amount: '', description: '' }, false);
  session.save(value, true);
  assert.equal(JSON.parse(storage.getItem(draftKey('alice', 'transaction:new'))).value.description, '午餐');
});

test('leave protection tracks the exact current snapshot, not a prior saved status', () => {
  const { draftProtection } = load();
  const storage = memoryStorage();
  const session = new FormDraftSession(storage, 'alice', 'note:new');
  const first = { content: 'first' };
  session.save(first, true);
  assert.equal(draftProtection(session.getSnapshot(), first, true).needsProtection, false);
  assert.equal(draftProtection(session.getSnapshot(), { content: 'next' }, true).needsProtection, true);
  assert.equal(draftProtection(session.getSnapshot(), { content: '' }, false).needsProtection, false);
  session.save({ content: 'next' }, true);
  assert.equal(draftProtection(session.getSnapshot(), { content: 'next' }, true).isPersisted, true);
});

test('restored draft comparison ignores nested object key order but preserves content and screenshot ordering', () => {
  const { draftProtection } = load();
  const storage = memoryStorage();
  const previous = { conversationId: 'conversation', messages: [{ id: 'message', text: 'previous' }],
    images: [{ data: 'first', name: 'one' }, { data: 'second', name: 'two' }], input: '', outbox: null };
  new FormDraftSession(storage, 'alice', 'assistant').save(previous, true);
  const key = draftKey('alice', 'assistant');
  const session = new FormDraftSession(storage, 'alice', 'assistant');
  const restored = session.restore(value => ({ outbox: value.outbox, input: value.input,
    images: value.images.map(image => ({ name: image.name, data: image.data })),
    messages: value.messages.map(message => ({ text: message.text, id: message.id })), conversationId: value.conversationId }));
  const persisted = storage.getItem(key);
  session.save({ messages: [], input: '' }, true);
  assert.equal(storage.getItem(key), persisted, 'a genuinely stale initial render must still be rejected');
  session.save(previous, true);
  assert.equal(draftProtection(session.getSnapshot(), restored, true).isPersisted, true);
  const reorderedImages = { ...previous, images: [...previous.images].reverse() };
  assert.equal(draftProtection(session.getSnapshot(), reorderedImages, true).isPersisted, false);
  session.save(reorderedImages, true);
  assert.deepEqual(JSON.parse(storage.getItem(key)).value.images, reorderedImages.images, 'image order changes are actual edits');
  const sending = { ...reorderedImages, outbox: { id: 'task', message: 'new request' } };
  session.save(sending, true);
  assert.equal(draftProtection(session.getSnapshot(), sending, true).isPersisted, true);
  assert.deepEqual(JSON.parse(storage.getItem(key)).value.outbox, sending.outbox, 'restoration must not silently block the next send');
});

test('a failed newer write and an unresolved old draft both require leave confirmation', () => {
  const { draftProtection } = load();
  const storage = memoryStorage();
  const session = new FormDraftSession(storage, 'alice', 'note:new');
  session.save({ content: 'old' }, true);
  const pending = new FormDraftSession(storage, 'alice', 'note:new');
  assert.equal(draftProtection(pending.getSnapshot(), { content: 'new' }, true).needsProtection, true);
  storage.setItem = () => { throw Error('quota'); };
  session.save({ content: 'new' }, true);
  assert.equal(draftProtection(session.getSnapshot(), { content: 'new' }, true).needsProtection, true);
  session.save({ content: 'old' }, true);
  assert.equal(draftProtection(session.getSnapshot(), { content: 'old' }, true).isPersisted, true);
});

function draftHookHarness(storage) {
  const exports = {};
  const slots = [];
  let index = 0;
  let pendingEffects = [];
  const authRequests = [];
  const events = {};
  const browser = { localStorage: storage, addEventListener: (name, fn) => { events[name] = fn; }, removeEventListener() {} };
  const drafts = load({ window: browser });
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../hooks/use-form-draft.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const react = {
    useRef(initial) {
      const key = index++;
      return slots[key] ?? (slots[key] = { current: initial });
    },
    useState(initial) {
      const key = index++;
      if (!slots[key]) slots[key] = { value: initial };
      return [slots[key].value, value => { slots[key].value = value; }];
    },
    useSyncExternalStore(_subscribe, getSnapshot) { index++; return getSnapshot(); },
    useEffect(callback, deps) {
      const key = index++;
      const previous = slots[key];
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      pendingEffects.push(() => {
        previous?.cleanup?.();
        slots[key] = { deps, cleanup: callback() };
      });
    },
  };
  vm.runInNewContext(source, {
    exports,
    require: key => key === 'react' ? react : drafts,
    window: browser,
    AbortController,
    fetch(_url, options) {
      return new Promise(resolve => { authRequests.push({ signal: options.signal, resolve }); });
    },
  });
  return {
    render(options) {
      index = 0;
      pendingEffects = [];
      const result = exports.useFormDraft(options);
      pendingEffects.forEach(effect => effect());
      return result;
    },
    async identify(userId = 'alice', requestIndex = authRequests.length - 1) {
      authRequests[requestIndex].resolve({ ok: true, json: async () => ({ user: { id: userId } }) });
      await new Promise(resolve => setImmediate(resolve));
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    logout: drafts.clearDraftsOnLogout,
    authRequests,
  };
}

test('synchronous draft persistence preserves conversation recovery when a large outbox exceeds storage quota', async () => {
  const storage = memoryStorage();
  const harness = draftHookHarness(storage);
  const previous = { conversationId: 'recoverable-conversation', messages: [{ id: 'existing', text: 'already reviewed' }], outbox: null };
  const options = { scope: 'assistant', value: previous, dirty: true, autoRestore: true, onRestore: value => value };
  assert.equal(harness.render(options).persist(previous), false, 'identity must be verified before writing');
  await harness.identify();
  const hook = harness.render(options);
  const key = draftKey('alice', 'assistant');
  const saved = storage.getItem(key);
  const write = storage.setItem;
  storage.setItem = (name, value) => {
    if (value.length > 1000) throw Error('QuotaExceededError');
    write(name, value);
  };
  assert.equal(hook.persist({ ...previous, outbox: { images: ['x'.repeat(1500)] } }), false);
  assert.equal(storage.getItem(key), saved, 'failed upload persistence must never erase the previous conversation');
  const lightweight = { ...previous, messages: [...previous.messages, { id: 'pending', taskId: 'stable-task' }] };
  assert.equal(hook.persist(lightweight), true);
  assert.deepEqual(JSON.parse(storage.getItem(key)).value, lightweight, 'stable task IDs are durable before the request is dispatched');
  harness.unmount();
});

test('synchronous draft persistence cannot write after account logout', async () => {
  const storage = memoryStorage();
  const harness = draftHookHarness(storage);
  const options = { scope: 'assistant', value: { input: 'original' }, dirty: true, onRestore() {} };
  harness.render(options);
  await harness.identify();
  const hook = harness.render(options);
  harness.logout();
  assert.equal(hook.persist({ input: 'late request' }), false);
  assert.equal(storage.getItem(draftKey('alice', 'assistant')), null);
  harness.unmount();
});

test('auto restore waits for a verified account, runs once, and protects the initial empty render', async () => {
  const storage = memoryStorage();
  const saved = { messages: [{ status: 'pending', commit: [{ id: 'batch', amount_cents: 300 }] }], input: 'saved text' };
  new FormDraftSession(storage, 'alice', 'assistant').save(saved, true);
  new FormDraftSession(storage, 'bob', 'assistant').save({ messages: [], input: 'other account' }, true);
  const key = draftKey('alice', 'assistant');
  const before = storage.getItem(key);
  const harness = draftHookHarness(storage);
  const restored = [];
  const options = { scope: 'assistant', value: { messages: [], input: '' }, dirty: false, autoRestore: true, onRestore: value => { restored.push(value); } };
  assert.equal(harness.render(options).status, 'checking');
  assert.equal(restored.length, 0);
  assert.equal(storage.getItem(key), before);
  await harness.identify();
  assert.equal(restored.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(restored[0])), saved);
  assert.equal(harness.render(options).hasDraft, false);
  assert.equal(storage.getItem(key), before);
  const resumed = { ...options, value: restored[0], dirty: true };
  harness.render(resumed);
  harness.render({ ...resumed, value: { ...saved, input: 'continued' } });
  assert.equal(JSON.parse(storage.getItem(key)).value.input, 'continued');
  assert.deepEqual(JSON.parse(storage.getItem(key)).value.messages[0].commit, saved.messages[0].commit);
  assert.equal(restored.length, 1);
  assert.equal(JSON.parse(storage.getItem(draftKey('bob', 'assistant'))).value.input, 'other account');
  harness.unmount();
});

test('manual restoration remains the default for other forms', async () => {
  const storage = memoryStorage();
  new FormDraftSession(storage, 'alice', 'note:new').save({ content: 'saved' }, true);
  const harness = draftHookHarness(storage);
  const restored = [];
  const options = { scope: 'note:new', value: { content: '' }, dirty: false, onRestore: value => { restored.push(value); } };
  harness.render(options);
  await harness.identify();
  const draft = harness.render(options);
  assert.equal(draft.hasDraft, true);
  assert.equal(restored.length, 0);
  draft.restore();
  assert.equal(restored[0].content, 'saved');
  harness.unmount();
});

test('auto restore accepts a normalized callback result and can save subsequent edits', async () => {
  const storage = memoryStorage();
  new FormDraftSession(storage, 'alice', 'assistant').save({ messages: [], input: 'image caption' }, true);
  const harness = draftHookHarness(storage);
  let restored;
  const options = { scope: 'assistant', value: { messages: [], input: '', image: null }, dirty: false, autoRestore: true, onRestore: value => {
    restored = { ...value, image: null };
    return restored;
  } };
  harness.render(options);
  await harness.identify();
  harness.render(options);
  harness.render({ ...options, value: restored, dirty: true });
  harness.render({ ...options, value: { ...restored, input: 'continued caption' }, dirty: true });
  assert.deepEqual(JSON.parse(storage.getItem(draftKey('alice', 'assistant'))).value, { messages: [], input: 'continued caption', image: null });
  harness.unmount();
});

test('clear during identity checking suppresses auto restore and only clears the verified scope', async () => {
  const storage = memoryStorage();
  new FormDraftSession(storage, 'alice', 'assistant').save({ input: 'old chat' }, true);
  new FormDraftSession(storage, 'alice', 'note:new').save({ input: 'note' }, true);
  new FormDraftSession(storage, 'bob', 'assistant').save({ input: 'other account' }, true);
  const harness = draftHookHarness(storage);
  let restores = 0;
  const options = { scope: 'assistant', value: { input: '' }, dirty: false, autoRestore: true, onRestore: () => { restores++; } };
  harness.render(options).clear();
  await harness.identify();
  assert.equal(restores, 0);
  assert.equal(storage.getItem(draftKey('alice', 'assistant')), null);
  assert.equal(JSON.parse(storage.getItem(draftKey('alice', 'note:new'))).value.input, 'note');
  assert.equal(JSON.parse(storage.getItem(draftKey('bob', 'assistant'))).value.input, 'other account');
  assert.equal(harness.render(options).status, 'ready');
  harness.unmount();
});

test('clear requested before an immediate unmount still finishes after identity verification', async () => {
  for (const replacement of [undefined, { input: '', confirmations: [{ batch_id: 'same-batch', drafts: [{ amount_cents: 300 }] }] }]) {
    const storage = memoryStorage();
    new FormDraftSession(storage, 'alice', 'assistant').save({ input: 'old chat' }, true);
    new FormDraftSession(storage, 'bob', 'assistant').save({ input: 'other account' }, true);
    const harness = draftHookHarness(storage);
    let restores = 0;
    const options = { scope: 'assistant', value: { input: '' }, dirty: false, autoRestore: true, onRestore: () => { restores++; } };
    const draft = harness.render(options);
    if (replacement) draft.clear(replacement, true);
    else draft.clear();
    harness.unmount();
    assert.equal(harness.authRequests[0].signal.aborted, false);
    await harness.identify();
    assert.equal(restores, 0);
    const raw = storage.getItem(draftKey('alice', 'assistant'));
    if (replacement) assert.deepEqual(JSON.parse(raw).value, replacement);
    else assert.equal(raw, null);
    assert.equal(JSON.parse(storage.getItem(draftKey('bob', 'assistant'))).value.input, 'other account');
  }
});

test('logout invalidates a detached clear before its identity response can write recovery data', async () => {
  const storage = memoryStorage();
  new FormDraftSession(storage, 'alice', 'assistant').save({ input: 'old chat' }, true);
  const harness = draftHookHarness(storage);
  let restores = 0;
  harness.render({ scope: 'assistant', value: { input: '' }, dirty: false, autoRestore: true, onRestore: () => { restores++; } })
    .clear({ input: '', confirmations: [{ batch_id: 'old-batch' }] }, true);
  harness.unmount();
  harness.logout();
  await harness.identify();
  assert.equal(restores, 0);
  assert.equal(storage.getItem(draftKey('alice', 'assistant')), null);
});

test('clear with a replacement persists immediately and ignores the previous hook render', async () => {
  const storage = memoryStorage();
  const harness = draftHookHarness(storage);
  const old = { input: 'old chat', confirmations: [] };
  const replacement = { input: '', confirmations: [{ batch_id: 'same-batch', drafts: [{ amount_cents: 300 }] }] };
  const options = { scope: 'assistant', value: old, dirty: true, autoRestore: true, onRestore() {} };
  const beforeIdentity = harness.render(options);
  await harness.identify();
  // This closure precedes publication of the initialized session to React state.
  // The bridge still clears the verified session synchronously.
  beforeIdentity.clear(replacement, true);
  const key = draftKey('alice', 'assistant');
  assert.deepEqual(JSON.parse(storage.getItem(key)).value, replacement);
  harness.render(options);
  assert.deepEqual(JSON.parse(storage.getItem(key)).value, replacement);
  harness.render({ ...options, value: replacement });
  harness.render({ ...options, value: { ...replacement, input: 'new chat' } });
  assert.equal(JSON.parse(storage.getItem(key)).value.input, 'new chat');
  assert.deepEqual(JSON.parse(storage.getItem(key)).value.confirmations, replacement.confirmations);
  harness.unmount();
});

test('a checking clear updater preserves stored confirmations while restoring only the cleared snapshot', async () => {
  for (const detached of [false, true]) {
    const storage = memoryStorage();
    const commit = [{ id: 'same-row', amount_cents: 300, member_id: 'alice' }];
    const old = { messages: [{ id: 'same-batch', text: 'private old chat', status: 'pending', commit }], input: 'old text', image: { name: 'old image' } };
    new FormDraftSession(storage, 'alice', 'assistant').save(old, true);
    new FormDraftSession(storage, 'bob', 'assistant').save({ input: 'other account' }, true);
    const harness = draftHookHarness(storage);
    const restored = [];
    const empty = { messages: [], input: '', image: null, confirmations: [] };
    const options = { scope: 'assistant', value: empty, dirty: false, autoRestore: true, onRestore: value => { restored.push(value); return value; } };
    harness.render(options).clear(stored => ({
      messages: [], input: '', image: null,
      confirmations: stored?.messages?.filter(message => message.commit).map(message => ({ batch_id: message.id, drafts: message.commit })) ?? [],
    }), next => next.confirmations.length > 0);
    if (detached) harness.unmount();
    await harness.identify();
    const expected = { messages: [], input: '', image: null, confirmations: [{ batch_id: 'same-batch', drafts: commit }] };
    const key = draftKey('alice', 'assistant');
    assert.deepEqual(JSON.parse(storage.getItem(key)).value, expected);
    assert.equal(restored.length, detached ? 0 : 1);
    if (!detached) {
      assert.deepEqual(JSON.parse(JSON.stringify(restored[0])), expected);
      harness.render(options);
      assert.deepEqual(JSON.parse(storage.getItem(key)).value, expected);
      harness.render({ ...options, value: restored[0], dirty: true });
      harness.unmount();
    }
    const reopened = new FormDraftSession(storage, 'alice', 'assistant');
    assert.deepEqual(JSON.parse(JSON.stringify(reopened.restore())), expected);
    assert.equal(JSON.parse(storage.getItem(draftKey('bob', 'assistant'))).value.input, 'other account');
  }
});

test('a clear updater does not retain an empty draft after checking or invoke obsolete restoration', async () => {
  const storage = memoryStorage();
  new FormDraftSession(storage, 'alice', 'assistant').save({ messages: [{ text: 'old chat' }], input: 'old text' }, true);
  const harness = draftHookHarness(storage);
  const restored = [];
  const empty = { messages: [], input: '', confirmations: [] };
  const options = { scope: 'assistant', value: empty, dirty: false, autoRestore: true, onRestore: value => { restored.push(value); return value; } };
  harness.render(options).clear(() => empty, next => next.confirmations.length > 0);
  await harness.identify();
  assert.equal(restored.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(restored[0])), empty);
  assert.equal(storage.getItem(draftKey('alice', 'assistant')), null);
  harness.render(options);
  assert.equal(storage.getItem(draftKey('alice', 'assistant')), null);
  harness.unmount();
});

test('logout and unmount block late identity responses from restoring local drafts', async () => {
  for (const stop of ['logout', 'unmount']) {
    const storage = memoryStorage();
    new FormDraftSession(storage, 'alice', 'assistant').save({ input: 'private text' }, true);
    const harness = draftHookHarness(storage);
    let restored = false;
    harness.render({ scope: 'assistant', value: { input: '' }, dirty: false, autoRestore: true, onRestore: () => { restored = true; } });
    harness[stop]();
    assert.equal(harness.authRequests[0].signal.aborted, true);
    await harness.identify();
    assert.equal(restored, false);
    harness.unmount();
  }
});

function guardHarness(confirm) {
  const exports = {};
  const refs = [];
  let index = 0;
  const cleanups = [];
  const messages = [];
  const listeners = new Map();
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../hooks/use-form-leave-guard.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const dependencies = {
    react: {
      useRef(initial) { const key = index++; return refs[key] ?? (refs[key] = { current: initial }); },
      useLayoutEffect(callback) { const cleanup = callback(); if (cleanup) cleanups.push(cleanup); },
      useEffect(callback) { const cleanup = callback(); if (cleanup) cleanups.push(cleanup); },
    },
    '@/hooks/use-confirm': { useConfirm: () => ({ confirm }) },
    '@/hooks/use-toast': { toast: { info: (message) => messages.push(message) } },
  };
  vm.runInNewContext(source, { exports, require: (key) => dependencies[key], window: {
    addEventListener: (event, listener) => listeners.set(event, listener),
    removeEventListener: (event, listener) => { if (listeners.get(event) === listener) listeners.delete(event); },
  } });
  return { listeners, render(options) { index = 0; return exports.useFormLeaveGuard(options); }, unmount() { cleanups.forEach((cleanup) => cleanup()); }, messages };
}

test('unchanged forms close directly; unuploaded files retain a cancel/edit option', async () => {
  let prompts = 0;
  let answer = false;
  let closed = 0;
  const harness = guardHarness(async () => { prompts++; return answer; });
  let guard = harness.render({ isDirty: false });
  assert.equal(await guard.requestClose(() => closed++), true);
  assert.equal(prompts, 0);
  guard = harness.render({ isDirty: false, hasPendingFiles: true });
  assert.equal(await guard.requestClose(() => closed++), false);
  assert.equal(closed, 1);
  answer = true;
  assert.equal(await guard.requestClose(() => closed++), true);
  assert.equal(closed, 2);
});

test('unsaved input warns on closing and unloading without mentioning local drafts', async () => {
  const prompts = [];
  let closed = false;
  const harness = guardHarness(async prompt => { prompts.push(prompt); return false; });
  const guard = harness.render({ isDirty: true });
  assert.equal(await guard.requestClose(() => { closed = true; }), false);
  assert.equal(closed, false);
  assert.match(prompts[0].description, /尚未保存/);
  assert.doesNotMatch(prompts[0].description, /草稿/);
  let prevented = false;
  const event = { preventDefault() { prevented = true; } };
  harness.listeners.get('beforeunload')(event);
  assert.equal(prevented, true);
  assert.equal(event.returnValue, '');
  harness.unmount();
  assert.equal(harness.listeners.has('beforeunload'), false);
});

test('an in-flight save blocks close even if it starts while confirmation is open', async () => {
  let resolve;
  let closed = 0;
  let prompts = 0;
  const harness = guardHarness(() => { prompts++; return new Promise((done) => { resolve = done; }); });
  let guard = harness.render({ isDirty: true, isBusy: true });
  assert.equal(await guard.requestClose(() => closed++), false);
  assert.equal(prompts, 0);
  guard = harness.render({ isDirty: true, isBusy: false });
  const pending = guard.requestClose(() => closed++);
  assert.equal(await guard.requestClose(() => closed++), false);
  harness.render({ isDirty: true, isBusy: true });
  resolve(true);
  assert.equal(await pending, false);
  assert.equal(closed, 0);
});

test('confirmation cannot close a replacement form after the original form unmounts', async () => {
  let resolve;
  let closed = 0;
  const harness = guardHarness(() => new Promise((done) => { resolve = done; }));
  const guard = harness.render({ isDirty: true });
  const pending = guard.requestClose(() => closed++);
  harness.unmount();
  resolve(true);
  assert.equal(await pending, false);
  assert.equal(closed, 0);
});

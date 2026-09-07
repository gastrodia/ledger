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
const { FormDraftSession, draftKey, clearStoredDrafts } = load();

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

function guardHarness(confirm) {
  const exports = {};
  const refs = [];
  let index = 0;
  const cleanups = [];
  const messages = [];
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../hooks/use-form-leave-guard.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const dependencies = {
    react: {
      useRef(initial) { const key = index++; return refs[key] ?? (refs[key] = { current: initial }); },
      useLayoutEffect(callback) { const cleanup = callback(); if (cleanup) cleanups.push(cleanup); },
      useEffect() {},
    },
    '@/hooks/use-confirm': { useConfirm: () => ({ confirm }) },
    '@/hooks/use-toast': { toast: { info: (message) => messages.push(message) } },
  };
  vm.runInNewContext(source, { exports, require: (key) => dependencies[key] });
  return { render(options) { index = 0; return exports.useFormLeaveGuard(options); }, unmount() { cleanups.forEach((cleanup) => cleanup()); }, messages };
}

test('persisted text closes directly; unuploaded files retain a cancel/edit option', async () => {
  let prompts = 0;
  let answer = false;
  let closed = 0;
  const harness = guardHarness(async () => { prompts++; return answer; });
  let guard = harness.render({ draft: { needsProtection: false } });
  assert.equal(await guard.requestClose(() => closed++), true);
  assert.equal(prompts, 0);
  guard = harness.render({ draft: { needsProtection: false }, hasPendingFiles: true });
  assert.equal(await guard.requestClose(() => closed++), false);
  assert.equal(closed, 1);
  answer = true;
  assert.equal(await guard.requestClose(() => closed++), true);
  assert.equal(closed, 2);
});

test('an in-flight save blocks close even if it starts while confirmation is open', async () => {
  let resolve;
  let closed = 0;
  let prompts = 0;
  const harness = guardHarness(() => { prompts++; return new Promise((done) => { resolve = done; }); });
  let guard = harness.render({ draft: { needsProtection: true }, isBusy: true });
  assert.equal(await guard.requestClose(() => closed++), false);
  assert.equal(prompts, 0);
  guard = harness.render({ draft: { needsProtection: true }, isBusy: false });
  const pending = guard.requestClose(() => closed++);
  assert.equal(await guard.requestClose(() => closed++), false);
  harness.render({ draft: { needsProtection: true }, isBusy: true });
  resolve(true);
  assert.equal(await pending, false);
  assert.equal(closed, 0);
});

test('confirmation cannot close a replacement form after the original form unmounts', async () => {
  let resolve;
  let closed = 0;
  const harness = guardHarness(() => new Promise((done) => { resolve = done; }));
  const guard = harness.render({ draft: { needsProtection: true } });
  const pending = guard.requestClose(() => closed++);
  harness.unmount();
  resolve(true);
  assert.equal(await pending, false);
  assert.equal(closed, 0);
});

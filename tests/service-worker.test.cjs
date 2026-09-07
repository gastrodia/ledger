/* eslint-disable @typescript-eslint/no-require-imports -- node:test worker harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function worker({ offline = false } = {}) {
  const handlers = {};
  const deleted = [];
  const cached = new Map();
  const fallback = new Response('offline page');
  vm.runInNewContext(fs.readFileSync('public/sw.js', 'utf8'), {
    URL, Response,
    self: {
      location: { origin: 'https://ledger.test' },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      keys: async () => ['ledger-pwa-v1', 'ledger-pwa-v2', 'ledger-pwa-v3', 'other-app'],
      delete: async (key) => { deleted.push(key); },
      open: async () => ({
        addAll: async (urls) => { urls.forEach(url => cached.set(url, fallback)); },
        match: async (url) => cached.get(url),
      }),
    },
    fetch: async () => {
      if (offline) throw new Error('offline');
      return new Response('current deployment');
    },
  });
  return { handlers, deleted, cached };
}

test('route, prefetch, API and chunk requests bypass SW caches', () => {
  const { handlers } = worker();
  for (const [path, headers] of [
    ['/dashboard/giftbooks?_rsc=old', { RSC: '1' }],
    ['/dashboard/notes?_rsc=prefetch', { RSC: '1', 'Next-Router-Prefetch': '1' }],
    ['/dashboard/giftbooks', {}],
    ['/_next/static/chunks/old.js', {}],
    ['/api/transactions', {}],
    ['/manifest.webmanifest', {}],
  ]) {
    let intercepted = false;
    handlers.fetch({
      request: { method: 'GET', mode: 'cors', url: `https://ledger.test${path}`, headers: new Headers(headers) },
      respondWith: () => { intercepted = true; },
    });
    assert.equal(intercepted, false, path);
  }
});

test('activation removes previous ledger caches but preserves unrelated caches', async () => {
  const { handlers, deleted } = worker();
  let pending;
  handlers.activate({ waitUntil: promise => { pending = promise; } });
  await pending;
  assert.deepEqual(deleted, ['ledger-pwa-v1', 'ledger-pwa-v2']);
});

for (const offline of [false, true]) {
  test(`document navigation uses ${offline ? 'offline fallback' : 'current network response'}`, async () => {
    const { handlers, cached } = worker({ offline });
    let pending;
    handlers.install({ waitUntil: promise => { pending = promise; } });
    await pending;
    assert.deepEqual([...cached.keys()], ['/offline.html']);
    handlers.fetch({
      request: { method: 'GET', mode: 'navigate', url: 'https://ledger.test/dashboard' },
      respondWith: promise => { pending = promise; },
    });
    assert.equal(await (await pending).text(), offline ? 'offline page' : 'current deployment');
  });
}

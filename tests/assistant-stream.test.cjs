/* eslint-disable @typescript-eslint/no-require-imports -- isolate the browser transport without server dependencies. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/assistant-stream.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports: exportsObject, TextDecoder, DOMException, Error,
  require: name => { const contract = require('./helpers/assistant-contracts.cjs')(name); if (contract) return contract; throw new Error(`Unexpected runtime dependency: ${name}`); },
});
const { readAssistantStream } = exportsObject;
const encoder = new TextEncoder();
const chat = { action: 'chat', reply: '你好，我可以帮你记账。', drafts: [], query: null };
const draft = { id: 'draft-1', type: 'expense', amount_cents: 1200, category_id: null, member_id: null,
  transaction_date: '2026-10-08', description: '午餐', payment_method: null, note: '' };
const record = { action: 'record', reply: '请核对账目', drafts: [draft], query: null };
const plain = value => JSON.parse(JSON.stringify(value));
const line = event => `${JSON.stringify(event)}\n`;
function controlled(type = 'application/x-ndjson; charset=utf-8', status = 200) {
  let controller;
  let cancelled = false;
  const stream = new ReadableStream({ start(value) { controller = value; }, cancel() { cancelled = true; } });
  return { response: new Response(stream, { status, headers: { 'content-type': type } }),
    send(value) { controller.enqueue(typeof value === 'string' ? encoder.encode(value) : value); },
    close() { controller.close(); }, get cancelled() { return cancelled; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('progress is visible while the result is pending; complete cards are returned only after the terminal event', async () => {
  const feed = controlled();
  const seen = [];
  let finished = false;
  const pending = readAssistantStream(feed.response, event => seen.push(plain(event)))
    .then(result => { finished = true; return result; });
  feed.send(line({ type: 'status', phase: 'thinking' }) + line({ type: 'delta', text: '请核对' }));
  await tick();
  assert.equal(finished, false);
  assert.deepEqual(seen, [{ type: 'status', phase: 'thinking' }, { type: 'delta', text: '请核对' }]);
  const resultLine = line({ type: 'result', plan: record });
  feed.send(resultLine.slice(0, -8));
  await tick();
  assert.equal(finished, false);
  assert.equal(seen.some(event => 'drafts' in event || 'plan' in event), false);
  feed.send(resultLine.slice(-8));
  assert.deepEqual(plain(await pending), record);
  assert.equal(feed.cancelled, true, 'do not leave a terminal result connection open');
  assert.equal(feed.response.body.locked, false);
});

test('split UTF-8 code points, CRLF, empty lines and a result without final newline decode correctly', async () => {
  const content = '\r\n' + line({ type: 'delta', text: '中文 🧾\n第二行' }).replace(/\n$/, '\r\n')
    + JSON.stringify({ type: 'result', plan: chat });
  const feed = controlled();
  const seen = [];
  const pending = readAssistantStream(feed.response, event => seen.push(plain(event)));
  for (const byte of encoder.encode(content)) feed.send(new Uint8Array([byte]));
  feed.close();
  assert.deepEqual(plain(await pending), chat);
  assert.deepEqual(seen, [{ type: 'delta', text: '中文 🧾\n第二行' }]);
});

test('EOF after progress or a partial result fails and never delivers draft data', async () => {
  for (const suffix of ['', '{"type":"result","plan":{"action":"record","drafts":[']) {
    const feed = controlled();
    const seen = [];
    const pending = readAssistantStream(feed.response, event => seen.push(plain(event)));
    feed.send(line({ type: 'delta', text: '正在整理' }) + suffix);
    feed.close();
    await assert.rejects(pending, /回复中断|回复格式无效/);
    assert.deepEqual(seen, [{ type: 'delta', text: '正在整理' }]);
    assert.equal(feed.response.body.locked, false);
  }
});

test('terminal server errors reject even after deltas and cancel further processing', async () => {
  const feed = controlled();
  const seen = [];
  const pending = readAssistantStream(feed.response, event => seen.push(plain(event)));
  feed.send(line({ type: 'delta', text: '截至今天' }) + line({ type: 'error', message: '查询失败，请重试。' })
    + line({ type: 'result', plan: chat }));
  await assert.rejects(pending, /查询失败/);
  assert.equal(feed.cancelled, true);
  assert.deepEqual(seen, [{ type: 'delta', text: '截至今天' }]);
});

test('abort cancels an idle reader immediately, including before reading and from a progress callback', async () => {
  for (const when of ['before', 'idle', 'callback']) {
    const feed = controlled();
    const abort = new AbortController();
    if (when === 'before') abort.abort();
    const pending = readAssistantStream(feed.response, () => abort.abort(), abort.signal);
    const rejected = assert.rejects(pending, error => error.name === 'AbortError');
    if (when === 'idle') abort.abort();
    if (when === 'callback') feed.send(line({ type: 'status', phase: 'images' }) + line({ type: 'result', plan: chat }));
    await rejected;
    assert.equal(feed.cancelled, true);
    assert.equal(feed.response.body.locked, false);
  }
});

test('legacy JSON responses retain plan and error compatibility without progress callbacks', async () => {
  const seen = [];
  const response = new Response(JSON.stringify(record), { headers: { 'content-type': 'application/json' } });
  assert.deepEqual(plain(await readAssistantStream(response, event => seen.push(event))), record);
  assert.deepEqual(seen, []);
  await assert.rejects(readAssistantStream(new Response(JSON.stringify({ error: '未登录' }), {
    status: 401, headers: { 'content-type': 'application/json' },
  }), () => {}), /未登录/);
  await assert.rejects(readAssistantStream(new Response(JSON.stringify(chat), {
    status: 500, headers: { 'content-type': 'application/json' },
  }), () => {}), /请求失败/);
});

test('malformed events, unknown phases, invalid UTF-8 and unusable results fail cleanly', async () => {
  const malformed = [
    'not JSON\n', line(null), line({ type: 'status', phase: 'invented' }), line({ type: 'delta', text: 123 }),
    line({ type: 'result', plan: {} }), line({ type: 'result', plan: { ...chat, action: 'invented' } }),
    line({ type: 'result', plan: { ...chat, reply: null } }),
    line({ type: 'result', plan: { ...record, drafts: [{ ...draft, amount_cents: '1200' }] } }),
    line({ type: 'result', plan: { ...record, drafts: [{ ...draft, note: undefined }] } }),
    line({ type: 'result', plan: { ...record, drafts: [] } }),
    line({ type: 'result', plan: { ...chat, drafts: [draft] } }),
    line({ type: 'result', plan: { ...chat, action: 'update', update: { member_id: 'member-1' } } }),
    line({ type: 'result', plan: { ...chat, import_summary: { warnings: [null] } } }),
    new Uint8Array([0xff, 0xfe]),
  ];
  for (const input of malformed) {
    const feed = controlled();
    const pending = readAssistantStream(feed.response, () => {});
    feed.send(input);
    await assert.rejects(pending, /回复格式无效/);
    assert.equal(feed.cancelled, true);
  }
});

test('event, reply and total transport budgets bound malformed and runaway streams', async () => {
  const fixtures = [
    'x'.repeat(256 * 1024 + 1),
    line({ type: 'delta', text: 'x'.repeat(32 * 1024) }).repeat(3),
    '\n'.repeat(2 * 1024 * 1024 + 1),
  ];
  for (const fixture of fixtures) {
    const feed = controlled();
    const pending = readAssistantStream(feed.response, () => {});
    feed.send(fixture);
    await assert.rejects(pending, /回复格式无效/);
    assert.equal(feed.cancelled, true);
  }
});

test('exceptions in consumer rendering cancel the stream and propagate to the caller', async () => {
  const feed = controlled();
  const pending = readAssistantStream(feed.response, () => { throw new Error('render failed'); });
  feed.send(line({ type: 'delta', text: 'hello' }));
  await assert.rejects(pending, /render failed/);
  assert.equal(feed.cancelled, true);
});

test('draft removal requires a complete exclusive target in both JSON and streaming responses', async () => {
  const removal = { action: 'remove', reply: '正在更新草稿', drafts: [], query: null, remove: { batch_id: 'batch', draft_ids: ['draft'] } };
  for (const type of ['application/json', 'application/x-ndjson']) {
    const response = new Response(type === 'application/json' ? JSON.stringify(removal) : line({ type: 'result', plan: removal }), { headers: { 'content-type': type } });
    assert.deepEqual(plain(await readAssistantStream(response, () => {})), removal);
  }
  for (const patch of [{ remove: null }, { remove: { batch_id: 'batch', draft_ids: [] } }, { action: 'chat' }, { drafts: [draft] }, { undo: removal.remove }]) {
    await assert.rejects(readAssistantStream(new Response(JSON.stringify({ ...removal, ...patch })), () => {}), /格式无效/);
  }
});

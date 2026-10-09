/* eslint-disable @typescript-eslint/no-require-imports -- exercise authenticated task routes and production SQL with isolated fixtures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const { NextResponse } = require('next/server');

const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const categoryId = id(1), memberId = id(2), taskId = id(3), conversationId = id(4), messageId = id(5);
const draft = { id: id(6), type: 'expense', amount_cents: 1200, category_id: categoryId, member_id: memberId,
  transaction_date: '2026-10-08', description: '午餐', payment_method: null, note: '' };
const record = { action: 'record', reply: '请核对后确认入账。', drafts: [draft], query: null };
const imageRecord = { action: 'record', reply: record.reply, drafts: [{ type: 'expense', amount_cents: 1200,
  category: 1, member: 1, date: draft.transaction_date, description: draft.description, payment_method: null, note: '' }] };
const imageBatch = settings => {
  const content = settings.messages.at(-1).content;
  const label = content.filter(part => part.type === 'text').at(-1).text;
  const localIndex = Number(label.match(/source\.image_index=(\d+)/)[1]);
  const targetIndex = Number(label.match(/原始第(\d+)张/)[1]);
  return { ...imageRecord, outcome: 'complete', date_context: null, drafts: imageRecord.drafts.map(value => ({ ...value, description: `午餐 ${targetIndex}`,
    source: { image_index: localIndex, row_index: 1, time: '12:00', transaction_id: null, kind: 'statement' } })) };
};
const chat = { action: 'chat', reply: '可以把收支发给我。', drafts: [], query: null };
const plain = value => JSON.parse(JSON.stringify(value));
const body = (patch = {}) => ({ id: taskId, conversation_id: conversationId, user_message_id: messageId,
  message: '午餐花了12元', display_text: '午餐花了12元', today: '2026-10-08', ...patch });
const request = (value = body(), signal = new AbortController().signal, url = 'http://localhost/api/assistant/tasks') => ({
  json: async () => value, signal, url, nextUrl: new URL(url),
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function loader(dependencies, globals = {}) {
  const modules = new Map();
  const load = file => {
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, { exports, require: name => {
      if (name in dependencies) return dependencies[name];
      if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
      if (name.startsWith('.')) return load(path.join(path.dirname(file), `${name}.ts`));
      assert.fail(`Unexpected dependency ${name}`);
    }, Error, SyntaxError, Date, JSON, Number, URL, Response, TextEncoder, TextDecoder,
    ReadableStream, AbortController, AbortSignal, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
    process: { env: {} }, ...globals }, { filename: file });
    return exports;
  };
  return load;
}

function fixture({ sql, session = { userId: 'owner' }, provider = {} } = {}) {
  const background = [], paidCalls = [];
  const database = sql || (() => assert.fail('invalid requests must not query the database'));
  database.query ||= async () => assert.fail('invalid requests must not query the database');
  class BailianError extends Error {
    constructor(status, code) { super('provider failure'); this.status = status; this.code = code; }
  }
  const invoke = fn => async (...args) => { paidCalls.push(args); return fn(...args); };
  const load = loader({
    '@/lib/assistant-task-dispatch': { runAndContinueAssistantTask: async (...args) => { await load('lib/assistant-tasks.ts').runAssistantTask(...args); } },
    'next/server': { NextResponse, after: callback => background.push(callback) },
    ai: require('ai'), zod: require('zod'),
    'node:crypto': crypto, '@/lib/db': { sql: database }, '@/lib/auth': { getSession: async () => session },
    '@/lib/assistant-output': { ASSISTANT_OUTPUT_SCHEMA: {} },
    '@/lib/bailian': {
      BAILIAN_ASSISTANT_MODEL: 'fixture-object', BAILIAN_SUMMARY_MODEL: 'fixture-summary', BailianError,
      bailianConfig: () => ({}), bailianFailure: error => ({ status: error.status || 502, message: 'AI 服务暂时无法连接，请稍后重试。' }),
      bailianObject: invoke(provider.bailianObject || (async settings => settings.schemaName === 'ledger_image_batch' ? imageBatch(settings) : settings.schemaName === 'ledger_image_import' ? imageRecord : record)),
      bailianObjectStream: invoke(provider.bailianObjectStream || (async (settings, partial) => {
        const output = settings.schemaName === 'ledger_image_batch' ? imageBatch(settings) : settings.schemaName === 'ledger_image_import' ? imageRecord : record;
        partial(output); return output;
      })),
      bailianText: invoke(provider.bailianText || (async () => assert.fail('unexpected query summary'))),
      bailianStream: invoke(provider.bailianStream || (async () => assert.fail('unexpected query summary stream'))),
    },
  });
  return { load, tasks: load('lib/assistant-tasks.ts'), background, paidCalls };
}

// Opt in to execute the exact schema and CAS statements against disposable
// PostgreSQL. This never connects to DATABASE_URL or touches account data.
const PGlite = process.env.LEDGER_TASKS_PGLITE_MODULE
  ? require(process.env.LEDGER_TASKS_PGLITE_MODULE).PGlite : null;

async function databaseFixture(t, options = {}) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE TABLE users (id VARCHAR(36) PRIMARY KEY);
    CREATE TABLE categories (id VARCHAR(36) PRIMARY KEY,user_id VARCHAR(36),name TEXT,type TEXT,icon TEXT,created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE members (id VARCHAR(36) PRIMARY KEY,user_id VARCHAR(36),name TEXT,avatar TEXT,created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE transactions (id VARCHAR(36) PRIMARY KEY,user_id VARCHAR(36),type TEXT,amount NUMERIC,
      category_id VARCHAR(36),member_id VARCHAR(36),transaction_date TIMESTAMP,description TEXT);
    INSERT INTO users VALUES ('owner'),('foreign');
    INSERT INTO categories(id,user_id,name,type) VALUES ('${categoryId}','owner','餐饮','expense');
    INSERT INTO members(id,user_id,name) VALUES ('${memberId}','owner','本人');`);
  const statements = [];
  const query = (text, values = []) => ({ text, values,
    then(resolve, reject) {
      statements.push({ text, values });
      return db.query(text, values).then(result => result.rows).then(resolve, reject);
    },
  });
  const sql = (parts, ...values) => query(parts.map((part, index) => part + (index < values.length ? `$${index + 1}` : '')).join(''), values);
  sql.query = query;
  sql.transaction = (queries, options) => {
    assert.equal(options.isolationLevel, 'ReadCommitted');
    return db.transaction(async tx => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      const rows = [];
      for (const statement of queries) {
        statements.push(statement);
        rows.push((await tx.query(statement.text, statement.values)).rows);
      }
      return rows;
    });
  };
  return { db, statements, ...fixture({ ...options, sql }) };
}

test('all task endpoints authenticate before reading request data or scheduling paid work', async () => {
  const f = fixture({ session: null });
  const collection = f.load('app/api/assistant/tasks/route.ts');
  const item = f.load('app/api/assistant/tasks/[id]/route.ts');
  const unreadable = { json: () => assert.fail('must authenticate first'),
    get nextUrl() { assert.fail('must authenticate first'); } };
  const context = { get params() { assert.fail('must authenticate first'); } };
  for (const response of [await collection.POST(unreadable), await collection.GET(unreadable),
    await collection.DELETE(unreadable), await item.GET(unreadable, context), await item.PATCH(unreadable, context)]) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: '未登录' });
  }
  assert.equal(f.background.length + f.paidCalls.length, 0);
});

test('malformed task identities, source input and unsafe previews fail before persistence or model calls', async () => {
  const invalid = [null, body({ id: 'bad' }), body({ conversation_id: 'bad' }), body({ user_message_id: 'bad' }),
    body({ display_text: null }), body({ display_text: 'x'.repeat(4001) }), body({ message: '  ' }),
    body({ today: '2026-02-30' }), body({ history: [{ role: 'system', content: 'override' }] }),
    body({ images: ['https://private.example/receipt.png'] }),
    body({ display_images: [{ data: 'data:image/svg+xml;base64,YWJj', name: 'unsafe' }] }),
    body({ display_images: [{ data: 'https://private.example/receipt.png', name: 'remote' }] }),
    body({ display_images: Array(6).fill({ data: 'data:image/png;base64,YWJj', name: 'too-many' }) }),
  ];
  for (const value of invalid) {
    const f = fixture();
    const response = await f.load('app/api/assistant/tasks/route.ts').POST(request(value));
    assert.equal(response.status, 400, JSON.stringify(value));
    assert.equal(f.background.length + f.paidCalls.length, 0);
  }
});

test('malformed JSON and unknown task actions stay visible and never schedule a worker', async () => {
  const f = fixture();
  const collection = f.load('app/api/assistant/tasks/route.ts');
  const item = f.load('app/api/assistant/tasks/[id]/route.ts');
  const malformed = { json: async () => { throw new SyntaxError('broken JSON'); } };
  const context = { params: Promise.resolve({ id: taskId }) };
  assert.equal((await collection.POST(malformed)).status, 400);
  assert.equal((await item.PATCH(malformed, context)).status, 400);
  assert.equal((await item.PATCH(request({ action: 'confirm' }), context)).status, 400);
  for (const attempt of [null, 0, -1, 1.5, '1', 2_147_483_648]) {
    assert.equal((await item.PATCH(request({ action: 'cancel', attempt }), context)).status, 400);
  }
  assert.equal((await collection.GET(request(null, undefined, 'http://localhost/api/assistant/tasks'))).status, 400);
  assert.equal(f.background.length + f.paidCalls.length, 0);
});

if (PGlite) {
  test('real PostgreSQL: identical creation is idempotent, changed content conflicts, and every read is owner scoped', async t => {
    const f = await databaseFixture(t);
    const [first, replay] = await Promise.all([f.tasks.createAssistantTask('owner', body()), f.tasks.createAssistantTask('owner', body())]);
    assert.deepEqual(plain(first), plain(replay));
    assert.equal(first.status, 'queued');
    assert.equal(first.attempt, 1);
    await assert.rejects(f.tasks.createAssistantTask('owner', body({ message: '另一笔支出' })), error => error.status === 409);
    await assert.rejects(f.tasks.getAssistantTask('foreign', taskId), error => error.status === 404);
    await assert.rejects(f.tasks.changeAssistantTask('foreign', taskId, 'cancel'), error => error.status === 404);
    assert.deepEqual(plain(await f.tasks.listAssistantTasks('foreign', conversationId)), []);
    const sameIdOtherOwner = await f.tasks.createAssistantTask('foreign', body({ message: '另一个账户的消息' }));
    assert.equal(sameIdOtherOwner.input.message, '另一个账户的消息');
    assert.equal((await f.tasks.getAssistantTask('owner', taskId)).input, undefined, 'polls omit potentially large message previews');
    const listed = await f.tasks.listAssistantTasks('owner', conversationId);
    assert.deepEqual(plain(listed), [plain(await f.tasks.getAssistantTask('owner', taskId))]);
    assert.equal(listed[0].input, undefined, 'routine recovery polls omit image previews');
    assert.deepEqual(plain((await f.tasks.getAssistantTask('owner', taskId, true)).input), plain(first.input));
    assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM assistant_tasks')).rows[0].count, 2);
    assert.equal(f.paidCalls.length, 0, 'saving and recovering a task do not generate a second result');
  });

  test('real PostgreSQL: duplicate workers claim once, preserve a recoverable result and never post ledger entries', async t => {
    const started = deferred(), finish = deferred();
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async (_settings, partial) => {
      partial(record); started.resolve(); await finish.promise; return record;
    } } });
    await f.tasks.createAssistantTask('owner', body());
    const running = f.tasks.runAssistantTask('owner', taskId);
    await started.promise;
    await f.tasks.runAssistantTask('owner', taskId);
    assert.equal(f.paidCalls.length, 1);
    assert.equal(f.paidCalls[0][0].timeoutMs, undefined, 'ordinary background conversation keeps the default provider timeout');
    assert.equal((await f.tasks.getAssistantTask('owner', taskId)).status, 'running');
    finish.resolve(); await running;
    const saved = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(saved.status, 'succeeded');
    assert.equal(saved.result.action, 'record');
    assert.equal(saved.result.drafts[0].amount_cents, 1200);
    assert.notEqual(saved.result.drafts[0].id, draft.id, 'server validates and assigns the result draft identity');
    await f.tasks.runAssistantTask('owner', taskId);
    assert.equal(f.paidCalls.length, 1);
    assert.deepEqual(plain((await f.tasks.listAssistantTasks('owner', conversationId))[0].result), plain(saved.result));
    assert.equal((await f.db.query('SELECT payload FROM assistant_tasks')).rows[0].payload, null, 'successful recognition releases original image payloads');
    assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows, []);
    assert.equal(f.statements.some(statement => /(?:INSERT INTO|UPDATE|DELETE FROM) transactions/i.test(statement.text)), false);
  });

  test('real PostgreSQL: request abort after acceptance does not cancel the detached worker or lose its result', async t => {
    const started = deferred(), finish = deferred();
    let upstreamSignal;
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async (_settings, partial, signal) => {
      upstreamSignal = signal; partial(chat); started.resolve(); await finish.promise; return chat;
    } } });
    const controller = new AbortController();
    const route = f.load('app/api/assistant/tasks/route.ts');
    const accepted = await route.POST(request(body(), controller.signal));
    assert.equal(accepted.status, 202);
    assert.equal(accepted.headers.get('cache-control'), 'no-store');
    assert.equal(f.background.length, 1);
    controller.abort();
    const running = f.background[0]();
    await started.promise;
    assert.equal(upstreamSignal.aborted, false);
    finish.resolve(); await running;
    const recovered = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(recovered.status, 'succeeded');
    assert.equal(recovered.result.reply, chat.reply);
  });

  test('real PostgreSQL: returning to a queued conversation resumes work and fetches display input only on demand', async t => {
    const f = await databaseFixture(t);
    const image = { data: 'data:image/png;base64,YWJj', name: '账单截图' };
    await f.tasks.createAssistantTask('owner', body({ images: [image.data], display_images: [image] }));
    const list = await f.load('app/api/assistant/tasks/route.ts').GET(request(null, undefined,
      `http://localhost/api/assistant/tasks?conversation_id=${conversationId}`));
    assert.equal(list.status, 200);
    assert.equal((await list.json()).tasks[0].input, undefined);
    assert.equal(f.background.length, 1, 'recovering an accepted but unstarted task schedules its worker');
    const item = f.load('app/api/assistant/tasks/[id]/route.ts');
    const restored = await item.GET(request(null, undefined, `http://localhost/api/assistant/tasks/${taskId}?include_input=1`),
      { params: Promise.resolve({ id: taskId }) });
    assert.deepEqual((await restored.json()).task.input.display_images, [image]);
    assert.equal(f.background.length, 2);
    await Promise.all(f.background.map(callback => callback()));
    assert.equal(f.paidCalls.length, 1, 'list and detail recovery cannot execute the same queued task twice');
    assert.equal(f.paidCalls[0][0].schemaName, 'ledger_image_batch');
    assert.equal(f.paidCalls[0][0].timeoutMs, 90000, 'each image target has a bounded provider budget');
    assert.equal((await f.tasks.getAssistantTask('owner', taskId)).status, 'succeeded');
  });

  test('real PostgreSQL: invalid compact screenshot references fail without persisting draft cards or posting transactions', async t => {
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async (settings, partial) => {
      const output = imageBatch(settings);
      const invalid = { ...output, drafts: [{ ...output.drafts[0], member: 2 }] };
      partial(invalid); return invalid;
    } } });
    await f.tasks.createAssistantTask('owner', body({ images: ['data:image/png;base64,YWJj'] }));
    await f.tasks.runAssistantTask('owner', taskId);
    const failed = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.result, null);
    assert.equal(failed.text, '');
    assert.match(failed.error, /截图识别格式|引用无效/);
    assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows, []);
    assert.equal((await f.db.query('SELECT payload FROM assistant_tasks')).rows[0].payload.images.length, 1);
  });

  test('real PostgreSQL: explicit cancellation reaches a running provider and never reappears as a failed or succeeded task', async t => {
    const started = deferred(), aborted = deferred();
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async (_settings, partial, signal) => {
      partial(chat); started.resolve();
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => {
        aborted.resolve(); reject(signal.reason);
      }, { once: true }));
    } } });
    await f.tasks.createAssistantTask('owner', body());
    const running = f.tasks.runAssistantTask('owner', taskId);
    await started.promise;
    assert.equal((await f.tasks.changeAssistantTask('owner', taskId, 'cancel', 1)).status, 'cancelled');
    await aborted.promise; await running;
    const stopped = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(stopped.status, 'cancelled');
    assert.equal(stopped.result, null);
    assert.equal(stopped.error, null);
    assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows, []);
  });

  test('real PostgreSQL: a delayed old worker and duplicate retries cannot overwrite the next attempt', async t => {
    const oldStarted = deferred(), oldFinish = deferred();
    let calls = 0;
    const freshPlan = { ...chat, reply: '这是重试后的完整回复。' };
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async (_settings, partial) => {
      if (++calls === 1) { oldStarted.resolve(); await oldFinish.promise; return { ...chat, reply: '旧任务的过期回复。' }; }
      partial(freshPlan); return freshPlan;
    } } });
    await f.tasks.createAssistantTask('owner', body());
    const oldWorker = f.tasks.runAssistantTask('owner', taskId);
    await oldStarted.promise;
    await f.tasks.changeAssistantTask('owner', taskId, 'cancel');
    const retries = await Promise.all([
      f.tasks.changeAssistantTask('owner', taskId, 'retry', 1), f.tasks.changeAssistantTask('owner', taskId, 'retry', 1),
    ]);
    assert.ok(retries.every(task => task.attempt === 2 && task.status === 'queued'));
    await f.tasks.runAssistantTask('owner', taskId);
    oldFinish.resolve(); await oldWorker;
    const current = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(current.attempt, 2);
    assert.equal(current.status, 'succeeded');
    assert.equal(current.result.reply, freshPlan.reply);
    assert.equal((await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1)).attempt, 2);
    assert.equal(calls, 2);
  });

  test('real PostgreSQL: a delayed stop only cancels its observed attempt and preserves a newer queued or running retry', async t => {
    const started = deferred(), finish = deferred();
    let signal;
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async (_settings, _partial, upstreamSignal) => {
      signal = upstreamSignal; started.resolve(); await finish.promise; return chat;
    } } });
    await f.tasks.createAssistantTask('owner', body());
    const item = f.load('app/api/assistant/tasks/[id]/route.ts');
    const context = { params: Promise.resolve({ id: taskId }) };
    assert.equal((await item.PATCH(request({ action: 'cancel', attempt: 1 }), context)).status, 200);
    assert.equal((await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1)).attempt, 2);
    const queued = await item.PATCH(request({ action: 'cancel', attempt: 1 }), context);
    assert.equal((await queued.json()).task.status, 'queued');
    const worker = f.tasks.runAssistantTask('owner', taskId);
    await started.promise;
    const running = await item.PATCH(request({ action: 'cancel', attempt: 1 }), context);
    assert.equal((await running.json()).task.status, 'running');
    assert.equal(signal.aborted, false);
    finish.resolve(); await worker;
    const completed = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(completed.attempt, 2);
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.result.reply, chat.reply);
    await f.tasks.createAssistantTask('owner', body({ id: id(7), user_message_id: id(8) }));
    const current = await f.tasks.changeAssistantTask('owner', id(7), 'cancel');
    assert.equal(current.status, 'cancelled', 'legacy cancellation without an attempt still stops the current task');
  });

  test('real PostgreSQL: an expired worker becomes a retryable visible error without changing another owner or task', async t => {
    const f = await databaseFixture(t);
    await f.tasks.createAssistantTask('owner', body());
    await f.tasks.createAssistantTask('owner', body({ id: id(7), user_message_id: id(8), conversation_id: id(9) }));
    await f.tasks.createAssistantTask('foreign', body());
    await f.db.query("UPDATE assistant_tasks SET status='running',lease_until=NOW()-INTERVAL '1 second'");
    const expired = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(expired.status, 'failed');
    assert.match(expired.error, /超时.*重试/);
    const untouched = (await f.db.query("SELECT status FROM assistant_tasks WHERE user_id='foreign' OR id=$1", [id(7)])).rows;
    assert.ok(untouched.every(row => row.status === 'running'));
    await assert.rejects(f.tasks.changeAssistantTask('owner', taskId, 'retry', 0), error => error.status === 400);
    const retried = await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1);
    assert.equal(retried.status, 'queued');
    assert.equal(retried.attempt, 2);
    assert.equal(retried.error, null);
  });

  test('real PostgreSQL: provider failures keep the original input for retry and never expose a partial plan as success', async t => {
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async (_settings, partial) => {
      partial({ action: 'chat', reply: '可以帮你' });
      throw new Error('upstream dropped');
    } } });
    const image = 'data:image/png;base64,YWJj';
    await f.tasks.createAssistantTask('owner', body({ images: [image], display_images: [{ data: image, name: '账单截图' }] }));
    await f.tasks.runAssistantTask('owner', taskId);
    const failed = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.result, null);
    assert.equal(failed.text, '', 'image partial responses never pretend to be a complete recognition');
    assert.match(failed.error, /无法连接/);
    assert.deepEqual((await f.db.query('SELECT payload FROM assistant_tasks')).rows[0].payload.images, [image]);
    const retried = await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1);
    assert.equal(retried.phase, 'images');
    assert.equal(retried.text, '');
    assert.equal(retried.result, null);
  });

  test('real PostgreSQL: clearing one conversation cancels its active work and removes retry sources within that owner only', async t => {
    const f = await databaseFixture(t);
    await f.tasks.createAssistantTask('owner', body());
    await f.tasks.createAssistantTask('owner', body({ id: id(7), user_message_id: id(8), conversation_id: id(9) }));
    await f.tasks.createAssistantTask('foreign', body());
    await f.tasks.cancelConversationTasks('owner', conversationId);
    assert.equal((await f.tasks.getAssistantTask('owner', taskId)).status, 'cancelled');
    await assert.rejects(f.tasks.changeAssistantTask('owner', taskId, 'retry', 1), error => error.status === 409);
    assert.equal((await f.tasks.getAssistantTask('foreign', taskId)).status, 'queued');
    assert.equal((await f.tasks.getAssistantTask('owner', id(7))).status, 'queued');
    await f.tasks.runAssistantTask('owner', taskId);
    assert.equal(f.paidCalls.length, 0);
    const item = f.load('app/api/assistant/tasks/[id]/route.ts');
    assert.equal((await item.GET(request(), { params: Promise.resolve({ id: id(99) }) })).status, 404);
  });

  test('real PostgreSQL: clearing before a delayed send prevents that conversation from being recreated', async t => {
    const f = await databaseFixture(t);
    await f.tasks.cancelConversationTasks('owner', conversationId);
    await assert.rejects(f.tasks.createAssistantTask('owner', body()), error => error.status === 409 && /清空/.test(error.message));
    assert.deepEqual(plain(await f.tasks.listAssistantTasks('owner', conversationId)), []);
    await f.tasks.createAssistantTask('foreign', body());
    await f.tasks.createAssistantTask('owner', body({ conversation_id: id(9) }));
    assert.equal((await f.tasks.getAssistantTask('owner', taskId)).conversation_id, id(9));
    assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM assistant_tasks')).rows[0].count, 2);
  });

  test('real PostgreSQL: five images run in bounded waves and publish only the complete ordered plan', async t => {
    let active = 0, peak = 0;
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return imageBatch(settings);
    } } });
    await f.tasks.createAssistantTask('owner', body({ images: Array(5).fill('data:image/png;base64,YWJj') }));
    let continuation = await f.tasks.runAssistantTask('owner', taskId);
    assert.ok(continuation && continuation.attempt === 1);
    let saved = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(saved.status, 'queued');
    assert.equal(saved.result, null);
    assert.deepEqual(plain(saved.image_progress), { total: 5, completed: 2, failed: [], active: [], stage: 'recognizing' });
    assert.equal((await f.db.query('SELECT image_checkpoint FROM assistant_tasks')).rows[0].image_checkpoint.results.filter(Boolean).length, 2);
    assert.equal(JSON.stringify(saved).includes('image_checkpoint'), false);
    const oldContinuation = continuation;
    continuation = await f.tasks.runAssistantTask('owner', taskId, continuation);
    assert.ok(continuation && continuation.runToken !== oldContinuation.runToken);
    assert.equal(await f.tasks.runAssistantTask('owner', taskId, oldContinuation), null, 'replayed continuation cannot claim a later queued wave');
    assert.equal(f.paidCalls.length, 4);
    assert.equal(await f.tasks.runAssistantTask('owner', taskId, continuation), null);
    saved = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(saved.status, 'succeeded');
    assert.deepEqual(plain(saved.result.drafts.map(value => value.description)), ['午餐 1', '午餐 2', '午餐 3', '午餐 4', '午餐 5']);
    assert.equal(saved.image_progress.completed, 5);
    assert.equal(f.paidCalls.length, 5);
    assert.equal(peak, 1, 'month-dependent screenshots must consume completed preceding results');
    const privateRow = (await f.db.query('SELECT payload,image_checkpoint,run_token FROM assistant_tasks')).rows[0];
    assert.deepEqual(privateRow, { payload: null, image_checkpoint: null, run_token: null });
    assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows, []);
  });

  test('real PostgreSQL: each image checkpoints before a sibling finishes and retry rechecks the suffix even without carried context', async t => {
    const siblingStarted = deferred(), siblingFinish = deferred();
    let failSecond = true;
    const calls = [];
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
      const output = imageBatch(settings), index = Number(output.drafts[0].description.split(' ')[1]);
      calls.push(index);
      if (index === 2 && failSecond) { siblingStarted.resolve(); await siblingFinish.promise; throw new Error('private provider detail'); }
      if (index >= 3) output.drafts[0].date = failSecond ? '2026-11-03' : '2026-10-03';
      return output;
    } } });
    await f.tasks.createAssistantTask('owner', body({ images: Array(5).fill('data:image/png;base64,YWJj') }));
    const wave = f.tasks.runAssistantTask('owner', taskId);
    await siblingStarted.promise;
    let partial;
    for (let tries = 0; tries < 50; tries++) {
      partial = await f.tasks.getAssistantTask('owner', taskId);
      if (partial.image_progress.completed === 1) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(partial.image_progress.completed, 1);
    assert.equal(partial.status, 'running');
    assert.equal(partial.result, null);
    siblingFinish.resolve();
    let continuation = await wave;
    assert.ok(continuation, 'an individual failure does not stop later untouched targets');
    while (continuation) continuation = await f.tasks.runAssistantTask('owner', taskId, continuation);
    const failed = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(failed.status, 'failed');
    assert.deepEqual(plain(failed.image_progress), { total: 5, completed: 4, failed: [2], active: [], stage: 'recognizing' });
    assert.match(failed.error, /第 2 张截图/);
    assert.equal(failed.error.includes('private provider detail'), false);
    assert.equal(failed.result, null);
    assert.deepEqual(calls, [1, 2, 3, 4, 5]);
    failSecond = false;
    const retried = await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1);
    assert.equal(retried.image_progress.completed, 4);
    assert.deepEqual(plain(retried.image_progress.failed), []);
    continuation = await f.tasks.runAssistantTask('owner', taskId);
    while (continuation) continuation = await f.tasks.runAssistantTask('owner', taskId, continuation);
    assert.deepEqual(calls, [1, 2, 3, 4, 5, 2, 3, 4, 5], 'missing carried context after a failure is not evidence that later dates are independent');
    const succeeded = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(succeeded.status, 'succeeded');
    assert.equal(succeeded.result.drafts.length, 5);
    assert.ok(succeeded.result.drafts.slice(2).every(draft => draft.transaction_date === '2026-10-03'), 'retry must replace later dates guessed while preceding month evidence was missing');
    assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows, []);
  });

  test('real PostgreSQL: cancelled image work keeps completed checkpoints and conversation clear erases them', async t => {
    const secondStarted = deferred(), secondFinish = deferred();
    let calls = 0;
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
      if (++calls === 2) { secondStarted.resolve(); await secondFinish.promise; }
      return imageBatch(settings);
    } } });
    await f.tasks.createAssistantTask('owner', body({ images: Array(2).fill('data:image/png;base64,YWJj') }));
    const worker = f.tasks.runAssistantTask('owner', taskId);
    await secondStarted.promise;
    for (let tries = 0; tries < 50; tries++) {
      if ((await f.tasks.getAssistantTask('owner', taskId)).image_progress.completed === 1) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await f.tasks.changeAssistantTask('owner', taskId, 'cancel', 1);
    secondFinish.resolve(); await worker;
    const cancelled = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.image_progress.completed, 1);
    assert.deepEqual(plain(cancelled.image_progress.active), []);
    await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1);
    await f.tasks.runAssistantTask('owner', taskId);
    assert.equal(calls, 3, 'retry preserves the first image and regenerates only the unfinished second');
    await f.tasks.createAssistantTask('owner', body({ id: id(70), user_message_id: id(71), images: Array(3).fill('data:image/png;base64,YWJj') }));
    await f.tasks.runAssistantTask('owner', id(70));
    await f.tasks.cancelConversationTasks('owner', conversationId);
    const rows = (await f.db.query('SELECT payload,image_checkpoint,image_progress,run_token FROM assistant_tasks')).rows;
    assert.ok(rows.every(row => row.payload === null && row.image_checkpoint === null && row.image_progress === null && row.run_token === null));
  });

  test('real PostgreSQL: model input fingerprints invalidate changed category mappings, while corrupt cached targets are retried', async t => {
    const f = await databaseFixture(t);
    await f.tasks.createAssistantTask('owner', body({ images: Array(3).fill('data:image/png;base64,YWJj') }));
    await f.tasks.runAssistantTask('owner', taskId);
    await f.db.query("UPDATE categories SET name='新餐饮' WHERE id=$1", [categoryId]);
    const next = await f.tasks.runAssistantTask('owner', taskId);
    assert.ok(next, 'changed options safely restart recognition rather than mixing category mappings');
    assert.equal(f.paidCalls.length, 4);
    const current = (await f.db.query('SELECT image_checkpoint FROM assistant_tasks')).rows[0].image_checkpoint;
    current.results[0].output.drafts[0].category_id = id(999);
    await f.db.query('UPDATE assistant_tasks SET image_checkpoint=$1::jsonb', [JSON.stringify(current)]);
    await f.tasks.runAssistantTask('owner', taskId, next);
    assert.equal(f.paidCalls.length, 6, 'corrupt first target and untouched third target run; the valid second remains cached');
    assert.equal((await f.tasks.getAssistantTask('owner', taskId)).status, 'succeeded');
  });

  test('real PostgreSQL: unreadable image stays retryable without exposing the other image as a complete import', async t => {
    let unclear = true;
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
      const output = imageBatch(settings);
      return unclear && output.drafts[0].description === '午餐 2'
        ? { action: 'chat', drafts: [], outcome: 'needs_clarification', date_context: null, reply: '日期看不清，请补充清晰截图。' } : output;
    } } });
    await f.tasks.createAssistantTask('owner', body({ images: Array(2).fill('data:image/png;base64,YWJj') }));
    await f.tasks.runAssistantTask('owner', taskId);
    const failed = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.image_progress.completed, 1);
    assert.deepEqual(plain(failed.image_progress.failed), [2]);
    assert.equal(failed.result, null);
    assert.match(failed.error, /日期看不清/);
    unclear = false;
    await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1);
    await f.tasks.runAssistantTask('owner', taskId);
    assert.equal(f.paidCalls.length, 3);
    assert.equal((await f.tasks.getAssistantTask('owner', taskId)).status, 'succeeded');
  });

  test('real PostgreSQL: old invocation writes cannot replace a newer run within the same attempt', async t => {
    const oldStarted = deferred(), oldFinish = deferred();
    let calls = 0;
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
      if (++calls === 1) { oldStarted.resolve(); await oldFinish.promise; }
      return imageBatch(settings);
    } } });
    await f.tasks.createAssistantTask('owner', body({ images: ['data:image/png;base64,YWJj'] }));
    const oldWorker = f.tasks.runAssistantTask('owner', taskId);
    await oldStarted.promise;
    const before = (await f.db.query('SELECT run_token FROM assistant_tasks')).rows[0].run_token;
    // Simulate a recovered queued wave while the old provider ignores cancellation.
    await f.db.query("UPDATE assistant_tasks SET status='queued',run_token=$1", [crypto.randomUUID()]);
    await f.tasks.runAssistantTask('owner', taskId);
    oldFinish.resolve(); await oldWorker;
    const saved = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(saved.status, 'succeeded');
    assert.equal(saved.attempt, 1);
    assert.equal(saved.result.drafts.length, 1);
    assert.equal(await f.tasks.runAssistantTask('owner', taskId, { attempt: 1, runToken: before }), null);
    assert.equal(calls, 2);
  });


  test('real PostgreSQL: existing task tables receive additive checkpoint columns without losing saved tasks', async t => {
    const f = await databaseFixture(t);
    await f.tasks.createAssistantTask('owner', body());
    await f.db.exec('ALTER TABLE assistant_tasks DROP COLUMN image_checkpoint,DROP COLUMN image_progress,DROP COLUMN run_token');
    const restored = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(restored.status, 'queued');
    assert.equal(restored.image_progress, null);
    await f.tasks.runAssistantTask('owner', taskId);
    assert.equal((await f.tasks.getAssistantTask('owner', taskId)).status, 'succeeded');
  });

  test('real PostgreSQL: over-cap merged drafts remain a clear retryable failure without truncation or partial cards', async t => {
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
      const output = imageBatch(settings), first = output.drafts[0];
      output.drafts = Array.from({ length: 11 }, (_, index) => ({ ...first,
        amount_cents: 100 + index, description: `${first.description} 行 ${index + 1}`,
        source: { ...first.source, row_index: index + 1 } }));
      return output;
    } } });
    await f.tasks.createAssistantTask('owner', body({ images: Array(2).fill('data:image/png;base64,YWJj') }));
    await f.tasks.runAssistantTask('owner', taskId);
    const failed = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.result, null);
    assert.match(failed.error, /20/);
    assert.equal(failed.image_progress.completed, 2);
    const checkpoint = (await f.db.query('SELECT image_checkpoint FROM assistant_tasks')).rows[0].image_checkpoint;
    assert.equal(checkpoint.results.reduce((count, result) => count + result.output.drafts.length, 0), 22);
    assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows, []);
  });


  test('real PostgreSQL: a null or failed earlier date context blocks older month evidence from later waves', async t => {
    for (const failSecond of [false, true]) {
      const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
        const output = imageBatch(settings);
        const target = Number(output.drafts[0].description.split(' ')[1]);
        if (target === 1) output.date_context = { year: 2026, month: 10, source_image_index: 1, evidence: '2026年10月' };
        if (target === 2 && failSecond) throw new Error('timeout');
        if (target >= 3) assert.match(settings.messages[0].content, /已完成前图的日期标题引用：null/);
        return output;
      } } });
      await f.tasks.createAssistantTask('owner', body({ images: Array(4).fill('data:image/png;base64,YWJj') }));
      const continuation = await f.tasks.runAssistantTask('owner', taskId);
      assert.ok(continuation);
      await f.tasks.runAssistantTask('owner', taskId, continuation);
      assert.equal(f.paidCalls.length, 4);
      assert.equal((await f.tasks.getAssistantTask('owner', taskId)).status, failSecond ? 'failed' : 'succeeded');
    }
  });


  test('real PostgreSQL: a month transition is available to the next target in the same wave', async t => {
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
      const output = imageBatch(settings);
      const target = Number(output.drafts[0].description.split(' ')[1]);
      const context = { year: 2026, month: target < 3 ? 10 : 9,
        source_image_index: target < 3 ? target : 3, evidence: target < 3 ? '2026年10月' : '2026年9月' };
      if (target >= 4) assert.match(settings.messages[0].content, /已完成前图的日期标题引用：.*"month":9.*"source_image_index":3/);
      output.date_context = context;
      output.drafts[0].date = target < 3 ? '2026-10-03' : '2026-09-30';
      return output;
    } } });
    await f.tasks.createAssistantTask('owner', body({ images: Array(5).fill('data:image/png;base64,YWJj') }));
    let continuation = await f.tasks.runAssistantTask('owner', taskId);
    while (continuation) continuation = await f.tasks.runAssistantTask('owner', taskId, continuation);
    const result = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(result.status, 'succeeded');
    assert.ok(result.result.drafts.slice(2).every(draft => draft.transaction_date === '2026-09-30'));
  });

  test('real PostgreSQL: retry invalidates a later cached target after its preceding image failed', async t => {
    let failThird = true;
    const calls = [];
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
      const output = imageBatch(settings);
      const target = Number(output.drafts[0].description.split(' ')[1]);
      calls.push(target);
      if (target <= 2) output.date_context = { year: 2026, month: 10, source_image_index: target, evidence: '2026年10月' };
      if (target === 3 && failThird) throw new Error('timeout');
      return output;
    } } });
    await f.tasks.createAssistantTask('owner', body({ images: Array(4).fill('data:image/png;base64,YWJj') }));
    let continuation = await f.tasks.runAssistantTask('owner', taskId);
    await f.tasks.runAssistantTask('owner', taskId, continuation);
    const failed = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.image_progress.completed, 3);
    const checkpoint = (await f.db.query('SELECT image_checkpoint FROM assistant_tasks')).rows[0].image_checkpoint;
    assert.equal(checkpoint.contextInputs['4'], null, 'a failed preceding target blocks older month evidence');
    failThird = false;
    await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1);
    continuation = await f.tasks.runAssistantTask('owner', taskId);
    while (continuation) continuation = await f.tasks.runAssistantTask('owner', taskId, continuation);
    assert.deepEqual(calls, [1, 2, 3, 4, 3, 4], 'the cached fourth image is rechecked because it consumed earlier model-derived month context');
    assert.equal((await f.tasks.getAssistantTask('owner', taskId)).status, 'succeeded');
  });


  test('real PostgreSQL: malformed checkpoint failures cannot hide pending work or corrupt public progress', async t => {
    const f = await databaseFixture(t);
    await f.tasks.createAssistantTask('owner', body({ images: Array(3).fill('data:image/png;base64,YWJj') }));
    const continuation = await f.tasks.runAssistantTask('owner', taskId);
    const checkpoint = (await f.db.query('SELECT image_checkpoint FROM assistant_tasks')).rows[0].image_checkpoint;
    checkpoint.failures = { 1: 'stale completed failure', 3: 123, 99: 'invalid index', bad: 'invalid key' };
    await f.db.query('UPDATE assistant_tasks SET image_checkpoint=$1::jsonb', [JSON.stringify(checkpoint)]);
    await f.tasks.runAssistantTask('owner', taskId, continuation);
    const saved = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(saved.status, 'succeeded');
    assert.deepEqual(plain(saved.image_progress), { total: 3, completed: 3, failed: [], active: [], stage: 'merging' });
    assert.equal(f.paidCalls.length, 3);
  });

}

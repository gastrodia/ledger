/* eslint-disable @typescript-eslint/no-require-imports -- exercise authenticated task routes and production SQL with isolated fixtures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const { NextRequest, NextResponse } = require('next/server');

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
  return { ...imageRecord, outcome: 'complete', date_context: null, date_dependency: null, drafts: imageRecord.drafts.map(value => ({ ...value, description: `午餐 ${targetIndex}`,
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
    ReadableStream, AbortController, AbortSignal, Buffer, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval,
    process: { env: {} }, ...globals }, { filename: file });
    return exports;
  };
  return load;
}

function fixture({ sql, session = { userId: 'owner' }, provider = {}, extraDependencies = {} } = {}) {
  const background = [], paidCalls = [];
  const database = sql || (() => assert.fail('invalid requests must not query the database'));
  database.query ||= async () => assert.fail('invalid requests must not query the database');
  class BailianError extends Error {
    constructor(status, code) { super('provider failure'); this.status = status; this.code = code; }
  }
  const invoke = fn => async (...args) => { paidCalls.push(args); const output = await fn(...args); return args[0].schemaName === 'ledger_image_batch' && output && Array.isArray(output.drafts) ? { ...output, total_rows: output.total_rows ?? output.drafts.length } : output; };
  const pendingPlans = new Map();
  let latestRecord = record;
  let scriptedModel;
  const load = loader({
    '@/lib/assistant-task-dispatch': { runAndContinueAssistantTask: async (...args) => { await load('lib/assistant-tasks.ts').runAssistantTask(...args); } },
    'next/server': { NextResponse, after: callback => background.push(callback) },
    ai: require('ai'), zod: require('zod'),
    // SQL/concurrency fixtures provide domain decisions directly. Native wire
    // encoding and schema validation are exercised in ai-sdk/native-tools tests.
    '@/lib/assistant-native-tools': {
      ASSISTANT_NATIVE_AGENT_PROMPT: '仅Ledger业务工具；执行由任务状态与凭据核验。',
      assistantNativeToolsForState: () => ({ scripted: {} }),
      assistantNativeRecordIds: () => [],
      assistantNativeMessages: messages => messages,
      assistantNativeDecision: call => ({ step: call.input, call }),
    },
    'node:crypto': crypto, 'node:async_hooks': require('node:async_hooks'), '@/lib/db': { sql: database }, '@/lib/auth': { getSession: async () => session },
    '@/lib/bailian': {
      BAILIAN_ASSISTANT_MODEL: 'fixture-object', BAILIAN_SUMMARY_MODEL: 'fixture-summary', BailianError,
      bailianConfig: () => ({}), bailianFailure: error => ({ status: error.status || 502, message: 'AI 服务暂时无法连接，请稍后重试。' }),
      bailianTool: async (settings, signal) => ({ id: `fixture-${paidCalls.length}`, name: 'scripted', input: await scriptedModel({ ...settings, schemaName: 'ledger_agent_step' }, signal) }),
      bailianObject: scriptedModel = async (settings, signal) => {
        if (settings.schemaName === 'ledger_record_page') {
          if (provider.bailianRecordPage) return provider.bailianRecordPage(settings, signal);
          return { plan: latestRecord, segments: [{ text: JSON.parse(settings.messages.at(-1).content).remaining, draft_indexes: latestRecord.drafts.map((_, i) => i + 1) }] };
        }
        const pending = pendingPlans.get(settings.telemetryId);
        if (settings.schemaName === 'ledger_agent_step' && pending) { pendingPlans.delete(settings.telemetryId); if (pending.plan_json) { const p = JSON.parse(pending.plan_json); if (p.action === 'record') latestRecord = p; } return pending; }
        return invoke(async (settings, signal) => {
        if (settings.schemaName !== 'ledger_agent_step') return provider.bailianObject ? provider.bailianObject(settings, signal)
          : settings.schemaName === 'ledger_image_batch' ? imageBatch(settings) : settings.schemaName === 'ledger_image_import' ? imageRecord : record;
        // Preserve the provider promises used by worker concurrency/cancellation
        // tests while exercising the actual portable agent schema and SQL loop.
        let output;
        if (provider.bailianStream && settings.messages.some(message => typeof message.content === 'string' && message.content.startsWith('账本工具 query 的结果'))) {
          let reply = '';
          for await (const chunk of await provider.bailianStream(settings, signal)) {
            signal.throwIfAborted(); if (chunk.type === 'text-delta') reply += chunk.text;
          }
          output = { action: 'chat', reply, drafts: [], query: null };
        } else output = provider.bailianObject ? await provider.bailianObject(settings, signal)
          : provider.bailianObjectStream ? await provider.bailianObjectStream(settings, () => {}, signal) : record;
        if (output.action === 'record') latestRecord = output;
        if (output.kind) { if (output.plan_json) { const p = JSON.parse(output.plan_json); if (p.action === 'record') latestRecord = p; } return output; }
        const chosen = output.action === 'query' ? { kind: 'read', tool: 'query', arguments_json: JSON.stringify(output.query), plan_json: null, needs_input: false }
          : { kind: 'respond', tool: null, arguments_json: '{}', plan_json: JSON.stringify(output), needs_input: false };
        chosen.operation_id = 'fixture';
        if (!settings.messages.some(message => message.content.startsWith('账本工具 workflow 的结果'))) {
          pendingPlans.set(settings.telemetryId, chosen);
          return {kind:'plan',tool:null,operation_id:null,arguments_json:JSON.stringify({operations:[{id:'fixture',label:'当前脚本目标',sources:[settings.messages.findLast(message=>message.role==='user'&&!['账本工具','本次服务端','本次请求上下文','服务端核实'].some(prefix=>message.content.startsWith(prefix))).content],action:output.action,effect:['chat','query'].includes(output.action)?'read':['edit','update','remove','navigate'].includes(output.action)?'local':'write',depends_on:[]}]}),plan_json:null,needs_input:false};
        }
        return chosen;
      })(settings, signal);
      },
      bailianObjectStream: invoke(provider.bailianObjectStream || (async (settings, partial) => {
        const output = settings.schemaName === 'ledger_image_batch' ? imageBatch(settings) : settings.schemaName === 'ledger_image_import' ? imageRecord : record;
        partial(output); return output;
      })),
      bailianText: invoke(provider.bailianText || (async () => assert.fail('unexpected query summary'))),
      bailianStream: invoke(provider.bailianStream || (async () => assert.fail('unexpected query summary stream'))),
    },
    ...extraDependencies,
  });
  return { load, tasks: load('lib/assistant-tasks.ts'), background, paidCalls };
}

// Opt in to execute the exact schema and CAS statements against disposable
// PostgreSQL. This never connects to DATABASE_URL or touches account data.
test('task snapshots restore every old query card from the server checkpoint without replaying tools', async () => {
  const resources = ['loans', 'notes', 'transactions'];
  const oldResult = { ...chat, reply_view: { title: '资金流水统计' } };
  const checkpoint = { version: 2, goal_id: taskId, goal: '查询借还。查询便利贴。统计本月收支。', status: 'completed', steps: 2,
    messages: [], pending_approval: null, preview_fingerprints: [],
    operations: resources.map((resource, index) => ({ id: resource, label: resource, action: index === 2 ? 'query' : 'manage', effect: 'read', status: 'completed', depends_on: [], sources: [resource] })),
    tool_results: resources.map((resource, index) => ({ call_id: `read-${index}`, operation_id: resource, name: index === 2 ? 'query' : 'records',
      result: index === 2 ? { reply: '统计结果', reply_view: oldResult.reply_view } : { reply: resource, record_context: { resource, rows: [] } } })),
  };
  const row = { id: taskId, conversation_id: conversationId, user_message_id: messageId, status: 'succeeded', phase: 'thinking', partial_text: '', result: oldResult,
    agent_checkpoint: checkpoint, attempt: 1, created_at: '2026-10-13T08:37:47.119Z', updated_at: '2026-10-13T08:38:00.000Z' };
  const sql = { query: async text => text.includes('FROM assistant_tasks WHERE') ? [row] : [] };
  const f = fixture({ sql });
  const recovered = await f.tasks.getAssistantTask('owner', taskId);
  assert.equal(recovered.result.read_results.length, 3);
  assert.deepEqual(plain(recovered.result.read_results.map(result => result.id)), ['read-0', 'read-1', 'read-2']);
  assert.equal(recovered.result.reply_view, undefined);
  assert.equal(oldResult.reply_view.title, '资金流水统计');
  assert.equal(f.paidCalls.length, 0);
});

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
  const controlRoute = f.load('app/api/assistant/tasks/[id]/control/route.ts');
  const unreadable = { json: () => assert.fail('must authenticate first'),
    get nextUrl() { assert.fail('must authenticate first'); } };
  const context = { get params() { assert.fail('must authenticate first'); } };
  for (const response of [await collection.POST(unreadable), await collection.GET(unreadable),
    await collection.DELETE(unreadable), await item.GET(unreadable, context), await item.PATCH(unreadable, context), await controlRoute.POST(unreadable, context)]) {
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
  test('real PostgreSQL: context failures are identified before model calls and retry preserves the original task', async t => {
    const f = await databaseFixture(t);
    await f.tasks.createAssistantTask('owner', body());
    await f.db.exec('ALTER TABLE categories RENAME COLUMN icon TO unavailable_icon');
    await f.tasks.runAssistantTask('owner', taskId);
    const failed = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error, '读取记账上下文失败，请重新处理。');
    assert.equal(failed.execution_steps.find(step => step.id === 'context').state, 'failed');
    assert.equal(f.paidCalls.length, 0);
    await f.db.exec('ALTER TABLE categories RENAME COLUMN unavailable_icon TO icon');
    await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1);
    await f.tasks.runAssistantTask('owner', taskId);
    const recovered = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(recovered.id, taskId);
    assert.equal(recovered.attempt, 2);
    assert.equal(recovered.status, 'succeeded');
    assert.equal(recovered.result.action, 'record');
    assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows, []);
  });
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
    assert.ok(f.paidCalls[0][0].tools, 'Agent calls the native tool transport');
    assert.equal(f.paidCalls[0][0].timeoutMs, 60000, 'each agent model call is bounded within the 75-second runtime budget');
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
    const privateState = (await f.db.query('SELECT payload,agent_checkpoint FROM assistant_tasks')).rows[0];
    assert.equal(privateState.payload.message, body().message, 'record goal input is retained until actual batch confirmation');
    assert.equal(privateState.agent_checkpoint.status, 'waiting_approval');
    assert.equal(privateState.agent_checkpoint.pending_batch.batch_id, saved.result.agent.output_id);
    assert.equal(privateState.agent_checkpoint.pending_plan.drafts[0].id, saved.result.drafts[0].id);
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
    assert.ok(f.paidCalls[0][0].timeoutMs > 0 && f.paidCalls[0][0].timeoutMs <= 90000,
      'each image target has a bounded provider budget after preparation');
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

  test('real PostgreSQL: automatic image retries publish one draft batch without checkpointing invalid attempts or posting transactions', async t => {
    const retryStarted = deferred(), retryFinish = deferred();
    let calls = 0;
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
      if (++calls === 1) return [];
      retryStarted.resolve();
      await retryFinish.promise;
      return imageBatch(settings);
    } } });
    await f.tasks.createAssistantTask('owner', body({ images: ['data:image/png;base64,YWJj'] }));
    const worker = f.tasks.runAssistantTask('owner', taskId);
    await retryStarted.promise;
    const pending = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(pending.status, 'running');
    assert.equal(pending.result, null);
    assert.equal(pending.image_progress.completed, 0);
    assert.deepEqual((await f.db.query('SELECT image_checkpoint FROM assistant_tasks')).rows[0].image_checkpoint.results, [null]);
    assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows, []);
    assert.equal(await f.tasks.runAssistantTask('owner', taskId), null, 'a duplicate worker cannot start additional attempts');
    assert.equal(calls, 2);
    retryFinish.resolve();
    await worker;
    const completed = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.attempt, 1, 'automatic retries remain inside the original task attempt');
    assert.equal(completed.result.drafts.length, 1);
    assert.equal(completed.result.drafts[0].amount_cents, 1200);
    const draftId = completed.result.drafts[0].id;
    await f.tasks.runAssistantTask('owner', taskId);
    const replay = await f.tasks.createAssistantTask('owner', body({ images: ['data:image/png;base64,YWJj'] }));
    assert.equal(replay.result.drafts[0].id, draftId);
    assert.equal(calls, 2);
    assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows, []);
  });

  test('real PostgreSQL: exhausting automatic image retries saves failure without a partial draft or ledger write', async t => {
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async () => [] } });
    await f.tasks.createAssistantTask('owner', body({ images: ['data:image/png;base64,YWJj'] }));
    await f.tasks.runAssistantTask('owner', taskId);
    const failed = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.result, null);
    assert.equal(failed.image_progress.completed, 0);
    assert.deepEqual(plain(failed.image_progress.failed), [1]);
    assert.equal(f.paidCalls.length, 3);
    assert.deepEqual((await f.db.query('SELECT image_checkpoint FROM assistant_tasks')).rows[0].image_checkpoint.results, [null]);
    assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows, []);
  });

  test('real PostgreSQL: each image checkpoints before a sibling finishes and retry reuses independent successful targets', async t => {
    const siblingStarted = deferred(), siblingFinish = deferred();
    let failSecond = true;
    const calls = [];
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
      const output = imageBatch(settings), index = Number(output.drafts[0].description.split(' ')[1]);
      calls.push(index);
      if (index === 2 && failSecond) { siblingStarted.resolve(); await siblingFinish.promise; throw new Error('private provider detail'); }
      if (index >= 3) output.drafts[0].date = '2026-11-03';
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
    assert.deepEqual(calls, [1, 2, 3, 4, 5, 2], 'independent successful targets are reused after the failed target recovers');
    const succeeded = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(succeeded.status, 'succeeded');
    assert.equal(succeeded.result.drafts.length, 5);
    assert.ok(succeeded.result.drafts.slice(2).every(draft => draft.transaction_date === '2026-11-03'), 'independent target dates stay unchanged');
    assert.ok(succeeded.execution_steps.filter(step => ['image-3', 'image-4', 'image-5'].includes(step.id)).every(step => step.details.some(detail => detail.includes('复用'))));
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

  test('real PostgreSQL: reverse-overlap merge failure retries saved 24-row checkpoints without another model request', async t => {
    const starts = [9, 3, 0];
    const entries = Array.from({ length: 17 }, (_, index) => ({ ...draft, description: `交易${index}`, amount_cents: 1000 + index,
      source: { image_index: 1, row_index: 1, time: `12:${String(index).padStart(2, '0')}`, transaction_id: null, kind: 'statement' } }));
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
      const output = imageBatch(settings);
      const target = Number(output.drafts[0].description.split(' ')[1]) - 1;
      return { ...output, drafts: entries.slice(starts[target], starts[target] + 8).map((entry, index) => ({ ...output.drafts[0],
        description: entry.description, amount_cents: entry.amount_cents,
        source: { ...entry.source, image_index: output.drafts[0].source.image_index, row_index: index + 1 } })) };
    } } });
    await f.tasks.createAssistantTask('owner', body({ images: Array(3).fill('data:image/png;base64,YWJj') }));
    await f.tasks.runAssistantTask('owner', taskId);
    const checkpoint = (await f.db.query('SELECT image_checkpoint FROM assistant_tasks')).rows[0].image_checkpoint;
    // Reproduce a pre-fix terminal task: all three targets are valid and saved,
    // but finalization rejected the unmerged 24 visible rows.
    checkpoint.results[2] = { ...checkpoint.results[1], image_index: 3, output: { ...checkpoint.results[1].output,
      drafts: entries.slice(0, 8).map((entry, index) => ({ ...entry, source: { ...entry.source, image_index: 3, row_index: index + 1 } })) } };
    await f.db.query(`UPDATE assistant_tasks SET image_checkpoint=$1::jsonb,status='failed',run_token=NULL,lease_until=NULL,
      image_progress=$2::jsonb,error='一次最多识别20笔，请分批输入。'`, [JSON.stringify(checkpoint),
      JSON.stringify({ total: 3, completed: 3, active: [], failed: [], stage: 'merging' })]);
    const requests = f.paidCalls.length;
    await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1);
    await f.tasks.runAssistantTask('owner', taskId);
    const recovered = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(recovered.status, 'succeeded');
    assert.equal(recovered.result.drafts.length, 17);
    assert.equal(recovered.result.import_summary.removed_duplicates, 7);
    assert.equal(f.paidCalls.length, requests, 'merge retry must reuse every saved target');
    assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows, []);
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
    assert.equal(f.paidCalls.length, 5, 'validated source pages rebuild the corrupt first target; only the untouched third needs a provider request');
    assert.equal((await f.tasks.getAssistantTask('owner', taskId)).status, 'succeeded');
  });

  test('real PostgreSQL: unreadable image stays retryable without exposing the other image as a complete import', async t => {
    let unclear = true;
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
      const output = imageBatch(settings);
      return unclear && output.drafts[0].description === '午餐 2'
        ? { action: 'chat', drafts: [], outcome: 'needs_clarification', date_context: null, date_dependency: null, reply: '日期看不清，请补充清晰截图。' } : output;
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
    await f.db.exec('ALTER TABLE assistant_tasks DROP COLUMN image_checkpoint,DROP COLUMN image_progress,DROP COLUMN run_token,DROP COLUMN execution_steps');
    const restored = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(restored.status, 'queued');
    assert.equal(restored.image_progress, null);
    assert.deepEqual(plain(restored.execution_steps), []);
    await f.tasks.runAssistantTask('owner', taskId);
    assert.equal((await f.tasks.getAssistantTask('owner', taskId)).status, 'succeeded');
  });

  test('real PostgreSQL: twenty-two merged drafts are complete and remain pending until user confirmation', async t => {
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
    assert.equal(failed.status, 'succeeded');
    assert.equal(failed.result.drafts.length, 22);
    assert.equal(failed.image_progress.completed, 2);
    assert.equal((await f.db.query('SELECT image_checkpoint FROM assistant_tasks')).rows[0].image_checkpoint, null);
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
      output.date_dependency = target >= 4 ? context : null;
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

  test('real PostgreSQL: retry reuses an independent later target after its preceding image recovers', async t => {
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
    assert.deepEqual(calls, [1, 2, 3, 4, 3], 'the independent fourth image is reused regardless of available context');
    assert.equal((await f.tasks.getAssistantTask('owner', taskId)).status, 'succeeded');
  });

  test('real PostgreSQL: a recovered first image preserves dependent targets when their actual visual date basis is unchanged', async t => {
    let failFirst = true;
    const calls = [], basis = { year: 2026, month: 10, source_image_index: 1, evidence: '2026年10月' };
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
      const output = imageBatch(settings), target = Number(output.drafts[0].description.split(' ')[1]);
      calls.push(target);
      if (target === 1 && failFirst) throw new Error('network');
      if (target <= 2) {
        output.date_context = basis;
        output.date_dependency = target === 1 ? null : basis;
      } else output.date_context = { ...basis, source_image_index: 3 };
      return output;
    } } });
    await f.tasks.createAssistantTask('owner', body({ images: Array(3).fill('data:image/png;base64,YWJj') }));
    let continuation = await f.tasks.runAssistantTask('owner', taskId);
    while (continuation) continuation = await f.tasks.runAssistantTask('owner', taskId, continuation);
    const before = (await f.db.query('SELECT image_checkpoint FROM assistant_tasks')).rows[0].image_checkpoint;
    assert.equal(before.contextInputs['2'], null);
    assert.deepEqual(before.results[1].date_dependency, basis);
    failFirst = false;
    await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1);
    continuation = await f.tasks.runAssistantTask('owner', taskId);
    while (continuation) continuation = await f.tasks.runAssistantTask('owner', taskId, continuation);
    assert.deepEqual(calls, [1, 2, 3, 1]);
    const saved = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(saved.status, 'succeeded');
    assert.equal(saved.result.drafts.length, 3);
    const draftIds = saved.result.drafts.map(row => row.id);
    await f.tasks.runAssistantTask('owner', taskId);
    assert.deepEqual(plain((await f.tasks.getAssistantTask('owner', taskId)).result.drafts.map(row => row.id)), plain(draftIds));
    assert.deepEqual(calls, [1, 2, 3, 1]);
    assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows, []);
  });

  test('real PostgreSQL: changed dates invalidate only actual dependencies, including mixed rows before a new own header', async t => {
    for (const resetBoundary of [false, true]) {
      let failFirst = true;
      const calls = [], oldBasis = { year: 2026, month: 10, source_image_index: 1, evidence: '2026年10月' };
      const newBasis = { ...oldBasis, month: 9, evidence: '2026年9月' };
      const ownBasis = { year: 2026, month: 11, source_image_index: 2, evidence: '2026年11月' };
      const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
        const output = imageBatch(settings), target = Number(output.drafts[0].description.split(' ')[1]);
        calls.push(target);
        if (target === 1 && failFirst) throw new Error('network');
        const basis = failFirst ? oldBasis : newBasis;
        if (target === 1) { output.date_context = basis; output.drafts[0].date = '2026-09-03'; }
        if (target === 2) {
          output.date_dependency = basis;
          output.date_context = resetBoundary ? ownBasis : basis;
          output.drafts[0].date = failFirst ? '2026-10-03' : '2026-09-03';
          if (resetBoundary) output.drafts.push({ ...output.drafts[0], date: '2026-11-01', description: '本图新月份',
            source: { ...output.drafts[0].source, row_index: 2 } });
        }
        if (target === 3) {
          output.date_dependency = resetBoundary ? ownBasis : basis;
          output.date_context = output.date_dependency;
          output.drafts[0].date = resetBoundary ? '2026-11-03' : failFirst ? '2026-10-03' : '2026-09-03';
        }
        return output;
      } } });
      await f.tasks.createAssistantTask('owner', body({ images: Array(3).fill('data:image/png;base64,YWJj') }));
      let continuation = await f.tasks.runAssistantTask('owner', taskId);
      while (continuation) continuation = await f.tasks.runAssistantTask('owner', taskId, continuation);
      assert.equal((await f.tasks.getAssistantTask('owner', taskId)).status, 'failed');
      failFirst = false;
      await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1);
      continuation = await f.tasks.runAssistantTask('owner', taskId);
      if (!resetBoundary) {
        assert.ok(continuation, 'dependent cascade beyond two requests continues in a fresh wave');
        const pending = await f.tasks.getAssistantTask('owner', taskId);
        assert.equal(pending.status, 'queued');
        assert.equal(pending.image_progress.completed, 2, 'stale cached dates no longer count as completed');
        assert.equal(pending.result, null, 'a stale dependent target cannot reach the draft card');
      }
      while (continuation) continuation = await f.tasks.runAssistantTask('owner', taskId, continuation);
      assert.deepEqual(calls, resetBoundary ? [1, 2, 3, 1, 2] : [1, 2, 3, 1, 2, 3]);
      const saved = await f.tasks.getAssistantTask('owner', taskId);
      assert.equal(saved.status, 'succeeded');
      assert.ok(saved.execution_steps.find(step => step.id === 'image-2').details.some(detail => detail.includes('日期依据已变化')));
      assert.deepEqual(plain(saved.result.drafts.map(draft => draft.transaction_date)), resetBoundary
        ? ['2026-09-03', '2026-09-03', '2026-11-01', '2026-11-03'] : Array(3).fill('2026-09-03'));
      assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows, []);
    }
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

  test('real PostgreSQL: matching v5 financial checkpoints migrate and remain reusable when date inputs are unchanged', async t => {
    let failThird = true;
    const calls = [];
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
      const output = imageBatch(settings), target = Number(output.drafts[0].description.split(' ')[1]);
      calls.push(target);
      if (target === 3 && failThird) throw new Error('network');
      output.date_context = { year: 2026, month: 10, source_image_index: target, evidence: '2026年10月' };
      return output;
    } } });
    await f.tasks.createAssistantTask('owner', body({ images: Array(3).fill('data:image/png;base64,YWJj') }));
    let continuation = await f.tasks.runAssistantTask('owner', taskId);
    while (continuation) continuation = await f.tasks.runAssistantTask('owner', taskId, continuation);
    const old = (await f.db.query('SELECT payload,image_checkpoint FROM assistant_tasks')).rows[0];
    const checkpoint = old.image_checkpoint;
    checkpoint.results.filter(Boolean).forEach(result => { delete result.date_dependency; });
    checkpoint.version = 'target-image-v5';
    const input = f.load('lib/assistant-generation.ts').validateAssistantInput(old.payload);
    const categories = (await f.db.query('SELECT id,name,type FROM categories WHERE user_id=$1 ORDER BY created_at', ['owner'])).rows;
    const members = (await f.db.query('SELECT id,name FROM members WHERE user_id=$1 ORDER BY created_at', ['owner'])).rows;
    checkpoint.key = crypto.createHash('sha256').update(JSON.stringify({ version: checkpoint.version, input,
      model: 'fixture-object', categories, members })).digest('hex');
    await f.db.query('UPDATE assistant_tasks SET image_checkpoint=$1::jsonb', [JSON.stringify(checkpoint)]);
    failThird = false;
    await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1);
    continuation = await f.tasks.runAssistantTask('owner', taskId);
    while (continuation) continuation = await f.tasks.runAssistantTask('owner', taskId, continuation);
    assert.deepEqual(calls, [1, 2, 3, 3]);
    assert.equal((await f.tasks.getAssistantTask('owner', taskId)).status, 'succeeded');
    assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows, []);
  });

  test('real PostgreSQL: detailed query steps persist while generating and survive task recovery', async t => {
    const started = deferred(), finish = deferred();
    const query = { start_date: '2026-10-01', end_date: '2026-10-09', type: 'expense', category_id: categoryId, member_id: memberId, keyword: '午餐' };
    const f = await databaseFixture(t, { provider: {
      bailianObjectStream: async () => ({ action: 'query', reply: '查询中', drafts: [], query }),
      bailianStream: async () => (async function* () { started.resolve(); await finish.promise; yield { type: 'text-delta', text: '匹配一笔午餐，支出12元。' }; yield { finishReason: 'stop' }; })(),
    } });
    await f.db.query(`INSERT INTO transactions(id,user_id,type,amount,category_id,member_id,transaction_date,description)
      VALUES($1,'owner','expense',12,$2,$3,'2026-10-08','午餐')`, [id(800),categoryId,memberId]);
    await f.tasks.createAssistantTask('owner', body());
    const running = f.tasks.runAssistantTask('owner', taskId);
    await started.promise;
    await new Promise(resolve => setTimeout(resolve, 1150));
    const live = await f.tasks.getAssistantTask('owner', taskId);
    const queryStep = live.execution_steps.find(step => step.id === 'agent_tool_2');
    assert.equal(queryStep.state, 'done');
    assert.match(queryStep.details.join(' '), /2026-10-01 至 2026-10-09.*分类：餐饮；成员：本人.*(?:匹配|找到) 1 笔/);
    assert.equal(live.execution_steps.find(step => step.id === 'agent_3').state, 'running');
    finish.resolve(); await running;
    const saved = (await f.tasks.listAssistantTasks('owner', conversationId))[0];
    assert.equal(saved.execution_steps.length, 5);
    assert.ok(saved.execution_steps.every(step => step.state === 'done' && step.finishedAt >= step.startedAt));
    assert.equal(saved.execution_steps.find(step => step.id === 'agent_3').label, '整理查询结果');
    assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM transactions')).rows[0].count, 1);
  });

  test('real PostgreSQL: image steps retain earlier waves and errors, retry replaces failed steps without replaying saved images', async t => {
    let fail = true;
    const f = await databaseFixture(t, { provider: { bailianObjectStream: async settings => {
      const result = imageBatch(settings);
      if (fail && result.drafts[0].description === '午餐 2') throw new Error('private provider diagnostic');
      return result;
    } } });
    const images = [1,2,3].map(value => `data:image/png;base64,${Buffer.from(String(value)).toString('base64')}`);
    await f.tasks.createAssistantTask('owner', body({ images }));
    let continuation = await f.tasks.runAssistantTask('owner', taskId);
    await f.tasks.runAssistantTask('owner', taskId, continuation);
    const failed = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(failed.execution_steps.find(step => step.id === 'image-1').state, 'done');
    assert.equal(failed.execution_steps.find(step => step.id === 'image-1').kind, 'model');
    assert.equal(failed.execution_steps.find(step => step.id === 'image-1').model, 'fixture-object');
    assert.equal(failed.execution_steps.find(step => step.id === 'image-2').state, 'failed');
    assert.equal(failed.execution_steps.find(step => step.id === 'image-2').model, 'fixture-object');
    assert.equal(failed.execution_steps.find(step => step.id === 'merge'), undefined);
    assert.equal(JSON.stringify(failed.execution_steps).includes('private provider diagnostic'), false);
    fail = false;
    const retried = await f.tasks.changeAssistantTask('owner', taskId, 'retry', 1);
    assert.deepEqual(plain(retried.execution_steps), []);
    continuation = await f.tasks.runAssistantTask('owner', taskId);
    if (continuation) await f.tasks.runAssistantTask('owner', taskId, continuation);
    const saved = await f.tasks.getAssistantTask('owner', taskId);
    assert.equal(saved.status, 'succeeded');
    assert.match(saved.execution_steps.find(step => step.id === 'image-1').details.join(' '), /复用/);
    assert.equal(saved.execution_steps.find(step => step.id === 'image-1').kind, 'check');
    assert.equal(saved.execution_steps.find(step => step.id === 'image-1').model, undefined);
    assert.equal(saved.execution_steps.find(step => step.id === 'image-2').kind, 'model');
    assert.equal(saved.execution_steps.find(step => step.id === 'image-2').model, 'fixture-object');
    assert.match(saved.execution_steps.find(step => step.id === 'merge').details.join(' '), /保留 3 笔/);
    assert.ok(saved.execution_steps.every(step => step.state === 'done'));
    await f.tasks.cancelConversationTasks('owner', conversationId);
    assert.deepEqual((await f.db.query('SELECT execution_steps FROM assistant_tasks')).rows[0].execution_steps, []);
  });

}

if (PGlite) {
  test('real PostgreSQL: clarification resumes the original durable agenda once and preserves unanswered items across reload', async t => {
    const operations = [
      {id:'gift',label:'小美生日送礼和鞋子',sources:['小美生日送礼500外加一双200的鞋子'],action:'event',effect:'write',depends_on:[]},
      {id:'breakfast',label:'早餐3.9',sources:['早餐3.9'],action:'record',effect:'write',depends_on:[]},
    ];
    const steps = [
      {kind:'plan',tool:null,arguments_json:JSON.stringify({operations}),plan_json:null,operation_id:null},
      {kind:'respond',tool:null,arguments_json:'{}',plan_json:JSON.stringify({...chat,reply:'鞋子的200元是实际买鞋付款还是估值？'}),operation_id:'gift',needs_input:true},
      {kind:'respond',tool:null,arguments_json:'{}',plan_json:JSON.stringify({...chat,reply:'已经明确是估值；还需要选所属成员。'}),operation_id:'gift',needs_input:true},
    ];
    const f = await databaseFixture(t,{provider:{bailianObject:async()=>steps.shift()}});
    await f.tasks.createAssistantTask('owner',body({message:'早餐3.9，小美生日送礼500外加一双200的鞋子'}));
    await f.tasks.runAssistantTask('owner',taskId);
    const question=await f.tasks.getAssistantTask('owner',taskId,true);
    assert.equal(question.agent.awaiting_answer,true);assert.equal(question.agent.operations.length,2);
    const original=(await f.db.query('SELECT payload FROM assistant_tasks')).rows[0].payload;
    assert.equal(original.message,'早餐3.9，小美生日送礼500外加一双200的鞋子');
    const answer=body({user_message_id:id(80),today:'2026-10-11',message:'200只是估值，鞋子以前买的',display_text:'200只是估值，鞋子以前买的',continuation:{attempt:1,output_id:question.agent.output_id,kind:'answer'}});
    const resumed=await f.tasks.createAssistantTask('owner',answer);
    const replay=await f.tasks.createAssistantTask('owner',answer);
    assert.equal(resumed.id,taskId);assert.equal(resumed.attempt,2);assert.equal(replay.attempt,2);
    assert.equal((await f.db.query('SELECT payload FROM assistant_tasks')).rows[0].payload.today, original.today, 'a later answer cannot move the original goal date');
    await assert.rejects(f.tasks.createAssistantTask('owner',{...answer,user_message_id:id(81),message:'是新买的',display_text:'是新买的'}),error=>error.status===409);
    await assert.rejects(f.tasks.createAssistantTask('foreign',answer),error=>error.status===404);
    await f.tasks.runAssistantTask('owner',taskId);
    const next=await f.tasks.getAssistantTask('owner',taskId,true);
    assert.equal(next.user_message_id,id(80));assert.equal(next.input.display_text,answer.display_text);
    assert.equal(next.output_history.length,1);assert.equal(next.output_history[0].result.reply,question.result.reply);
    assert.equal(next.agent.operations[1].status,'pending');assert.notEqual(next.agent.output_id,question.agent.output_id);
    const rows=(await f.db.query('SELECT * FROM assistant_tasks')).rows;assert.equal(rows.length,1);
    assert.equal((await f.db.query('SELECT count(*)::int count FROM transactions')).rows[0].count,0);
    assert.ok(rows[0].agent_checkpoint.messages.some(message=>message.content.includes(answer.message)));
    await f.tasks.cancelConversationTasks('owner',conversationId);
    await assert.rejects(f.tasks.createAssistantTask('owner',{...answer,continuation:{...answer.continuation,attempt:2,output_id:next.agent.output_id}}),error=>error.status===409);
  });
}

if(PGlite)test('real PostgreSQL: member picker answers remain in the original goal and validate the selected member',async t=>{
 const batch={batch_id:id(70),status:'pending',drafts:[{...draft,member_id:null}]};
 const update=member=>({kind:'respond',tool:null,operation_id:'member',arguments_json:'{}',plan_json:JSON.stringify({action:'update',reply:'选人员',drafts:[],query:null,update:{batch_id:batch.batch_id,draft_ids:[draft.id],member_id:member}}),needs_input:member===null});
 const steps=[{kind:'plan',tool:null,operation_id:null,arguments_json:JSON.stringify({operations:[{id:'member',label:'选择草稿成员',action:'update',effect:'local',depends_on:[],sources:['修改这笔的支出人']},{id:'stats',label:'查询本月',action:'query',effect:'read',depends_on:['member'],sources:['然后查询本月支出']}]}),plan_json:null},update(null),update(memberId)];
 const f=await databaseFixture(t,{provider:{bailianObject:async()=>steps.shift()}});
 await f.tasks.createAssistantTask('owner',body({message:'修改这笔的支出人，然后查询本月支出',draft_batch:batch}));await f.tasks.runAssistantTask('owner',taskId);
 const question=await f.tasks.getAssistantTask('owner',taskId);assert.equal(question.agent.awaiting_answer,true);
 const answer=body({user_message_id:id(80),message:'选本人',display_text:'选本人',draft_batch:batch,continuation:{attempt:1,output_id:question.agent.output_id,kind:'answer',selected_member_id:id(99)}});
 await assert.rejects(f.tasks.createAssistantTask('owner',answer),error=>error.status===400);
 const valid={...answer,continuation:{...answer.continuation,selected_member_id:memberId}};
 const queued=await f.tasks.createAssistantTask('owner',valid);assert.equal(queued.id,taskId);assert.equal(queued.attempt,2);
 await f.tasks.runAssistantTask('owner',taskId);const selected=await f.tasks.getAssistantTask('owner',taskId);
 assert.equal(selected.result.update.member_id,memberId);assert.equal(selected.agent.awaiting_delivery,true);assert.equal(selected.agent.operations[1].status,'pending');
 assert.equal((await f.db.query('SELECT COUNT(*)::int count FROM transactions')).rows[0].count,0);
});

if (PGlite) {
 test('real PostgreSQL: agent waves requeue with a fenced token and preserve reads through continuation replay', async t => {
  const query={scope:'daily',start_date:'2026-10-01',end_date:'2026-10-10',type:null,category_id:null,member_id:null,keyword:null};
  const steps=[{kind:'plan',tool:null,operation_id:null,arguments_json:JSON.stringify({operations:[{id:'stats',label:'查询统计',sources:['查询统计'],action:'query',effect:'read',depends_on:[]}]}),plan_json:null},
    ...Array(7).fill({kind:'read',tool:'query',operation_id:'stats',arguments_json:JSON.stringify(query),plan_json:null}),
    {kind:'respond',tool:null,operation_id:'stats',arguments_json:'{}',plan_json:JSON.stringify(chat)}];
  const f=await databaseFixture(t,{provider:{bailianObject:async()=>steps.shift()}});
  await f.tasks.createAssistantTask('owner',body({message:'查询统计'}));
  const wave=await f.tasks.runAssistantTask('owner',taskId);assert.ok(wave);
  const queued=await f.tasks.getAssistantTask('owner',taskId);assert.equal(queued.status,'queued');assert.equal(queued.result,null);assert.equal(queued.agent.awaiting_answer,undefined);
  assert.equal((await f.db.query('SELECT agent_checkpoint FROM assistant_tasks')).rows[0].agent_checkpoint.tool_results.filter(t=>t.name==='query').length,7);
  await f.tasks.runAssistantTask('owner',taskId,wave);assert.equal(await f.tasks.runAssistantTask('owner',taskId,wave),null);
  const done=await f.tasks.getAssistantTask('owner',taskId);assert.equal(done.status,'succeeded');assert.equal(done.agent.status,'completed');assert.equal(done.attempt,1);
  assert.equal((await f.db.query('SELECT count(*)::int count FROM transactions')).rows[0].count,0);
 });
 test('real PostgreSQL: technical interruption retries once without an answer and retains the original agenda', async t => {
  const steps=[{kind:'plan',tool:null,operation_id:null,arguments_json:JSON.stringify({operations:[{id:'stats',label:'查询统计',sources:['查询统计'],action:'query',effect:'read',depends_on:[]}]}),plan_json:null},
    ...Array(3).fill({kind:'respond',tool:null,operation_id:'unknown',arguments_json:'{}',plan_json:JSON.stringify(chat)}),
    {kind:'respond',tool:null,operation_id:'stats',arguments_json:'{}',plan_json:JSON.stringify(chat)}];
  const f=await databaseFixture(t,{provider:{bailianObject:async()=>steps.shift()}});
  await f.tasks.createAssistantTask('owner',body({message:'查询统计'}));await f.tasks.runAssistantTask('owner',taskId);
  const interrupted=await f.tasks.getAssistantTask('owner',taskId);assert.equal(interrupted.agent.status,'interrupted');assert.equal(interrupted.agent.awaiting_answer,undefined);
  await assert.rejects(f.tasks.changeAssistantTask('foreign',taskId,'retry',1),e=>e.status===404);
  const retries=await Promise.all([f.tasks.changeAssistantTask('owner',taskId,'retry',1),f.tasks.changeAssistantTask('owner',taskId,'retry',1)]);
  assert.ok(retries.every(task=>task.attempt===2));await f.tasks.runAssistantTask('owner',taskId);
  const done=await f.tasks.getAssistantTask('owner',taskId);assert.equal(done.agent.status,'completed');assert.equal(done.agent.goal,'查询统计');assert.equal(done.output_history.length,1);
  assert.equal((await f.db.query('SELECT count(*)::int count FROM transactions')).rows[0].count,0);
 });
}

if(PGlite) {
 test('real PostgreSQL: malformed model decisions recover within the same attempt and preserve the original agenda',async t=>{
  const steps=[{kind:'plan',operation_id:null,tool:null,arguments_json:JSON.stringify({operations:[{id:'gift',label:'送礼',sources:['小美生日送礼500元'],action:'event',effect:'write',depends_on:[]}]}),plan_json:null},
   {kind:'respond',operation_id:'错误编号',tool:null,arguments_json:'{}',plan_json:JSON.stringify(chat)},
   {kind:'respond',operation_id:'gift',tool:null,arguments_json:'{}',plan_json:JSON.stringify({...chat,reply:'这笔支出属于哪个成员？'}),needs_input:true}];
  const f=await databaseFixture(t,{provider:{bailianObject:async()=>steps.shift()}});
  await f.tasks.createAssistantTask('owner',body({message:'小美生日送礼500元'}));await f.tasks.runAssistantTask('owner',taskId);
  const recovered=await f.tasks.getAssistantTask('owner',taskId);assert.equal(recovered.status,'succeeded');assert.equal(recovered.error,null);assert.equal(recovered.attempt,1);assert.equal(recovered.agent.awaiting_answer,true);assert.equal(recovered.agent.operations[0].status,'needs_input');
  assert.equal(recovered.result.reply,'这笔支出属于哪个成员？');assert.ok(recovered.execution_steps.some(step=>step.id==='agent_2'&&step.state==='failed'));
  const row=(await f.db.query('SELECT agent_checkpoint FROM assistant_tasks')).rows[0];assert.equal(row.agent_checkpoint.outputs.length,1);assert.equal(row.agent_checkpoint.tool_results.filter(t=>t.name==='validation_error').length,1);
  assert.equal(await f.tasks.runAssistantTask('owner',taskId),null);assert.equal((await f.db.query('SELECT count(*)::int count FROM transactions')).rows[0].count,0);
 });
}

if(PGlite) {
 test('real PostgreSQL: a local agent exception is not misreported as an AI network outage',async t=>{
  const f=await databaseFixture(t,{provider:{bailianObject:async()=>{throw new Error('private internal detail');}}});
  await f.tasks.createAssistantTask('owner',body({message:'早餐3.9元'}));await f.tasks.runAssistantTask('owner',taskId);
  const failed=await f.tasks.getAssistantTask('owner',taskId);assert.equal(failed.status,'failed');assert.equal(failed.error,'AI 任务处理出现异常，请重新处理。');assert.equal(JSON.stringify(failed).includes('private internal detail'),false);
  assert.equal((await f.db.query('SELECT count(*)::int count FROM transactions')).rows[0].count,0);
 });
}

if(PGlite) {
 test('real PostgreSQL: offered event choices persist once and bypass model reinterpretation without authorizing writes',async t=>{
  const event={operation:'create',kind:'gift_given',counterparty:'小美',amount_cents:50000,date:'2026-10-10',allow_duplicate:false};
  let models=0;const events=[];
  const f=await databaseFixture(t,{provider:{bailianObject:async()=>{models++;return models===1?{kind:'plan',tool:null,operation_id:null,arguments_json:JSON.stringify({operations:[{id:'gift',label:'送礼',action:'event',effect:'write',depends_on:[],sources:['小美生日送礼500元']}]}),plan_json:null}:{kind:'preview',tool:'event',operation_id:'gift',arguments_json:JSON.stringify(event),plan_json:null};}},extraDependencies:{
   '@/lib/assistant-control-server':{loadAssistantControlContexts:async()=>[]},
   '@/lib/assistant-command-server':{ensureAssistantActionsSchema:async()=>{},prepareAssistantAgentPreview:async(_user,_conversation,_goal,_fp,_signal,work)=>work()},
   '@/lib/ledger-event-server':{prepareLedgerEvent:async(_user,_conversation,input)=>{events.push(input);return input.allow_duplicate?{reply:'请核对后确认',approval:{id:id(90),summary:'送礼',count:1,expires_at:null},event_context:{status:'pending',event_id:null,input},event_choices:[]}:{reply:'发现已登记事项，请核对是不是已经记过',event_context:{status:'pending',event_id:null,input},event_choices:[{label:'这是另外新发生的一笔，继续核对',input:{...input,allow_duplicate:true}}]};}}
  }});
  await f.tasks.createAssistantTask('owner',body({message:'小美生日送礼500元'}));await f.tasks.runAssistantTask('owner',taskId);
  const question=await f.tasks.getAssistantTask('owner',taskId);assert.equal(question.agent.awaiting_answer,true);
  const selected=question.result.event_choices[0].input;
  const answer=body({user_message_id:id(80),message:'这是另外新发生的一笔，继续核对',display_text:'这是另外新发生的一笔，继续核对',event_selection:selected,continuation:{kind:'answer',attempt:1,output_id:question.agent.output_id}});
  await assert.rejects(f.tasks.createAssistantTask('owner',{...answer,event_selection:{...selected,amount_cents:60000}}),e=>e.status===409);
  const accepted=await f.tasks.createAssistantTask('owner',answer);assert.equal(accepted.attempt,2);assert.equal((await f.tasks.createAssistantTask('owner',answer)).attempt,2);
  await f.tasks.runAssistantTask('owner',taskId);const review=await f.tasks.getAssistantTask('owner',taskId);assert.equal(review.agent.status,'waiting_approval');assert.equal(models,2);assert.deepEqual(events.map(e=>e.allow_duplicate),[false,true]);
  assert.equal((await f.db.query('SELECT count(*)::int count FROM transactions')).rows[0].count,0);
  const c=(await f.db.query('SELECT agent_checkpoint FROM assistant_tasks')).rows[0].agent_checkpoint;assert.equal(c.event_resolutions[0].pending,false);assert.equal(c.outputs.length,2);assert.equal(c.operations[0].status,'waiting_approval');
 });
}

if(PGlite) {
 test('real PostgreSQL: an ordinary short reply resumes a stopped question in the same conversation exactly once',async t=>{
  let count=0;const original='早餐3.9 地铁2.96 小美生日送礼500外加一双200的鞋子';
  const operations=[{id:'breakfast',label:'早餐',action:'record',effect:'write',depends_on:[],sources:['早餐3.9']},{id:'metro',label:'地铁',action:'record',effect:'write',depends_on:[],sources:['地铁2.96']},{id:'gift',label:'送礼',action:'event',effect:'write',depends_on:[],sources:['小美生日送礼500外加一双200的鞋子'],questions:['鞋子是实际购买还是已有物品？']}];
  const f=await databaseFixture(t,{provider:{bailianObject:async settings=>{count++;if(count===1)return {kind:'plan',operation_id:null,tool:null,arguments_json:JSON.stringify({operations}),plan_json:null};if(count===2)return {kind:'respond',operation_id:'gift',tool:null,arguments_json:'{}',plan_json:JSON.stringify(chat)};assert.ok(settings.messages.some(m=>m.content.includes('已有物品')));assert.ok(settings.messages.some(m=>m.content.includes(original)));return {kind:'respond',operation_id:'gift',tool:null,arguments_json:'{}',plan_json:JSON.stringify({...chat,reply:'送礼支出属于哪个成员？'}),needs_input:true};}}});
  await f.tasks.createAssistantTask('owner',body({message:original}));await f.tasks.runAssistantTask('owner',taskId);await f.tasks.changeAssistantTask('owner',taskId,'cancel',1);
  const paused=await f.tasks.getAssistantTask('owner',taskId);assert.equal(paused.agent.awaiting_answer,true);
  const answer=body({id:id(70),user_message_id:id(80),message:'已有物品',display_text:'已有物品'});
  const resumed=await f.tasks.createAssistantTask('owner',answer);assert.equal(resumed.id,taskId);assert.equal(resumed.attempt,2);assert.equal(resumed.agent.goal,original);assert.equal((await f.tasks.createAssistantTask('owner',answer)).attempt,2);
  await assert.rejects(f.tasks.createAssistantTask('owner',{...answer,message:'新买的',display_text:'新买的'}),e=>e.status===409);
  await f.tasks.runAssistantTask('owner',taskId);const next=await f.tasks.getAssistantTask('owner',taskId);assert.equal(next.agent.goal,original);assert.equal(next.agent.operations.length,3);assert.equal(next.agent.operations[0].status,'pending');assert.equal(next.result.reply,'送礼支出属于哪个成员？');
  assert.equal((await f.db.query('SELECT count(*)::int count FROM assistant_tasks')).rows[0].count,1);assert.equal((await f.db.query('SELECT count(*)::int count FROM transactions')).rows[0].count,0);
 });
 test('real PostgreSQL: resuming a paused question rebinds an already split chat reply and retires only the confused clarification',async t=>{
  let count=0;const original='小美生日送礼500元';
  const f=await databaseFixture(t,{provider:{bailianObject:async()=>++count===1?{kind:'plan',operation_id:null,tool:null,arguments_json:JSON.stringify({operations:[{id:'gift',label:'送礼',action:'event',effect:'write',depends_on:[],sources:[original],questions:['鞋子是已有物品吗？']}]}),plan_json:null}:{kind:'respond',operation_id:'gift',tool:null,arguments_json:'{}',plan_json:JSON.stringify({...chat,reply:'支出属于哪个成员？'}),needs_input:true}}});
  await f.tasks.createAssistantTask('owner',body({message:original}));await f.tasks.runAssistantTask('owner',taskId);await f.tasks.changeAssistantTask('owner',taskId,'cancel',1);
  const parent=(await f.db.query('SELECT * FROM assistant_tasks')).rows[0];
  const c={version:1,goal_id:id(70),goal:'已有物品',status:'needs_input',steps:1,messages:[],tool_results:[],preview_fingerprints:[],pending_approval:null,awaiting_answer:true,output_id:id(71),current_operation_id:'question',operations:[{id:'question',label:'澄清',action:'chat',effect:'read',depends_on:[],sources:['已有物品'],status:'needs_input'}],outputs:[{id:id(71),user_message_id:id(80),input:{message:'已有物品',display_text:'已有物品',display_images:[]},attempt:1,plan:chat}]};
  const payload={...parent.payload,message:'已有物品'};
  await f.db.query(`INSERT INTO assistant_tasks(user_id,id,conversation_id,user_message_id,request_hash,payload,display_input,status,phase,result,agent_checkpoint,attempt,created_at) VALUES('owner',$1,$2,$3,'split',$4::jsonb,$5::jsonb,'succeeded','thinking',$6::jsonb,$7::jsonb,1,$8)`,[id(70),conversationId,id(80),JSON.stringify(payload),JSON.stringify({message:'已有物品',display_text:'已有物品',display_images:[]}),JSON.stringify(chat),JSON.stringify(c),new Date(new Date(parent.created_at).getTime()+1000)]);
  const recovered=await f.tasks.listAssistantTasks('owner',conversationId);const resumed=recovered.find(task=>task.id===taskId);assert.equal(resumed.id,taskId);assert.equal(resumed.attempt,2);assert.equal(resumed.user_message_id,id(80));
  const linked=await f.tasks.getAssistantTask('owner',id(70));assert.equal(linked.agent.status,'completed');assert.equal(linked.agent.awaiting_answer,undefined);assert.match(linked.result.reply,/接续原来/);
  await f.tasks.runAssistantTask('owner',taskId);const next=await f.tasks.getAssistantTask('owner',taskId);assert.equal(next.agent.goal,original);assert.equal(next.agent.awaiting_answer,true);
  const answer=await f.tasks.createAssistantTask('owner',body({id:id(90),user_message_id:id(91),message:'王城丽',display_text:'王城丽'}));assert.equal(answer.id,taskId);assert.equal(answer.attempt,3);
  assert.equal((await f.db.query('SELECT count(*)::int count FROM transactions')).rows[0].count,0);
 });
}

if (PGlite) {
  test('real PostgreSQL: 53 text rows continue automatically across worker waves as one pending group', async t => {
    const source=Array.from({length:53},(_,i)=>`早餐${i+1}花了${i+1}.01元\n`).join(''), starts=[];
    const f=await databaseFixture(t,{provider:{bailianRecordPage:async settings=>{
      const remaining=JSON.parse(settings.messages.at(-1).content).remaining,lines=remaining.match(/[^\n]+\n/g).slice(0,20);starts.push(Number(lines[0].match(/早餐(\d+)/)[1]));
      return {plan:{action:'record',reply:'请核对',query:null,drafts:lines.map(text=>{const n=Number(text.match(/早餐(\d+)/)[1]);return {...draft,amount_cents:n*100+1,description:`早餐${n}`};})},segments:lines.map((text,i)=>({text,draft_indexes:[i+1]}))};
    }}});
    await f.tasks.createAssistantTask('owner',body({message:source,display_text:source}));
    const continuation=await f.tasks.runAssistantTask('owner',taskId);assert.ok(continuation);
    const queued=await f.tasks.getAssistantTask('owner',taskId);assert.equal(queued.status,'queued');assert.equal(queued.result,null);
    const privateCheckpoint=(await f.db.query('SELECT agent_checkpoint FROM assistant_tasks')).rows[0].agent_checkpoint;
    assert.equal(privateCheckpoint.record_checkpoint.pages.length,2);assert.ok(privateCheckpoint.record_step);
    assert.equal(await f.tasks.runAssistantTask('owner',taskId,continuation),null);
    const finished=await f.tasks.getAssistantTask('owner',taskId);assert.equal(finished.status,'succeeded');assert.equal(finished.agent.status,'waiting_approval');assert.equal(finished.result.drafts.length,53);
    assert.deepEqual(starts,[1,21,41]);assert.equal(f.paidCalls.length,1,'the saved record decision resumes without another planning request');
    const restored=(await f.db.query('SELECT agent_checkpoint FROM assistant_tasks')).rows[0].agent_checkpoint;
    assert.equal(f.load('lib/assistant-agent-state.ts').restoreAssistantAgentCheckpoint(restored).pending_batch.draft_ids.length,53);
    assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows,[]);
  });

  test('real PostgreSQL: a 47-row screenshot persists pages and queues its tail before publishing review', async t=>{
    const starts=[];
    const f=await databaseFixture(t,{provider:{bailianObjectStream:async settings=>{
      const start=Number(settings.messages[0].content.match(/本页仅输出图内第(\d+)至/)[1]);starts.push(start);const output=imageBatch(settings),first=output.drafts[0];
      return {...output,total_rows:47,drafts:Array.from({length:Math.min(20,48-start)},(_,i)=>({...first,amount_cents:start+i,description:`交易${start+i}`,source:{...first.source,row_index:start+i}}))};
    }}});
    await f.tasks.createAssistantTask('owner',body({images:['data:image/png;base64,YWJj']}));
    const continuation=await f.tasks.runAssistantTask('owner',taskId);assert.ok(continuation);
    const queued=await f.tasks.getAssistantTask('owner',taskId);assert.equal(queued.status,'queued');assert.equal(queued.result,null);assert.equal(queued.image_progress.completed,0);
    const c=(await f.db.query('SELECT image_checkpoint FROM assistant_tasks')).rows[0].image_checkpoint;assert.equal(c.pages[1].length,2);assert.equal(c.results[0],null);
    assert.equal(await f.tasks.runAssistantTask('owner',taskId,continuation),null);
    const result=await f.tasks.getAssistantTask('owner',taskId);assert.equal(result.status,'succeeded');assert.equal(result.result.drafts.length,47);assert.equal(result.image_progress.completed,1);assert.deepEqual(starts,[1,21,41]);
    assert.deepEqual((await f.db.query('SELECT * FROM transactions')).rows,[]);
  });
}

if (PGlite) {
 test('real PostgreSQL: persisted control cancellation is fenced, account scoped, replay safe and resumes from the authoritative receipt',async t=>{
  const f=await databaseFixture(t,{provider:{bailianObject:async()=>({kind:'respond',tool:null,operation_id:null,arguments_json:'{}',plan_json:JSON.stringify({action:'chat',reply:'模型完成文字不作为凭据',drafts:[],query:null})})}});
  const message='早餐的修改先不用做了';
  await f.tasks.createAssistantTask('owner',body({message,display_text:message}));
  const commands=f.load('lib/assistant-command-server.ts');
  const saved=await commands.saveAssistantApproval('owner',conversationId,{command:{resource:'transactions',operation:'update'},items:[],dependencies:[]},'早餐金额20改22，尚未执行。');
  const other=await commands.saveAssistantApproval('owner',id(40),{command:{resource:'transactions',operation:'delete'},items:[],dependencies:[]},'其他对话的删除');
  const server=f.load('lib/assistant-control-server.ts');
  const contexts=await server.loadAssistantControlContexts('owner',conversationId,taskId);
  const target=contexts.find(c=>c.target_id===saved.approval.id);
  const control={target_type:'action',target_id:target.target_id,operation:target.operation,revision:target.revision,decision:'cancel',target_reference:'早餐',requested_operation:'update',changes_json:'{}',user_quote:message};
  const output=id(80);
  const c={version:1,workflow_required:true,goal_id:taskId,goal:message,status:'needs_input',steps:1,messages:[{role:'user',content:message}],tool_results:[],pending_approval:null,preview_fingerprints:[],output_id:output,current_operation_id:'control',awaiting_delivery:true,operations:[{id:'control',label:message,action:'control',effect:'local',depends_on:[],status:'needs_input',sources:[message]}],pending_plan:{action:'control',control,reply:'等待执行',drafts:[],query:null}};
  await f.db.query("UPDATE assistant_tasks SET status='succeeded',agent_checkpoint=$2::jsonb WHERE id=$1",[taskId,JSON.stringify(c)]);
  const route=f.load('app/api/assistant/tasks/[id]/control/route.ts');
  const request=attempt=>new NextRequest('http://ledger.test/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({attempt,output_id:output})});
  const context={params:Promise.resolve({id:taskId})};
  assert.equal((await route.POST(request(0),context)).status,400);
  for(let i=0;i<2;i++) { const response=await route.POST(request(1),context);assert.equal(response.status,200);assert.equal((await response.json()).status,'cancelled'); }
  assert.equal((await commands.getAssistantAction('owner',other.approval.id)).status,'pending');
  const delivered=await f.tasks.createAssistantTask('owner',body({message:'继续原任务',display_text:'继续原任务',continuation:{kind:'delivery',attempt:1,output_id:output,ok:true}}));
  assert.equal(delivered.attempt,2);assert.equal((await route.POST(request(1),context)).status,400,'consumed control cannot execute again');
  await f.tasks.runAssistantTask('owner',taskId);
  const done=await f.tasks.getAssistantTask('owner',taskId);assert.equal(done.agent.status,'completed');assert.match(done.result.reply,/取消/);assert.doesNotMatch(done.result.reply,/模型完成文字/);
  const checkpoint=(await f.db.query('SELECT agent_checkpoint FROM assistant_tasks WHERE id=$1',[taskId])).rows[0].agent_checkpoint;
  assert.equal(checkpoint.tool_results.filter(r=>r.name==='control_result').length,1);assert.equal(checkpoint.operations[0].status,'completed');
  assert.equal((await f.db.query('SELECT count(*)::int count FROM transactions')).rows[0].count,0);
 });
}

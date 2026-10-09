/* eslint-disable @typescript-eslint/no-require-imports -- exercise the real route with isolated provider and database fixtures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const { NextResponse } = require('next/server');

function load(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Error, SyntaxError, Date, JSON, Number, Response, TextEncoder,
    ReadableStream, AbortController, AbortSignal, process: { env: {} },
    require: name => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; },
  });
  return exports;
}
const assistant = load('lib/assistant.ts');
const images = load('lib/assistant-images.ts');
const imageImport = load('lib/assistant-image-import.ts', { '@/lib/assistant': assistant, '@/lib/assistant-images': images });
const imageRecognition = load('lib/assistant-image-recognition.ts', { ai: require('ai'), zod: require('zod'),
  '@/lib/assistant': assistant, '@/lib/assistant-images': images });
const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const categoryId = uuid(1), memberId = uuid(2), batchId = uuid(3), draftId = uuid(4);
const row = { id: draftId, type: 'expense', amount_cents: 1200, category_id: categoryId, member_id: memberId,
  transaction_date: '2026-10-08', description: '午餐', payment_method: null, note: '' };
const chat = { action: 'chat', reply: '可以把收支发给我。', drafts: [], query: null };
const record = { action: 'record', reply: '请核对后确认入账。', drafts: [row], query: null };
const imagePlan = value => ({ action: value.action, reply: value.reply, drafts: value.drafts.map(draft => ({
  type: draft.type, amount_cents: draft.amount_cents, category: draft.category_id === null ? null : 1,
  member: draft.member_id === null ? null : 1, date: draft.transaction_date, description: draft.description,
  payment_method: draft.payment_method, note: draft.note, source: draft.source ?? null,
})) });
const query = { start_date: '2026-10-01', end_date: '2026-10-08', type: 'expense',
  category_id: categoryId, member_id: memberId, keyword: '午餐' };
const queryPlan = { action: 'query', reply: '不应显示这个未查询的金额 999 元', drafts: [], query };
const facts = { summary: { count: 2, income: '0', expense: '24', balance: '-24' },
  breakdown: [{ category: '餐饮', type: 'expense', count: 2, amount: '24' }],
  largest_records: [{ type: 'expense', amount: '12', date: '2026-10-08', description: '午餐', category: '餐饮', member: '本人' }],
  currency: 'CNY' };
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
}
class BailianError extends Error {
  constructor(status, code) { super('provider failure'); this.status = status; this.code = code; }
}
function fixture(provider = {}, session = { userId: 'authorized-user' }) {
  const statements = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    statements.push({ text, values });
    assert.match(text, /^SELECT /);
    assert.equal(values[0], 'authorized-user');
    if (text.includes('FROM categories')) return [{ id: categoryId, name: '餐饮', type: 'expense' }];
    if (text.includes('FROM members')) return [{ id: memberId, name: '本人' }];
    assert.fail(`Unexpected SQL: ${text}`);
  };
  sql.query = async (text, values) => {
    statements.push({ text, values });
    assert.match(text, /^SELECT /);
    assert.equal(values[0], 'authorized-user');
    if (text.includes('GROUP BY')) return facts.breakdown;
    if (text.includes('TO_CHAR')) return facts.largest_records;
    return [facts.summary];
  };
  const deps = {
    'next/server': { NextResponse }, 'node:crypto': crypto,
    '@/lib/auth': { getSession: async () => session }, '@/lib/db': { sql }, '@/lib/assistant': assistant,
    '@/lib/assistant-output': { ASSISTANT_OUTPUT_SCHEMA: {} }, '@/lib/assistant-image-import': imageImport,
    '@/lib/assistant-image-recognition': imageRecognition,
    '@/lib/bailian': {
      BAILIAN_ASSISTANT_MODEL: 'fixture-object', BAILIAN_SUMMARY_MODEL: 'fixture-summary', BailianError,
      bailianConfig: () => ({}), bailianFailure: error => ({ status: error.status || 502,
        message: error.code === 'truncated' ? 'AI 回复被截断，请重试。' : 'AI 服务暂时无法连接，请稍后重试。' }),
      bailianObject: async () => assert.fail('streaming request used non-streaming object generation'),
      bailianObjectStream: async () => assert.fail('missing object stream fixture'),
      bailianStream: async () => assert.fail('unexpected summary stream'),
      bailianText: async () => assert.fail('streaming request used non-streaming text generation'),
      ...provider,
    },
  };
  deps['@/lib/assistant-generation'] = load('lib/assistant-generation.ts', deps);
  const route = load('app/api/assistant/route.ts', deps);
  return { route, statements };
}
function request(body = {}, signal = new AbortController().signal) {
  return { signal, json: async () => ({ message: '帮我记账', today: '2026-10-08', stream: true, ...body }) };
}
function observe(response) {
  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const done = (async () => {
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const text = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (text.trim()) events.push(JSON.parse(text));
      }
      if (done) { assert.equal(buffer, ''); return events; }
    }
  })();
  return { events, reader, done };
}

test('chat status and incremental text reach the reader before complete structured output is available', async () => {
  const gate = deferred();
  let upstreamSignal;
  const { route, statements } = fixture({ bailianObjectStream: async (settings, partial, signal) => {
    upstreamSignal = signal;
    assert.equal(settings.model, 'fixture-object');
    partial({ action: 'chat', reply: '可以' });
    partial({ action: 'chat', reply: '可以把收支' });
    await gate.promise;
    partial(chat);
    return chat;
  } });
  const response = await route.POST(request());
  assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  assert.match(response.headers.get('cache-control'), /no-transform/);
  const watched = observe(response);
  await tick();
  assert.deepEqual(watched.events, [{ type: 'status', phase: 'thinking' },
    { type: 'delta', text: '可以' }, { type: 'delta', text: '把收支' }]);
  assert.equal(upstreamSignal.aborted, false);
  gate.resolve();
  const events = await watched.done;
  assert.equal(events.filter(event => event.type === 'delta').map(event => event.text).join(''), chat.reply);
  assert.equal(events.at(-1).type, 'result');
  assert.equal(events.at(-1).plan.action, 'chat');
  assert.equal(events.at(-1).plan.reply, chat.reply);
  assert.equal(upstreamSignal.aborted, true, 'completion releases the upstream request');
  assert.equal(statements.length, 2, 'conversation generation only loads options');
});

test('record, member update and undo expose no provisional cards or operation replies before account validation', async () => {
  const targets = { batch_id: batchId, draft_ids: [draftId] };
  const scenarios = [
    { plan: imagePlan(record), body: { images: ['data:image/png;base64,YWJj'] }, phase: 'images' },
    { plan: { ...chat, action: 'update', reply: '已修改', update: { ...targets, member_id: memberId } },
      body: { draft_batch: { batch_id: batchId, status: 'pending', drafts: [row] } }, phase: 'thinking' },
    { plan: { ...chat, action: 'undo', reply: '已撤销', undo: targets },
      body: { saved_batch: { batch_id: batchId, status: 'saved', drafts: [row] } }, phase: 'thinking' },
  ];
  for (const scenario of scenarios) {
    const gate = deferred();
    const { route, statements } = fixture({ bailianObjectStream: async (settings, partial) => {
      partial(scenario.plan);
      await gate.promise;
      return scenario.plan;
    } });
    const watched = observe(await route.POST(request(scenario.body)));
    await tick();
    assert.deepEqual(watched.events, [{ type: 'status', phase: scenario.phase }]);
    gate.resolve();
    const events = await watched.done;
    assert.deepEqual(events.map(event => event.type), ['status', 'result']);
    assert.equal(events[1].plan.action, scenario.plan.action);
    assert.equal(statements.length, 2, 'partial and final plans perform no transaction writes');
    if (scenario.plan.action === 'record') {
      assert.equal(events[1].plan.drafts[0].amount_cents, row.amount_cents);
      assert.notEqual(events[1].plan.drafts[0].id, draftId, 'server assigns a fresh validated draft identity');
    } else if (scenario.plan.action === 'undo') {
      assert.match(events[1].plan.reply, /正在撤销/);
      assert.doesNotMatch(events[1].plan.reply, /已撤销/);
    }
  }
});

test('foreign update targets fail validation and never become actionable terminal results', async () => {
  const invalid = { ...chat, action: 'update', update: { batch_id: batchId, draft_ids: [uuid(99)], member_id: memberId } };
  const { route, statements } = fixture({ bailianObjectStream: async (_settings, partial) => { partial(invalid); return invalid; } });
  const watched = observe(await route.POST(request({ draft_batch: { batch_id: batchId, status: 'pending', drafts: [row] } })));
  const events = await watched.done;
  assert.deepEqual(events.map(event => event.type), ['status', 'error']);
  assert.match(events.at(-1).message, /目标账单已变更/);
  assert.equal(statements.length, 2);
});

test('streamed screenshot output discards a zero-value row only after completion and retains paid cents', async () => {
  const output = imagePlan({ ...record, reply: '识别到3笔', drafts: [row, { ...row, amount_cents: 0 }, { ...row, amount_cents: 1 }] });
  const gate = deferred();
  const { route, statements } = fixture({ bailianObjectStream: async (_settings, partial) => {
    partial(output); await gate.promise; return output;
  } });
  const watched = observe(await route.POST(request({ images: ['data:image/jpeg;base64,YWJj'] })));
  await tick();
  assert.deepEqual(watched.events, [{ type: 'status', phase: 'images' }]);
  gate.resolve();
  const events = await watched.done;
  assert.deepEqual(events.map(event => event.type), ['status', 'result']);
  assert.deepEqual(events[1].plan.drafts.map(d => d.amount_cents), [1200, 1]);
  assert.equal(events[1].plan.import_summary.skipped_zero_amounts, 1);
  assert.equal(statements.length, 2, 'generation only reads account options');
});

test('invalid compact screenshot references expose neither provisional cards nor a terminal plan', async () => {
  for (const patch of [{ category: 2 }, { member: memberId }, { amount_cents: 1.5 }]) {
    const output = imagePlan(record);
    output.drafts[0] = { ...output.drafts[0], ...patch };
    const gate = deferred();
    const { route, statements } = fixture({ bailianObjectStream: async (_settings, partial) => {
      partial(output); await gate.promise; return output;
    } });
    const watched = observe(await route.POST(request({ images: ['data:image/png;base64,YWJj'] })));
    await tick();
    assert.deepEqual(watched.events, [{ type: 'status', phase: 'images' }]);
    gate.resolve();
    const events = await watched.done;
    assert.deepEqual(events.map(event => event.type), ['status', 'error']);
    assert.match(events.at(-1).message, /截图识别格式|引用无效/);
    assert.equal(statements.length, 2);
  }
});

test('query summary starts only after user-scoped SQL facts and streams the second model response', async () => {
  const gate = deferred();
  let summarySettings;
  const { route, statements } = fixture({
    bailianObjectStream: async (_settings, partial) => { partial(queryPlan); return queryPlan; },
    bailianStream: async settings => {
      summarySettings = settings;
      return (async function* () {
        yield { type: 'text-delta', text: '你共支出 ' };
        await gate.promise;
        yield { type: 'text-delta', text: '24 元，共 2 笔。' };
        yield { type: 'finish', finishReason: 'stop' };
      })();
    },
  });
  const watched = observe(await route.POST(request({ message: '本月午餐花了多少？' })));
  await tick();
  assert.deepEqual(watched.events, [{ type: 'status', phase: 'thinking' }, { type: 'status', phase: 'query' },
    { type: 'delta', text: '你共支出 ' }]);
  assert.equal(summarySettings.model, 'fixture-summary');
  const context = JSON.parse(summarySettings.messages[1].content);
  assert.deepEqual(context, { question: '本月午餐花了多少？', filters: query, facts });
  assert.equal(statements.length, 5);
  for (const statement of statements.slice(2)) {
    assert.match(statement.text, /t\.user_id = \$1/);
    assert.deepEqual(plain(statement.values), ['authorized-user', query.start_date, query.end_date, 'expense', categoryId, memberId, '午餐']);
  }
  gate.resolve();
  const events = await watched.done;
  assert.equal(events.at(-1).plan.reply, '你共支出 24 元，共 2 笔。');
  assert.equal(events.filter(event => event.type === 'delta').map(event => event.text).join(''), events.at(-1).plan.reply);
  assert.equal(events.some(event => JSON.stringify(event).includes('999')), false);
});

test('provider failure after a visible chat partial terminates with an error and no complete plan', async () => {
  const gate = deferred();
  let signal;
  const { route } = fixture({ bailianObjectStream: async (_settings, partial, upstreamSignal) => {
    signal = upstreamSignal;
    partial({ action: 'chat', reply: '你可以' });
    await gate.promise;
    throw new BailianError(502, 'disconnected');
  } });
  const watched = observe(await route.POST(request()));
  await tick();
  assert.equal(watched.events.at(-1).text, '你可以');
  gate.resolve();
  const events = await watched.done;
  assert.deepEqual(events.map(event => event.type), ['status', 'delta', 'error']);
  assert.equal(signal.aborted, true);
});

test('character-by-character false chat success claims remain hidden when the provider disconnects', async () => {
  for (const reply of ['已撤销', '已修改', '撤销成功', '取消成功', '删除完成']) {
    const gate = deferred();
    const { route } = fixture({ bailianObjectStream: async (_settings, partial) => {
      for (let end = 1; end <= reply.length; end++) partial({ action: 'chat', reply: reply.slice(0, end) });
      await gate.promise;
      throw new BailianError(502, 'disconnected');
    } });
    const watched = observe(await route.POST(request()));
    await tick();
    assert.deepEqual(watched.events, [{ type: 'status', phase: 'thinking' }], reply);
    gate.resolve();
    const events = await watched.done;
    assert.deepEqual(events.map(event => event.type), ['status', 'error'], reply);
  }
});

test('false member and undo success statements in chat are exposed only as validated correction text', async () => {
  const memberCorrection = '尚未修改草稿，请明确指定本组成员，或直接在卡片中选择。';
  const undoCorrection = '尚未撤销，请使用账单卡片中的撤销入账。';
  const cases = [
    ['好的，已将本组成员改为「本人」。', '好的，', memberCorrection],
    ['成员已修改为本人。', '成员', memberCorrection],
    ['已撤销。', '', undoCorrection],
    ['撤销成功。', '', undoCorrection],
    ['取消成功。', '', undoCorrection],
    ['删除完成。', '', undoCorrection],
    ['现已全部取消。', '现', undoCorrection],
    ['我已为你撤销。', '我', undoCorrection],
    ['**已撤销**。', '**', undoCorrection],
  ];
  for (const [reply, safePrefix, corrected] of cases) {
    const gate = deferred();
    const { route, statements } = fixture({ bailianObjectStream: async (_settings, partial) => {
      for (let end = 1; end <= reply.length; end++) partial({ action: 'chat', reply: reply.slice(0, end) });
      await gate.promise;
      return { ...chat, reply };
    } });
    const watched = observe(await route.POST(request()));
    await tick();
    assert.equal(watched.events.filter(event => event.type === 'delta').map(event => event.text).join(''), safePrefix, reply);
    assert.equal(watched.events.some(event => event.type === 'result'), false);
    gate.resolve();
    const events = await watched.done;
    assert.equal(events.at(-1).type, 'result', reply);
    assert.equal(events.at(-1).plan.action, 'chat');
    assert.equal(events.at(-1).plan.reply, corrected, reply);
    assert.equal(statements.length, 2, 'a falsely labelled conversation cannot execute the claimed operation');
  }
});

test('holding a potentially sensitive chat prefix preserves the full legitimate explanation in the final reply', async () => {
  const reply = '可以在已入账卡片中撤销，再核对后重新确认。';
  const gate = deferred();
  const { route } = fixture({ bailianObjectStream: async (_settings, partial) => {
    for (let end = 1; end <= reply.length; end++) partial({ action: 'chat', reply: reply.slice(0, end) });
    await gate.promise;
    return { ...chat, reply };
  } });
  const watched = observe(await route.POST(request()));
  await tick();
  assert.equal(watched.events.filter(event => event.type === 'delta').map(event => event.text).join(''), '可以在');
  gate.resolve();
  const events = await watched.done;
  assert.equal(events.at(-1).plan.reply, reply);
});

test('truncated and incomplete query streams fail without a result and close the upstream iterator', async () => {
  for (const finishReason of ['length', null]) {
    let stopped = false;
    let signal;
    const { route } = fixture({
      bailianObjectStream: async () => queryPlan,
      bailianStream: async (_settings, upstreamSignal) => {
        signal = upstreamSignal;
        return (async function* () {
          try {
            yield { type: 'text-delta', text: '你共支出 ' };
            if (finishReason) yield { type: 'finish', finishReason };
          } finally { stopped = true; }
        })();
      },
    });
    const events = await observe(await route.POST(request())).done;
    assert.deepEqual(events.map(event => event.type), ['status', 'status', 'delta', 'error']);
    assert.equal(stopped, true);
    assert.equal(signal.aborted, true);
  }
});

test('request abort and response reader cancellation both promptly abort pending model work', { timeout: 2000 }, async () => {
  for (const method of ['request', 'reader']) {
    const abort = new AbortController();
    let signal;
    let stopped = false;
    const { route } = fixture({ bailianObjectStream: async (_settings, partial, upstreamSignal) => {
      signal = upstreamSignal;
      partial({ action: 'chat', reply: '开始回复' });
      try {
        await new Promise((resolve, reject) => {
          upstreamSignal.addEventListener('abort', () => reject(upstreamSignal.reason), { once: true });
        });
      } finally { stopped = true; }
    } });
    const watched = observe(await route.POST(request({}, abort.signal)));
    await tick();
    assert.equal(watched.events.at(-1).type, 'delta');
    if (method === 'request') abort.abort();
    else await watched.reader.cancel();
    await watched.done;
    await tick();
    assert.equal(signal.aborted, true);
    assert.equal(stopped, true);
    assert.equal(watched.events.some(event => event.type === 'result' || event.type === 'error'), false);
  }
});

test('non-streaming callers preserve the JSON plan contract and unauthenticated calls never start a provider', async () => {
  const { route } = fixture({ bailianObject: async () => record });
  const response = await route.POST(request({ stream: false }));
  assert.match(response.headers.get('content-type'), /application\/json/);
  const result = await response.json();
  assert.equal(result.action, 'record');
  assert.equal(result.drafts[0].amount_cents, row.amount_cents);
  const unauthorized = fixture({}, null);
  const denied = await unauthorized.route.POST(request());
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: '未登录' });
  assert.equal(unauthorized.statements.length, 0);
});

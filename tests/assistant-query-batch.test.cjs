/* eslint-disable @typescript-eslint/no-require-imports -- real isolated PostgreSQL reads, no account DB. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueryLedger, id, goal, command } = require('../scripts/fixtures/assistant-query-ledger.cjs');
const monthly = { start_date: '2026-10-01', end_date: '2026-10-31' };
function request() {
  const sources = goal.match(/[^。]+。/g);
  const operations = sources.map((source, n) => ({ id: `q${n}`, label: source, effect: 'read', depends_on: [], sources: [source] }));
  const reads = [
    ['q0', command('loans', { status: 'outstanding' })],
    ['q1', command('gifts_given', monthly)], ['q1', command('gift_records', monthly)],
    ['q2', command('notes', { status: 'active' })],
    ['q3', { ...command('transactions', monthly), order: 'desc' }],
  ].map(([operation_id, parameters]) => ({ operation_id, tool: 'records', parameters }));
  return { operations, reads };
}

test('the reported four-part request completes in two decisions with correct complete SQL results', { skip: !process.env.LEDGER_TASKS_PGLITE_MODULE }, async () => {
  const f = await createQueryLedger();
  try {
    const native = f.load('lib/assistant-native-tools.ts');
    const { runAssistantAgent } = f.load('lib/assistant-agent-runtime.ts');
    let calls = 0, checkpoint;
    f.adapters.chooseStep = async (messages, signal, operations) => {
      calls++;
      assert.equal(calls, 1, 'all read parameters come from the initial decision');
      const name = 'set_workflow';
      const input = request();
      const schema = native.assistantNativeToolsForState(operations)[name].inputSchema;
      const parsed = await schema.validate(input); assert.equal(parsed.success, true);
      return native.assistantNativeDecision({ id: `call-${calls}`, name, input: parsed.value }, [], goal, operations);
    };
    f.adapters.summarize = async (_goal, results) => {
      calls++;
      assert.ok(checkpoint.operations.every(op => op.status === 'completed'));
      assert.ok(results.some(r => r.result?.record_context?.rows.length === 84));
      const projected = JSON.parse(native.assistantReadSummaryMessages(goal, results)[1].content);
      const tx = projected.results.find(r => r.result.command?.resource === 'transactions');
      assert.equal(tx.result.count, 84); assert.equal(tx.result.record_context, undefined);
      return '已按借还方向、送收礼和未归档便利贴整理；收支明细按日期降序列出。';
    };
    const plan = await runAssistantAgent({ goalId: id(1), goal, requireWorkflow: true, messages: [], signal: AbortSignal.timeout(10000), adapters: f.adapters, onCheckpoint: value => { checkpoint = value; } });
    assert.equal(calls, 2);
    assert.deepEqual(f.check(plan, checkpoint), { completed: true, loans: true, gifts: true, notes: true, transactions: true, order: true, displayed: true, parameters: true, writes: true });
    assert.equal(f.reads.length, 5);
    const pages = f.sqlCalls.filter(call => call.text.includes('FROM transactions r'));
    assert.equal(pages.length, 2, '84 rows are read in pages of 50 and 34');
    assert.ok(pages.every(call => call.text.includes('LIMIT 50')));
    assert.deepEqual(Array.from(plan.record_context.rows, row => row.id), Array.from(checkpoint.tool_results.find(r => r.name === 'records' && r.result.record_context.resource === 'transactions').result.record_context.rows, row => row.id));
    assert.equal(plan.agent.operations.length, 4);
    assert.ok(!checkpoint.pending_reads?.length);
    assert.ok(!checkpoint.tool_results.some(r => r.name === 'validation_error'));
  } finally { await f.close(); }
});

test('keyset pagination preserves same-date rows, both date orders, and account boundaries', { skip: !process.env.LEDGER_TASKS_PGLITE_MODULE }, async () => {
  const f = await createQueryLedger();
  try {
    const server = f.load('lib/assistant-command-server.ts');
    const ordered = [];
    for (const order of ['asc','desc']) {
      const raw = command('transactions', monthly); const { values, ...fields } = raw;
      const result = await server.prepareLedgerCommand('owner', id(1), { ...fields, values_json: JSON.stringify(values), order });
      const rows = result.record_context.rows;
      assert.equal(rows.length, 84); assert.equal(new Set(rows.map(row => row.id)).size, 84);
      assert.ok(rows.every(row => row.id !== id(998) && row.id !== id(999)));
      assert.ok(rows.every((row, n) => !n || (order === 'asc' ? rows[n-1].transaction_date <= row.transaction_date : rows[n-1].transaction_date >= row.transaction_date)));
      ordered.push(rows.map(row => row.id));
    }
    assert.deepEqual(ordered[0], ordered[1].reverse());
    const raw = command('transactions', monthly); const { values, ...fields } = raw;
    await assert.rejects(server.prepareLedgerCommand('owner', id(1), { ...fields, operation: 'delete', values_json: JSON.stringify(values) }), /50/);
  } finally { await f.close(); }
});

test('saved read queue resumes unfinished work without querying completed resources again', { skip: !process.env.LEDGER_TASKS_PGLITE_MODULE }, async () => {
  const f = await createQueryLedger();
  try {
    const native = f.load('lib/assistant-native-tools.ts');
    const { runAssistantAgent } = f.load('lib/assistant-agent-runtime.ts');
    const { restoreAssistantAgentCheckpoint } = f.load('lib/assistant-agent-state.ts');
    let checkpoint, calls = 0;
    const originalCommand = f.adapters.command;
    f.adapters.command = async (...args) => {
      if (args[0].resource === 'gift_records') throw Error('SQL read failed');
      return originalCommand(...args);
    };
    f.adapters.chooseStep = async () => { calls++; return native.assistantNativeDecision({ id: 'first', name: 'set_workflow', input: request() }, [], goal); };
    const opts = { goalId: id(1), goal, requireWorkflow: true, messages: [], signal: AbortSignal.timeout(10000), adapters: f.adapters, onCheckpoint: value => { checkpoint = value; } };
    await assert.rejects(runAssistantAgent(opts), /SQL read failed/);
    assert.equal(calls, 1); assert.equal(checkpoint.operations[0].status, 'completed');
    assert.equal(checkpoint.pending_reads.length, 3);
    const restored = restoreAssistantAgentCheckpoint(checkpoint); assert.ok(restored);
    f.adapters.command = originalCommand;
    f.adapters.chooseStep = async (_m, _s, operations) => { calls++; assert.ok(operations.every(op => op.status === 'completed')); return native.assistantNativeDecision({ id: 'summary', name: 'respond', input: { reply: '查询完成', needs_input: false } }, [], goal, operations); };
    const plan = await runAssistantAgent({ ...opts, checkpoint: restored });
    assert.equal(calls, 2); assert.ok(Object.values(f.check(plan, checkpoint)).every(Boolean));
    assert.equal(f.reads.filter(r => r.parameters.resource === 'loans').length, 1);
    assert.equal(f.reads.filter(r => r.parameters.resource === 'gifts_given').length, 1);
  } finally { await f.close(); }
});

test('optional giftbook dates remain complete when a page ends inside NULL dates', { skip: !process.env.LEDGER_TASKS_PGLITE_MODULE }, async () => {
  const f = await createQueryLedger();
  try {
    for (let n = 0; n < 55; n++) await f.db.query('INSERT INTO giftbooks VALUES($1,$2,$3,NULL,$4,NULL,NULL)', [id(2000+n), 'owner', `礼簿${n}`, n < 10 ? '2026-10-10' : null]);
    const server = f.load('lib/assistant-command-server.ts');
    for (const order of ['asc', 'desc']) {
      const { values, ...fields } = command('giftbooks');
      const result = await server.prepareLedgerCommand('owner', id(1), { ...fields, values_json: JSON.stringify(values), order });
      assert.equal(result.record_context.rows.length, 55);
      assert.equal(new Set(result.record_context.rows.map(row => row.id)).size, 55);
      assert.ok(result.record_context.rows.slice(10).every(row => row.event_date === null));
    }
  } finally { await f.close(); }
});

test('batch parameters retain full agenda coverage and reject writes or missing queries before SQL', { skip: !process.env.LEDGER_TASKS_PGLITE_MODULE }, async () => {
  const f = await createQueryLedger();
  try {
    const native = f.load('lib/assistant-native-tools.ts');
    const { runAssistantAgent } = f.load('lib/assistant-agent-runtime.ts');
    const invalid = request(); invalid.reads[0].parameters.operation = 'delete';
    assert.equal((await native.ASSISTANT_NATIVE_TOOLS.set_workflow.inputSchema.validate(invalid)).success, false);
    const partial = request(); partial.reads = partial.reads.filter(r => r.operation_id !== 'q3');
    assert.throws(() => native.assistantNativeDecision({ id: 'bad', name: 'set_workflow', input: partial }, [], goal), /reads/);
    const omitted = request(); omitted.operations = omitted.operations.slice(0, 3); omitted.reads = omitted.reads.filter(r => r.operation_id !== 'q3');
    f.adapters.chooseStep = async () => native.assistantNativeDecision({ id: 'bad', name: 'set_workflow', input: omitted }, [], goal);
    const result = await runAssistantAgent({ goalId: id(1), goal, requireWorkflow: true, maxSteps: 1, messages: [], signal: AbortSignal.timeout(10000), adapters: f.adapters });
    assert.equal(result.agent.status, 'running'); assert.equal(f.reads.length, 0); assert.equal(f.sqlCalls.length, 0);
  } finally { await f.close(); }
});

test('read batches preserve existing duplicate queries and deliver complete CSV exports', { skip: !process.env.LEDGER_TASKS_PGLITE_MODULE }, async () => {
  const f = await createQueryLedger();
  try {
    const native = f.load('lib/assistant-native-tools.ts');
    const { runAssistantAgent } = f.load('lib/assistant-agent-runtime.ts');
    for (const operation of ['duplicates', 'export']) {
      const goal = operation === 'export' ? '导出本月收支明细' : '查询本月疑似重复收支';
      const input = { operations: [{ id: 'read', label: goal, effect: 'read', depends_on: [], sources: [goal] }],
        reads: [{ operation_id: 'read', tool: 'records', parameters: { ...command('transactions', monthly), operation } }] };
      assert.equal((await native.ASSISTANT_NATIVE_TOOLS.set_workflow.inputSchema.validate(input)).success, true);
      f.adapters.chooseStep = async () => native.assistantNativeDecision({ id: 'batch', name: 'set_workflow', input }, [], goal);
      f.adapters.summarize = async () => '已查询疑似重复候选，未修改账本。';
      const plan = await runAssistantAgent({ goalId: id(1), goal, requireWorkflow: true, messages: [], signal: AbortSignal.timeout(10000), adapters: f.adapters });
      assert.equal(plan.agent.status, 'completed');
      if (operation === 'export') {
        assert.equal(plan.action, 'manage'); assert.equal(plan.command.operation, 'export');
        assert.equal(plan.record_context.rows.length, 84);
        assert.equal(plan.export_file.csv.split('\r\n').length, 85);
      } else assert.match(plan.reply, /疑似重复/);
    }
  } finally { await f.close(); }
});

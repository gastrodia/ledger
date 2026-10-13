// Real configured model, actual read SQL against an isolated synthetic ledger.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.argv.includes('--live')) { console.log('Use --live; requires isolated PGlite. No account database access.'); process.exit(0); }
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name)+1] : fallback;
const { createQueryLedger } = require('./fixtures/assistant-query-ledger.cjs');
const repeat = Number(option('--repeat', '2'));
const report = { evidence: 'live_model_with_actual_SQL_in_synthetic_PGlite', account_database_access: false, account_writes: 0, runs: [] };
for (let round = 1; round <= repeat; round++) {
  const fixture = await createQueryLedger(option('--baseline'));
  const { load, adapters, goal } = fixture;
  const native = load('lib/assistant-native-tools.ts');
  const { bailianTool, bailianText, BAILIAN_ASSISTANT_MODEL } = load('lib/bailian.ts');
  const { runAssistantAgent } = load('lib/assistant-agent-runtime.ts');
  const execution = load('lib/assistant-execution.ts').createAssistantExecution();
  const model = process.env.BAILIAN_ASSISTANT_MODEL?.trim() || BAILIAN_ASSISTANT_MODEL;
  let calls = 0, checkpoint; const usage = [], durations = [];
  adapters.model = model;
  if (native.assistantReadSummaryMessages) adapters.summarize = async (goal, results, signal) => {
    calls++; const start = Date.now();
    try { return await bailianText({ model, thinking: false, temperature: 0.2, maxOutputTokens: 2000, timeoutMs: 60000, onUsage: u => usage.push(u), messages: native.assistantReadSummaryMessages(goal, results) }, signal); }
    finally { durations.push(Date.now()-start); }
  };
  adapters.chooseStep = async (messages, signal, operations, targets = [], results = [], userMessage = goal) => {
    calls++; const start = Date.now();
    try { return native.assistantNativeDecision(await bailianTool({ model, thinking: false, temperature: 0.2, maxOutputTokens: 6000, timeoutMs: 60000,
      onUsage: u => usage.push(u), tools: native.assistantNativeToolsForState(operations, targets, { draft_batch: false, saved_batch: false, record_ids: native.assistantNativeRecordIds(results) }), messages: native.assistantNativeMessages(messages) }, signal), targets, userMessage, operations); }
    finally { durations.push(Date.now()-start); }
  };
  const started = Date.now();
  try {
    let plan;
    do {
      plan = await runAssistantAgent({ goalId: fixture.id(1), goal, checkpoint, signal: AbortSignal.timeout(90000), requireWorkflow: true, adapters, execution,
        messages: [{ role: 'system', content: native.ASSISTANT_NATIVE_AGENT_PROMPT + '\n' + load('lib/ledger-event.ts').LEDGER_EVENT_PROMPT + '\n当前请求日期(today)：2026-10-13，相对日期以此为唯一基准。' }, { role: 'user', content: JSON.stringify({ today: '2026-10-13', categories: [], members: [], draft_batch: null, saved_batch: null, history: [] }) }, { role: 'user', content: goal }],
        onCheckpoint: value => { checkpoint = value; } });
    } while (plan.agent.status === 'running' && calls < 24);
    const checks = fixture.check(plan, checkpoint);
    report.runs.push({ round, model, passed: Object.values(checks).every(Boolean), checks, calls, elapsed_ms: Date.now()-started, model_ms: durations.reduce((a,b)=>a+b,0), durations, usage, status: plan.agent.status, operations: plan.agent.operations, reply: plan.reply, analysis: plan.analysis, reads: fixture.reads, sql_calls: fixture.sqlCalls, results: checkpoint.tool_results, native_calls: checkpoint.messages.filter(m => m.native_call).map(m => m.native_call), execution: execution.snapshot() });
  } catch (e) { report.runs.push({ round, passed: false, calls, elapsed_ms: Date.now()-started, model_ms: durations.reduce((a,b)=>a+b,0), error: { name: e.name, message: e.stepValidationError?.message || (e.name === 'BailianError' ? e.code : e.message) }, reads: fixture.reads, results: checkpoint?.tool_results }); }
  finally { await fixture.close(); }
  const output = path.resolve(option('--output', 'output/assistant-query-batch/results.json')); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2)+'\n');
  console.log(`Round ${round}: ${report.runs.at(-1).passed ? 'PASS' : 'FAIL'}, ${calls} model calls, ${report.runs.at(-1).elapsed_ms} ms`);
}
process.exitCode = report.runs.every(run => run.passed) ? 0 : 1;

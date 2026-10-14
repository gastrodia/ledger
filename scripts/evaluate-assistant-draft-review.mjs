// Real configured model and production task/generation code; all SQL uses disposable PGlite.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.argv.includes('--live')) { console.log('Use --live with LEDGER_TASKS_PGLITE_MODULE. No account database access.'); process.exit(0); }
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const { createDraftReview } = require('./fixtures/assistant-draft-review.cjs');
const report = { evidence: 'live_model_production_task_and_generation_with_synthetic_SQL', account_database_access: false, account_writes: 0, runs: [] };
for (let round = 1; round <= Number(option('--repeat', '2')); round++) {
  const f = await createDraftReview();
  const started = Date.now();
  try {
    const tasks = f.load('lib/assistant-tasks.ts');
    await f.load('lib/assistant-task-schema.ts').ensureAssistantTaskSchema();
    await f.load('lib/assistant-control-server.ts').loadAssistantControlContexts('owner', f.id(81), f.id(80));
    const start = f.statements.length;
    await tasks.createAssistantTask('owner', { id: f.id(80), conversation_id: f.id(81), user_message_id: f.id(82),
      message: f.goal, display_text: f.goal, today: '2026-10-14', draft_batch: f.batch });
    let next, waves = 0;
    do { next = await tasks.runAssistantTask('owner', f.id(80), next); waves++; } while (next && waves < 8);
    const task = await tasks.getAssistantTask('owner', f.id(80), true);
    const [saved] = (await f.db.query('SELECT agent_checkpoint FROM assistant_tasks WHERE id=$1', [f.id(80)])).rows;
    const checks = await f.check(task.result, saved.agent_checkpoint);
    const sqlWrites = f.statements.slice(start).filter(s => !/^\s*SELECT\b/.test(s.text) && !/assistant_tasks|assistant_task_conversations/.test(s.text));
    if (sqlWrites.length) throw Error('Unexpected business write during draft review');
    const run = { round, passed: true, elapsed_ms: Date.now() - started, waves, checks, status: task.status,
      agent: task.agent, execution: task.execution_steps, result: task.result, checkpoint: saved.agent_checkpoint };
    report.runs.push(run);
  } catch (error) {
    report.runs.push({ round, passed: false, elapsed_ms: Date.now() - started, error: { name: error.name, message: error.message } });
  } finally { await f.close(); }
  const output = path.resolve(option('--output', 'output/assistant-duplicate-diagnosis-20261014/live.json'));
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(`Round ${round}: ${report.runs.at(-1).passed ? 'PASS' : 'FAIL'}, ${report.runs.at(-1).elapsed_ms} ms`);
}
process.exitCode = report.runs.every(run => run.passed) ? 0 : 1;

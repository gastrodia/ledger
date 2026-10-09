/* eslint-disable @typescript-eslint/no-require-imports -- isolated progress presentation contracts. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => load(`${name.replace('@/', '')}.ts`) });
  return exports;
}
const { assistantProcessFromTask: snapshot, assistantProcessView: view, restoreAssistantProcess: restore } = load('lib/assistant-process.ts');
const task = extra => ({ status: 'running', phase: 'thinking', text: '', result: null, attempt: 1, ...extra });

test('initial understanding does not invent tool calls or completed steps', () => {
  const result = view(snapshot(task()));
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].state, 'running');
  assert.equal(result.steps.some(step => step.tool), false);
  assert.equal(view(snapshot(task({ status: 'queued' }))).steps[0].state, 'waiting');
});

test('query completion is only claimed after response text or a terminal query result', () => {
  const running = view(snapshot(task({ phase: 'query' })));
  assert.equal(running.steps[1].state, 'running');
  const streaming = view(snapshot(task({ phase: 'query', text: '汇总' })));
  assert.equal(streaming.steps[1].state, 'done');
  assert.equal(streaming.steps[2].state, 'running');
  const completed = view(snapshot(task({ status: 'succeeded', result: { action: 'query', drafts: [] } })));
  assert.ok(completed.steps.some(step => step.tool && step.label === '查询账本'));
  assert.ok(completed.steps.every(step => step.state === 'done'));
});

test('partial image failures preserve real counts without inventing merge completion', () => {
  const result = view(snapshot(task({ phase: 'images', status: 'failed', image_progress: { total: 3, completed: 1, failed: [2], active: [], stage: 'recognizing' } })));
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].state, 'failed');
  assert.match(result.steps[0].detail, /已完成 1\/3 张.*第 2 张失败/);
  assert.equal(result.active, false);
});

test('completed recognition remains done when merging is cancelled', () => {
  const result = view(snapshot(task({ phase: 'images', status: 'cancelled', image_progress: { total: 3, completed: 3, failed: [], active: [], stage: 'merging' } })));
  assert.equal(result.steps[0].state, 'done');
  assert.equal(result.steps[1].state, 'stopped');
});

test('restoration drops malformed metadata and excludes raw model or tool content', () => {
  const process = snapshot(task({ status: 'succeeded', result: { action: 'record', drafts: [{ id: 'draft' }], reply: 'private reply' } }));
  assert.equal(restore({ ...process, draftCount: -1 }), undefined);
  assert.equal(restore({ ...process, phase: 'invented' }), undefined);
  assert.equal(restore({ ...process, reasoning: 'private reasoning' }).reasoning, undefined);
  assert.equal(JSON.stringify(process).includes('private reply'), false);
  assert.match(view(process).steps.at(-1).detail, /需核对并确认/);
});

const { assistantProcessElapsed: elapsed } = load('lib/assistant-process.ts');
const started = Date.parse('2026-10-09T03:00:00Z');
const timedTask = extra => task({ created_at: new Date(started).toISOString(), updated_at: new Date(started + 65000).toISOString(), ...extra });

test('active timing advances from server submission time and survives refresh and retries', () => {
  const process = snapshot(timedTask());
  assert.equal(elapsed(process, started + 12000), '已用时 12 秒');
  assert.equal(elapsed(restore(JSON.parse(JSON.stringify(process))), started + 65000), '已用时 1 分 5 秒');
  assert.equal(elapsed(snapshot(timedTask({ status: 'queued', attempt: 2 })), started + 3661000), '已用时 1 小时 1 分 1 秒');
  assert.equal(elapsed(process, started - 1000), '已用时 0 秒');
});

test('success, failure and cancellation freeze at the server terminal timestamp', () => {
  for (const status of ['succeeded', 'failed', 'cancelled']) {
    const process = restore(snapshot(timedTask({ status })));
    assert.equal(elapsed(process, started + 65000), '耗时 1 分 5 秒');
    assert.equal(elapsed(process, started + 86400000), '耗时 1 分 5 秒');
  }
});

test('legacy or invalid timing is hidden instead of fabricating historical durations', () => {
  assert.equal(elapsed(restore(snapshot(task())), started), null);
  assert.equal(elapsed(snapshot(timedTask({ status: 'failed', updated_at: 'invalid' })), started), null);
  assert.equal(elapsed(snapshot(timedTask({ status: 'failed', updated_at: new Date(started - 1).toISOString() })), started), null);
  assert.equal(restore({ ...snapshot(timedTask()), startedAt: 'invalid' }).startedAt, undefined);
  assert.equal(restore({ ...snapshot(timedTask()), finishedAt: started + 1000 }).finishedAt, undefined);
});

const execution = load('lib/assistant-execution.ts');
const detailedStep = extra => ({ id: 'query', label: '查询账本记录', kind: 'tool', state: 'done', startedAt: started, finishedAt: started + 2000, details: ['日期：2026-10-01 至 2026-10-09', '匹配 3 笔记录'], ...extra });

test('detailed records replace coarse stages with actual parameters, outcomes and individual durations', () => {
  const process = restore(snapshot(timedTask({ status: 'succeeded', execution_steps: [detailedStep()] })));
  const result = view(process);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].label, '查询账本记录');
  assert.equal(result.steps[0].details[1], '匹配 3 笔记录');
  assert.equal(result.steps[0].duration, '2 秒');
});

test('cancellation and expiry interrupt in-flight detailed work without altering completed steps', () => {
  for (const status of ['cancelled', 'failed']) {
    const result = view(snapshot(timedTask({ status, execution_steps: [detailedStep(), detailedStep({ id: 'answer', state: 'running', finishedAt: undefined })] })));
    assert.equal(result.steps[0].state, 'done');
    assert.equal(result.steps[1].state, status === 'cancelled' ? 'stopped' : 'failed');
    assert.equal(result.steps[1].duration, '1 分 5 秒');
  }
});

test('trace restoration strips unknown payloads, oversized entries and duplicate ids', () => {
  const steps = execution.restoreAssistantExecution([detailedStep({ prompt: 'secret', sql: 'private' }), detailedStep(), detailedStep({ id: 'oversized', details: ['a'.repeat(241)] })]);
  assert.equal(steps.length, 1);
  assert.equal(JSON.stringify(steps).includes('secret'), false);
  assert.equal(execution.restoreAssistantExecution(Array(25).fill(detailedStep())).length, 0);
});

test('execution reporter replaces states without modifying earlier snapshots and only fails unfinished work', () => {
  const report = execution.createAssistantExecution();
  report.start('context', '读取分类', 'tool');
  const active = report.snapshot();
  report.finish('context', ['分类 3 个']);
  report.start('model', '理解请求', 'model');
  report.failRunning();
  assert.equal(active[0].state, 'running');
  assert.equal(report.snapshot()[0].state, 'done');
  assert.equal(report.snapshot()[1].state, 'failed');
});

/* eslint-disable @typescript-eslint/no-require-imports -- isolated financial pagination contracts. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function fixture() {
  const cache = new Map();
  const load = file => {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
      exports, Date, JSON, Number, Error, AbortController, AbortSignal, structuredClone, process, console,
      require: name => {
        if (name === '@/lib/bailian') return { BAILIAN_ASSISTANT_MODEL: 'fixture', bailianObject: () => assert.fail('unexpected paid call') };
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        return require(name);
      },
    });
    return exports;
  };
  return { ...load('lib/assistant-record-batches.ts'), assistant: load('lib/assistant.ts'), draftActions: load('lib/assistant-draft-actions.ts'), state: load('lib/assistant-agent-state.ts') };
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = { source: Array.from({ length: 53 }, (_, i) => `第${i + 1}次早餐${i + 1}.01元\n`).join(''), today: '2026-10-12', context: {}, categories: [{ id: id(1), type: 'expense', name: '餐饮' }], members: [{ id: id(2), name: '本人' }] };
const draft = n => ({ type: 'expense', amount_cents: n * 100 + 1, category_id: id(1), member_id: id(2), transaction_date: input.today, description: `早餐${n}`, payment_method: null, note: '' });
function page(messages) {
  const remaining = JSON.parse(messages.at(-1).content).remaining;
  const lines = remaining.match(/[^\n]+\n/g).slice(0, 20);
  return { plan: { action: 'record', reply: '待核对', drafts: lines.map(line => draft(Number(line.match(/第(\d+)次/)[1]))), query: null },
    segments: lines.map((text, index) => ({ text, draft_indexes: [index + 1] })) };
}

test('53 text transactions are consumed as 20/20/13 with exact cents and source order', async () => {
  const api = fixture(), sizes = [], checkpoints = [];
  const plan = await api.generateAssistantRecordBatches(input, new AbortController().signal, {
    generatePage: async (messages, schema) => { const raw = page(messages); sizes.push(raw.plan.drafts.length); assert.equal((await schema.validate(raw)).success, true); return raw; },
    onCheckpoint: c => checkpoints.push(c),
  });
  assert.deepEqual(sizes, [20, 20, 13]);
  assert.equal(plan.drafts.length, 53);
  assert.deepEqual(Array.from(plan.drafts, d => d.amount_cents), Array.from({ length: 53 }, (_, i) => (i + 1) * 100 + 1));
  assert.equal(new Set(plan.drafts.map(d => d.id)).size, 53);
  assert.equal(checkpoints.at(-1).pages.flatMap(p => p.segments).map(s => s.text).join(''), input.source);
  assert.equal(api.assistant.confirmationRows(plan.drafts).length, 53);
  const batch = { batch_id: id(3), status: 'pending', drafts: plan.drafts };
  assert.equal(api.assistant.validateDraftBatch(batch).drafts.length, 53);
  assert.equal(api.draftActions.draftConfirmSchema.safeParse({ batch_id: id(3), draft_ids: plan.drafts.map(d => d.id) }).success, true);
  assert.equal(api.assistant.applyDraftMemberUpdate(plan.drafts, { batch_id: id(3), draft_ids: plan.drafts.map(d => d.id), member_id: id(2) }, input.members).length, 53);
});

test('a failed middle page exposes no partial card and resumes completed pages without rereading them', async () => {
  const api = fixture(); let checkpoint, calls = 0;
  await assert.rejects(api.generateAssistantRecordBatches(input, new AbortController().signal, {
    generatePage: async messages => { if (++calls === 2) throw new Error('provider interrupted'); return page(messages); }, onCheckpoint: c => { checkpoint = c; },
  }), /provider interrupted/);
  assert.equal(checkpoint.pages.length, 1);
  const resumed = [];
  const result = await api.generateAssistantRecordBatches(input, new AbortController().signal, { checkpoint,
    generatePage: async messages => { resumed.push(JSON.parse(messages.at(-1).content).remaining); return page(messages); },
  });
  assert.equal(resumed.length, 2); assert.match(resumed[0], /^第21次/); assert.equal(result.drafts.length, 53);
});

test('a source gap, omitted draft mapping, repeated mapping or zero progress fails closed', () => {
  const api = fixture(), raw = page([{ content: JSON.stringify({ remaining: input.source }) }]);
  for (const mutate of [p => p.segments.shift(), p => { p.segments[0].draft_indexes = []; }, p => { p.segments[1].draft_indexes = [1]; }, p => { p.segments = []; }, p => { p.segments[0].text = ''; }]) {
    const value = structuredClone(raw); mutate(value);
    assert.throws(() => api.validateAssistantRecordPage(value, input.source, input));
  }
});

test('ambiguity in a later page never publishes earlier drafts as a complete review group', async () => {
  const api = fixture(); let calls = 0;
  const result = await api.generateAssistantRecordBatches(input, new AbortController().signal, {
    generatePage: async messages => ++calls === 1 ? page(messages) : { plan: { action: 'chat', reply: '请补充日期', drafts: [], query: null }, segments: [{ text: JSON.parse(messages.at(-1).content).remaining, draft_indexes: [] }] },
  });
  assert.equal(result.action, 'chat'); assert.equal(result.drafts.length, 0); assert.match(result.reply, /尚未完成/);
});

test('equal transactions on separate source occurrences remain separate drafts across pages', async () => {
  const api = fixture(), repeated = { ...input, source: '早餐1元\n'.repeat(41) };
  const result = await api.generateAssistantRecordBatches(repeated, new AbortController().signal, {
    generatePage: async messages => { const lines = JSON.parse(messages.at(-1).content).remaining.match(/[^\n]+\n/g).slice(0,20); return { plan: { action: 'record', reply: '', drafts: lines.map(() => draft(1)), query: null }, segments: lines.map((text, i) => ({ text, draft_indexes: [i+1] })) }; },
  });
  assert.equal(result.drafts.length, 41);
});

test('source scoping unions overlapping quotes, preserves repeated occurrences and keeps original order', () => {
  const api = fixture();
  assert.equal(api.assistantRecordSource('早餐12元，早餐12元；地铁3元。', ['早餐12元', '地铁3元', '早餐12元']), '早餐12元\n早餐12元\n地铁3元');
  assert.equal(api.assistantRecordSource('今天早餐12元，地铁3元。', ['地铁3元', '今天早餐12元，地铁3元', '早餐12元']), '今天早餐12元，地铁3元');
});

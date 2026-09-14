/* eslint-disable @typescript-eslint/no-require-imports -- node:test harness for notes rules and authenticated routes. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { NextResponse } = require('next/server');
function load(file, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: name => { if (!(name in deps)) throw Error(`Unexpected dependency: ${name}`); return deps[name]; }, console: { error() {} }, SyntaxError,
  });
  return exports;
}
const rules = load('lib/notes.ts');
const note = (id, fields = {}) => ({ id, title: null, content: '记得买牛奶', updated_at: '2026-09-14', ...fields });

test('wall filtering handles legacy colors, content search, archives and pinned ordering without mutating input', () => {
  const notes = [note('old'), note('pink', { color: 'pink', title: 'IDEA' }), note('pin', { pinned_at: '2026-09-14' }), note('archive', { archived_at: '2026-09-14' })];
  assert.equal(rules.selectNotes(notes, '', false, 'all').map(n => n.id).join(','), 'pin,old,pink');
  assert.equal(rules.selectNotes(notes, ' idea ', false, 'pink')[0].id, 'pink');
  assert.equal(rules.selectNotes(notes, '牛奶', true, 'yellow')[0].id, 'archive');
  assert.equal(rules.selectNotes(notes, '', false, 'purple').length, 0);
  assert.equal(notes[0].id, 'old');
  assert.equal(rules.getNoteColor('invalid').value, 'yellow');
});

test('note validation rejects malformed payloads before writes and accepts historic Markdown unchanged', () => {
  for (const input of [null, [], 'text', { content: 42 }, { content: '' }, { content: '  ' }, { content: 'ok', title: 42 }, { content: 'ok', title: 'a'.repeat(256) }, { content: 'ok', color: 'red' }, { content: 'ok', pinned: 'false' }]) assert.ok(rules.validateNoteInput(input, true));
  assert.equal(rules.validateNoteInput({ content: '# 标题\n![](https://example.invalid/image.png)', color: 'blue' }, true), null);
  assert.equal(rules.validateNoteInput({ pinned: false, archived: true }), null);
  assert.equal(rules.validateNoteInput({ title: null, color: 'purple' }), null);
});

function fixture({ session = { userId: 'owner' }, result = [note('n')], schemaFailure } = {}) {
  const calls = [];
  let schemaCalls = 0;
  const sql = async (parts, ...values) => { calls.push({ query: parts.join('?'), values }); return result; };
  sql.query = async (query, values) => { calls.push({ query, values }); return result; };
  const dependencies = {
    'next/server': { NextResponse }, '@/lib/db': { sql }, '@/lib/auth': { getSession: async () => session },
    '@/lib/notes': rules, '@/lib/notes-schema': { ensureNotesSchema: async () => { schemaCalls++; if (schemaFailure) throw schemaFailure; } }, uuid: { v4: () => 'new-note' },
  };
  return { calls, schemaCalls: () => schemaCalls, collection: load('app/api/notes/route.ts', dependencies), item: load('app/api/notes/[id]/route.ts', dependencies) };
}
const req = body => ({ json: async () => body });
const context = { params: Promise.resolve({ id: 'n' }) };

test('every notes operation requires authentication before schema checks and reads/writes', async () => {
  const f = fixture({ session: null });
  for (const operation of [() => f.collection.GET({}), () => f.collection.POST(req({ content: 'hello' })), ...['GET', 'PATCH', 'DELETE'].map(method => () => f.item[method](req({ content: 'hello' }), context))]) assert.equal((await operation()).status, 401);
  assert.equal(f.calls.length, 0); assert.equal(f.schemaCalls(), 0);
});

test('create persists color and untouched Markdown, defaults older clients to yellow, rejects invalid writes', async () => {
  const f = fixture();
  const content = '\n# Original\n![](https://example.invalid/legacy.png)\n';
  assert.equal((await f.collection.POST(req({ title: ' Title ', content, color: 'green' }))).status, 201);
  assert.deepEqual(f.calls[0].values, ['new-note', 'owner', 'Title', content, 'green']);
  await f.collection.POST(req({ content })); assert.equal(f.calls[1].values.at(-1), 'yellow');
  assert.equal((await f.collection.POST(req({ content, color: 'invalid' }))).status, 400); assert.equal(f.calls.length, 2);
});

test('partial edits update only supplied fields atomically and restrict the write to the owner', async () => {
  const f = fixture();
  assert.equal((await f.item.PATCH(req({ color: 'blue' }), context)).status, 200);
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].query, /UPDATE notes/);
  assert.deepEqual(f.calls[0].values, [false, null, false, null, true, 'blue', false, false, false, false, 'n', 'owner']);
  assert.match(f.calls[0].query, /ELSE content END/); assert.match(f.calls[0].query, /WHERE id = \? AND user_id = \?/);
  assert.equal((await f.item.PATCH(req({ content: 42 }), context)).status, 400); assert.equal(f.calls.length, 1);
  assert.equal((await fixture({ result: [] }).item.PATCH(req({ pinned: true }), context)).status, 404);
});

test('list filters use bound parameters and read/delete lookups retain ownership boundaries', async () => {
  const f = fixture();
  await f.collection.GET({ nextUrl: new URL('https://example.invalid/api/notes?archived=true&q=%27') });
  assert.match(f.calls[0].query, /archived_at IS NOT NULL/); assert.deepEqual(Array.from(f.calls[0].values), ['owner', "%'%"]);
  await f.item.GET({}, context); await f.item.DELETE({}, context);
  for (const call of f.calls.slice(1)) { assert.match(call.query, /WHERE id = \? AND user_id = \?/); assert.deepEqual(call.values, ['n', 'owner']); }
});

test('schema upgrade is additive, skips DDL once present and retries after permission failure', async () => {
  let present = false, denied = true; const writes = [];
  const { ensureNotesSchema } = load('lib/notes-schema.ts', { '@/lib/db': { sql: async parts => {
    const query = parts.join('');
    if (query.startsWith('SELECT')) { if (!present) throw { code: '42703' }; return []; }
    writes.push(query); if (denied) throw Error('denied'); present = true;
  } } });
  await assert.rejects(ensureNotesSchema, /denied/); denied = false;
  await ensureNotesSchema(); await ensureNotesSchema();
  assert.equal(writes.length, 2); assert.match(writes[0], /ADD COLUMN IF NOT EXISTS color/); assert.doesNotMatch(writes[0], /DELETE|DROP|UPDATE/);
  const broken = load('lib/notes-schema.ts', { '@/lib/db': { sql: async () => { throw Error('network'); } } });
  await assert.rejects(broken.ensureNotesSchema, /network/);
});

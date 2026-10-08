/* eslint-disable @typescript-eslint/no-require-imports -- node:test harness for authenticated icon updates. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { NextResponse } = require('next/server');

function load(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name) => {
    assert.ok(name in dependencies, `Unexpected import: ${name}`);
    return dependencies[name];
  }, console: { error() {} } });
  return exports;
}

const catalog = load('lib/entity-icon-catalog.ts');
const context = { params: Promise.resolve({ id: 'entity' }) };
const request = (body) => ({ json: async () => body });

function fixture(entity, { authenticated = true, exists = true } = {}) {
  const field = entity === 'categories' ? 'icon' : 'avatar';
  const value = entity === 'categories' ? catalog.DEFAULT_CATEGORY_ICON : catalog.DEFAULT_MEMBER_AVATAR;
  const queries = [];
  const sql = async (parts, ...values) => {
    const text = parts.join('?');
    queries.push({ text, values });
    if (text.includes('SELECT *')) return exists ? [{ id: 'entity', name: 'saved', type: 'expense', [field]: value }] : [];
    return [{ id: 'entity' }];
  };
  sql.transaction = async (statements) => Promise.all(statements);
  const deps = {
    'next/server': { NextResponse },
    '@/lib/auth': { getSession: async () => authenticated ? { userId: 'owner' } : null },
    '@/lib/db': { sql },
    '@/lib/entity-icon-catalog': catalog,
    '@/lib/categories-schema': { ensureCategoriesSchema: async () => {} },
    uuid: { v4: () => 'entity' },
  };
  return {
    field, value, queries,
    create: (body) => load(`app/api/${entity}/route.ts`, deps).POST(request({ name: 'new', type: 'expense', ...body })),
    update: (body) => load(`app/api/${entity}/[id]/route.ts`, deps).PATCH(request(body), context),
  };
}

for (const entity of ['categories', 'members']) {
  test(`${entity} rejects Emoji, SVG markup, unknown identifiers, and nonstring icon values before SQL`, async () => {
    for (const value of ['🍜', '<svg onload="alert(1)"></svg>', 'lucide:unknown', 'https://example.com/icon.svg', ' ', {}, [], 1, false]) {
      const f = fixture(entity);
      for (const save of [f.create, f.update]) {
        assert.equal((await save({ [f.field]: value })).status, 400);
        assert.equal(f.queries.length, 0);
      }
    }
  });

  test(`${entity} persists valid selections, clears null/empty values, and retains omitted values on update`, async () => {
    const initial = fixture(entity);
    for (const value of [initial.value, null, '', undefined]) {
      for (const method of ['create', 'update']) {
        const f = fixture(entity);
        assert.equal((await f[method](value === undefined ? {} : { [f.field]: value })).status, 200);
        const write = f.queries.find(({ text }) => /INSERT INTO|UPDATE (categories|members)\s+SET/.test(text));
        assert.ok(write);
        const expected = value === undefined && method === 'update' ? f.value : value || null;
        const valueIndex = method === 'create' ? (entity === 'categories' ? 4 : 3) : (entity === 'categories' ? 2 : 1);
        assert.equal(write.values[valueIndex], expected);
        if (method === 'update') assert.match(write.text, /WHERE id = \? AND user_id = \?/);
      }
    }
  });

  test(`${entity} icon writes require authentication and ownership`, async () => {
    const guest = fixture(entity, { authenticated: false });
    for (const save of [guest.create, guest.update]) assert.equal((await save({ [guest.field]: guest.value })).status, 401);
    assert.equal(guest.queries.length, 0);
    const missing = fixture(entity, { exists: false });
    assert.equal((await missing.update({ [missing.field]: missing.value })).status, 404);
    assert.equal(missing.queries.length, 1);
    assert.deepEqual(missing.queries[0].values, ['entity', 'owner']);
  });
}

test('members saves family, text and initials avatars on create and update without allowing them as category icons', async () => {
  for (const value of ['initials', 'family:father', 'family:mother', 'family:maternal-grandmother', 'text:father', 'text:mother']) {
    const f = fixture('members');
    assert.equal((await f.create({ avatar: value })).status, 200);
    assert.equal(f.queries[0].values[3], value);
    assert.equal((await f.update({ avatar: value })).status, 200);
    const update = f.queries.find(({ text }) => text.includes('UPDATE members'));
    assert.equal(update.values[1], value);
    assert.equal((await fixture('categories').create({ icon: value })).status, 400);
  }
});

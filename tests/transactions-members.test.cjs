(async () => {
  const [{ default: assert }, { default: test }, { default: fs }, { default: vm }, { default: ts }, { NextResponse }] = await Promise.all([
    import('node:assert/strict'), import('node:test'), import('node:fs'), import('node:vm'), import('typescript'), import('next/server.js'),
  ]);

  function fixture({ exists = true } = {}) {
    const calls = { queries: [], attachments: 0, writes: 0 };
    const sql = (strings, ...values) => {
      const text = strings.join('?');
      calls.queries.push({ text, values });
      if (text.includes('FROM categories')) return [{ id: 'food', type: 'expense' }];
      if (text.includes('FROM members')) return exists ? [{ id: 'member' }] : [];
      return [];
    };
    sql.transaction = async () => { calls.writes++; return [[], [{ id: 'record', member_id: 'member', amount: '10' }]]; };
    const mocks = {
      'next/server': { NextResponse },
      '@/lib/auth': { getSession: async () => ({ userId: 'owner' }) },
      '@/lib/db': { sql },
      '@/lib/attachments': { validateAttachment: async () => { calls.attachments++; return null; } },
      uuid: { v4: () => 'new-id' },
    };
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/transactions/route.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, require: (id) => { assert.ok(id in mocks); return mocks[id]; }, console });
    return { calls, create: (member_id) => exports.POST({ json: async () => ({ type: 'expense', category_id: 'food', amount: 10, transaction_date: '2026-09-07', member_id }) }) };
  }

  test('create requires a nonblank string member before SQL or attachment processing', async () => {
    for (const value of [undefined, null, '', '   ', 1, {}, []]) {
      const f = fixture();
      const response = await f.create(value);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, '请选择家庭成员');
      assert.equal(f.calls.queries.length, 0);
      assert.equal(f.calls.attachments, 0);
      assert.equal(f.calls.writes, 0);
    }
  });

  test('missing or foreign members are rejected using an owner-scoped lookup', async () => {
    const f = fixture({ exists: false });
    const response = await f.create('foreign-member');
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, '家庭成员不存在');
    assert.match(f.calls.queries.find((query) => query.text.includes('FROM members')).text, /id = \? AND user_id = \?/);
    assert.deepEqual(f.calls.queries.find((query) => query.text.includes('FROM members')).values, ['foreign-member', 'owner']);
    assert.equal(f.calls.attachments, 0);
    assert.equal(f.calls.writes, 0);
  });

  test('a valid owned member can create a transaction', async () => {
    const f = fixture();
    const response = await f.create('member');
    assert.equal(response.status, 201);
    assert.equal((await response.json()).data.member_id, 'member');
    assert.equal(f.calls.writes, 1);
  });
})().catch((error) => { console.error(error); process.exitCode = 1; });

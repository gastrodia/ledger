(async () => {
  const [assert, { test }, fs, vm, ts, { NextResponse }] = await Promise.all([
    import('node:assert/strict').then(m => m.default), import('node:test'), import('node:fs').then(m => m.default),
    import('node:vm').then(m => m.default), import('typescript').then(m => m.default), import('next/server.js'),
  ]);
  function fixture(method, { category = { id: 'food', type: 'expense' }, oldCategory = 'food' } = {}) {
    const calls = { writes: 0, attachments: 0, queries: [] };
    const sql = (strings, ...values) => {
      const text = strings.join('?'); calls.queries.push({ text, values });
      if (text.includes('SELECT * FROM transactions')) return [{ id: 'record', category_id: oldCategory, type: 'expense', amount: 10 }];
      if (text.includes('FROM categories')) return category ? [category] : [];
      if (text.includes('FROM members')) return [{ id: 'member' }];
      return [];
    };
    sql.transaction = async () => { calls.writes++; return [[], [{ id: 'record', amount: '10' }]]; };
    const mocks = {
      'next/server': { NextResponse }, '@/lib/db': { sql },
      '@/lib/auth': { getSession: async () => ({ userId: 'owner' }) },
      '@/lib/attachments': { validateAttachment: async () => { calls.attachments++; return null; }, deleteOwnedAttachment: async () => {} },
      uuid: { v4: () => 'id' },
    };
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(method === 'POST' ? 'app/api/transactions/route.ts' : 'app/api/transactions/[id]/route.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, require: id => mocks[id], console });
    return { calls, run: body => exports[method]({ json: async () => ({ type: 'expense', amount: 10, transaction_date: '2026-09-07', member_id: 'member', ...body }) }, { params: Promise.resolve({ id: 'record' }) }) };
  }
  for (const method of ['POST', 'PATCH']) {
    test(`${method} rejects empty or malformed categories before writes and attachments`, async () => {
      for (const category_id of [null, '', '  ', 1, {}, []]) {
        const f = fixture(method); const response = await f.run({ category_id });
        assert.equal(response.status, 400); assert.equal((await response.json()).error, '请选择分类');
        assert.equal(f.calls.writes, 0); assert.equal(f.calls.attachments, 0);
      }
    });
    test(`${method} rejects missing/foreign categories and mismatched types`, async () => {
      for (const category of [null, { id: 'food', type: 'income' }]) {
        const f = fixture(method, { category }); const response = await f.run({ category_id: 'food' });
        assert.equal(response.status, 400); assert.equal(f.calls.writes, 0); assert.equal(f.calls.attachments, 0);
        const query = f.calls.queries.find(q => q.text.includes('FROM categories'));
        assert.match(query.text, /id = \? AND user_id = \?/); assert.deepEqual(query.values, ['food', 'owner']);
      }
    });
    test(`${method} accepts an owned category matching the transaction`, async () => {
      const f = fixture(method); assert.equal((await f.run({ category_id: 'food' })).status, method === 'POST' ? 201 : 200);
      assert.equal(f.calls.writes, 1);
      assert.ok(f.calls.queries.some(q => q.text.includes('EXISTS') && !q.text.includes('IS NULL OR')));
    });
  }
  test('omission is rejected on creation and historical uncategorized edits, but retains a valid PATCH category', async () => {
    for (const method of ['POST', 'PATCH']) {
      const f = fixture(method, { oldCategory: null }); assert.equal((await f.run({})).status, 400); assert.equal(f.calls.writes, 0);
    }
    const f = fixture('PATCH'); assert.equal((await f.run({ description: 'updated' })).status, 200);
  });
})().catch(error => { console.error(error); process.exitCode = 1; });

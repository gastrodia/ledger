(async () => {
const [{ default: assert }, { default: test }, { default: fs }, { default: path }, { default: ts }] = await Promise.all([
  import('node:assert/strict'), import('node:test'), import('node:fs'), import('node:path'), import('typescript'),
]);

const root = path.resolve(__dirname, '..');
function findNode(file, predicate) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let match;
  function visit(node) {
    if (!match && predicate(node, source)) match = node;
    if (!match) ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(match, `Expected source node in ${file}`);
  return match.getText(source);
}
function effectFor(file, endpoint) {
  const text = findNode(file, (node, source) => ts.isCallExpression(node)
    && node.expression.getText(source) === 'useEffect'
    && node.arguments[0].getText(source).includes(endpoint));
  return (bindings) => {
    let cleanup;
    const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    Function(...Object.keys(bindings), 'useEffect', js)(...Object.values(bindings), (effect) => { cleanup = effect(); });
    return cleanup;
  };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

for (const [file, endpoint, setter] of [
  ['app/dashboard/page.tsx', '/api/transactions?', 'setTransactions'],
  ['app/dashboard/stats/page.tsx', '/api/stats?', 'setStatsData'],
]) {
  test(`${endpoint}: an old response and finally cannot overwrite the newest filter`, async () => {
    const effect = effectFor(file, endpoint);
    const oldBody = deferred();
    const writes = [];
    const completed = [];
    const requests = [];
    const bindings = {
      query: 'month=old', requestKey: 'old', validPeriod: true, dateRangeError: null, reload: 0,
      setLoadError: () => {}, setHasAnyTransactions: () => {},
      router: { push: () => assert.fail('unexpected redirect') },
      AbortController, console,
      fetch: async (url, options) => {
        requests.push(options.signal);
        return { ok: true, json: () => url.includes('old') ? oldBody.promise : Promise.resolve({ data: ['new'], summary: {} }) };
      },
      [setter]: (data) => writes.push(data), setSummary: () => {},
      setLoadedQuery: (key) => completed.push(key),
    };
    const cleanupOld = effect(bindings);
    await settle(); // The first response has reached json(), which may ignore abort.
    cleanupOld();
    const cleanupNew = effect({ ...bindings, query: 'month=new', requestKey: 'new' });
    await settle();
    oldBody.resolve({ data: ['old'], summary: {} });
    await settle();
    assert.equal(requests[0].aborted, true);
    assert.deepEqual(writes, [['new']]);
    assert.deepEqual(completed, [endpoint === '/api/stats?' ? 'month=new' : 'new']);
    cleanupNew();
  });
  test(`${endpoint}: unmount prevents pending data from being applied`, async () => {
    const pending = deferred();
    let writes = 0;
    const cleanup = effectFor(file, endpoint)({
      query: 'month=one', requestKey: 'one', validPeriod: true, dateRangeError: null, reload: 0, AbortController, console,
      setLoadError: () => { writes++; }, setHasAnyTransactions: () => { writes++; },
      router: { push: () => { writes++; } },
      fetch: () => pending.promise,
      [setter]: () => { writes++; }, setSummary: () => { writes++; }, setLoadedQuery: () => { writes++; },
    });
    cleanup();
    pending.resolve({ ok: true, json: async () => ({ data: ['stale'] }) });
    await settle();
    assert.equal(writes, 0);
  });
}

test('transaction edit serializes explicitly cleared optional fields as null', () => {
  for (const field of ['description', 'member_id']) {
    const text = findNode('app/dashboard/page.tsx', (node, source) => ts.isPropertyAssignment(node)
      && node.name.getText(source) === field
      && node.initializer.getText(source).startsWith(`formData.${field} ||`));
    const payload = Function('formData', `return JSON.parse(JSON.stringify({${text}}));`)({ [field]: '' });
    assert.deepEqual(payload, { [field]: null });
  }
});

test('a cancelled AI request cannot clear the controller or loading state of its successor', async () => {
  const text = findNode('app/dashboard/stats/page.tsx', (node) => ts.isVariableDeclaration(node)
    && node.name.getText() === 'generateAiSummary');
  const firstResponse = deferred();
  const secondResponse = deferred();
  const aiAbortRef = { current: null };
  const state = { loading: false, summary: '', error: null };
  let calls = 0;
  const bindings = {
    aiAbortRef, AbortController, DOMException, TextDecoder, console,
    viewMode: 'month', selectedMonth: '2026-09', selectedYear: '2026',
    isValidYear: () => true, isValidMonth: () => true,
    setAiError: (value) => { state.error = value; },
    setAiSummary: (value) => { state.summary = value; },
    setIsAiLoading: (value) => { state.loading = value; },
    getErrorMessage: (error) => error.message,
    router: { push: () => assert.fail('unexpected redirect') },
    fetch: () => (++calls === 1 ? firstResponse.promise : secondResponse.promise),
  };
  const js = ts.transpileModule(`const ${text};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const generate = Function(...Object.keys(bindings), `${js}; return generateAiSummary;`)(...Object.values(bindings));
  const oldRequest = generate();
  const oldController = aiAbortRef.current;
  const newRequest = generate();
  const newController = aiAbortRef.current;
  assert.equal(oldController.signal.aborted, true);
  firstResponse.resolve({ ok: true, body: { getReader: () => assert.fail('stale response must be ignored') } });
  await oldRequest;
  assert.equal(aiAbortRef.current, newController);
  assert.equal(state.loading, true);
  secondResponse.resolve({ ok: true, body: { getReader: () => ({ read: async () => ({ done: true }) }) } });
  await newRequest;
  assert.equal(aiAbortRef.current, null);
  assert.equal(state.loading, false);
  assert.equal(state.error, null);
});

})().catch((error) => { console.error(error); process.exitCode = 1; });

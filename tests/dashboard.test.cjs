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
  ['app/dashboard/stats/page.tsx', '/api/stats?', 'setResource'],
]) {
  test(`${endpoint}: an old response body cannot overwrite the newest period resource`, async () => {
    const effect = effectFor(file, endpoint);
    const oldBody = deferred();
    const writes = [];
    const requests = [];
    const bindings = {
      query: 'month=old', requestKey: 'old',
      router: { push: () => assert.fail('unexpected redirect') },
      AbortController, console,
      fetch: async (url, options) => {
        requests.push(options.signal);
        return { ok: true, json: () => url.includes('old') ? oldBody.promise : Promise.resolve({ data: ['new'], summary: {} }) };
      },
      [setter]: (data) => writes.push(data),
    };
    const cleanupOld = effect(bindings);
    await settle(); // The first response has reached json(), which may ignore abort.
    cleanupOld();
    const cleanupNew = effect({ ...bindings, query: 'month=new', requestKey: 'new' });
    await settle();
    oldBody.resolve({ data: ['old'], summary: {} });
    await settle();
    assert.equal(requests[0].aborted, true);
    assert.deepEqual(writes, [{ key: 'new', data: ['new'] }]);
    cleanupNew();
  });
  test(`${endpoint}: unmount prevents pending data from being applied`, async () => {
    const pending = deferred();
    let writes = 0;
    const cleanup = effectFor(file, endpoint)({
      query: 'month=one', requestKey: 'one', AbortController, console,
      router: { push: () => { writes++; } },
      fetch: () => pending.promise,
      [setter]: () => { writes++; },
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
  const text = findNode('components/stats/ai-analysis.tsx', (node) => ts.isVariableDeclaration(node)
    && node.name.getText() === 'generate');
  const firstResponse = deferred();
  const secondResponse = deferred();
  const controllerRef = { current: null };
  const state = { loading: false, summary: '', error: null };
  let calls = 0;
  const bindings = {
    controllerRef, AbortController, TextDecoder,
    query: 'month=2026-10&asOf=2026-10-08',
    setError: (value) => { state.error = value; },
    setSummary: (value) => { state.summary = value; },
    setLoading: (value) => { state.loading = value; },
    onReveal() {}, onUnauthorized: () => assert.fail('unexpected redirect'),
    readSummaryError: () => assert.fail('successful stream must not read an error'),
    fetch: () => (++calls === 1 ? firstResponse.promise : secondResponse.promise),
  };
  const js = ts.transpileModule(`const ${text};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const generate = Function(...Object.keys(bindings), `${js}; return generate;`)(...Object.values(bindings));
  const oldRequest = generate();
  const oldController = controllerRef.current;
  const newRequest = generate();
  const newController = controllerRef.current;
  assert.equal(oldController.signal.aborted, true);
  firstResponse.resolve({ ok: true, body: { getReader: () => assert.fail('stale response must be ignored') } });
  await oldRequest;
  assert.equal(controllerRef.current, newController);
  assert.equal(state.loading, true);
  secondResponse.resolve(new Response('新分析'));
  await newRequest;
  assert.equal(controllerRef.current, null);
  assert.equal(state.loading, false);
  assert.equal(state.error, null);
  assert.equal(state.summary, '新分析');
});

})().catch((error) => { console.error(error); process.exitCode = 1; });

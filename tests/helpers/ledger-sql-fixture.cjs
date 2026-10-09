/* eslint-disable @typescript-eslint/no-require-imports -- disposable Postgres adapter, never DATABASE_URL. */
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
module.exports = async function createFixture(modulePath) {
  const { PGlite } = require(modulePath);
  const db = new PGlite();
  await db.exec(fs.readFileSync('scripts/init-db.sql', 'utf8'));
  await db.query("INSERT INTO users(id,email,username,password) VALUES('owner','test@example.invalid','test','unused'),('foreign','other@example.invalid','other','unused')");
  const statements = [];
  const query = (text, values = []) => ({ text, values, then(resolve, reject) {
    statements.push({ text, values });
    return db.query(text, values).then(result => result.rows).then(resolve, reject);
  } });
  const sql = (parts, ...values) => query(parts.map((part, i) => part + (i < values.length ? `$${i + 1}` : '')).join(''), values);
  sql.query = query;
  sql.transaction = statements => db.transaction(async tx => {
    const results = [];
    for (const statement of statements) results.push((await tx.query(statement.text, statement.values)).rows);
    return results;
  });
  const modules = new Map();
  let session = { userId: 'owner', username: 'test' };
  const supplied = { '@/lib/db': { sql }, '@/lib/auth': { getSession: async () => session }, '@/lib/attachments': { validateAttachment: async () => undefined, deleteOwnedAttachment: async () => undefined } };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
      { exports, process, console, Date, JSON, Error, SyntaxError, URL, Number, Buffer, Request, Response, Headers, fetch, AbortSignal, AbortController, ReadableStream, TextEncoder, TextDecoder, setTimeout, clearTimeout, structuredClone,
        require: name => name in supplied ? supplied[name] : name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name) });
    return exports;
  }
  return { db, sql, load, statements, setSession(value) { session = value; }, close: () => db.close() };
};

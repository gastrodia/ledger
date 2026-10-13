/* eslint-disable @typescript-eslint/no-require-imports -- isolated SQL/model evaluation fixture. */
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const goal = '帮我查一下还没结清的借还，区分我欠别人的和别人欠我的。帮我看看这个月的送礼和收礼记录。查看我当前未归档的便利贴。查询这个月的收支明细，按日期从近到远列出。';
const filter = { keyword: null, start_date: null, end_date: null, type: null, category_id: null, member_id: null, status: null, amount_min: null, amount_max: null };
const command = (resource, extra = {}) => ({ resource, operation: 'list', scope: 'all', ids: [], parent_id: null, parent_name: null, filter: { ...filter, ...extra }, values: {} });

async function createQueryLedger(baseline) {
  const pglitePath = process.env.LEDGER_TASKS_PGLITE_MODULE;
  if (!pglitePath) throw Error('Set LEDGER_TASKS_PGLITE_MODULE to an isolated PGlite installation.');
  const { PGlite } = require(pglitePath);
  const db = new PGlite();
  await db.exec(`CREATE TABLE transactions(id varchar PRIMARY KEY,user_id varchar,type text,amount numeric(12,2),transaction_date date,description text,category_id varchar,member_id varchar,flow_kind text);
    CREATE TABLE categories(id varchar PRIMARY KEY,name text);
    CREATE TABLE members(id varchar PRIMARY KEY,name text);
    CREATE TABLE loans(id varchar PRIMARY KEY,user_id varchar,direction text,subject_type text,counterparty_name text,amount numeric,item_quantity numeric,item_name text,occurred_at date,notes text);
    CREATE TABLE loan_repayments(id varchar PRIMARY KEY,user_id varchar,loan_id varchar,repaid_amount numeric,repaid_quantity numeric,repaid_at date,notes text);
    CREATE TABLE giftbooks(id varchar PRIMARY KEY,user_id varchar,name text,event_type text,event_date date,location text,description text);
    CREATE TABLE given_gifts(id varchar PRIMARY KEY,user_id varchar,recipient_name text,gift_date date,cash_amount numeric,items jsonb,occasion text,notes text);
    CREATE TABLE gift_records(id varchar PRIMARY KEY,user_id varchar,direction text,gift_type text,counterparty_name text,gift_date date,amount numeric,item_name text,notes text);
    CREATE TABLE notes(id varchar PRIMARY KEY,user_id varchar,title text,content text,color text,created_at timestamptz,archived_at timestamptz,pinned_at timestamptz);`);
  for (let n = 0; n < 84; n++) {
    const day = n === 83 ? 31 : n < 43 ? 1 + n % 5 : n < 52 ? 6 + n % 2 : 8 + n % 6;
    await db.query('INSERT INTO transactions VALUES($1,$2,$3,$4,$5,$6,NULL,NULL,$7)',
      [id(100 + n), 'owner', n % 7 ? 'expense' : 'income', String(n + 1), `2026-10-${String(day).padStart(2, '0')}`, `收支明细${n + 1}`, n === 83 ? 'loan_repayment' : 'daily']);
  }
  await db.query('INSERT INTO transactions VALUES($1,$2,$3,$4,$5,$6,NULL,NULL,$7)', [id(999), 'foreign', 'expense', '999', '2026-10-13', '其他账户', 'daily']);
  await db.query('INSERT INTO transactions VALUES($1,$2,$3,$4,$5,$6,NULL,NULL,$7)', [id(998), 'owner', 'expense', '998', '2026-09-30', '上月', 'daily']);
  for (let n = 0; n < 4; n++) await db.query('INSERT INTO loans VALUES($1,$2,$3,$4,$5,100,NULL,NULL,$6,NULL)', [id(10 + n), 'owner', n % 2 ? 'lent' : 'owed', 'money', `借还对象${n}`, '2026-09-10']);
  await db.query('INSERT INTO loan_repayments VALUES($1,$2,$3,40,NULL,$6,NULL),($4,$2,$5,100,NULL,$6,NULL)', [id(20), 'owner', id(11), id(21), id(13), '2026-10-05']);
  await db.query('INSERT INTO given_gifts VALUES($1,$2,$3,$4,100,$5,NULL,NULL)', [id(30), 'owner', '本月送礼', '2026-10-05', '[]']);
  await db.query('INSERT INTO given_gifts VALUES($1,$2,$3,$4,100,$5,NULL,NULL)', [id(31), 'owner', '上月送礼', '2026-09-30', '[]']);
  for (let n = 0; n < 3; n++) await db.query('INSERT INTO notes VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id(40 + n), 'owner', `便利贴${n}`, `内容${n}`, 'yellow', '2026-10-12T10:00:00Z', n === 2 ? '2026-10-13T00:00:00Z' : null, n === 1 ? '2026-10-13T00:00:00Z' : null]);
  const sqlCalls = [], modules = new Map();
  const sql = { query: async (text, values = []) => {
    sqlCalls.push({ text, values });
    if (!/^SELECT\b/.test(text.trim())) throw Error('Evaluation prohibits account/ledger writes.');
    return (await db.query(text, values)).rows;
  } };
  const source = file => fs.readFileSync(baseline ? path.join(baseline, `${file}.snapshot`) : file, 'utf8');
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    const code = file === 'lib/assistant-generation.ts' ? source(file).slice(source(file).indexOf('export async function queryLedger(')) : source(file);
    vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
      { exports, process, console, sql, ensureCashflowSchema: async () => {}, randomUUID, structuredClone, Date, Error, JSON, Number, Set, Map, BigInt, Buffer, URL, fetch, Headers, Request, Response, TextEncoder, TextDecoder, ReadableStream, TransformStream, AbortController, AbortSignal, setTimeout, clearTimeout,
        require: name => {
          if (name === '@/lib/db') return { sql };
          if (name.endsWith('-schema')) return { ensureLoansSchema: async () => {}, ensureGiftsGivenSchema: async () => {}, ensureGiftBooksSchema: async () => {}, ensureNotesSchema: async () => {} };
          return name.startsWith('@/') ? load(`${name.slice(2)}.ts`) : require(name);
        } }, { filename: file });
    return exports;
  }
  const server = load('lib/assistant-command-server.ts');
  const { validatePlan } = load('lib/assistant.ts');
  const { validateLedgerCommand } = load('lib/assistant-commands.ts');
  const reads = [];
  const adapters = {
    protocol: 'native', validatePlan: value => validatePlan(value, [], [], randomUUID), validateCommand: validateLedgerCommand,
    validateEvent: () => { throw Error('No event authorized'); },
    query: async (q, signal) => { signal.throwIfAborted(); reads.push({ tool: 'query', parameters: q }); const facts = await load('lib/assistant-generation.ts').queryLedger('owner', q); return { filters: q, facts, reply: `共${facts.summary.count}笔` }; },
    command: async (c, signal) => { signal.throwIfAborted(); if (!['list','duplicates','export'].includes(c.operation)) throw Error('No write authorized'); reads.push({ tool: 'records', parameters: c }); return server.prepareLedgerCommand('owner', id(1), c, { signal }); },
  };
  function check(plan, checkpoint) {
    const records = checkpoint.tool_results.filter(r => r.name === 'records').map(r => r.result.record_context).filter(Boolean);
    const rows = resource => records.filter(r => r.resource === resource).flatMap(r => r.rows);
    const tx = rows('transactions');
    return {
      completed: plan.agent.status === 'completed' && plan.agent.operations.every(op => op.status === 'completed') && !plan.agent.awaiting_answer,
      loans: rows('loans').length === 3 && [10,11,12].every(n => rows('loans').some(r => r.id === id(n))) && new Set(rows('loans').map(r => r.direction)).size === 2,
      gifts: rows('gifts_given').length === 1 && rows('gifts_given')[0].id === id(30) && rows('gift_records').length === 0 && reads.some(r => r.parameters.resource === 'gift_records'),
      notes: rows('notes').length === 2 && [40,41].every(n => rows('notes').some(r => r.id === id(n))),
      transactions: tx.length === 84 && new Set(tx.map(r => r.id)).size === 84 && Array.from({ length: 84 }, (_, n) => id(100+n)).every(key => tx.some(r => r.id === key)),
      order: tx.length === 84 && tx.every((r, n) => !n || tx[n-1].transaction_date >= r.transaction_date),
      displayed: Array.from({ length: 84 }, (_, n) => `收支明细${n+1}`).every(text => plan.reply.includes(text)) && [0,1].every(n => plan.reply.includes(`便利贴${n}`)),
      parameters: reads.filter(r => ['gift_records','gifts_given','transactions'].includes(r.parameters.resource)).every(r => r.parameters.filter.start_date === '2026-10-01' && r.parameters.filter.end_date === '2026-10-31') && reads.filter(r => r.parameters.resource === 'notes').every(r => r.parameters.filter.status === 'active') && reads.filter(r => r.parameters.resource === 'loans').every(r => r.parameters.filter.status === 'outstanding'),
      writes: sqlCalls.every(r => /^SELECT\b/.test(r.text.trim())),
    };
  }
  return { load, adapters, sqlCalls, reads, check, db, close: () => db.close(), id, goal };
}
module.exports = { createQueryLedger, id, goal, command };

/* eslint-disable @typescript-eslint/no-require-imports -- shared pure contracts for isolated test loaders. */
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const paths = ['@/lib/assistant-draft-match-rules', '@/lib/assistant-reply-view', '@/lib/assistant-execution', '@/lib/assistant-action-preview', '@/lib/ledger-event', '@/lib/assistant-commands', '@/lib/assistant-draft-actions', '@/lib/entity-icon-catalog'];
const cache = new Map();
module.exports = function contract(name) {
  if (!paths.includes(name)) return undefined;
  if (cache.has(name)) return cache.get(name);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(name.slice(2) + '.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Date, JSON, Error, require: dependency => { if (dependency === 'zod') return require('zod'); const loaded = module.exports(dependency); if (loaded) return loaded; throw new Error(dependency); } });
  cache.set(name, exports);
  return exports;
};

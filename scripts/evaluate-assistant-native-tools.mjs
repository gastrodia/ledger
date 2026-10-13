// A native transport smoke test against synthetic data; account DB imports fail.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (!process.argv.includes("--live")) { console.log("Use --live for isolated native tool transport verification."); process.exit(0); }
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(process.cwd());
const ts = require("typescript"), modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {}; modules.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, process, console, Date, Error, JSON, Number, Set, Map, BigInt, Buffer, URL, fetch, Headers, Request, Response, TextEncoder, TextDecoder,
      structuredClone, ReadableStream, TransformStream, AbortController, AbortSignal, setTimeout, clearTimeout, require: name => {
        if (name === "@/lib/db") throw new Error("Native evaluation cannot access the account database.");
        return name.startsWith("@/") ? load(`${name.slice(2)}.ts`) : require(name);
      } }, { filename: file });
  return exports;
}
const { bailianTool, BAILIAN_ASSISTANT_MODEL } = load("lib/bailian.ts");
const { ASSISTANT_NATIVE_TOOLS, assistantNativeDecision, ASSISTANT_NATIVE_AGENT_PROMPT } = load("lib/assistant-native-tools.ts");
const model = process.env.BAILIAN_ASSISTANT_MODEL?.trim() || BAILIAN_ASSISTANT_MODEL;
const messages = [{ role: "system", content: `${ASSISTANT_NATIVE_AGENT_PROMPT}\n隔离测试：完整清单已保存，事项read_1为query/read、pending、无依赖，sources为本轮完整用户原文。today=2026-10-13；无成员或分类过滤。` },
  { role: "user", content: "查2026年10月的日常支出总额。" }];
const report = { evidence: "live_native_transport_with_synthetic_results", model, account_database_access: false, account_writes: 0, scenarios: [] };
const started = Date.now();
try {
  const settings = { model, tools: { query_statistics: ASSISTANT_NATIVE_TOOLS.query_statistics, respond: ASSISTANT_NATIVE_TOOLS.respond }, thinking: process.env.BAILIAN_ASSISTANT_THINKING === "true", temperature: 0.2, maxOutputTokens: 3000, timeoutMs: 60000 };
  const call = await bailianTool({ ...settings, messages });
  const decision = assistantNativeDecision(call, [], "查2026年10月的日常支出总额。");
  report.scenarios.push({ name: "typed_query_call", passed: call.name === "query_statistics" && decision.step.tool === "query", call });
  if (!report.scenarios.at(-1).passed) throw new Error("Expected query tool.");
  messages.push({ role: "assistant", content: [{ type: "tool-call", toolCallId: call.id, toolName: call.name, input: call.input }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: call.id, toolName: call.name, output: { type: "json", value: { income: "0.00", expense: "80.00", count: 3, complete: true } } }] },
    { role: "system", content: "服务端已完成read_1，没有剩余事项。用respond汇总，省略operation_id、needs_input=false。" });
  const reply = await bailianTool({ ...settings, messages });
  assistantNativeDecision(reply, [], "查2026年10月的日常支出总额。");
  report.scenarios.push({ name: "native_result_roundtrip", passed: reply.name === "respond" && reply.input.needs_input === false && /80/.test(reply.input.reply), call: reply });
} catch (error) {
  report.error = error?.name === "BailianError" ? { type: error.name, status: error.status, code: error.code } : { type: "evaluation_failure" };
}
report.elapsed_ms = Date.now() - started;
const outputIndex = process.argv.indexOf("--output");
const output = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : "output/assistant-native-tools/transport.json");
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Native transport: ${!report.error && report.scenarios.length === 2 && report.scenarios.every(s => s.passed) ? "PASS" : "FAIL"}; report: ${output}`);
process.exitCode = report.error || report.scenarios.length !== 2 || report.scenarios.some(s => !s.passed) ? 1 : 0;

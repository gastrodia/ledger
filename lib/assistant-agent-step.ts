import type { AssistantAgentStep } from "@/lib/assistant-agent-runtime";

/** A step-format error never contains provider output or account values. */
export class AssistantAgentStepError extends Error {
  readonly code = "invalid_step";
  constructor(field: string, rule: string) {
    super(`助手步骤格式无效：${field}${rule}。请按步骤schema修正，不改变原任务或重放已完成事项。`);
    this.name = "AssistantAgentStepError";
  }
}
const fail = (field: string, rule: string): never => { throw new AssistantAgentStepError(field, rule); };
const identifier = /^[a-zA-Z0-9_-]{1,64}$/;
const keys = new Set(["kind", "operation_id", "covered_operation_ids", "tool", "arguments_json", "plan_json", "needs_input"]);
const limit = 24_000;
/** Shared by provider final validation and the runtime. Domain validation follows. */
export function parseAssistantAgentStep(raw: unknown, requireReference = false): AssistantAgentStep {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("step", "必须为对象");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !keys.has(key))) fail("step", "含有不支持的字段");
  if (typeof value.kind !== "string" || !["plan", "reuse", "read", "preview", "respond"].includes(value.kind)) fail("kind", "不在允许范围内");
  if (requireReference && !("operation_id" in value)) fail("operation_id", "必须显式填写，计划与最终总结为null");
  if (value.operation_id != null && (typeof value.operation_id !== "string" || !identifier.test(value.operation_id))) fail("operation_id", "必须为任务清单中的合法编号");
  if (value.covered_operation_ids !== undefined && (!Array.isArray(value.covered_operation_ids) || value.covered_operation_ids.length > 32
    || value.covered_operation_ids.some(id => typeof id !== "string" || !identifier.test(id)))) fail("covered_operation_ids", "必须为最多32个合法事项编号");
  if (value.needs_input !== undefined && typeof value.needs_input !== "boolean") fail("needs_input", "必须为布尔值");
  if (typeof value.arguments_json !== "string" || value.arguments_json.length > limit) fail("arguments_json", "必须为有界JSON字符串");
  if (value.plan_json !== null && (typeof value.plan_json !== "string" || value.plan_json.length > limit)) fail("plan_json", "必须为null或有界JSON字符串");
  const s = { ...value, needs_input: value.needs_input ?? false,
    ...(Array.isArray(value.covered_operation_ids) ? { covered_operation_ids: [...new Set(value.covered_operation_ids)] } : {}) } as AssistantAgentStep;
  const unusedPlan = ["plan", "reuse"].includes(s.kind) && s.tool === null
    || s.kind === "read" && ["query", "records", "draft_matches"].includes(s.tool || "")
    || s.kind === "preview" && ["command", "event"].includes(s.tool || "");
  if (unusedPlan) {
    if (s.kind === "plan" && s.plan_json !== null) {
      try {
        const args = JSON.parse(s.arguments_json), agenda = JSON.parse(s.plan_json);
        if (args && typeof args === "object" && !Array.isArray(args) && Object.keys(args).length === 0
          && agenda && typeof agenda === "object" && !Array.isArray(agenda) && Object.keys(agenda).length === 1 && Array.isArray(agenda.operations)) s.arguments_json = s.plan_json;
      } catch { /* Unused prose cannot authorize an action. */ }
    }
    s.plan_json = null;
  }
  if (["plan", "reuse"].includes(s.kind) ? s.tool !== null || s.plan_json !== null
    : s.kind === "respond" ? s.tool !== null || s.plan_json === null
    : s.plan_json !== null || !(s.kind === "read" ? ["query", "records", "draft_matches"] : ["command", "event"]).includes(s.tool || "")) fail("kind/tool/plan_json", "不符合账本允许的步骤组合，助手工具不在账本允许范围内");
  return s;
}

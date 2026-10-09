import type { AssistantPlan, AssistantQuery, AssistantCategory, AssistantMember } from "@/lib/assistant";

export type AssistantExecutionStep = {
  id: string;
  label: string;
  kind: "tool" | "model" | "check";
  state: "running" | "done" | "failed";
  startedAt: number;
  finishedAt?: number;
  details: string[];
};

const MAX_STEPS = 24;
const validTime = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Only bounded, explicit display fields are allowed into saved conversation history. */
export function restoreAssistantExecution(value: unknown): AssistantExecutionStep[] {
  if (!Array.isArray(value) || value.length > MAX_STEPS) return [];
  const result: AssistantExecutionStep[] = [];
  for (const step of value) {
    if (!step || typeof step !== "object" || typeof step.id !== "string" || !/^[a-z0-9_-]{1,48}$/.test(step.id)
      || result.some(item => item.id === step.id) || typeof step.label !== "string" || !step.label.trim() || step.label.length > 80
      || !["tool", "model", "check"].includes(step.kind) || !["running", "done", "failed"].includes(step.state)
      || !validTime(step.startedAt) || !Array.isArray(step.details) || step.details.length > 8
      || step.details.some((detail: unknown) => typeof detail !== "string" || detail.length > 240)
      || (step.state !== "running" && (!validTime(step.finishedAt) || step.finishedAt < step.startedAt))) continue;
    result.push({ id: step.id, label: step.label, kind: step.kind, state: step.state, startedAt: step.startedAt,
      ...(step.state !== "running" ? { finishedAt: step.finishedAt } : {}), details: [...step.details] });
  }
  return result;
}

/** Server-owned execution records; no prompts, hidden reasoning, SQL or raw provider responses. */
export function createAssistantExecution(initial: unknown = []) {
  let steps = restoreAssistantExecution(initial);
  const details = (items: string[]) => items.slice(0, 8).map(item => item.slice(0, 240));
  return {
    snapshot: () => steps,
    start(id: string, label: string, kind: AssistantExecutionStep["kind"], items: string[] = []) {
      const step: AssistantExecutionStep = { id, label, kind, state: "running", startedAt: Date.now(), details: details(items) };
      steps = steps.some(item => item.id === id) ? steps.map(item => item.id === id ? step : item) : [...steps, step].slice(-MAX_STEPS);
    },
    finish(id: string, items?: string[], state: "done" | "failed" = "done") {
      steps = steps.map(step => step.id === id ? { ...step, state, finishedAt: Math.max(step.startedAt, Date.now()),
        details: items ? details(items) : step.details } : step);
    },
    failRunning() {
      steps = steps.map(step => step.state === "running" ? { ...step, state: "failed", finishedAt: Math.max(step.startedAt, Date.now()) } : step);
    },
  };
}
export type AssistantExecutionReporter = ReturnType<typeof createAssistantExecution>;

export function assistantPlanExecutionDetails(plan: AssistantPlan): string[] {
  const labels: Record<AssistantPlan["action"], string> = {
    record: "生成记账草稿", query: "查询账本", chat: "对话回复", update: "修改草稿成员", undo: "准备撤销入账",
    remove: "准备删除草稿", manage: "整理账本操作", edit: "修改草稿", confirm: "准备确认草稿",
    navigate: "打开相关页面", event: "整理生活事件",
  };
  const details = [`识别意图：${labels[plan.action]}`];
  if (plan.drafts.length) details.push(`已校验 ${plan.drafts.length} 笔草稿的金额、日期、收支类型和成员/分类引用`,
    `待补全：${plan.drafts.filter(draft => !draft.category_id).length} 笔分类、${plan.drafts.filter(draft => !draft.member_id).length} 笔成员`,
    "草稿尚未入账，需核对后确认");
  const target = plan.update || plan.undo || plan.remove;
  if (target) details.push(`目标范围：${target.draft_ids.length} 笔账目`);
  return details;
}

export function assistantQueryExecutionDetails(query: AssistantQuery, categories: AssistantCategory[], members: AssistantMember[]): string[] {
  return [`日期：${query.start_date} 至 ${query.end_date}（含首尾）`,
    `口径：${query.scope === "cashflow" ? "资金流入流出，含借还往来" : "日常收支，排除借还往来"}；类型：${query.type === "income" ? "收入" : query.type === "expense" ? "支出" : "全部收支"}`,
    `分类：${query.category_id ? categories.find(item => item.id === query.category_id)?.name || "指定分类" : "全部"}；成员：${query.member_id ? members.find(item => item.id === query.member_id)?.name || "指定成员" : "全部"}`,
    ...(query.keyword ? [`描述关键词：${query.keyword}`] : [])].map(detail => detail.slice(0, 240));
}

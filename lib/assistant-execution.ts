import type { AssistantPlan, AssistantQuery, AssistantCategory, AssistantMember } from "@/lib/assistant";
import type { LedgerCommand, LedgerResource } from "@/lib/assistant-commands";

export type AssistantExecutionStep = {
  id: string;
  label: string;
  kind: "tool" | "model" | "check";
  model?: string;
  state: "running" | "done" | "failed";
  startedAt: number;
  finishedAt?: number;
  details: string[];
};

const MAX_STEPS = 24;
const validTime = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const modelName = (value: unknown): string | undefined => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$/.test(value) ? value : undefined;

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
      ...(step.kind === "model" && modelName(step.model) ? { model: modelName(step.model) } : {}),
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
    start(id: string, label: string, kind: AssistantExecutionStep["kind"], items: string[] = [], model?: string) {
      const step: AssistantExecutionStep = { id, label, kind, state: "running", startedAt: Date.now(), details: details(items) };
      if (kind === "model" && modelName(model)) step.model = modelName(model);
      steps = steps.some(item => item.id === id) ? steps.map(item => item.id === id ? step : item) : [...steps, step].slice(-MAX_STEPS);
    },
    finish(id: string, items?: string[], state: "done" | "failed" = "done", label?: string) {
      steps = steps.map(step => step.id === id ? { ...step, state, finishedAt: step.finishedAt ?? Math.max(step.startedAt, Date.now()),
        ...(label ? { label: label.slice(0, 80) } : {}),
        details: items ? details(items) : step.details } : step);
    },
    failRunning() {
      steps = steps.map(step => step.state === "running" ? { ...step, state: "failed", finishedAt: Math.max(step.startedAt, Date.now()) } : step);
    },
  };
}
export type AssistantExecutionReporter = ReturnType<typeof createAssistantExecution>;

const resources: Record<LedgerResource, string> = {
  transactions: "收支记录", categories: "分类", members: "成员", loans: "借还记录", repayments: "归还记录",
  giftbooks: "礼簿", gift_records: "收礼记录", gifts_given: "送礼记录", notes: "便利贴",
};
const statuses: Record<string, string> = { active: "未归档", archived: "已归档", pinned: "已置顶", unpaid: "未还", partial: "部分归还", outstanding: "未结清", settled: "已结清" };

export function assistantCommandExecutionLabel(command: LedgerCommand): string {
  const resource = resources[command.resource];
  if (command.operation === "list") return `查询${command.resource === "notes" && command.filter.status ? statuses[command.filter.status] || "" : ""}${resource}`;
  if (command.operation === "duplicates") return "查找疑似重复收支";
  if (command.operation === "export") return `导出${resource}`;
  const actions = { create: "新增", update: "修改", delete: "删除", reorder: "排序", link: "关联", unlink: "解除关联" };
  return `准备${actions[command.operation]}${resource}方案`;
}

export function assistantCommandExecutionDetails(command: LedgerCommand, categories: AssistantCategory[], members: AssistantMember[]): string[] {
  const filter = command.filter;
  const types: Record<string, string> = { income: "收入", expense: "支出", owed: "我欠对方", lent: "对方欠我", cash: "礼金", item: "实物", money: "钱款" };
  return [
    ...(filter.status ? [`状态：${statuses[filter.status] || filter.status}`] : []),
    ...(filter.keyword ? [`关键词：${filter.keyword}`] : []),
    ...(filter.start_date || filter.end_date ? [`日期：${filter.start_date || "不限起始日期"} 至 ${filter.end_date || "不限结束日期"}`] : []),
    ...(filter.type ? [`类型：${types[filter.type] || filter.type}`] : []),
    ...(filter.category_id ? [`分类：${categories.find(item => item.id === filter.category_id)?.name || "指定分类"}`] : []),
    ...(filter.member_id ? [`成员：${members.find(item => item.id === filter.member_id)?.name || "指定成员"}`] : []),
    ...(filter.amount_min != null || filter.amount_max != null ? [`金额：${filter.amount_min ?? "不限下限"} 至 ${filter.amount_max ?? "不限上限"} 元`] : []),
    ...(command.parent_name ? [`所属记录：${command.parent_name}`] : []),
    ...(command.ids.length ? [`已指定 ${command.ids.length} 条目标记录`] : []),
  ];
}

export function assistantToolExecutionLabel(plan: AssistantPlan): string {
  if (plan.command) return assistantCommandExecutionLabel(plan.command);
  if (plan.query) return `查询${plan.query.scope === "cashflow"
    ? plan.query.type === "expense" ? "资金流出" : plan.query.type === "income" ? "资金流入" : "资金流水"
    : plan.query.type === "expense" ? "日常支出" : plan.query.type === "income" ? "日常收入" : "日常收支"}`;
  if (plan.event) {
    const events: Record<string, string> = { loan_lent: "借出", loan_borrowed: "借入", repayment_received: "收到归还", repayment_paid: "归还", gift_given: "送礼", gift_received: "收礼" };
    return `核对${events[plan.event.kind || ""] || "生活"}事项并准备${plan.event.operation === "undo" ? "撤销" : "确认"}方案`;
  }
  return "查询账本记录";
}

export function assistantResponseExecutionLabel(plan: AssistantPlan, hasRead: boolean): string {
  const labels: Record<AssistantPlan["action"], string> = {
    record: "生成记账草稿", query: "整理查询条件", chat: hasRead ? "整理查询结果" : "生成回复", update: "整理草稿成员修改",
    undo: "准备撤销入账方案", remove: "准备删除草稿方案", manage: "整理账本操作条件", edit: "整理草稿修改",
    confirm: "准备确认草稿", navigate: "确定要打开的页面", event: "整理事项条件",
  };
  return labels[plan.action];
}

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

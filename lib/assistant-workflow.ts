/** A bounded agenda of existing Ledger operations; execution remains in domain adapters. */
export const WORKFLOW_ACTIONS = ["record", "query", "chat", "update", "undo", "remove", "manage", "edit", "confirm", "navigate", "event"] as const;
export type WorkflowAction = typeof WORKFLOW_ACTIONS[number];
export type WorkflowOperation = {
  id: string; label: string; action: WorkflowAction; effect: "read" | "write" | "local"; depends_on: string[];
  questions?: string[]; sources?: string[];
  status: "pending" | "running" | "needs_input" | "waiting_approval" | "completed" | "failed" | "cancelled";
  receipt_id?: string;
};
const operationId = /^[a-zA-Z0-9_-]{1,64}$/;
const statuses = new Set(["pending", "running", "needs_input", "waiting_approval", "completed", "failed", "cancelled"]);
export function validateWorkflow(value: unknown, restore = false): WorkflowOperation[] {
  if (!Array.isArray(value) || !value.length || value.length > 32) throw new Error("请将目标拆为最多32项账本操作。");
  const operations = value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("任务事项格式无效。");
    const item = raw as WorkflowOperation;
    const keys = restore ? ["id", "label", "action", "effect", "depends_on", "questions", "sources", "status", "receipt_id"] : ["id", "label", "action", "effect", "depends_on", "questions", "sources"];
    if (Object.keys(item).some(key => !keys.includes(key)) || typeof item.id !== "string" || !operationId.test(item.id)
      || typeof item.label !== "string" || !item.label.trim() || item.label.length > 500 || !WORKFLOW_ACTIONS.includes(item.action)
      || (item.effect !== undefined && !["read", "write", "local"].includes(item.effect))
      || !Array.isArray(item.depends_on) || item.depends_on.length > 32 || item.depends_on.some(id => typeof id !== "string" || !operationId.test(id))
      || (item.sources !== undefined && (!Array.isArray(item.sources) || !item.sources.length || item.sources.length > 32 || item.sources.some(source => typeof source !== "string" || !source.trim() || source.length > 4000)))
      || (item.questions !== undefined && (!Array.isArray(item.questions) || item.questions.length > 8 || item.questions.some(question => typeof question !== "string" || !question.trim() || question.length > 500)))
      || new Set(item.depends_on).size !== item.depends_on.length || (restore && !statuses.has(item.status))
      || (item.receipt_id !== undefined && (typeof item.receipt_id !== "string" || item.receipt_id.length > 100))) throw new Error("任务事项格式无效。");
    return { id: item.id, label: item.label, action: item.action, effect: item.effect || (["query", "chat"].includes(item.action) ? "read" : ["edit", "update", "remove", "navigate"].includes(item.action) ? "local" : "write"), depends_on: [...item.depends_on], status: restore ? item.status : "pending" as const,
      ...(item.sources ? { sources: [...item.sources] } : {}),
      ...(item.questions?.length ? { questions: [...item.questions] } : {}),
      ...(restore && item.receipt_id ? { receipt_id: item.receipt_id } : {}) };
  });
  if (operations.some(item => ["record", "event", "confirm", "undo"].includes(item.action) && item.effect !== "write" || ["edit", "update", "remove", "navigate"].includes(item.action) && item.effect !== "local" || ["query", "chat"].includes(item.action) && item.effect !== "read")) throw new Error("事项执行类型与业务动作不一致。");
  const byId = new Map(operations.map(item => [item.id, item]));
  if (byId.size !== operations.length) throw new Error("任务事项编号重复。");
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error("任务依赖存在冲突，请明确操作顺序。");
    if (visited.has(id)) return;
    const item = byId.get(id);
    if (!item) throw new Error("任务依赖引用了不存在的事项。");
    visiting.add(id); item.depends_on.forEach(visit); visiting.delete(id); visited.add(id);
  };
  operations.forEach(item => visit(item.id));
  return operations;
}
export function workflowOperation(operations: WorkflowOperation[], id: unknown): WorkflowOperation {
  const item = operations.find(item => item.id === id);
  if (!item) throw new Error("请为当前步骤指定任务清单中的operation_id。");
  if (["completed", "failed", "cancelled", "waiting_approval"].includes(item.status)) throw new Error("该事项已经完成或已暂停执行，不能重放。请继续未完成事项。");
  if (item.depends_on.some(id => operations.find(item => item.id === id)?.status !== "completed")) throw new Error("前置事项尚未完成，请先处理依赖或询问缺失条件。");
  return item;
}

/** A literal description + amount can bind a row to exactly one agenda item.
 * No semantic guessing: ambiguous/repeated sources still require explicit IDs. */
export function matchingRecordOperations(operations: WorkflowOperation[], drafts: Array<{ description: string; amount_cents: number }>): string[] {
  const matches = drafts.map(draft => {
    if (!draft || typeof draft.description !== "string" || !Number.isSafeInteger(draft.amount_cents) || draft.amount_cents <= 0) return [];
    const description = draft.description.replace(/\s/g, "");
    if (!description) return [];
    return operations.filter(operation => {
      if (operation.action !== "record" || operation.sources?.length !== 1 || operation.questions?.length) return false;
      const source = operation.sources[0].replace(/\s/g, "");
      if (!source.startsWith(description)) return false;
      const amount = source.slice(description.length).match(/^[¥￥]?(\d+)(?:\.(\d{1,2}))?(?:元|块钱?)?$/);
      return !!amount && Number(amount[1]) * 100 + Number((amount[2] || "").padEnd(2, "0")) === draft.amount_cents;
    }).map(operation => operation.id);
  });
  return matches.filter(ids => ids.length === 1 && matches.filter(other => other.includes(ids[0])).length === 1).map(ids => ids[0]);
}

/** Restore coverage omitted by older grouped previews using their existing receipt.
 * This only settles already executed work; it never prepares a financial action. */
export function reconcileRecordWorkflowReceipts(operations: WorkflowOperation[], outputs: Array<{ id: string; plan: { action: string; drafts: Array<{ description: string; amount_cents: number }> }; receipt?: { id: string; status: string } }>): void {
  for (const output of outputs) {
    if (output.plan.action !== "record" || !Array.isArray(output.plan.drafts) || output.receipt?.status !== "succeeded" || output.receipt.id !== output.id) continue;
    for (const id of matchingRecordOperations(operations, output.plan.drafts)) {
      const operation = operations.find(item => item.id === id)!;
      if (operation.status !== "pending" || operation.depends_on.some(dependency => operations.find(item => item.id === dependency)?.status !== "completed")) continue;
      operation.status = "completed";
      operation.receipt_id = output.receipt.id;
    }
  }
}


/** Literal current-request coverage prevents old history from creating a new agenda. */
export function assertWorkflowCoverage(operations: WorkflowOperation[], goal: string, authorizedAnswers: string[] = []): void {
  const used = Array<boolean>(goal.length).fill(false);
  const owners = new Map<string, WorkflowAction>();
  for (const operation of operations) {
    if (!operation.sources?.length) throw new Error("每个事项必须包含sources，逐字引用当前请求的对应片段；不能引用历史请求。");
    for (const source of operation.sources) {
      let offset = goal.indexOf(source);
      while (offset >= 0 && used.slice(offset, offset + source.length).some(Boolean)) offset = goal.indexOf(source, offset + 1);
      if (offset < 0 && owners.get(source) === operation.action) offset = goal.indexOf(source);
      if (offset < 0 && authorizedAnswers.some(answer => answer.includes(source))) continue;
      if (offset < 0) throw new Error(`事项源文本“${source.slice(0, 120)}”不在当前请求或重复覆盖；不能把历史目标加入新任务。`);
      owners.set(source, operation.action);
      for (let i = offset; i < offset + source.length; i++) used[i] = true;
    }
  }
  const missing = goal.split("").filter((character, index) => !used[index] && /[\p{L}\p{N}]/u.test(character)).join("");
  if (missing) throw new Error(`清单尚未覆盖当前请求：“${missing.slice(0, 500)}”。补齐这些原文事项及sources，不能丢弃未处理要求。`);
}

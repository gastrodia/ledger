import type { AssistantPlan } from "@/lib/assistant";
import type { AssistantAgentCheckpoint } from "@/lib/assistant-agent-runtime";

/** Keep each database read's identity and payload, including empty results.
 * Checkpoints also supply this projection for conversations saved before it existed. */
export function withAssistantReadResults(plan: AssistantPlan, checkpoint: AssistantAgentCheckpoint | null): AssistantPlan {
  if (!checkpoint?.operations || plan.action !== "chat" || checkpoint.awaiting_answer || plan.read_results) return plan;
  const reads = new Map<string, NonNullable<AssistantPlan["read_results"]>[number]>();
  let comparison = plan.reply_view?.kind === "draft_matches" ? plan.reply_view : undefined;
  for (const tool of checkpoint.tool_results) {
    if (!["query", "records", "draft_matches"].includes(tool.name)
      || !checkpoint.operations.some(operation => operation.id === tool.operation_id && operation.effect === "read")) continue;
    const result = tool.result as Pick<AssistantPlan, "reply" | "reply_view" | "record_context" | "command"> & { limited?: boolean; filters?: AssistantPlan["query"] };
    if (tool.name === "draft_matches") {
      if (!result.limited) comparison = result.reply_view;
      continue;
    }
    const key = JSON.stringify([tool.operation_id, result.filters || tool.call_id]);
    reads.set(key, { id: tool.call_id, operation_id: tool.operation_id!, reply: result.limited ? "查询结果不完整，请缩小范围后继续核对。" : result.reply,
      ...(!result.limited && result.reply_view ? { reply_view: result.reply_view } : {}),
      ...(!result.limited && result.record_context ? { record_context: result.record_context } : {}),
      ...(result.command ? { command: result.command } : {}) });
  }
  if (reads.size < (comparison ? 1 : 2)) return comparison ? { ...plan, reply_view: comparison } : plan;
  return { ...plan, reply_view: comparison, record_context: undefined, read_results: [...reads.values()] };
}

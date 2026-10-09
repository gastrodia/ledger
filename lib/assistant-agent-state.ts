import type { AssistantAgentCheckpoint, AssistantAgentMetadata } from "@/lib/assistant-agent-runtime";
import type { AssistantApproval, AssistantActionResult } from "@/lib/assistant-commands";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = ["running", "waiting_approval", "completed", "needs_input", "stopped"];
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const approval = (value: unknown) => object(value) && text(value.action_id, 36) && UUID.test(value.action_id) && text(value.fingerprint, 1024);

/** Only server-written checkpoints are restored. None of this private trace is returned by task APIs. */
export function restoreAssistantAgentCheckpoint(value: unknown): AssistantAgentCheckpoint | null {
  if (!object(value) || value.version !== 1 || !text(value.goal_id, 100) || !text(value.goal, 4000)
    || !statuses.includes(String(value.status)) || !Number.isSafeInteger(value.steps) || Number(value.steps) < 0 || Number(value.steps) > 64
    || !Array.isArray(value.messages) || value.messages.length > 200 || value.messages.some(message => !object(message)
      || !["system", "user", "assistant"].includes(String(message.role)) || !text(message.content, 128_000))
    || !Array.isArray(value.tool_results) || value.tool_results.length > 100 || value.tool_results.some(result => !object(result)
      || !text(result.call_id, 200) || !text(result.name, 100) || !("result" in result))
    || !Array.isArray(value.preview_fingerprints) || value.preview_fingerprints.length > 100
    || value.preview_fingerprints.some(fingerprint => !text(fingerprint, 1024))
    || (value.pending_plan !== undefined && (!object(value.pending_plan) || !text(value.pending_plan.action, 30)
      || !text(value.pending_plan.reply, 64_000) || !Array.isArray(value.pending_plan.drafts) || value.pending_plan.drafts.length > 20))
    || (value.pending_batch !== undefined && (!object(value.pending_batch) || !text(value.pending_batch.batch_id, 36) || !UUID.test(value.pending_batch.batch_id)
      || !Array.isArray(value.pending_batch.draft_ids) || !value.pending_batch.draft_ids.length || value.pending_batch.draft_ids.length > 20
      || value.pending_batch.draft_ids.some(id => !text(id, 36) || !UUID.test(id)) || new Set(value.pending_batch.draft_ids).size !== value.pending_batch.draft_ids.length))
    || (value.pending_approval !== null && !approval(value.pending_approval))
    || (value.pending_approvals !== undefined && (!Array.isArray(value.pending_approvals)
      || value.pending_approvals.length > 20 || value.pending_approvals.some(item => !approval(item))))) return null;
  // JSON round-trip breaks references to a caller's mutable runtime state.
  try { const serialized = JSON.stringify(value); if (serialized.length > 500_000) return null; return JSON.parse(serialized) as AssistantAgentCheckpoint; } catch { return null; }
}

export function assistantAgentApprovalIds(checkpoint: AssistantAgentCheckpoint): string[] {
  return [...new Set([...(checkpoint.pending_approval ? [checkpoint.pending_approval.action_id] : []),
    ...(checkpoint.pending_approvals ?? []).map(item => item.action_id)])];
}

export function assistantAgentMetadata(checkpoint: AssistantAgentCheckpoint | null): AssistantAgentMetadata | undefined {
  if (!checkpoint) return undefined;
  return { goal_id: checkpoint.goal_id, goal: checkpoint.goal, status: checkpoint.status,
    steps: checkpoint.steps, tool_calls: checkpoint.tool_results.filter(tool => ["query", "records", "command_preview", "event_preview", "target_verification"].includes(tool.name)).length,
    ...(checkpoint.pending_approval ? { pending_action_id: checkpoint.pending_approval.action_id } : {}),
    ...(checkpoint.pending_batch ? { pending_batch_id: checkpoint.pending_batch.batch_id } : {}) };
}

export function assistantAgentApprovalSettled(result: Pick<AssistantActionResult, "status">): boolean {
  return ["succeeded", "cancelled", "failed", "expired"].includes(result.status);
}

export type AssistantAgentApprovalHistory = Array<{ approval: AssistantApproval; result?: AssistantActionResult }>;
/** Public account-owned previews and receipts only; never the tool trace or model context. */
export function assistantAgentApprovalHistory(checkpoint: AssistantAgentCheckpoint | null): AssistantAgentApprovalHistory {
  if (!checkpoint) return [];
  const history: AssistantAgentApprovalHistory = [];
  for (const tool of checkpoint.tool_results) {
    if (!["command_preview", "event_preview"].includes(tool.name) || !object(tool.result) || !object(tool.result.approval)) continue;
    const candidate = tool.result.approval;
    if (!text(candidate.id, 36) || !UUID.test(candidate.id) || !text(candidate.summary, 12_000) || !Number.isSafeInteger(candidate.count)) continue;
    const approval: AssistantApproval = { id: candidate.id, summary: candidate.summary, count: Number(candidate.count),
      expires_at: typeof candidate.expires_at === "string" ? candidate.expires_at : null,
      ...(object(candidate.preview) ? { preview: candidate.preview as AssistantApproval["preview"] } : {}) };
    const receipt = checkpoint.tool_results.find(item => item.name === "approval_result" && object(item.result) && item.result.id === approval.id)?.result
      ?? (checkpoint.approval_outcome?.id === approval.id ? checkpoint.approval_outcome : undefined);
    const result = object(receipt) && text(receipt.text, 12_000) && assistantAgentApprovalSettled(receipt as AssistantActionResult)
      ? { id: approval.id, status: receipt.status as AssistantActionResult["status"], text: receipt.text,
        ...(typeof receipt.completed === "number" ? { completed: receipt.completed } : {}) } : undefined;
    const existing = history.findIndex(entry => entry.approval.id === approval.id);
    const entry = { approval, ...(result ? { result } : {}) };
    if (existing === -1) history.push(entry);
    else history[existing] = entry;
  }
  return history.slice(-20);
}

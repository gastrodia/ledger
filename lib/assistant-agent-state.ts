import { recoverAssistantEventResolution, isDuplicateEventQuestion } from "@/lib/assistant-event-clarification";
import { validateLedgerEvent } from "@/lib/ledger-event";
import { validateWorkflow, reconcileRecordWorkflowReceipts } from "@/lib/assistant-workflow";
import type { AssistantAgentCheckpoint, AssistantAgentMetadata } from "@/lib/assistant-agent-runtime";
import type { AssistantApproval, AssistantActionResult } from "@/lib/assistant-commands";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = ["running", "waiting_approval", "completed", "needs_input", "interrupted", "stopped"];
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const approval = (value: unknown) => object(value) && text(value.action_id, 36) && UUID.test(value.action_id) && text(value.fingerprint, 1024);

/** Only server-written checkpoints are restored. None of this private trace is returned by task APIs. */
export function restoreAssistantAgentCheckpoint(value: unknown): AssistantAgentCheckpoint | null {
  if (!object(value) || value.version !== 1 || !text(value.goal_id, 100) || !text(value.goal, 4000)
    || !statuses.includes(String(value.status)) || !Number.isSafeInteger(value.steps) || Number(value.steps) < 0 || Number(value.steps) > 192
    || !Array.isArray(value.messages) || value.messages.length > 600 || value.messages.some(message => !object(message)
      || !["system", "user", "assistant"].includes(String(message.role)) || !text(message.content, 128_000))
    || !Array.isArray(value.tool_results) || value.tool_results.length > 300 || value.tool_results.some(result => !object(result)
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
  try {
    if (value.workflow_required !== undefined && typeof value.workflow_required !== "boolean") return null;
    if (value.operations !== undefined) validateWorkflow(value.operations, true);
    if (value.pending_operation_ids !== undefined && (!Array.isArray(value.pending_operation_ids) || !value.pending_operation_ids.length || value.pending_operation_ids.length > 32 || new Set(value.pending_operation_ids).size !== value.pending_operation_ids.length || value.pending_operation_ids.some(id => !Array.isArray(value.operations) || !value.operations.some(item => object(item) && item.id === id)))) return null;
    if (value.duplicate_review !== undefined && (!object(value.duplicate_review) || !text(value.duplicate_review.operation_id, 64) || !text(value.duplicate_review.source_output_id, 36) || !UUID.test(value.duplicate_review.source_output_id) || !text(value.duplicate_review.fingerprint, 64) || typeof value.duplicate_review.answered !== "boolean" || typeof value.duplicate_review.all_matched !== "boolean")) return null;
    if (value.event_resolutions !== undefined && (!Array.isArray(value.event_resolutions) || value.event_resolutions.length > 32 || new Set(value.event_resolutions.map(item => object(item) ? item.operation_id : null)).size !== value.event_resolutions.length
      || value.event_resolutions.some(item => !object(item) || !Array.isArray(value.operations) || !value.operations.some(op => object(op) && op.id === item.operation_id && op.action === "event") || !text(item.source_output_id, 36) || !UUID.test(item.source_output_id) || typeof item.pending !== "boolean" || !validateLedgerEvent(item.input)))) return null;
    if (value.clarification_answers !== undefined && (!Array.isArray(value.clarification_answers) || value.clarification_answers.length > 192 || value.clarification_answers.some(item => !object(item) || !Array.isArray(value.operations) || !value.operations.some(op => object(op) && op.id === item.operation_id) || !text(item.message_id,36) || !UUID.test(item.message_id) || !text(item.output_id,36) || !UUID.test(item.output_id) || !text(item.text,4000)))) return null;
    if (value.rebound_task_id !== undefined && (!text(value.rebound_task_id, 36) || !UUID.test(value.rebound_task_id))) return null;
    if (value.authorized_answers !== undefined && (!Array.isArray(value.authorized_answers) || value.authorized_answers.length > 192 || value.authorized_answers.some(answer => !text(answer, 4000)))) return null;
    if (value.continuations !== undefined && (!Array.isArray(value.continuations) || value.continuations.length > 192 || value.continuations.some(item => !object(item) || !text(item.message_id, 36) || !UUID.test(item.message_id) || !text(item.output_id, 36) || !UUID.test(item.output_id) || !["answer", "delivery"].includes(String(item.kind)) || !text(item.hash, 64)))) return null;
    if (value.current_operation_id !== undefined && (!Array.isArray(value.operations) || !value.operations.some(item => object(item) && item.id === value.current_operation_id))) return null;
    if (value.output_id !== undefined && (!text(value.output_id, 36) || !UUID.test(value.output_id))) return null;
    if (value.turn_message_id !== undefined && (!text(value.turn_message_id, 36) || !UUID.test(value.turn_message_id))) return null;
    if (value.awaiting_answer !== undefined && typeof value.awaiting_answer !== "boolean" || value.awaiting_delivery !== undefined && typeof value.awaiting_delivery !== "boolean") return null;
    if (value.outputs !== undefined && (!Array.isArray(value.outputs) || value.outputs.length > 192 || value.outputs.some(item => !object(item) || !text(item.id, 36) || !UUID.test(item.id) || !text(item.user_message_id, 36) || !UUID.test(item.user_message_id) || !object(item.plan) || !object(item.input) || !text(item.input.message, 4000) || !text(item.input.display_text, 4000) || !Number.isSafeInteger(item.attempt)))) return null;
  } catch { return null; }
  // JSON round-trip breaks references to a caller's mutable runtime state.
  try {
    const serialized = JSON.stringify(value); if (serialized.length > 500_000) return null;
    const checkpoint = JSON.parse(serialized) as AssistantAgentCheckpoint;
    if (checkpoint.operations && checkpoint.outputs) reconcileRecordWorkflowReceipts(checkpoint.operations, checkpoint.outputs);
    // Older workers mislabeled a technical wave limit as a user question.
    // Recover only the exact server fallback with no business question or preview.
    const latest = checkpoint.outputs?.find(output => output.id === checkpoint.output_id);
    if (checkpoint.status === "needs_input" && checkpoint.operations && !checkpoint.pending_approval && !checkpoint.pending_batch
      && latest && /^(?:本次已达到步骤上限，|本次处理达到时间上限，)/.test(latest.plan.reply)
      && !checkpoint.operations.some(item => item.status === "needs_input")) {
      checkpoint.status = "interrupted"; checkpoint.awaiting_answer = false; checkpoint.awaiting_delivery = false;
      delete checkpoint.pending_plan;
      checkpoint.operations.forEach(item => { if (item.status === "running") item.status = "pending"; });
      latest.plan.reply = "剩余事项的处理暂时中断。已完成事项和未完成清单已保留，可继续处理原任务。";
    }
    const recovered = recoverAssistantEventResolution(checkpoint);
    if (recovered && checkpoint.status === "needs_input" && !checkpoint.pending_approval && !checkpoint.pending_batch
      && latest?.plan.action === "chat" && isDuplicateEventQuestion(latest.plan.reply)) {
      checkpoint.status = "interrupted"; checkpoint.awaiting_answer = false;
      const operation = checkpoint.operations?.find(item => item.id === checkpoint.current_operation_id);
      if (operation?.status === "needs_input") operation.status = "pending";
      latest.plan.reply = "已收到你对新发生事项的确认，原任务可以继续核对。";
    }
    return checkpoint;
  } catch { return null; }
}

export function assistantAgentApprovalIds(checkpoint: AssistantAgentCheckpoint): string[] {
  return [...new Set([...(checkpoint.pending_approval ? [checkpoint.pending_approval.action_id] : []),
    ...(checkpoint.pending_approvals ?? []).map(item => item.action_id)])];
}

export function assistantAgentMetadata(checkpoint: AssistantAgentCheckpoint | null): AssistantAgentMetadata | undefined {
  if (!checkpoint) return undefined;
  return { goal_id: checkpoint.goal_id, goal: checkpoint.goal, status: checkpoint.status,
    steps: checkpoint.steps, tool_calls: checkpoint.tool_results.filter(tool => ["query", "records", "draft_matches", "command_preview", "event_preview", "target_verification"].includes(tool.name)).length,
    ...(checkpoint.pending_approval ? { pending_action_id: checkpoint.pending_approval.action_id } : {}),
    ...(checkpoint.pending_batch ? { pending_batch_id: checkpoint.pending_batch.batch_id } : {}),
    ...(checkpoint.output_id ? { output_id: checkpoint.output_id } : {}),
    ...(checkpoint.operations ? { operations: JSON.parse(JSON.stringify(checkpoint.operations)) } : {}),
    ...(checkpoint.awaiting_answer ? { awaiting_answer: true } : {}), ...(checkpoint.awaiting_delivery ? { awaiting_delivery: true } : {}) };
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

import { assistantCardTarget, reconcileAssistantCardUpdate, reconcileAssistantCardHistory, relocateAssistantCard } from "@/lib/assistant-card-updates";
import { restoreAssistantExecution } from "@/lib/assistant-execution";
import { recordReplyView, type AssistantReplyView } from "@/lib/assistant-reply-view";
import type { AssistantActionPreview } from "@/lib/assistant-action-preview";
import { applyDraftEdit, assistantPagePaths, type AssistantDraftConfirm } from "@/lib/assistant-draft-actions";
import type { AssistantApproval, AssistantActionResult, AssistantExport } from "@/lib/assistant-commands";
import { applyDraftMemberUpdate, assignMissingDraftMembers, memberBatchQuestionText, unassignedMemberDrafts, validateAssistantUndo, validateDraftRemoval, UUID_PATTERN, type AssistantCategory, type AssistantDraft, type AssistantDraftMemberChoice, type AssistantMember, type AssistantPlan, type AssistantUndo } from "@/lib/assistant";
import { restoreAssistantImages, restoreAssistantImportSummary, type AssistantImage } from "@/lib/assistant-images";
import { sortedAssistantDrafts, type AssistantDraftSort } from "@/lib/assistant-draft-sort";
import { assistantTaskActive, restoreAssistantImageProgress, type AssistantImageProgress, type AssistantTask } from "@/lib/assistant-task-types";
import { assistantProcessFromTask, type AssistantProcess } from "@/lib/assistant-process";

export type EditableAssistantDraft = AssistantDraft & { amount: string; ignored?: boolean; softRemoved?: boolean };

export function syncSavedTransactionCards(messages: AssistantConversationMessage[], updates: NonNullable<AssistantActionResult["transaction_updates"]>) {
  return messages.map(message => {
    if (message.status !== "saved" || !message.drafts) return message;
    const changed = updates.filter(update => update.batch_id === message.id && message.drafts!.some(draft => draft.id === update.draft_id));
    if (!changed.length) return message;
    return { ...message, text: "本组账目已更新，请查看卡片中的最新信息。", drafts: message.drafts.map(draft => {
      const update = changed.find(update => update.draft_id === draft.id);
      if (!update) return draft;
      return { ...draft, type: update.type, amount_cents: update.amount_cents, amount: (update.amount_cents / 100).toFixed(2), category_id: update.category_id,
        member_id: update.member_id, transaction_date: update.transaction_date, description: update.description };
    }) };
  });
}
export type AssistantConversationMessage = {
  id: string; role: "user" | "assistant"; text: string; drafts?: EditableAssistantDraft[];
  status?: "pending" | "saved" | "ignored" | "deleted" | "conflict" | "undone"; commit?: AssistantDraft[]; error?: string;
  savedDrafts?: AssistantDraft[];
  memberFlow?: boolean;
  images?: AssistantImage[];
  image?: AssistantImage;
  importSummary?: AssistantPlan["import_summary"];
  memberChoice?: AssistantDraftMemberChoice;
  undoChoice?: AssistantUndo;
  approval?: AssistantApproval;
  actionResult?: AssistantActionResult;
  actionPreview?: AssistantActionPreview;
  replyView?: AssistantReplyView;
  draftMatchDecisions?: Record<string, "kept" | "removed">;
  replyKind?: "result";
  /** Historical location of a card; always points to its unchanged batch ID. */
  draftCardLink?: string;
  cardUpdatedLink?: string;
  updatesCardId?: string;
  supersededApproval?: { id: string; settled?: boolean };
  replacementBlocked?: boolean;
  proposalScope?: { resource: string; operation: string; ids: string[] };
  confirmChoice?: AssistantDraftConfirm & { snapshot: string };
  removeChoice?: AssistantDraftConfirm & { snapshot: string; excluded_ids?: string[] };
  clearChoice?: boolean;
  navigateTo?: string;
  exportFile?: AssistantExport;
  eventContext?: AssistantPlan["event_context"];
  eventChoices?: AssistantPlan["event_choices"];
  ledgerContext?: AssistantPlan["record_context"];
  draftSort?: AssistantDraftSort;
  incomplete?: "stopped" | "interrupted";
  /** An approval/cancellation handled locally is not an unsent model request. */
  localHandled?: boolean;
  taskId?: string;
  taskStatus?: AssistantTask["status"] | "submitting" | "missing";
  taskAttempt?: number;
  image_progress?: AssistantImageProgress | null;
  process?: AssistantProcess;
  /** Remains set after editing/deleting/moving drafts so recovery cannot replay them. */
  taskApplied?: boolean;
  agent?: NonNullable<AssistantPlan["agent"]>;
  /** Earlier checkpoint outputs remain visible when this stable reply advances. */
  taskHistory?: AssistantTaskOutput[];
  approvalHistory?: AssistantTask["approval_history"];
};

/** Move the one editable card after the update reply, leaving a non-executable link.
 * Marker IDs are presentation-only; they never replace batch or transaction IDs.
 */
export function relocateAssistantDraftCard(messages: AssistantConversationMessage[], batchId: string, afterId: string): AssistantConversationMessage[] {
  const source = messages.find(m => m.id === batchId);
  if (!source || source.status !== "pending" || !source.drafts?.length) return messages;
  return relocateAssistantCard(messages,batchId,afterId);
}

/** Keep the confirmation batch ID while placing its review after the member answer. */
export function completeAssistantMemberSelection(messages: AssistantConversationMessage[], messageId: string, member: AssistantMember,
  members: AssistantMember[], answerId: string, questionId: string): AssistantConversationMessage[] {
  const source = messages.find(message => message.id === messageId);
  if (!source || source.role !== "assistant" || source.status !== "pending" || source.commit || !source.drafts?.length
    || !messages.some(message => message.id === answerId && message.role === "user") || messages.some(message => message.id === questionId)) return messages;
  const unassigned = unassignedMemberDrafts(source.drafts, members);
  if (!unassigned.length) return messages;
  let selected: EditableAssistantDraft[];
  try { selected = assignMissingDraftMembers(source.drafts, member.id, members); }
  catch { return messages; }
  const questionText = memberBatchQuestionText(unassigned);
  const question: AssistantConversationMessage = { id: questionId, role: "assistant",
    text: source.text === questionText ? "" : source.text, draftCardLink: messageId };
  const review: AssistantConversationMessage = { ...source, drafts: selected, error: undefined, memberChoice: undefined,
    memberFlow: true, text: "成员已补充，请核对账目后确认入账。" };
  // Move the original card instead of creating a new batch: approvals, undo and
  // task recovery continue to reference the exact same persisted identity.
  return [...messages.map(message => message.id === messageId ? question
    : message.memberChoice?.batch_id === messageId ? { ...message, memberChoice: undefined } : message), review];
}

export type AssistantTaskOutput = Pick<AssistantConversationMessage, "text" | "replyView" | "ledgerContext" | "exportFile" | "actionPreview" | "actionResult" | "approval" | "eventContext" | "drafts" | "savedDrafts" | "status"> & { attempt: number };

export function restoreAssistantAgent(value: unknown): NonNullable<AssistantPlan["agent"]> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const agent = value as NonNullable<AssistantPlan["agent"]>;
  if (typeof agent.goal_id !== "string" || !UUID_PATTERN.test(agent.goal_id) || typeof agent.goal !== "string" || !agent.goal.trim() || agent.goal.length > 4000
    || !["running", "waiting_approval", "completed", "stopped", "needs_input"].includes(agent.status)
    || !Number.isSafeInteger(agent.steps) || agent.steps < 0 || !Number.isSafeInteger(agent.tool_calls) || agent.tool_calls < 0
    || (agent.pending_action_id !== undefined && (typeof agent.pending_action_id !== "string" || !UUID_PATTERN.test(agent.pending_action_id)))
    || (agent.pending_batch_id !== undefined && (typeof agent.pending_batch_id !== "string" || !UUID_PATTERN.test(agent.pending_batch_id)))) return;
  return { goal_id: agent.goal_id, goal: agent.goal, status: agent.status, steps: agent.steps, tool_calls: agent.tool_calls,
    ...(agent.pending_action_id ? { pending_action_id: agent.pending_action_id } : {}),
    ...(agent.pending_batch_id ? { pending_batch_id: agent.pending_batch_id } : {}) };
}

export function restoreAssistantApprovalHistory(value: unknown): NonNullable<AssistantTask["approval_history"]> {
  if (!Array.isArray(value)) return [];
  return value.filter(entry => entry && typeof entry === "object" && entry.approval && UUID_PATTERN.test(entry.approval.id)
    && typeof entry.approval.summary === "string" && (entry.approval.expires_at === null || typeof entry.approval.expires_at === "string")
    && (!entry.result || (entry.result.id === entry.approval.id && typeof entry.result.text === "string"
      && ["pending", "executing", "succeeded", "failed", "cancelled", "expired"].includes(entry.result.status)))).slice(-20);
}

export function restoreAssistantTaskHistory(value: unknown): AssistantTaskOutput[] {
  if (!Array.isArray(value)) return [];
  return value.filter(output => output && typeof output === "object" && typeof output.text === "string"
    && Number.isSafeInteger(output.attempt) && output.attempt > 0).slice(-20);
}

export function assistantAgentWaiting(task: AssistantTask) {
  const agent = restoreAssistantAgent(task.agent || task.result?.agent);
  return task.status === "succeeded" && agent?.status === "waiting_approval" && !!(agent.pending_action_id || agent.pending_batch_id);
}

export function assistantAgentActionSettled(result: AssistantActionResult) {
  return !result.replacement_approval && ["succeeded", "failed", "cancelled", "expired"].includes(result.status);
}

/** Resume consumes the durable server outcome; local text is never authority. */
export async function resumeAssistantAgentTask(task: AssistantTask, request: typeof fetch = fetch, signal?: AbortSignal) {
  return assistantTaskJson<{ task: AssistantTask }>(await request(`/api/assistant/tasks/${task.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify({ action: "resume", attempt: task.attempt }),
  }));
}

/** Stop the current incarnation of this goal even if a resume won the race. */
export async function cancelAssistantTaskCheckpoint(task: AssistantTask, request: typeof fetch = fetch, signal?: AbortSignal) {
  let current = task;
  for (let tries = 0; tries < 3; tries++) {
    const result = await assistantTaskJson<{ task: AssistantTask }>(await request(`/api/assistant/tasks/${current.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify({ action: "cancel", attempt: current.attempt }),
    }));
    if (!assistantTaskActive(result.task) && !assistantAgentWaiting(result.task)) return result;
    if (result.task.attempt === current.attempt) break;
    current = result.task;
  }
  throw new Error("原任务暂未停止，请核对处理状态后重试。");
}

function checkpointHistory(message: AssistantConversationMessage): AssistantTaskOutput[] {
  const previous = message.taskHistory || [];
  const actionId = message.actionResult?.id || message.approval?.id;
  if (previous.some(output => output.attempt === message.taskAttempt && (output.actionResult?.id || output.approval?.id) === actionId)) return previous;
  const { text, replyView, ledgerContext, exportFile, actionPreview, actionResult, approval, eventContext, drafts, savedDrafts, status } = message;
  return [...previous, { attempt: message.taskAttempt || 1, text, replyView, ledgerContext, exportFile, actionPreview, actionResult, drafts, savedDrafts, status,
    // Pending approvals stay on the current checkpoint only. History is read-only.
    ...(actionResult ? {} : approval ? { approval } : {}), eventContext }].slice(-20);
}


export function assistantImageProgressText(progress: AssistantImageProgress, status: AssistantTask["status"] | "recovering") {
  const completed = `已完成 ${progress.completed}/${progress.total} 张`;
  if (status === "recovering") return `上次进度：${completed}，正在恢复处理进度…`;
  if (status === "failed" || status === "cancelled") {
    if (progress.stage === "merging") return `已识别 ${progress.completed}/${progress.total} 张，但账目整理${status === "failed" ? "失败" : "已停止"}，尚未生成可确认的账单。`;
    return `${progress.failed.length ? `第 ${progress.failed.join("、")} 张识别失败；` : ""}${completed}${progress.completed > 0 ? "，识别进度已保存，尚未生成可确认的账单" : ""}`;
  }
  if (progress.stage === "merging") return `${completed}，正在整理账目…`;
  if (status === "queued") return `${completed}，等待继续识别…`;
  if (progress.active.length) return `${completed}，正在识别第 ${progress.active.join("、")} 张…`;
  return `${completed}，正在准备识别…`;
}

export function assistantTaskRetryLabel(message: Pick<AssistantConversationMessage, "taskId" | "taskStatus" | "image_progress">) {
  if (!message.taskId) return "重新发送";
  if (message.taskStatus === "missing") return "重试发送";
  const progress = restoreAssistantImageProgress(message.image_progress);
  return progress ? progress.completed === progress.total ? "重新整理结果" : "继续识别" : "重新处理";
}

export function assistantMemberChoiceTarget(choice: AssistantDraftMemberChoice | undefined, messages: AssistantConversationMessage[]) {
  if (!choice || choice.member_id !== null || !UUID_PATTERN.test(choice.batch_id)
    || !Array.isArray(choice.draft_ids) || !choice.draft_ids.length || choice.draft_ids.length > 20
    || new Set(choice.draft_ids).size !== choice.draft_ids.length || choice.draft_ids.some(id => typeof id !== "string" || !UUID_PATTERN.test(id))) return;
  const message = messages.find(m => m.id === choice.batch_id);
  if (!message || message.role !== "assistant" || message.status !== "pending" || message.commit || !message.drafts?.length) return;
  const drafts = sortedAssistantDrafts(message.drafts, message.draftSort).filter(d => !d.ignored && !d.softRemoved && choice.draft_ids.includes(d.id));
  if (drafts.length !== choice.draft_ids.length || new Set(drafts.map(d => d.id)).size !== drafts.length) return;
  return { message, drafts };
}

const changed = "草稿状态已变化，本次未修改。请核对当前卡片后重试。";

function draftRemovalTotals(drafts: EditableAssistantDraft[]) {
  const totals = { income: 0, expense: 0 };
  for (const draft of drafts) {
    const cents = Math.round(Number(draft.amount) * 100);
    if (!/^\d+(?:\.\d{1,2})?$/.test(draft.amount) || !Number.isSafeInteger(cents)) return "部分金额待核对，请以逐笔明细为准。";
    totals[draft.type] += cents;
  }
  return `涉及收入 ¥${(totals.income / 100).toFixed(2)}，支出 ¥${(totals.expense / 100).toFixed(2)}。`;
}

/** Soft removal changes participation only. IDs, values and ordering remain intact. */
export function setAssistantDraftRemoval(messages: AssistantConversationMessage[], batchId: string, draftIds: string[], removed: boolean): AssistantConversationMessage[] {
  const target = messages.find(m => m.id === batchId && m.role === "assistant");
  if (!target || target.status !== "pending" || target.commit || !draftIds.length || draftIds.some(id => !target.drafts?.some(d => d.id === id && !d.ignored))) return messages;
  return messages.map(m => m.id === batchId ? { ...m, error: undefined, drafts: m.drafts!.map(d => draftIds.includes(d.id) ? { ...d, softRemoved: removed } : d) }
    : m.memberChoice?.batch_id === batchId && m.memberChoice.draft_ids.some(id => draftIds.includes(id)) ? { ...m, memberChoice: undefined } : m);
}

/** Keep the original review intact; exclusions are reversible until confirmation. */
function draftRemovalSelection(choice: NonNullable<AssistantConversationMessage["removeChoice"]>) {
  const snapshot: EditableAssistantDraft[] = JSON.parse(choice.snapshot);
  if (!Array.isArray(snapshot) || snapshot.length !== choice.draft_ids.length || new Set(snapshot.map(d => d.id)).size !== snapshot.length
    || snapshot.some(d => !choice.draft_ids.includes(d.id))) throw new Error("invalid removal snapshot");
  const excluded = choice.excluded_ids ?? [];
  if (!Array.isArray(excluded) || excluded.some(id => typeof id !== "string" || !choice.draft_ids.includes(id)) || new Set(excluded).size !== excluded.length) throw new Error("invalid exclusions");
  return { excluded, selectedSnapshot: snapshot.filter(d => !excluded.includes(d.id)), ids: choice.draft_ids.filter(id => !excluded.includes(id)) };
}
/** Old local deletion previews become reversible selections in the canonical card. */
export function migrateAssistantDraftRemovalPreviews(messages: AssistantConversationMessage[]): AssistantConversationMessage[] {
  let next = messages;
  for (const request of messages.filter(m => m.role === "assistant" && m.removeChoice)) {
    const choice = request.removeChoice!;
    const target = next.find(m => m.id === choice.batch_id);
    let valid = false;
    try {
      const { ids, selectedSnapshot } = draftRemovalSelection(choice);
      valid = !!target && target.role === "assistant" && target.status === "pending" && !target.commit
        && JSON.stringify(target.drafts?.filter(d => ids.includes(d.id))) === JSON.stringify(selectedSnapshot);
      if (valid && ids.length) next = setAssistantDraftRemoval(next, choice.batch_id, ids, true);
    } catch { valid = false; }
    next = next.map(m => m.id === request.id ? { ...m, removeChoice: undefined, replyKind: "result", text: valid
      ? "移除选择已合并到原账目卡片，可直接点击“恢复”。尚未入账。"
      : "旧移除方案已失效，请在账目卡片重新选择。未改动草稿或账本。" } : m);
    if (valid) next = relocateAssistantDraftCard(next, choice.batch_id, request.id);
  }
  return next;
}

export function toggleAssistantDraftRemoval(messages: AssistantConversationMessage[], requestId: string, draftId: string): AssistantConversationMessage[] {
  const request = messages.find(m => m.id === requestId && m.role === "assistant");
  const choice = request?.removeChoice;
  if (!choice || !choice.draft_ids.includes(draftId)) return messages;
  const target = messages.find(m => m.id === choice.batch_id);
  try {
    validateDraftRemoval(choice, target?.role === "assistant" && target.status === "pending" && !target.commit && target.drafts?.length
      ? { batch_id: target.id, status: "pending", drafts: target.drafts.filter(d => !d.ignored && !d.softRemoved) } : null);
    const { excluded } = draftRemovalSelection(choice);
    const nextChoice = { ...choice, excluded_ids: excluded.includes(draftId) ? excluded.filter(id => id !== draftId) : [...excluded, draftId] };
    const { selectedSnapshot } = draftRemovalSelection(nextChoice);
    return messages.map(m => m.id !== requestId ? m : { ...m, error: undefined, removeChoice: nextChoice,
      text: selectedSnapshot.length ? `准备移除 ${selectedSnapshot.length} 笔待确认草稿。${draftRemovalTotals(selectedSnapshot)}尚未执行，请核对后确认。`
        : "本次未选择需移除的草稿。可恢复账目重新选择，确认后保留全部。" });
  } catch { return messages; }
}

/** Resolve the current persisted preview, never a stale click closure; consume it atomically. */
export function approveAssistantDraftRemoval(messages: AssistantConversationMessage[], requestId: string, members: AssistantMember[]): AssistantConversationMessage[] {
  const request = messages.find(message => message.id === requestId);
  if (!request?.removeChoice) return messages;
  const choice = request.removeChoice;
  const target = messages.find(message => message.id === choice.batch_id);
  try {
    const { ids, selectedSnapshot } = draftRemovalSelection(choice);
    if (!ids.length) return messages.map(m => m.id === requestId ? { ...m, removeChoice: undefined, replyKind: "result", error: undefined,
      text: "已保留全部账目，未删除任何草稿。" } : m);
    validateDraftRemoval({ batch_id: choice.batch_id, draft_ids: ids }, target?.role === "assistant" && target.status === "pending" && !target.commit && target.drafts?.length
      ? { batch_id: target.id, status: "pending", drafts: target.drafts.filter(d => !d.ignored && !d.softRemoved) } : null);
    const selected = target!.drafts!.filter(d => ids.includes(d.id));
    if (JSON.stringify(selected) !== JSON.stringify(selectedSnapshot)) throw new Error("stale removal preview");
    const remaining = target!.drafts!.filter(d => !ids.includes(d.id));
    const unassigned = target!.memberFlow ? unassignedMemberDrafts(remaining, members) : [];
    return messages.map(message => {
      if (message.id === requestId) return { ...message, removeChoice: undefined, replyKind: "result",
        text: `已删除 ${selected.length} 笔待确认草稿：${selected.map(d => `「${d.description || "未填写用途"}」`).join("、")}。${remaining.length ? `本组剩余 ${remaining.length} 笔，尚未入账。` : "本组已清空，未入账。"}` };
      if (message.id === target!.id) return { ...message, drafts: remaining, error: undefined,
        status: remaining.length ? "pending" : "deleted",
        text: remaining.length ? unassigned.length ? memberBatchQuestionText(unassigned) : "请核对账目后确认入账。" : "这组草稿已删除，未入账。" };
      if (message.memberChoice?.batch_id === target!.id && message.memberChoice.draft_ids.some(id => ids.includes(id))) return { ...message, memberChoice: undefined };
      return message;
    });
  } catch {
    return messages.map(message => message.id === requestId ? { ...message, removeChoice: undefined, replyKind: "result",
      text: "草稿在确认期间已变化，本次未删除。请重新核对并发起删除。" } : message);
  }
}

/** Quick decisions are bound to the exact draft read by the comparison. */
export function assistantDraftMatchTarget(messages: AssistantConversationMessage[], replyId: string, draftId: string) {
  const comparison = messages.find(m => m.id === replyId && m.role === "assistant")?.replyView?.draftComparison;
  const row = comparison?.rows.find(row => row.draft_id === draftId);
  const target = messages.find(m => m.id === comparison?.batch_id);
  const draft = target?.drafts?.find(d => d.id === draftId && !d.ignored && !d.softRemoved);
  if (!row || !target || target.role !== "assistant" || target.status !== "pending" || target.commit || !draft) return null;
  const snapshot = row.snapshot;
  if (draft.type !== snapshot.type || draft.description !== snapshot.description || draft.transaction_date !== snapshot.transaction_date
    || !/^\d+(?:\.\d{1,2})?$/.test(draft.amount) || Math.round(Number(draft.amount) * 100) !== snapshot.amount_cents
    || (draft.member_id ?? null) !== snapshot.member_id || (draft.category_id ?? null) !== snapshot.category_id) return null;
  return { target, draft };
}
export function resolveAssistantDraftMatch(messages: AssistantConversationMessage[], replyId: string, draftId: string, decision: "kept" | "removed") {
  const reply = messages.find(m => m.id === replyId);
  if (reply?.draftMatchDecisions?.[draftId]) return messages;
  const match = assistantDraftMatchTarget(messages, replyId, draftId);
  if (!match) return messages;
  const next = (decision === "removed" ? setAssistantDraftRemoval(messages, match.target.id, [draftId], true) : messages).map(m => m.id === replyId
    ? { ...m, draftMatchDecisions: { ...m.draftMatchDecisions, [draftId]: decision } } : m);
  return decision === "removed" ? relocateAssistantDraftCard(next, match.target.id, replyId) : next;
}

/** Pure, replay-safe recovery. Financial writes always remain explicit UI actions. */
export function mergeAssistantTasks(
  messages: AssistantConversationMessage[], tasks: AssistantTask[], conversationId: string, members: AssistantMember[], categories: AssistantCategory[] = [],
): AssistantConversationMessage[] {
  let next = messages;
  for (const task of tasks) {
    let updatedBatchId: string | undefined;
    if (task.conversation_id !== conversationId || !UUID_PATTERN.test(task.id) || !UUID_PATTERN.test(task.user_message_id)) continue;
    const user = next.find(message => message.id === task.user_message_id);
    if (user?.taskId === task.id && (user.taskAttempt || 0) > task.attempt) continue;
    const imageProgress = restoreAssistantImageProgress(task.image_progress);
    if (!user && !task.input) continue;
    if (!user) next = [...next, { id: task.user_message_id, role: "user", text: task.input!.display_text,
      images: restoreAssistantImages(task.input!.display_images, undefined, true), taskId: task.id, taskStatus: task.status, taskAttempt: task.attempt }];
    const incomplete = task.status === "succeeded" ? undefined : task.status === "cancelled" ? "stopped" : "interrupted";
    const currentUser = user || next[next.length - 1];
    if (currentUser.taskId !== task.id || currentUser.taskStatus !== task.status || currentUser.taskAttempt !== task.attempt
      || currentUser.incomplete !== incomplete || currentUser.error !== undefined || !sameTaskValue(currentUser.image_progress || null, imageProgress)) {
      next = next.map(message => message.id === task.user_message_id
        ? { ...message, taskId: task.id, taskStatus: task.status, taskAttempt: task.attempt, incomplete, error: undefined, ...(imageProgress || currentUser.image_progress ? { image_progress: imageProgress } : {}) } : message);
    }
    // This flag is persisted on the stable reply, even when its drafts were moved
    // into a later member-selection card or removed by the user.
    const previousReply = next.find(message => message.id === task.id);
    if (previousReply && assistantCardTarget(previousReply)) continue;
    const agent = restoreAssistantAgent(task.agent || task.result?.agent);
    const approvalHistory = restoreAssistantApprovalHistory(task.approval_history);
    const advanced = !!previousReply && task.attempt > (previousReply.taskAttempt || 1);
    // A stop receipt belongs to the existing action card. Keep its identity even
    // after executable approval controls are removed, including on fresh recovery.
    if (agent?.status === "stopped" && (previousReply || task.result?.approval)) {
      const approval = previousReply?.approval || task.result?.approval;
      const actionId = previousReply?.actionResult?.id || approval?.id;
      const receipt = approvalHistory.find(entry => entry.approval.id === actionId)?.result;
      const stopped: AssistantConversationMessage = {
        ...(previousReply || { id: task.id, role: "assistant", text: task.result?.reply || task.text, taskId: task.id }),
        agent, approvalHistory, taskApplied: true, taskStatus: task.status, taskAttempt: task.attempt,
        actionResult: receipt || previousReply?.actionResult,
        actionPreview: previousReply?.actionPreview || approval?.preview,
        process: assistantProcessFromTask(task), approval: undefined, error: undefined, incomplete: undefined,
      };
      if (previousReply) {
        if (!sameTaskValue(previousReply, stopped)) next = next.map(message => message.id === task.id ? stopped : message);
      } else {
        const userIndex = next.findIndex(message => message.id === task.user_message_id);
        next = [...next.slice(0, userIndex + 1), stopped, ...next.slice(userIndex + 1)];
      }
      continue;
    }
    if (previousReply?.taskApplied && !advanced) {
      if (!previousReply.proposalScope && task.result?.command) next = next.map(m => m.id === task.id ? { ...m,proposalScope:{resource:task.result!.command!.resource,operation:task.result!.command!.operation,ids:task.result!.command!.ids} } : m);
      const rebound = agent?.status === "waiting_approval" && task.result?.approval?.id === agent.pending_action_id
        && (previousReply.approval?.id || previousReply.actionResult?.id) !== agent.pending_action_id
        && previousReply.agent?.pending_action_id !== agent.pending_action_id ? task.result?.approval : undefined;
      if (rebound) {
        const receipt = approvalHistory.find(entry => entry.approval.id === (previousReply.actionResult?.id || previousReply.approval?.id))?.result;
        next = next.map(message => message.id === task.id ? { ...message, agent, approvalHistory,
          taskHistory: checkpointHistory({ ...message, ...(receipt ? { actionResult: receipt } : {}) }), approval: rebound,
          actionResult: undefined, actionPreview: rebound.preview, text: rebound.summary, error: undefined } : message);
      }
      if (agent && (!sameTaskValue(previousReply.agent, agent) || previousReply.taskStatus !== task.status || !sameTaskValue(previousReply.approvalHistory || [], approvalHistory))) next = next.map(message => message.id === task.id
        ? { ...message, agent, ...(approvalHistory.length ? { approvalHistory } : {}), taskStatus: task.status, process: assistantProcessFromTask(task),
          ...(agent.status === "stopped" ? { approval: undefined, error: undefined } : {}) } : message);
      if (!previousReply.process || (previousReply.process.startedAt === undefined && Number.isFinite(Date.parse(task.created_at))) || (!previousReply.process.execution?.length && restoreAssistantExecution(task.execution_steps).length > 0)) next = next.map(message => message.id === task.id
        ? { ...message, process: assistantProcessFromTask(task) } : message);
      continue;
    }
    if (assistantTaskActive(task)) {
      if (previousReply && agent) {
        const process = assistantProcessFromTask(task);
        if (!sameTaskValue(previousReply.agent, agent) || previousReply.taskStatus !== task.status
          || !sameTaskValue(previousReply.process, process) || !sameTaskValue(previousReply.approvalHistory || [], approvalHistory)
          || previousReply.incomplete !== undefined || previousReply.error !== undefined) next = next.map(message => message.id === task.id
          ? { ...message, agent, ...(approvalHistory.length ? { approvalHistory } : {}), taskStatus: task.status, process, incomplete: undefined, error: undefined } : message);
      } else if (previousReply) next = next.filter(message => message.id !== task.id);
      continue;
    }
    let reply: AssistantConversationMessage = { id: task.id, role: "assistant", text: task.text,
      taskId: task.id, taskAttempt: task.attempt, taskStatus: task.status, process: assistantProcessFromTask(task), ...(imageProgress ? { image_progress: imageProgress } : {}) };
    if (task.status !== "succeeded" || !task.result) {
      reply = { ...reply, incomplete: task.status === "cancelled" ? "stopped" : "interrupted",
        error: task.error || (task.status === "cancelled" ? "已停止处理，可以重新识别。" : "处理未完成，请重试原请求。") };
      if (previousReply && previousReply.text === reply.text && previousReply.taskId === reply.taskId
        && previousReply.taskStatus === reply.taskStatus && previousReply.taskAttempt === reply.taskAttempt
        && previousReply.incomplete === reply.incomplete && previousReply.error === reply.error
        && sameTaskValue(previousReply.process, reply.process)
        && sameTaskValue(previousReply.image_progress || null, reply.image_progress || null)) continue;
    } else {
      const result = task.result;
      reply = { ...reply, text: result.reply, replyView: result.reply_view, taskApplied: true, importSummary: restoreAssistantImportSummary(result.import_summary) };
      if (result.action === "manage" || result.action === "event") {
        reply = { ...reply, ...(result.command ? { proposalScope: {resource:result.command.resource,operation:result.command.operation,ids:result.command.ids} } : {}), eventContext: result.event_context, eventChoices: result.event_choices, approval: result.approval, actionPreview: result.approval?.preview, exportFile: result.export_file, ledgerContext: result.record_context, replyView: result.record_context ? recordReplyView(result.record_context.resource, result.record_context.rows, result.command, members, categories) : result.reply_view };
      } else if (result.action === "edit") {
        reply.replyKind = "result";
        const edit = result.edit;
        const target = next.find(message => message.id === edit?.batch_id);
        if (!edit || !target || target.status !== "pending" || target.commit || !target.drafts?.length) reply.text = changed;
        else try {
          const drafts = applyDraftEdit(target.drafts, edit, categories, members);
          next = next.map(message => message.id === target.id ? { ...message, drafts, error: undefined }
            : message.memberChoice?.batch_id === target.id ? { ...message, memberChoice: undefined } : message);
          reply.text = `已修改 ${edit.edits.length} 笔待确认草稿，请核对卡片；尚未入账。`;
          updatedBatchId = target.id;
        } catch (error) { reply.text = error instanceof Error ? error.message : changed; }
      } else if (result.action === "confirm") {
        const target = next.find(message => message.id === result.confirm?.batch_id);
        try {
          const choice = validateDraftRemoval(result.confirm, target?.status === "pending" && !target.commit && target.drafts?.length
            ? { batch_id: target.id, status: "pending", drafts: target.drafts.filter(d => !d.ignored && !d.softRemoved) } : null);
          const selected = target!.drafts!.filter(d => choice.draft_ids.includes(d.id));
          reply.confirmChoice = { ...choice, snapshot: JSON.stringify(selected) };
          reply.text = `准备将以下 ${selected.length} 笔草稿入账：\n${selected.map(d => `- ${d.description} · ${d.transaction_date} · ${d.type === "income" ? "收入" : "支出"} ¥${d.amount} · ${members.find(m => m.id === d.member_id)?.name || "未选成员"} · ${categories.find(c => c.id === d.category_id)?.name || "未选分类"}`).join("\n")}\n尚未入账。回复“确认执行”批准，或回复“取消”。`;
        } catch { reply.text = changed; }
      } else if (result.action === "navigate" && result.navigation) {
        const nav = result.navigation;
        if (nav.operation === "clear_chat") reply.clearChoice = true;
        else if (nav.operation === "open") { reply.navigateTo = assistantPagePaths[nav.page]; reply.text = "已找到对应页面，可直接打开。"; }
        else {
          const target = next.find(message => message.id === nav.batch_id && message.status === "pending" && !message.commit);
          if (!target || !nav.order) reply.text = changed;
          else { reply.replyKind = "result"; next = next.map(message => message.id === target.id ? { ...message, draftSort: nav.order! } : message); reply.text = "已调整本组草稿的显示顺序。"; updatedBatchId = target.id; }
        }
      } else if (result.action === "undo") {
        const target = next.find(message => message.id === result.undo?.batch_id);
        try {
          const undo = validateAssistantUndo(result.undo, target?.status === "saved" && target.drafts?.length
            ? { batch_id: target.id, status: "saved", drafts: target.drafts } : null);
          reply = { ...reply, text: `已找到要撤销的 ${undo.draft_ids.length} 笔入账，请核对后确认撤销。`, undoChoice: undo };
        } catch { reply.text = "原账单状态已变化，请在交易记录中核对撤销结果。"; }
      } else if (result.action === "remove") {
        const target = next.find(message => message.id === result.remove?.batch_id);
        try {
          const removal = validateDraftRemoval(result.remove, target?.role === "assistant" && target.status === "pending" && !target.commit && target.drafts?.length
            ? { batch_id: target.id, status: "pending", drafts: target.drafts.filter(d => !d.ignored && !d.softRemoved) } : null);
          next = setAssistantDraftRemoval(next, target!.id, removal.draft_ids, true);
          reply.replyKind = "result";
          reply.text = `已将 ${removal.draft_ids.length} 笔草稿标记为移除，暂不入账。可在账目卡片点击“恢复”；未改动已保存账本。`;
          updatedBatchId = target!.id;
        } catch { reply.text = "草稿状态已变化，本次未删除。请核对当前卡片后重试。"; }
      } else if (result.action === "update") {
        reply.replyKind = "result";
        const update = result.update;
        const target = next.find(message => message.id === update?.batch_id);
        if (!update || !target || target.status !== "pending" || target.commit || !target.drafts?.length) reply.text = changed;
        else if (update.member_id === null) {
          if (assistantMemberChoiceTarget(update, next)) { reply.memberChoice = update; reply.replyKind = undefined; }
          else reply.text = changed;
        } else {
          try {
            const drafts = applyDraftMemberUpdate(target.drafts, update, members);
            next = next.map(message => message.id === target.id ? { ...message, drafts, error: undefined } : message);
            updatedBatchId = target.id;
          } catch { reply.text = changed; }
        }
      } else if (result.drafts.length) {
        const unassigned = unassignedMemberDrafts(result.drafts, members);
        reply = { ...reply, text: unassigned.length && !currentUser.images?.length ? memberBatchQuestionText(unassigned) : result.reply,
          drafts: result.drafts.map(draft => ({ ...draft, amount: (draft.amount_cents / 100).toFixed(2) })), status: "pending", memberFlow: true,
        };
      }
    }
    if (agent) { reply.agent = agent; if (approvalHistory.length) reply.approvalHistory = approvalHistory; }
    if (previousReply && agent) {
      reply.taskHistory = advanced ? checkpointHistory(previousReply) : previousReply.taskHistory;
      if (agent.status === "completed" && previousReply.status === "saved" && previousReply.drafts?.length && !reply.drafts?.length) {
        reply = { ...reply, drafts: previousReply.drafts, savedDrafts: previousReply.savedDrafts, status: "saved",
          taskHistory: previousReply.taskHistory };
      }
      // A stopped goal preserves its settled card and has no automatic retry.
      if (agent.status === "stopped") reply = { ...previousReply, agent, ...(approvalHistory.length ? { approvalHistory } : {}), taskStatus: task.status,
        taskAttempt: task.attempt, process: assistantProcessFromTask(task), approval: undefined, error: undefined, incomplete: undefined };
    }
    const previousIndex = next.findIndex(message => message.id === task.id);
    if (previousIndex !== -1) next = next.map(message => message.id === task.id ? reply : message);
    else {
      const userIndex = next.findIndex(message => message.id === task.user_message_id);
      next = [...next.slice(0, userIndex + 1), reply, ...next.slice(userIndex + 1)];
    }
    if (updatedBatchId) next = relocateAssistantDraftCard(next, updatedBatchId, task.id);
    if (advanced && previousReply) next = relocateAssistantCard(next,task.id,next.at(-1)!.id);
    next = reconcileAssistantCardUpdate(next, task.id, currentUser.text, currentUser.updatesCardId);
  }
  return reconcileAssistantCardHistory(next);
}

export class AssistantTaskRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function assistantTaskJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AssistantTaskRequestError(typeof data.error === "string" ? data.error : "任务状态暂未获取，请重试。", response.status);
  return data as T;
}

// Polls decode fresh JSON objects even when the plan and uploaded input have not
// changed. Compare their values without serializing image data on every poll.
function sameTaskValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameTaskValue(value, right[index]));
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameTaskValue(a[key], b[key]));
}

/** Ignore stale polls and preserve references when the snapshot has not changed. */
export function reconcileAssistantTaskSnapshots(current: AssistantTask[], received: AssistantTask[]) {
  const byId = new Map(current.map(task => [task.id, task]));
  let changed = false;
  for (const task of received) {
    const previous = byId.get(task.id);
    if (previous) {
      const previousAgent = restoreAssistantAgent(previous.agent || previous.result?.agent);
      const receivedAgent = restoreAssistantAgent(task.agent || task.result?.agent);
      const sameGoal = !!previousAgent && previousAgent.goal_id === receivedAgent?.goal_id;
      const continuingGoal = sameGoal && previousAgent.status === "waiting_approval" && task.attempt > previous.attempt;
      const stoppedGoal = sameGoal && receivedAgent?.status === "stopped" && task.status === "cancelled";
      const retryingGoal = sameGoal && task.attempt > previous.attempt && ["cancelled", "failed"].includes(previous.status) && assistantTaskActive(task);
      if (task.attempt < previous.attempt || (previous.status === "succeeded" && task.status !== "succeeded" && !continuingGoal && !stoppedGoal)
        || (previousAgent?.status === "stopped" && sameGoal && receivedAgent?.status !== "stopped" && !retryingGoal)) continue;
      if (task.attempt === previous.attempt) {
        if (Date.parse(task.updated_at) < Date.parse(previous.updated_at)) continue;
        if (!assistantTaskActive(previous) && assistantTaskActive(task)) continue;
      }
    }
    const agent = restoreAssistantAgent(task.agent || task.result?.agent);
    const approvalHistory = restoreAssistantApprovalHistory(task.approval_history);
    const stableApprovalHistory = previous && sameTaskValue(previous.approval_history || [], approvalHistory) ? previous.approval_history : approvalHistory;
    const stableAgent = previous && sameTaskValue(previous.agent, agent) ? previous.agent : agent;
    const input = task.input || previous?.input;
    const stableInput = previous && sameTaskValue(previous.input, input) ? previous.input : input;
    const result = previous && sameTaskValue(previous.result, task.result) ? previous.result : task.result;
    const execution = restoreAssistantExecution(task.execution_steps);
    const stableExecution = previous && sameTaskValue(previous.execution_steps || [], execution) ? previous.execution_steps : execution;
    const imageProgress = restoreAssistantImageProgress(task.image_progress);
    const stableProgress = previous && sameTaskValue(previous.image_progress || null, imageProgress) ? previous.image_progress : imageProgress;
    if (previous && previous.conversation_id === task.conversation_id && previous.user_message_id === task.user_message_id
      && previous.status === task.status && previous.phase === task.phase && previous.text === task.text
      && previous.error === task.error && previous.attempt === task.attempt && previous.created_at === task.created_at
      && previous.updated_at === task.updated_at && previous.result === result && previous.input === stableInput && previous.agent === stableAgent && sameTaskValue(previous.approval_history || [], stableApprovalHistory || [])
      && sameTaskValue(previous.execution_steps || [], stableExecution || [])
      && sameTaskValue(previous.image_progress || null, stableProgress || null)) continue;
    // Heartbeats still advance updated_at so an older response cannot overwrite
    // newer progress, while the unchanged result/input retain their references.
    byId.set(task.id, { ...task, result, ...(stableAgent ? { agent: stableAgent } : {}), ...(stableApprovalHistory?.length ? { approval_history: stableApprovalHistory } : {}), execution_steps: stableExecution, ...(stableInput ? { input: stableInput } : {}),
      ...(Object.hasOwn(task, "image_progress") || previous?.image_progress ? { image_progress: stableProgress || null } : {}) });
    changed = true;
  }
  return changed ? [...byId.values()].sort((left, right) => left.created_at.localeCompare(right.created_at)) : current;
}

/** A polling subscription owns only reads; stopping it can never cancel a task. */
export function subscribeAssistantTasks(options: {
  conversationId: string;
  needsInput: (task: AssistantTask) => boolean;
  onTasks: (tasks: AssistantTask[]) => void;
  onError: (error: Error) => void;
  fetch?: typeof fetch;
  activeInterval?: number;
  idleInterval?: number;
}) {
  const request = options.fetch || fetch;
  let stopped = false;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued = false;
  const refresh = async () => {
    if (stopped) return;
    if (controller) { queued = true; return; }
    clearTimeout(timer);
    const activeController = new AbortController();
    controller = activeController;
    let delay = options.activeInterval ?? 1500;
    try {
      const { tasks } = await assistantTaskJson<{ tasks: AssistantTask[] }>(await request(`/api/assistant/tasks?conversation_id=${encodeURIComponent(options.conversationId)}`, {
        cache: "no-store", signal: activeController.signal,
      }));
      if (stopped || activeController.signal.aborted) return;
      if (!Array.isArray(tasks)) throw new Error("任务状态格式无效，请重试。");
      // Lists never carry historical screenshots. Recover an unknown message
      // from its own bounded response; existing local messages need no download.
      const pending = tasks.filter(task => task.conversation_id === options.conversationId && !task.input && options.needsInput(task));
      const withInput = new Map<string, AssistantTask>();
      let index = 0;
      const recover = async () => {
        while (index < pending.length && !activeController.signal.aborted) {
          const missing = pending[index++];
          const { task } = await assistantTaskJson<{ task: AssistantTask }>(await request(`/api/assistant/tasks/${missing.id}?include_input=1`, { cache: "no-store", signal: activeController.signal }));
          withInput.set(task.id, task);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, pending.length) }, recover));
      if (stopped || activeController.signal.aborted) return;
      const recovered = tasks.map(task => {
        const recovered = withInput.get(task.id) || task;
        return Object.hasOwn(recovered, "image_progress") ? { ...recovered, image_progress: restoreAssistantImageProgress(recovered.image_progress) } : recovered;
      });
      options.onTasks(recovered);
      if (!recovered.some(assistantTaskActive)) delay = options.idleInterval ?? 15000;
    } catch (error) {
      if (!stopped && !activeController.signal.aborted) options.onError(error instanceof Error ? error : new Error("连接中断，正在重新获取处理结果。"));
      delay = 5000;
    } finally {
      if (controller === activeController) controller = undefined;
      if (!stopped) {
        const retryImmediately = queued;
        queued = false;
        timer = setTimeout(() => { void refresh(); }, retryImmediately ? 0 : delay);
      }
    }
  };
  void refresh();
  return { refresh: () => { void refresh(); }, stop: () => { stopped = true; clearTimeout(timer); controller?.abort(); } };
}

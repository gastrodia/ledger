import type { AssistantConversationMessage as Message } from "@/lib/assistant-task-client";
import { UUID_PATTERN } from "@/lib/assistant";

export function assistantCardTarget(message: Message) { return message.cardUpdatedLink || message.draftCardLink; }
/** A superseded card loses its controls, while the question stays in the timeline. */
export function assistantHistoryQuestion(message: Pick<Message, "text" | "agent" | "memberChoice" | "eventChoices" | "eventContext" | "memberFlow" | "drafts">): string | undefined {
  const text = message.text?.trim();
  if (!text) return;
  return message.agent?.awaiting_answer || message.memberChoice || message.eventChoices?.length || message.eventContext?.payment_review
    || message.memberFlow && message.drafts?.some(draft => draft.member_id === null) ? text : undefined;
}
export function relocateAssistantCard(messages: Message[], cardId: string, afterId: string): Message[] {
  const source = messages.find(m => m.id === cardId);
  const sourceIndex = messages.findIndex(m => m.id === cardId), afterIndex = messages.findIndex(m => m.id === afterId);
  if (!source || source.role !== "assistant" || assistantCardTarget(source) || source.commit || !UUID_PATTERN.test(afterId)
    || (!source.drafts?.length && !source.actionPreview && !source.approval && !source.replyView && !source.readResults?.length && !source.eventContext)
    || afterIndex < 0 || sourceIndex === afterIndex || sourceIndex === afterIndex + 1) return messages;
  const ids = new Set(messages.map(m => m.id));
  let prefix = (parseInt(afterId.slice(0, 8), 16) ^ 0x80000000) >>> 0;
  let markerId = `${prefix.toString(16).padStart(8,"0")}${afterId.slice(8)}`;
  while (ids.has(markerId)) { prefix = (prefix + 1) >>> 0; markerId = `${prefix.toString(16).padStart(8,"0")}${afterId.slice(8)}`; }
  const marker: Message = { id: markerId, role: "assistant", text: assistantHistoryQuestion(source) || "", ...(source.drafts?.length ? {draftCardLink:cardId} : {cardUpdatedLink:cardId}) };
  const next = messages.map(m => m.id === cardId ? marker : m.memberChoice?.batch_id === cardId ? { ...m, memberChoice: undefined } : m);
  return [...next.slice(0,afterIndex+1),source,...next.slice(afterIndex+1)];
}
function pending(message: Message) {
  return !assistantCardTarget(message) && message.role === "assistant" && (!message.actionResult || message.actionResult.status === "pending")
    && (message.approval || message.eventContext?.status === "pending" || message.replyView?.analysis || message.readResults?.length || message.ledgerContext);
}
/** Supersession requires a declared output ID; text and similarity never select a card. */
export function reconcileAssistantCardUpdate(messages: Message[], newId: string, explicitPreviousId?: string): Message[] {
  const index = messages.findIndex(m => m.id === newId), current = messages[index];
  if (!current || !pending(current) || (!current.approval && !current.eventChoices?.length && !current.eventContext?.payment_review && !current.replyView?.analysis && !current.readResults?.length && !current.ledgerContext)) return messages;
  if (!explicitPreviousId) return messages;
  const candidates = messages.slice(0, index).filter(message => pending(message) && message.id === explicitPreviousId);
  if (candidates.length !== 1) return messages;
  const old = candidates[0];
  const marker: Message = { id: old.id, role: "assistant", text: assistantHistoryQuestion(old) || "", cardUpdatedLink: newId,
    taskId: old.taskId, taskAttempt: old.taskAttempt, taskStatus: old.taskStatus, taskApplied: true,
    ...(old.approval ? { supersededApproval: { id: old.approval.id } } : {}) };
  return messages.map(m => m.id === old.id ? marker : assistantCardTarget(m) === old.id
    ? { ...m, ...(m.cardUpdatedLink ? {cardUpdatedLink:newId} : {draftCardLink:newId}) } : m);
}
/** Restore recorded supersession links without reinterpreting historical prose. */
export function reconcileAssistantCardHistory(messages: Message[]): Message[] {
  let next = messages;
  for (const message of messages) {
    if (message.role !== "assistant" || assistantCardTarget(message)) continue;
    const index = next.findIndex(m => m.id === message.id);
    const user = [...next.slice(0,index)].reverse().find(m => m.role === "user");
    if (user) next = reconcileAssistantCardUpdate(next,message.id,message.updatesCardId || user.updatesCardId);
  }
  return next;
}

/** Saved event receipts follow the latest verified state of the same event. */
export function linkAssistantEventCards(messages: Message[], newId: string, eventId: string): Message[] {
  if (!UUID_PATTERN.test(eventId) || !messages.some(m => m.id === newId)) return messages;
  const oldIds = new Set(messages.filter(m => m.id !== newId && m.role === "assistant" && !assistantCardTarget(m) && m.eventContext?.event_id === eventId).map(m => m.id));
  if (!oldIds.size) return messages;
  return messages.map(m => oldIds.has(m.id) ? { id:m.id,role:"assistant",text:assistantHistoryQuestion(m) || "",cardUpdatedLink:newId,taskId:m.taskId,taskAttempt:m.taskAttempt,taskStatus:m.taskStatus,taskApplied:true }
    : oldIds.has(assistantCardTarget(m) || "") ? { ...m, ...(m.cardUpdatedLink ? {cardUpdatedLink:newId} : {draftCardLink:newId}) } : m);
}

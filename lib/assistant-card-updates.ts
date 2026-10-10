import type { AssistantConversationMessage as Message } from "@/lib/assistant-task-client";
import { UUID_PATTERN } from "@/lib/assistant";

export function assistantCardTarget(message: Message) { return message.cardUpdatedLink || message.draftCardLink; }
export function relocateAssistantCard(messages: Message[], cardId: string, afterId: string): Message[] {
  const source = messages.find(m => m.id === cardId);
  const sourceIndex = messages.findIndex(m => m.id === cardId), afterIndex = messages.findIndex(m => m.id === afterId);
  if (!source || source.role !== "assistant" || assistantCardTarget(source) || source.commit || !UUID_PATTERN.test(afterId)
    || (!source.drafts?.length && !source.actionPreview && !source.approval && !source.replyView && !source.eventContext)
    || afterIndex < 0 || sourceIndex === afterIndex || sourceIndex === afterIndex + 1) return messages;
  const ids = new Set(messages.map(m => m.id));
  let prefix = (parseInt(afterId.slice(0, 8), 16) ^ 0x80000000) >>> 0;
  let markerId = `${prefix.toString(16).padStart(8,"0")}${afterId.slice(8)}`;
  while (ids.has(markerId)) { prefix = (prefix + 1) >>> 0; markerId = `${prefix.toString(16).padStart(8,"0")}${afterId.slice(8)}`; }
  const marker: Message = { id: markerId, role: "assistant", text: source.drafts?.length ? "这组账目卡片已更新。" : "这张卡片已更新。", ...(source.drafts?.length ? {draftCardLink:cardId} : {cardUpdatedLink:cardId}) };
  const next = messages.map(m => m.id === cardId ? marker : m.memberChoice?.batch_id === cardId ? { ...m, memberChoice: undefined } : m);
  return [...next.slice(0,afterIndex+1),source,...next.slice(afterIndex+1)];
}
function family(message: Message): string | undefined {
  if (message.eventContext) return `event:${message.eventContext.input.kind}:${message.eventContext.input.operation}`;
  if (message.proposalScope) return `command:${message.proposalScope.resource}:${message.proposalScope.operation}:${[...message.proposalScope.ids].sort().join(",")}`;
  if (message.ledgerContext) return `records:${message.ledgerContext.resource}`;
  if (message.replyView?.analysis) return "analysis";
  return;
}
function pending(message: Message) {
  return !assistantCardTarget(message) && message.role === "assistant" && (!message.actionResult || message.actionResult.status === "pending")
    && (message.approval || message.eventContext?.status === "pending" || message.replyView?.analysis || message.ledgerContext);
}
/** A correction replaces a scoped proposal; an additional request stays independent. */
export function reconcileAssistantCardUpdate(messages: Message[], newId: string, userText: string, explicitPreviousId?: string): Message[] {
  const index = messages.findIndex(m => m.id === newId), current = messages[index];
  if (!current || !pending(current) || (!current.approval && !current.eventChoices?.length && !current.replyView?.analysis && !current.ledgerContext) || !family(current)) return messages;
  const correction = /记错|查错|更正|纠正|修改|刷新(?:刚才|上次|原)|更新(?:刚才|上次|原)|改(?:为|成|一下|下|到)|应该是|不是.{1,40}(?:是|而是)|(?:金额|日期|成员|分类|支出人|收入所属人).{0,10}(?:改|是|调整|增加|减少)/.test(userText);
  const previous = messages.slice(0,index).filter(m => pending(m) && family(m) === family(current));
  const selectedChoice = previous.filter(m => m.eventChoices?.some(choice => choice.label === userText));
  const explicit = explicitPreviousId ? messages.slice(0,index).filter(m => m.id === explicitPreviousId && m.role === "assistant" && !assistantCardTarget(m) && m.eventContext?.status === "pending") : [];
  if (!explicit.length && ((!correction || /另外|另记|再记|新增|又一笔|再送|再借/.test(userText)) && selectedChoice.length !== 1)) return messages;
  let candidates = explicit.length === 1 ? explicit : selectedChoice.length === 1 ? selectedChoice : previous;
  if (candidates.length > 1 && current.eventContext) candidates = candidates.filter(m => m.eventContext?.input.event_id
    ? m.eventContext.input.event_id === current.eventContext!.input.event_id
    : m.eventContext?.input.counterparty === current.eventContext!.input.counterparty);
  if (candidates.length > 1 && /刚才|上一(?:张|个|次)|最后一/.test(userText)) candidates = candidates.slice(-1);
  if (candidates.length !== 1) return messages;
  const old = candidates[0];
  const marker: Message = { id: old.id, role: "assistant", text: "这张卡片已更新。", cardUpdatedLink: newId,
    taskId: old.taskId, taskAttempt: old.taskAttempt, taskStatus: old.taskStatus, taskApplied: true,
    ...(old.approval ? { supersededApproval: { id: old.approval.id } } : {}) };
  return messages.map(m => m.id === old.id ? marker : assistantCardTarget(m) === old.id
    ? { ...m, ...(m.cardUpdatedLink ? {cardUpdatedLink:newId} : {draftCardLink:newId}) } : m);
}
/** Upgrade conversations saved before all card types supported update markers. */
export function reconcileAssistantCardHistory(messages: Message[]): Message[] {
  let next = messages;
  for (const message of messages) {
    if (message.role !== "assistant" || assistantCardTarget(message)) continue;
    const index = next.findIndex(m => m.id === message.id);
    const user = [...next.slice(0,index)].reverse().find(m => m.role === "user");
    if (user) next = reconcileAssistantCardUpdate(next,message.id,user.text,user.updatesCardId);
  }
  return next;
}

/** Saved event receipts follow the latest verified state of the same event. */
export function linkAssistantEventCards(messages: Message[], newId: string, eventId: string): Message[] {
  if (!UUID_PATTERN.test(eventId) || !messages.some(m => m.id === newId)) return messages;
  const oldIds = new Set(messages.filter(m => m.id !== newId && m.role === "assistant" && !assistantCardTarget(m) && m.eventContext?.event_id === eventId).map(m => m.id));
  if (!oldIds.size) return messages;
  return messages.map(m => oldIds.has(m.id) ? { id:m.id,role:"assistant",text:"这张卡片已更新。",cardUpdatedLink:newId,taskId:m.taskId,taskAttempt:m.taskAttempt,taskStatus:m.taskStatus,taskApplied:true }
    : oldIds.has(assistantCardTarget(m) || "") ? { ...m, ...(m.cardUpdatedLink ? {cardUpdatedLink:newId} : {draftCardLink:newId}) } : m);
}

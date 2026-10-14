"use client";

import { toast } from "@/hooks/use-toast";
import { type AssistantDraftBatch, type AssistantSavedBatch } from "@/lib/assistant";
import { assistantCardTarget } from "@/lib/assistant-card-updates";
import { assistantCardControlContexts } from "@/lib/assistant-control";
import { type Conversation } from "@/lib/assistant-conversation-state";
import { sortedAssistantDrafts } from "@/lib/assistant-draft-sort";
import { MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH, prepareAssistantMessageImage } from "@/lib/assistant-images";
import { assistantTaskAnswerable, restoreAssistantAgent, type EditableAssistantDraft as EditableDraft, type AssistantConversationMessage as Message } from "@/lib/assistant-task-client";
import { type AssistantTaskRequest } from "@/lib/assistant-task-types";
import { localCalendarDate } from "@/lib/stats-period";
import type { AssistantActivity } from "./use-assistant-controller";
import type { AssistantSession } from "./use-assistant-session";
import type { useAssistantTasks } from "./use-assistant-tasks";

export function useAssistantSend(session: Pick<AssistantSession, "messages" | "setMessages" | "conversationId" | "setOutbox" | "setOutboxPersistable" | "outboxRef" | "input" | "setInput" | "configured" | "setSending" | "actionPendingRef" | "images" | "setImages" | "followReplyRef" | "confirmationsRef" | "undosRef" | "conversationEpochRef" | "saveLockRef" | "sendLockRef" | "draft" | "currentConversation">, taskRuntime: Pick<ReturnType<typeof useAssistantTasks>, "knownTasksRef" | "submitTask">, activity: () => AssistantActivity) {
  const { messages, setMessages, conversationId, setOutbox, setOutboxPersistable, outboxRef, input, setInput, configured, setSending, actionPendingRef, images, setImages, followReplyRef, confirmationsRef, undosRef, conversationEpochRef, saveLockRef, sendLockRef, draft, currentConversation } = session;
  const { knownTasksRef, submitTask } = taskRuntime;
  async function send(override?: string, eventSelection?: import("@/lib/ledger-event").LedgerEventInput, draftBatchId?: string, eventCardId?: string) {
    const originalInput = override ?? input;
    const sentImages = override ? [] : images;
    const text = originalInput.trim() || (sentImages.length ? "请按图片顺序识别截图里的收支，衔接重叠账目，生成待确认账单。" : "");
    if (!text || actionPendingRef.current || activity().busy || outboxRef.current || sendLockRef.current || saveLockRef.current || draft.hasDraft || draft.status === "checking" || configured === null || !conversationId) return;
    const answerCandidates = [...knownTasksRef.current].reverse().filter(assistantTaskAnswerable);
    const answering = !sentImages.length
      ? eventCardId ? answerCandidates.find(task => restoreAssistantAgent(task.agent || task.result?.agent)?.output_id === eventCardId) : answerCandidates[0]
      : undefined;
    if (configured === false) { toast.error("请先在服务端配置百炼 API Key。"); return; }
    if (messages.length >= 78 && !answering) { toast.info("当前对话已较长，请先确认待处理账单，再清空对话。"); return; }
    const latestBatch = draftBatchId ? messages.find(m => m.id === draftBatchId) : [...messages].reverse().find(m => m.drafts?.length);
    if (draftBatchId && (!latestBatch || latestBatch.status !== "pending" || latestBatch.commit || !latestBatch.drafts?.some(d => !d.ignored && !d.softRemoved))) {
      toast.info("这组草稿已变化，请核对最新卡片。"); return;
    }
    const draftBatch: AssistantDraftBatch | null = latestBatch?.status === "pending" && !latestBatch.commit && latestBatch.drafts?.some(d => !d.ignored && !d.softRemoved)
      ? { batch_id: latestBatch.id, status: "pending", drafts: sortedAssistantDrafts(latestBatch.drafts!, latestBatch.draftSort).filter(d => !d.ignored && !d.softRemoved).map(d => ({ id: d.id, type: d.type, description: d.description, member_id: d.member_id, category_id: d.category_id, amount_cents: Math.round(Number(d.amount) * 100), transaction_date: d.transaction_date, payment_method: d.payment_method, note: d.note })) } : null;
    const savedBatch: AssistantSavedBatch | null = latestBatch?.status === "saved"
      ? { batch_id: latestBatch.id, status: "saved", drafts: sortedAssistantDrafts(latestBatch.drafts!, latestBatch.draftSort).filter(d => !d.ignored && !d.softRemoved).map(d => ({ id: d.id, type: d.type, description: d.description, member_id: d.member_id, category_id: d.category_id, amount_cents: Math.round(Number(d.amount) * 100), transaction_date: d.transaction_date, payment_method: d.payment_method, note: d.note })) } : null;
    const epoch = conversationEpochRef.current;
    sendLockRef.current = true; setSending(true);
    try {
      // Waiting proposals require an explicit decision on their own cards.
      // Sending another request must not cancel those unrelated operations.
      const previews = sentImages.length ? await Promise.all(sentImages.map(image => prepareAssistantMessageImage(image, Math.floor(MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH / sentImages.length)))) : [];
      if (!currentConversation(epoch)) return;
      const id = answering?.id || crypto.randomUUID();
      const userMessage: Message = {
        id: crypto.randomUUID(), role: "user", incomplete: "interrupted", taskId: id, taskStatus: "submitting",
        ...(eventCardId ? { updatesCardId: eventCardId } : {}), text: originalInput.trim() ? text : sentImages.length ? `识别这 ${sentImages.length} 张截图` : text, images: previews
      };
      const eventContext = (eventCardId ? messages.find(message => message.id === eventCardId) : [...messages].reverse().find(message => message.eventContext))?.eventContext;
      const request: AssistantTaskRequest = {
        id, ...(answering ? { continuation: { attempt: answering.attempt, output_id: restoreAssistantAgent(answering.agent || answering.result?.agent)!.output_id!, kind: "answer" as const } } : {}), conversation_id: conversationId, user_message_id: userMessage.id, message: text,
        display_text: userMessage.text, display_images: previews, ...(sentImages.length ? { images: sentImages.map(image => image.data) } : {}), today: localCalendarDate(), draft_batch: draftBatch, saved_batch: savedBatch,
        ...(eventSelection ? { event_selection: eventSelection } : {}),
        ...(eventContext ? { event_context: eventContext } : {}),
        record_contexts: messages.flatMap(m => [...(m.taskHistory || []).flatMap(output => output.ledgerContext ? [output.ledgerContext] : []), ...(m.ledgerContext ? [m.ledgerContext] : [])]).slice(-3),
        control_contexts: await assistantCardControlContexts(messages),
        card_contexts: messages.filter(message => message.role === "assistant" && !assistantCardTarget(message)
          && (message.approval || message.eventChoices?.length || message.eventContext?.payment_review || message.replyView || message.readResults?.length || message.ledgerContext)).slice(-10)
          .map(message => ({ id: message.id, summary: (message.approval?.summary || message.text).slice(0, 4000) })),
        history: messages.filter(m => !m.incomplete && !assistantCardTarget(m)).slice(-8).map(m => ({
          role: m.role, content: m.drafts
            ? `${m.text.slice(0, 500)}\n卡片当前状态：${m.status === "saved" ? "已保存" : m.status === "deleted" ? "已删除，未入账" : m.status === "conflict" ? "保存冲突待核对" : "待确认"}。以下是用户核对编辑后的账单，以此为准，不要重复生成：\n${JSON.stringify(sortedAssistantDrafts(m.drafts, m.draftSort).map(d => ({ type: d.type, amount_cents: Math.round(Number(d.amount) * 100), date: d.transaction_date, description: d.description.slice(0, 40), excluded_from_posting: !!d.softRemoved })))}`.slice(0, 4000)
            : [m.text, m.analysis ? `分析说明（仅供参考，不是执行凭据）：${m.analysis}` : ""].filter(Boolean).join("\n").slice(0, 4000)
        }))
      };
      if (!currentConversation(epoch)) return;
      const nextMessages = [...messages.map(message => ({ ...message, memberChoice: undefined, eventChoices: undefined })), userMessage];
      // Persist stable identifiers and the original upload before dispatch. The
      // outbox is dropped only after the server has acknowledged this exact ID.
      const snapshot: Conversation = { conversationId, messages: nextMessages, input: draftBatchId ? input : "", images: draftBatchId ? images : [], confirmations: confirmationsRef.current, undos: undosRef.current, outbox: request };
      const persisted = draft.persist(snapshot);
      if (!persisted && !draft.persist({ ...snapshot, outbox: null })) {
        toast.error("本机对话暂时无法保存；本次尚未发送，输入和截图仍保留在当前页面，请稍后重试。");
        return;
      }
      outboxRef.current = request; setOutbox(request); setOutboxPersistable(persisted); setMessages(nextMessages); if (!draftBatchId) { setInput(""); setImages([]); }
      if (!persisted) toast.info("原截图暂未保存在本机，请等待发送完成后再离开；服务器接收后可用原图重试。");
      await submitTask(request);
    } catch (error) {
      if (currentConversation(epoch)) { toast.error(error instanceof Error ? error.message : "截图准备失败，请重试。"); if (!draftBatchId) { setInput(originalInput); setImages(sentImages); } }
    } finally { if (currentConversation(epoch)) { sendLockRef.current = false; setSending(false); } }
  }
  function manualEntry() {
    if (activity().busy || draft.hasDraft || saveLockRef.current || messages.length >= 120) return;
    followReplyRef.current = true;
    const d: EditableDraft = {
      id: crypto.randomUUID(), type: "expense", amount_cents: 0, amount: "", category_id: null,
      member_id: null, transaction_date: localCalendarDate(), description: "", payment_method: null, note: ""
    };
    setMessages(current => [...current.map(m => m.memberChoice ? { ...m, memberChoice: undefined } : m), { id: crypto.randomUUID(), role: "assistant", text: "填好下面这笔账，再确认入账。", drafts: [d], status: "pending" }]);
  }

  return { send, manualEntry };
}

"use client";

import { toast } from "@/hooks/use-toast";
import { applyDraftMemberUpdate, assignMissingDraftMembers, confirmationRows, unassignedMemberDrafts, type AssistantDraft, type AssistantMember, type AssistantMemberSelection } from "@/lib/assistant";
import { eventActionPreview, summaryActionPreview } from "@/lib/assistant-action-preview";
import { assistantCardTarget, linkAssistantEventCards, relocateAssistantCard } from "@/lib/assistant-card-updates";
import { type AssistantActionResult } from "@/lib/assistant-commands";
import { type Conversation } from "@/lib/assistant-conversation-state";
import { editDraft, invalidDraftFields, submittedDrafts, type DraftValidationField } from "@/lib/assistant-draft-editor";
import { nextAssistantDraftSort, sortedAssistantDrafts } from "@/lib/assistant-draft-sort";
import { approveAssistantDraftRemoval, assistantAgentActionSettled, assistantAgentWaiting, assistantTaskAnswerable, completeAssistantMemberSelection, assistantMemberChoiceTarget as memberChoiceTarget, relocateAssistantDraftCard, assistantResponseJson as responseJson, restoreAssistantAgent, setAssistantDraftRemoval, syncSavedTransactionCards, type EditableAssistantDraft as EditableDraft, type AssistantConversationMessage as Message } from "@/lib/assistant-task-client";
import { type AssistantTaskRequest } from "@/lib/assistant-task-types";
import { savedDraftSnapshot, undoRecoverySnapshots, validateUndoResult, type AssistantUndoRecovery } from "@/lib/assistant-undo";
import { localCalendarDate } from "@/lib/stats-period";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { AssistantActivity } from "./use-assistant-controller";
import type { AssistantSession } from "./use-assistant-session";
import type { useAssistantTasks } from "./use-assistant-tasks";

export function useAssistantActions(session: Pick<AssistantSession, "messages" | "setMessages" | "conversationId" | "outbox" | "setOutbox" | "setOutboxPersistable" | "outboxRef" | "messagesRef" | "input" | "categories" | "members" | "loadError" | "isInitializing" | "setSending" | "setActionPending" | "actionPendingRef" | "setSavingId" | "images" | "confirmations" | "setConfirmations" | "undos" | "followReplyRef" | "confirmationsRef" | "undosRef" | "conversationEpochRef" | "liveRef" | "saveLockRef" | "sendLockRef" | "draft" | "reloadSetup" | "newController" | "finishController" | "currentConversation" | "changeConfirmation" | "changeUndo" | "patchMessage" | "clearConversation">, taskRuntime: Pick<ReturnType<typeof useAssistantTasks>, "knownTasksRef" | "submitTask" | "continueAgentCheckpoint" | "stopTask">, activity: () => AssistantActivity) {
  const { messages, setMessages, conversationId, outbox, setOutbox, setOutboxPersistable, outboxRef, messagesRef, input, categories, members, loadError, isInitializing, setSending, setActionPending, actionPendingRef, setSavingId, images, confirmations, setConfirmations, undos, followReplyRef, confirmationsRef, undosRef, conversationEpochRef, liveRef, saveLockRef, sendLockRef, draft, reloadSetup, newController, finishController, currentConversation, changeConfirmation, changeUndo, patchMessage, clearConversation } = session;
  const { knownTasksRef, submitTask, continueAgentCheckpoint, stopTask } = taskRuntime;
  const [confirmingIds, setConfirmingIds] = useState<string[]>([]);
  const [undoingIds, setUndoingIds] = useState<string[]>([]);
  const [expandedDrafts, setExpandedDrafts] = useState<Record<string, boolean>>({});
  const [validationTarget, setValidationTarget] = useState<{ draftId: string; field: DraftValidationField } | null>(null);
  const confirmationControllersRef = useRef(new Map<string, AbortController>());
  const undoControllersRef = useRef(new Map<string, AbortController>());
  const revokingApprovalsRef = useRef(new Set<string>());
  const revokeSupersededApprovals = useEffectEvent(() => {
    if (isInitializing || loadError) return;
    for (const message of messages) {
      const old = message.supersededApproval;
      if (!message.cardUpdatedLink || !old || old.settled || revokingApprovalsRef.current.has(old.id)) continue;
      revokingApprovalsRef.current.add(old.id);
      const epoch = conversationEpochRef.current;
      const controller = newController(false);
      void (async () => {
        try {
          const result: AssistantActionResult = await responseJson(await fetch(`/api/assistant/actions/${old.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "cancel" }), signal: controller.signal }));
          if (!currentConversation(epoch) || result.id !== old.id) return;
          const submitted = result.status === "executing" || result.status === "succeeded" || (result.completed || 0) > 0;
          setMessages(current => {
            const replacement = current.find(m => m.id === message.cardUpdatedLink)?.approval;
            return current.map(m => m.id === message.id ? { ...m, supersededApproval: submitted && replacement ? { id: replacement.id, settled: false } : { id: old.id, settled: true } }
              : submitted && m.id === message.cardUpdatedLink ? { ...m, approval: undefined, replacementBlocked: true, actionResult: { ...result, status: "failed", text: "原方案已提交执行，请先核对账本结果再创建更正方案。" }, error: "原方案已提交执行，请先核对账本结果。", ...(result.event_context ? { eventContext: result.event_context } : {}) } : m);
          });
        } catch { /* The old card remains non-executable; a later refresh retries cancellation. */ }
        finally { revokingApprovalsRef.current.delete(old.id); finishController(controller); }
      })();
    }
  });
  useEffect(() => { revokeSupersededApprovals(); }, [messages, isInitializing, loadError]);
  async function decideConversationAction(message: Message, decision: "approve" | "cancel", read = false, userReply?: Message) {
    if (actionPendingRef.current || saveLockRef.current || sendLockRef.current || activity().busy || messagesRef.current.some(m => m.id === message.id && assistantCardTarget(m))) return;
    actionPendingRef.current = true;
    setActionPending({ id: message.id, phase: read ? "read" : decision });
    patchMessage(message.id, { error: undefined });
    try { return await performConversationAction(message, decision, read, userReply); }
    finally { actionPendingRef.current = false; if (liveRef.current) setActionPending(null); }
  }

  async function performConversationAction(message: Message, decision: "approve" | "cancel", read = false, userReply?: Message) {
    if (saveLockRef.current || sendLockRef.current || activity().busy) return;
    if (messagesRef.current.some(m => m.cardUpdatedLink === message.id && m.supersededApproval && !m.supersededApproval.settled)) return;
    if (message.approval || (read && message.actionResult)) {
      const epoch = conversationEpochRef.current;
      saveLockRef.current = true; setSavingId(message.id);
      try {
        const response = await fetch(`/api/assistant/actions/${message.approval?.id || message.actionResult!.id}`, read ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
        const result: AssistantActionResult = await responseJson(response);
        if (!currentConversation(epoch)) return;
        patchMessage(message.id, {
          error: undefined, actionPreview: result.preview || message.actionPreview || message.approval?.preview || (message.eventContext ? eventActionPreview(message.eventContext.input, message.approval?.summary || message.text) : summaryActionPreview(message.approval?.summary || message.text)), text: result.status === "pending" && message.approval ? message.approval.summary : result.text, actionResult: result, ...(result.event_context ? { eventContext: result.event_context, eventChoices: undefined } : {}),
          ...(["succeeded", "failed", "cancelled", "expired"].includes(result.status) ? { approval: undefined } : {})
        });
        if (result.transaction_updates?.length) setMessages(current => {
          let next = syncSavedTransactionCards(current, result.transaction_updates!);
          for (const batchId of new Set(result.transaction_updates!.map(row => row.batch_id))) next = relocateAssistantCard(next, batchId, message.id);
          return next;
        });
        if (result.replacement_approval) patchMessage(message.id, {
          approval: result.replacement_approval, actionPreview: result.replacement_approval.preview,
          actionResult: { ...result, status: "pending" }, text: result.replacement_approval.summary, error: undefined
        });
        if (result.status === "succeeded") {
          if (result.event_context?.event_id) setMessages(current => linkAssistantEventCards(current, message.id, result.event_context!.event_id!));
          reloadSetup();
        }
        const agentTask = knownTasksRef.current.find(task => task.id === message.taskId && assistantAgentWaiting(task));
        if (agentTask && (assistantAgentActionSettled(result) || result.replacement_approval)) await continueAgentCheckpoint(agentTask, result);
      } catch (error) { if (currentConversation(epoch)) patchMessage(message.id, { error: error instanceof Error ? error.message : "结果待核对，请查询操作状态。" }); }
      finally { saveLockRef.current = false; if (currentConversation(epoch)) setSavingId(null); }
      return;
    }
    if (decision === "cancel") {
      patchMessage(message.id, { confirmChoice: undefined, removeChoice: undefined, clearChoice: undefined, undoChoice: undefined, replyKind: "result", text: "已取消本次操作，未执行。" });
      if (message.agent?.operations && message.taskId) await stopTask(message.taskId);
      return true;
    }
    if (message.removeChoice) {
      setMessages(current => approveAssistantDraftRemoval(current, message.id, members)); return true;
    }
    if (message.clearChoice) { clearConversation(); return true; }
    if (message.undoChoice) {
      const target = messages.find(m => m.id === message.undoChoice!.batch_id);
      const saved = await undoSaved(target, message.undoChoice.draft_ids);
      patchMessage(message.id, { undoChoice: undefined, delivery: { action: "undo", status: saved ? "succeeded" : "failed" }, replyKind: "result", text: saved ? "已撤销入账，并恢复为待确认草稿。" : "请查看原账单卡片核对撤销结果。" }); return saved;
    }
    if (message.confirmChoice) {
      const choice = message.confirmChoice;
      const target = messages.find(m => m.id === choice.batch_id);
      const selected = target?.drafts?.filter(d => choice.draft_ids.includes(d.id)) || [];
      if (!target || target.status !== "pending" || target.commit || JSON.stringify(selected) !== choice.snapshot) {
        patchMessage(message.id, { confirmChoice: undefined, text: "草稿在确认期间已变化，未入账。请重新核对并发起确认。" }); return;
      }
      try { confirmationRows(submittedDrafts(selected)); } catch (error) {
        patchMessage(message.id, { confirmChoice: undefined, text: error instanceof Error ? error.message : "请先补全草稿。" }); return;
      }
      const remaining = target.drafts!.filter(d => !choice.draft_ids.includes(d.id));
      const agentBatch = knownTasksRef.current.some(task => assistantAgentWaiting(task) && restoreAssistantAgent(task.agent || task.result?.agent)?.pending_batch_id === target.id);
      const batch: Message = remaining.length ? {
        ...target, id: agentBatch ? target.id : crypto.randomUUID(), drafts: selected,
        ...(agentBatch ? {} : { taskId: undefined }), taskApplied: true
      } : target;
      const remainder: Message | undefined = remaining.length && agentBatch ? {
        ...target, id: crypto.randomUUID(), drafts: remaining,
        agent: undefined, taskId: undefined, taskHistory: undefined, approvalHistory: undefined, text: "其余草稿仍待核对，尚未入账。"
      } : undefined;
      // Persist the exact subset before posting, preserving all unselected rows.
      const changed = messages.map(m => m.id === message.id ? { ...m, confirmChoice: undefined, text: "正在核对入账结果。" }
        : remaining.length && m.id === target.id ? agentBatch ? batch : { ...m, drafts: remaining } : m);
      const updated = [...(remainder ? [...changed, remainder] : remaining.length ? [...changed, batch] : changed), ...(userReply ? [userReply] : [])];
      if (!draft.persist({ conversationId: conversationId || undefined, messages: updated, input: "", images, confirmations, undos, outbox })) {
        patchMessage(message.id, { text: "无法保存本机操作记录，本次尚未入账，请稍后重试。" }); return;
      }
      setMessages(updated);
      const saved = await confirm(batch);
      patchMessage(message.id, { confirmChoice: undefined, replyKind: "result", text: saved ? `已将 ${selected.length} 笔草稿记入账本。` : "入账未确认，请查看原卡片的提示并核对结果。" });
      return saved;
    }
  }
  async function chooseMember(message: Message, member: AssistantMember) {
    if (activity().busy || sendLockRef.current || saveLockRef.current || draft.hasDraft || draft.status === "checking" || message.status !== "pending" || message.commit) return;
    const unassigned = unassignedMemberDrafts(message.drafts || [], members);
    const memberDraft = unassigned[0];
    if (!memberDraft) return;
    try { assignMissingDraftMembers(message.drafts || [], member.id, members); }
    catch (error) { toast.error(error instanceof Error ? error.message : "成员选择无效。"); return; }
    sendLockRef.current = true; followReplyRef.current = true; setSending(true);
    const epoch = conversationEpochRef.current;
    const controller = newController();
    const memberLabel = unassigned.every(d => d.type === "expense") ? "支出人" : unassigned.every(d => d.type === "income") ? "收入所属人" : "所属成员";
    const answer: Message = { id: crypto.randomUUID(), role: "user", text: `${unassigned.length > 1 ? `这 ${unassigned.length} 笔账目` : memberDraft.description.slice(0, 80) || "这笔账"}：${memberLabel}是「${member.name}」` };
    setMessages(current => [...current, answer]);
    try {
      const result: AssistantMemberSelection = await responseJson(await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ operation: "select_member", draft_id: memberDraft.id, member_id: member.id })
      }));
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      if (result.draft_id !== memberDraft.id || result.member?.id !== member.id) throw new Error("成员选择结果无效，请重试。");
      const questionId = crypto.randomUUID();
      setMessages(current => completeAssistantMemberSelection(current, message.id, member, members, answer.id, questionId));
    } catch (error) {
      if (!controller.signal.aborted && currentConversation(epoch)) {
        toast.error(error instanceof Error ? error.message : "发送选择失败，请重试。");
        setMessages(current => current.filter(m => m.id !== answer.id));
      }
    } finally { finishController(controller); if (currentConversation(epoch)) { sendLockRef.current = false; setSending(false); } }
  }

  async function selectReplacementMember(question: Message, member: AssistantMember) {
    if (activity().busy || sendLockRef.current || saveLockRef.current || draft.hasDraft || draft.status === "checking") return;
    const choice = question.memberChoice;
    const target = memberChoiceTarget(choice, messages);
    if (!choice || !target) { toast.error("待修改的账目已变化，请重新选择。"); return; }
    const update = { ...choice, member_id: member.id };
    const pendingTask = knownTasksRef.current.find(task => {
      const agent = restoreAssistantAgent(task.agent || task.result?.agent);
      return task.id === question.taskId && assistantTaskAnswerable(task) && agent?.awaiting_answer && agent.output_id === question.id;
    });
    if (pendingTask) {
      const answer: Message = { id: crypto.randomUUID(), role: "user", text: `这 ${target.drafts.length} 笔账目的成员选「${member.name}」`, taskId: pendingTask.id, taskStatus: "submitting" };
      const request: AssistantTaskRequest = {
        id: pendingTask.id, conversation_id: pendingTask.conversation_id, user_message_id: answer.id,
        message: answer.text, display_text: answer.text, today: localCalendarDate(),
        continuation: { kind: "answer", attempt: pendingTask.attempt, output_id: question.id, selected_member_id: member.id },
        draft_batch: { batch_id: target.message.id, status: "pending", drafts: sortedAssistantDrafts(target.message.drafts!, target.message.draftSort).filter(row => !row.ignored && !row.softRemoved).map(({ amount, ...row }) => ({ ...row, amount_cents: Math.round(Number(amount) * 100) })) },
      };
      const next = [...messagesRef.current, answer];
      const snapshot: Conversation = { conversationId: conversationId || undefined, messages: next, input, images, confirmations: confirmationsRef.current, undos: undosRef.current, outbox: request };
      const persisted = draft.persist(snapshot);
      if (!persisted && !draft.persist({ ...snapshot, outbox: null })) { toast.error("本机暂时无法保存回答，请稍后重新选择。"); return; }
      outboxRef.current = request; setOutbox(request); setOutboxPersistable(persisted); setMessages(next);
      await submitTask(request); return;
    }
    try { applyDraftMemberUpdate(target.message.drafts!, update, members); }
    catch (error) { toast.error(error instanceof Error ? error.message : "成员选择无效。"); return; }
    sendLockRef.current = true; followReplyRef.current = true; setSending(true);
    const epoch = conversationEpochRef.current;
    const controller = newController();
    const label = target.drafts.every(d => d.type === "expense") ? "支出人" : "所属成员";
    const answer: Message = { id: crypto.randomUUID(), role: "user", text: `将这 ${target.drafts.length} 笔账目的${label}改为「${member.name}」` };
    setMessages(current => [...current, answer]);
    try {
      const result: AssistantMemberSelection = await responseJson(await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ operation: "select_member", draft_id: target.drafts[0].id, member_id: member.id })
      }));
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      if (result.draft_id !== target.drafts[0].id || result.member?.id !== member.id) throw new Error("成员选择结果无效，请重试。");
      const reply: Message = { id: crypto.randomUUID(), role: "assistant", text: `已将这 ${target.drafts.length} 笔账目的${label}改为「${result.member.name}」，请核对后确认入账。` };
      setMessages(current => {
        const active = current.find(m => m.id === question.id);
        const latest = active?.memberChoice && memberChoiceTarget(active.memberChoice, current);
        if (!latest || active.memberChoice!.batch_id !== choice.batch_id || active.memberChoice!.draft_ids.length !== choice.draft_ids.length
          || choice.draft_ids.some(id => !active.memberChoice!.draft_ids.includes(id))) {
          return [...current, { ...reply, text: "草稿状态已变化，本次未修改。请核对当前卡片后重试。" }];
        }
        let updated: EditableDraft[];
        try { updated = applyDraftMemberUpdate(latest.message.drafts!, update, members); }
        catch { return [...current, { ...reply, text: "待修改的账目已变化，本次未修改。请核对当前卡片后重试。" }]; }
        return relocateAssistantDraftCard([...current.map(m => m.id === latest.message.id ? { ...m, drafts: updated, error: undefined } : m.id === question.id ? { ...m, memberChoice: undefined } : m), reply], latest.message.id, reply.id);
      });
    } catch (error) {
      if (!controller.signal.aborted && currentConversation(epoch)) {
        toast.error(error instanceof Error ? error.message : "成员修改失败，请重试。");
        setMessages(current => current.filter(m => m.id !== answer.id));
      }
    } finally { finishController(controller); if (currentConversation(epoch)) { sendLockRef.current = false; setSending(false); } }
  }

  function revealInvalidDraft(message: Message) {
    if (message.commit) return;
    const drafts = sortedAssistantDrafts(message.drafts || [], message.draftSort).filter(d => !d.ignored && !d.softRemoved);
    for (const d of drafts) {
      const invalid = invalidDraftFields(d, categories, members);
      const field = (Object.keys(invalid) as DraftValidationField[]).find(key => invalid[key]);
      if (!field) continue;
      setExpandedDrafts(current => ({ ...current, [d.id]: true }));
      setValidationTarget({ draftId: d.id, field });
      return;
    }
  }

  async function confirm(message: Message) {
    if (saveLockRef.current || activity().busy || confirmationControllersRef.current.has(message.id)) return;
    let submitted: AssistantDraft[];
    try { submitted = message.commit || submittedDrafts(message.drafts || []); confirmationRows(submitted); }
    catch (error) { const text = error instanceof Error ? error.message : "请核对账单。"; patchMessage(message.id, { error: text }); toast.error(text); revealInvalidDraft(message); return; }
    // Persist the exact payload before the request. A lost response/reload retries
    // the same batch; edits remain locked until its outcome has been established.
    saveLockRef.current = true; setSavingId(message.id); patchMessage(message.id, { commit: submitted, error: undefined });
    changeConfirmation(message.id, { id: message.id, drafts: submitted });
    const epoch = conversationEpochRef.current;
    const controller = newController(false);
    confirmationControllersRef.current.set(message.id, controller);
    setConfirmingIds(current => [...current, message.id]);
    try {
      const response = await fetch("/api/assistant/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ batch_id: message.id, drafts: submitted, ...(message.agent?.operations && message.taskId ? { task_id: message.taskId, excluded_draft_ids: (message.drafts || []).filter(row => row.softRemoved || row.ignored).map(row => row.id) } : {}) })
      });
      const result = await response.json().catch(() => ({}));
      if (!liveRef.current || controller.signal.aborted) return;
      if (!response.ok) {
        // A validation rejection is known to have performed no write. Other
        // failures preserve the submitted payload for idempotent reconciliation.
        const error = result.error || "确认结果暂未获取，请重试确认。";
        if (response.status === 400 || result.notSaved || result.batchRevoked) changeConfirmation(message.id);
        else changeConfirmation(message.id, { id: message.id, drafts: submitted, error });
        patchMessage(message.id, { ...(result.batchConflict || result.batchRevoked ? { status: "conflict", commit: undefined } : response.status === 400 || result.notSaved ? { commit: undefined } : {}), error });
        if (!currentConversation(epoch)) toast.error(error);
        return;
      }
      changeConfirmation(message.id);
      patchMessage(message.id, { status: "saved", error: undefined, commit: undefined, savedDrafts: submitted.map(d => ({ ...d })), drafts: message.drafts?.filter(d => submitted.some(saved => saved.id === d.id)) });
      toast.success(`${result.count} 笔已记入账本${result.replayed ? "（已核对，无重复记账）" : ""}`);
      if (currentConversation(epoch)) {
        const waiting = knownTasksRef.current.find(task => assistantAgentWaiting(task) && restoreAssistantAgent(task.agent || task.result?.agent)?.pending_batch_id === message.id);
        if (waiting) await continueAgentCheckpoint(waiting);
      }
      return true;
    } catch {
      if (!controller.signal.aborted && liveRef.current) {
        const error = "网络中断，保存结果待核对。请重试确认，不会重复记账。";
        changeConfirmation(message.id, { id: message.id, drafts: submitted, error }); patchMessage(message.id, { error });
      }
    } finally {
      finishController(controller); confirmationControllersRef.current.delete(message.id);
      if (liveRef.current) {
        setConfirmations([...confirmationsRef.current]);
        setConfirmingIds(current => current.filter(id => id !== message.id));
        if (currentConversation(epoch)) { saveLockRef.current = false; setSavingId(null); }
      }
    }
  }

  async function undoSaved(message?: Message, draftIds?: string[], retry?: AssistantUndoRecovery) {
    if (saveLockRef.current || (retry && undoControllersRef.current.has(retry.id))) return;
    let operation: AssistantUndoRecovery;
    try {
      if (retry) operation = undoRecoverySnapshots([retry])[0];
      else {
        if (!message || message.status !== "saved" || !message.drafts?.length) throw new Error("这组账目已变化，请核对当前卡片。");
        if (undosRef.current.some(item => item.batch_id === message.id)) throw new Error("撤销结果尚待核对，请先核对原操作。");
        const drafts = savedDraftSnapshot(message.savedDrafts || submittedDrafts(message.drafts));
        const ids = draftIds || message.drafts.map(d => d.id);
        if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !message.drafts!.some(d => d.id === id))) throw new Error("撤销目标已变化，请核对当前卡片。");
        operation = { id: crypto.randomUUID(), batch_id: message.id, drafts, draft_ids: [...ids], draftSort: message.draftSort };
      }
      if (!operation) throw new Error("原始撤销操作无效，请核对交易记录。");
    } catch (error) { toast.error(error instanceof Error ? error.message : "撤销目标无效。"); return; }
    const request = { ...operation, error: undefined };
    saveLockRef.current = true; setSavingId(request.batch_id);
    changeUndo(request.id, request); patchMessage(request.batch_id, { error: undefined });
    const epoch = conversationEpochRef.current;
    const controller = newController(false);
    undoControllersRef.current.set(request.id, controller);
    setUndoingIds(current => [...current, request.id]);
    try {
      const response = await fetch("/api/assistant/undo", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ batch_id: request.batch_id, drafts: request.drafts, draft_ids: request.draft_ids, undo_id: request.id })
      });
      const data = await response.json().catch(() => ({}));
      if (!liveRef.current || controller.signal.aborted) return;
      if (!response.ok) {
        const error = typeof data.error === "string" ? data.error : "撤销结果暂未获取，请核对原操作。";
        if (response.status === 400 || data.notUndone) changeUndo(request.id);
        else changeUndo(request.id, { ...request, error });
        patchMessage(request.batch_id, { error }); toast.error(error);
        return;
      }
      const result = validateUndoResult(data, request);
      const restored: Message = {
        id: result.batch_id, role: "assistant", text: `已撤销 ${result.drafts.length} 笔入账，草稿已恢复。核对后可重新确认。`,
        status: "pending", drafts: result.drafts.map(editDraft), draftSort: request.draftSort, memberFlow: true
      };
      // Only the recovered draft survives a cleared chat; never bring its old
      // messages, screenshots or composerRef back into the new conversation.
      setMessages(current => {
        const next = current.map(m => {
          if (m.id !== request.batch_id) return m;
          const remaining = m.drafts?.filter(d => !result.undone_draft_ids.includes(d.id)) || [];
          return {
            ...m, drafts: remaining, savedDrafts: request.drafts, status: remaining.length ? "saved" as const : "undone" as const,
            ...(remaining.length ? {} : { text: "本组入账已撤销，草稿已恢复。" }), error: undefined, commit: undefined
          };
        });
        return next.some(m => m.id === restored.id) ? next : [...next, restored];
      });
      changeUndo(request.id);
      toast.success(`已撤销 ${result.drafts.length} 笔入账，草稿已恢复`);
      return true;
    } catch {
      if (liveRef.current && !controller.signal.aborted) {
        const error = "撤销结果待核对，请重试原操作；核对成功后会自动恢复草稿。";
        changeUndo(request.id, { ...request, error }); patchMessage(request.batch_id, { error }); toast.error(error);
      }
    } finally {
      finishController(controller); undoControllersRef.current.delete(request.id);
      if (liveRef.current) {
        setUndoingIds(current => current.filter(id => id !== request.id));
        if (currentConversation(epoch)) { saveLockRef.current = false; setSavingId(null); }
      }
    }
  }

  function updateDraft(messageId: string, draftId: string, update: Partial<EditableDraft>) {
    if (activity().busy || sendLockRef.current || saveLockRef.current) return;
    setValidationTarget(current => current?.draftId === draftId ? null : current);
    setMessages(current => current.map(m => {
      if ("member_id" in update && m.memberChoice?.batch_id === messageId && m.memberChoice.draft_ids.includes(draftId)) return { ...m, memberChoice: undefined };
      return m.id === messageId && m.status === "pending" && !m.commit ? { ...m, error: undefined, drafts: m.drafts?.map(d => d.id === draftId ? { ...d, ...update } : d) } : m;
    }));
  }

  function cycleDraftSort(messageId: string) {
    if (activity().busy || sendLockRef.current) return;
    setMessages(current => current.map(message => message.id === messageId && message.drafts?.length
      ? { ...message, draftSort: nextAssistantDraftSort(message.draftSort) } : message));
  }

  function deleteDrafts(messageId: string, draftId?: string) {
    if (activity().busy || saveLockRef.current || sendLockRef.current) return;
    setMessages(current => {
      const target = current.find(m => m.id === messageId);
      const row = target?.drafts?.find(d => d.id === draftId);
      const active = target?.drafts?.filter(d => !d.ignored && !d.softRemoved) || [];
      const removed = draftId ? !row?.softRemoved : active.length > 0;
      const ids = draftId ? [draftId] : (target?.drafts || []).filter(d => !d.ignored).map(d => d.id);
      return setAssistantDraftRemoval(current, messageId, ids, removed);
    });
  }

  function resetActions(kind: "clear" | "logout") {
    if (kind === "clear") setExpandedDrafts({});
    else { setConfirmingIds([]); setUndoingIds([]); }
  }

  return { confirmingIds, undoingIds, expandedDrafts, setExpandedDrafts, validationTarget, decideConversationAction, chooseMember, selectReplacementMember, confirm, undoSaved, updateDraft, cycleDraftSort, deleteDrafts, resetActions };
}

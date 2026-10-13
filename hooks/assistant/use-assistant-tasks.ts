"use client";

import { toast } from "@/hooks/use-toast";
import { assistantCardTarget } from "@/lib/assistant-card-updates";
import { type AssistantActionResult } from "@/lib/assistant-commands";
import { assistantCardControlContexts, validateAssistantControl } from "@/lib/assistant-control";
import { assistantAgentActionSettled, assistantAgentWaiting, assistantTaskJson, AssistantTaskRequestError, cancelAssistantTaskCheckpoint, mergeAssistantTasks, reconcileAssistantTaskSnapshots, assistantResponseJson as responseJson, restoreAssistantAgent, resumeAssistantAgentTask, subscribeAssistantTasks, syncSavedTransactionCards, type AssistantConversationMessage as Message } from "@/lib/assistant-task-client";
import { type AssistantTask, type AssistantTaskRequest } from "@/lib/assistant-task-types";
import { localCalendarDate } from "@/lib/stats-period";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { AssistantActivity } from "./use-assistant-controller";
import type { AssistantSession } from "./use-assistant-session";

export function useAssistantTasks(session: Pick<AssistantSession, "messages" | "setMessages" | "conversationId" | "outbox" | "setOutbox" | "outboxRef" | "messagesRef" | "input" | "setInput" | "categories" | "members" | "loadError" | "isInitializing" | "sending" | "setSending" | "actionPending" | "actionPendingRef" | "savingId" | "images" | "setImages" | "confirmations" | "undos" | "followReplyRef" | "composerRef" | "conversationEpochRef" | "saveLockRef" | "sendLockRef" | "draft" | "newController" | "finishController" | "currentConversation" | "patchMessage">, activity: () => AssistantActivity, decide: (message: Message, decision: "approve" | "cancel") => Promise<boolean | undefined>) {
  const { messages, setMessages, conversationId, outbox, setOutbox, outboxRef, messagesRef, input, setInput, categories, members, loadError, isInitializing, sending, setSending, actionPending, actionPendingRef, savingId, images, setImages, confirmations, undos, followReplyRef, composerRef, conversationEpochRef, saveLockRef, sendLockRef, draft, newController, finishController, currentConversation, patchMessage } = session;
  const [tasks, setTasks] = useState<AssistantTask[]>([]);
  const [tasksReady, setTasksReady] = useState(false);
  const [taskConnectionError, setTaskConnectionError] = useState("");
  const taskSubscriptionRef = useRef<ReturnType<typeof subscribeAssistantTasks> | null>(null);
  const submittingTasksRef = useRef(new Set<string>());
  const resumingAgentsRef = useRef(new Set<string>());
  const knownTasksRef = useRef<AssistantTask[]>([]);
  function acceptTasks(received: AssistantTask[], completeSnapshot = false) {
    if (!conversationId) return;
    const valid = reconcileAssistantTaskSnapshots(knownTasksRef.current, received.filter(task => task.conversation_id === conversationId));
    knownTasksRef.current = valid;
    setTasks(valid);
    setMessages(current => {
      const merged = mergeAssistantTasks(current, valid, conversationId, members, categories);
      if (!completeSnapshot) return merged;
      const recovered = merged.map(message => message.role === "user" && message.taskId && !valid.some(task => task.id === message.taskId)
        && !submittingTasksRef.current.has(message.taskId) && !merged.some(reply => reply.id === message.taskId && reply.taskApplied)
        && message.taskStatus !== "missing"
        ? { ...message, taskStatus: "missing" as const, incomplete: "interrupted" as const, error: "消息未发送完成，请重试发送。" } : message);
      return recovered.some((message, index) => message !== merged[index]) ? recovered : merged;
    });
    if (outboxRef.current && valid.some(task => task.user_message_id === outboxRef.current!.user_message_id && task.conversation_id === outboxRef.current!.conversation_id || task.id === outboxRef.current!.id && !outboxRef.current!.continuation)) { outboxRef.current = null; setOutbox(null); }
    setTaskConnectionError(""); setTasksReady(true);
  }

  const handleTaskSnapshot = useEffectEvent((snapshot: AssistantTask[]) => acceptTasks(snapshot, true));
  const handleTaskError = useEffectEvent((error: Error) => {
    setTasksReady(true);
    setTaskConnectionError(error instanceof AssistantTaskRequestError && error.status === 401
      ? "登录状态已失效，请重新登录后恢复结果。" : "暂时无法获取处理进度，正在重新连接。已提交的任务会继续处理。");
    setMessages(current => current.map(message => message.taskStatus === "submitting" && !submittingTasksRef.current.has(message.taskId || "")
      ? { ...message, taskStatus: "missing", error: "发送结果暂未确认，重试会先核对原任务。" } : message));
  });
  const draftChecking = draft.status === "checking";
  useEffect(() => {
    if (!conversationId || draftChecking || isInitializing || loadError) return;
    const epoch = conversationEpochRef.current;
    const subscription = subscribeAssistantTasks({
      conversationId,
      needsInput: task => !messagesRef.current.some(message => message.id === task.user_message_id),
      onTasks: snapshot => { if (currentConversation(epoch)) handleTaskSnapshot(snapshot); },
      onError: error => { if (currentConversation(epoch)) handleTaskError(error); },
    });
    taskSubscriptionRef.current = subscription;
    const refresh = () => { if (document.visibilityState !== "hidden") subscription.refresh(); };
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh); document.addEventListener("visibilitychange", refresh);
    return () => {
      subscription.stop();
      if (taskSubscriptionRef.current === subscription) taskSubscriptionRef.current = null;
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh);
    };
  }, [conversationId, draftChecking, isInitializing, loadError, conversationEpochRef, currentConversation, messagesRef]);

  async function submitTask(request: AssistantTaskRequest) {
    if (!conversationId || request.conversation_id !== conversationId) return;
    const epoch = conversationEpochRef.current;
    const controller = newController();
    submittingTasksRef.current.add(request.id);
    sendLockRef.current = true; followReplyRef.current = true; setSending(true);
    try {
      const { task } = await assistantTaskJson<{ task: AssistantTask }>(await fetch("/api/assistant/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify(request),
      }));
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      acceptTasks([task]);
    } catch (error) {
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      // A lost acknowledgement must be reconciled before another submission.
      try {
        const { task } = await assistantTaskJson<{ task: AssistantTask }>(await fetch(`/api/assistant/tasks/${request.id}`, { cache: "no-store", signal: controller.signal }));
        if (!currentConversation(epoch) || controller.signal.aborted) return;
        if (request.continuation && task.user_message_id !== request.user_message_id) throw new Error("回答发送结果尚未确认，请重试原回答。");
        acceptTasks([task]);
      } catch (lookupError) {
        if (!currentConversation(epoch) || controller.signal.aborted) return;
        const missing = lookupError instanceof AssistantTaskRequestError && lookupError.status === 404;
        patchMessage(request.user_message_id, {
          taskStatus: "missing", incomplete: "interrupted", error: missing
            ? error instanceof Error ? error.message : "消息未发送完成，请重试发送。"
            : "发送结果暂未确认，重试会先核对原任务。"
        });
      }
    } finally {
      submittingTasksRef.current.delete(request.id); finishController(controller);
      if (currentConversation(epoch)) { sendLockRef.current = false; setSending(false); taskSubscriptionRef.current?.refresh(); }
    }
  }

  async function continueAgentCheckpoint(task: AssistantTask, settled?: AssistantActionResult) {
    const agent = restoreAssistantAgent(task.agent || task.result?.agent);
    if (!assistantAgentWaiting(task) || !agent || messagesRef.current.some(m => m.id === (agent.output_id || task.id) && (assistantCardTarget(m) || m.replacementBlocked))) return;
    const key = `${task.id}:${task.attempt}:${agent.pending_action_id || agent.pending_batch_id}`;
    if (resumingAgentsRef.current.has(key)) return;
    resumingAgentsRef.current.add(key);
    const epoch = conversationEpochRef.current;
    const controller = newController();
    let dispatched = false;
    try {
      if (agent.pending_batch_id) {
        const { task: resumed } = await resumeAssistantAgentTask(task, fetch, controller.signal);
        if (!currentConversation(epoch) || controller.signal.aborted) return;
        dispatched = resumed.attempt > task.attempt || !assistantAgentWaiting(resumed);
        acceptTasks([resumed]);
        return;
      }
      const result = settled || await responseJson(await fetch(`/api/assistant/actions/${agent.pending_action_id}`, { cache: "no-store", signal: controller.signal })) as AssistantActionResult;
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      if (result.id !== agent.pending_action_id || (!assistantAgentActionSettled(result) && !result.replacement_approval)) return;
      patchMessage(agent.output_id || task.id, result.replacement_approval
        ? { approval: result.replacement_approval, actionResult: { ...result, status: "pending" }, actionPreview: result.replacement_approval.preview, text: result.replacement_approval.summary, error: undefined }
        : { actionResult: result, actionPreview: result.preview || task.result?.approval?.preview, approval: undefined, error: undefined });
      // The server verifies the stored action outcome before continuing this ID.
      const { task: resumed } = await resumeAssistantAgentTask(task, fetch, controller.signal);
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      dispatched = resumed.attempt > task.attempt || !assistantAgentWaiting(resumed)
        || restoreAssistantAgent(resumed.agent || resumed.result?.agent)?.pending_action_id !== agent.pending_action_id;
      acceptTasks([resumed]);
    } catch (error) {
      if (currentConversation(epoch) && !controller.signal.aborted) patchMessage(agent.output_id || task.id, { error: error instanceof Error ? error.message : "任务暂未继续，正在核对原操作结果。" });
    } finally {
      resumingAgentsRef.current.delete(key); finishController(controller);
      if (dispatched && currentConversation(epoch)) taskSubscriptionRef.current?.refresh();
    }
  }

  async function deliverAgentCheckpoint(task: AssistantTask, delivered?: Message) {
    const agent = restoreAssistantAgent(task.agent || task.result?.agent);
    const output = delivered || messagesRef.current.find(message => message.id === agent?.output_id);
    if (!agent?.awaiting_delivery || !agent.output_id || !output?.taskApplied || !output.delivery || output.delivery.status === "waiting" || output.undoChoice || output.clearChoice || output.confirmChoice || output.memberChoice) return;
    const key = `delivery:${task.id}:${task.attempt}:${agent.output_id}`;
    if (resumingAgentsRef.current.has(key)) return;
    resumingAgentsRef.current.add(key);
    const controller = newController();
    const epoch = conversationEpochRef.current;
    const latest = [...messagesRef.current].reverse().find(message => message.drafts?.length);
    const batchRows = latest?.drafts?.filter(row => !row.ignored && !row.softRemoved).map(({ amount, ...row }) => ({ ...row, amount_cents: Math.round(Number(amount) * 100) })) || [];
    try {
      const ok = output.delivery.status === "succeeded";
      const request: AssistantTaskRequest = {
        id: task.id, conversation_id: task.conversation_id, user_message_id: task.user_message_id,
        message: "继续原任务", display_text: "继续原任务", today: localCalendarDate(),
        continuation: { attempt: task.attempt, output_id: agent.output_id, kind: "delivery", ok },
        draft_batch: latest?.status === "pending" && batchRows.length ? { batch_id: latest.id, status: "pending", drafts: batchRows } : null,
        saved_batch: latest?.status === "saved" && batchRows.length ? { batch_id: latest.id, status: "saved", drafts: batchRows } : null,
        record_contexts: messagesRef.current.flatMap(message => message.ledgerContext ? [message.ledgerContext] : []).slice(-3),
      };
      const { task: resumed } = await assistantTaskJson<{ task: AssistantTask }>(await fetch("/api/assistant/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify(request),
      }));
      if (currentConversation(epoch) && !controller.signal.aborted) { acceptTasks([resumed]); taskSubscriptionRef.current?.refresh(); }
    } catch (error) {
      if (currentConversation(epoch) && !controller.signal.aborted) patchMessage(agent.output_id, { error: error instanceof Error ? error.message : "任务接续失败，请重试。" });
    } finally { resumingAgentsRef.current.delete(key); finishController(controller); }
  }

  async function applyAgentControl(task: AssistantTask) {
    const agent = restoreAssistantAgent(task.agent || task.result?.agent);
    const output = messagesRef.current.find(message => message.id === agent?.output_id);
    const control = output?.control;
    if (!output || !control || output.delivery?.status !== "waiting") return;
    const key = `control:${task.id}:${task.attempt}:${output.id}`;
    if (resumingAgentsRef.current.has(key)) return;
    resumingAgentsRef.current.add(key);
    const epoch = conversationEpochRef.current;
    const controller = newController();
    try {
      if (control.target_type !== "card") {
        const result: AssistantActionResult = await responseJson(await fetch(`/api/assistant/tasks/${task.id}/control`, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ attempt: task.attempt, output_id: output.id }),
        }));
        if (!currentConversation(epoch) || controller.signal.aborted) return;
        const target = messagesRef.current.find(message => (message.approval?.id || message.actionResult?.id) === result.id);
        if (target) patchMessage(target.id, {
          actionResult: result, text: result.replacement_approval?.summary || result.text,
          approval: result.replacement_approval || (["succeeded", "failed", "cancelled", "expired"].includes(result.status) ? undefined : target.approval),
          actionPreview: result.preview || target.actionPreview, ...(result.event_context ? { eventContext: result.event_context } : {})
        });
        if (result.transaction_updates?.length) setMessages(current => syncSavedTransactionCards(current, result.transaction_updates!));
        patchMessage(output.id, { text: result.text, control: undefined, delivery: { action: "control", status: "succeeded" } });
        return;
      }
      const userMessage = task.input?.message || messagesRef.current.find(message => message.id === task.user_message_id)?.text;
      const contexts = await assistantCardControlContexts(messagesRef.current);
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      validateAssistantControl(control, contexts, userMessage || "");
      const target = messagesRef.current.find(message => message.id === control.target_id)!;
      if (control.decision === "status") {
        patchMessage(output.id, { text: "该卡片仍在等待确认，尚未执行。", control: undefined, delivery: { action: "control", status: "succeeded" } });
      } else {
        const consumed = messagesRef.current.map(message => message.id === output.id ? { ...message, control: undefined, delivery: { action: "control" as const, status: "failed" as const } } : message);
        if (!draft.persist({ conversationId: conversationId || undefined, messages: consumed, input, images, confirmations, undos, outbox })) throw new Error("无法保存本机决定，本次尚未执行。");
        messagesRef.current = consumed; setMessages(consumed);
        const applied = await decide(target, control.decision);
        patchMessage(output.id, { text: "请查看原卡片上的处理结果。", delivery: { action: "control", status: applied ? "succeeded" : "failed" } });
      }
    } catch (error) {
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      patchMessage(output.id, { control: undefined, text: error instanceof Error ? error.message : "原卡片未处理，请重新核对。", delivery: { action: "control", status: "failed" } });
    } finally { resumingAgentsRef.current.delete(key); finishController(controller); }
  }

  const recoverAgentCheckpoints = useEffectEvent(() => {
    if (saveLockRef.current || sendLockRef.current || actionPendingRef.current) return;
    for (const task of knownTasksRef.current) {
      if (assistantAgentWaiting(task)) void continueAgentCheckpoint(task);
      else if (task.status === "succeeded" && task.result?.control && !task.result.control_result && messagesRef.current.some(message => message.id === restoreAssistantAgent(task.agent || task.result?.agent)?.output_id && message.control && message.delivery?.status === "waiting")) void applyAgentControl(task);
      else if (task.status === "succeeded" && restoreAssistantAgent(task.agent || task.result?.agent)?.awaiting_delivery) void deliverAgentCheckpoint(task);
    }
  });
  useEffect(() => { recoverAgentCheckpoints(); }, [tasks, messages, sending, savingId, actionPending]);

  async function retryTask(message: Message) {
    if (activity().requestBusy || sendLockRef.current || saveLockRef.current || !conversationId) return;
    const taskId = message.taskId;
    if (!taskId) {
      const source = message.role === "user" ? message : [...messages.slice(0, messages.findIndex(item => item.id === message.id))].reverse().find(item => item.role === "user");
      if (!source) return;
      setInput(source.text); setImages(source.images || []); composerRef.current?.focus();
      if (source.images?.length) toast.info("已恢复截图预览，请核对清晰度后重新发送；可重新选择原图。");
      return;
    }
    const epoch = conversationEpochRef.current;
    const controller = newController();
    sendLockRef.current = true; setSending(true);
    try {
      let task: AssistantTask;
      try {
        ({ task } = await assistantTaskJson<{ task: AssistantTask }>(await fetch(`/api/assistant/tasks/${taskId}`, { cache: "no-store", signal: controller.signal })));
      } catch (error) {
        if (!(error instanceof AssistantTaskRequestError) || error.status !== 404) throw error;
        const request = outboxRef.current;
        if (request?.id !== taskId) throw new Error("原请求已不可恢复，请重新选择原截图或重新输入后发送。");
        if (!currentConversation(epoch) || controller.signal.aborted) return;
        await submitTask(request);
        return;
      }
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      const pendingDelivery = restoreAssistantAgent(task.agent || task.result?.agent);
      if (pendingDelivery?.awaiting_delivery && pendingDelivery.output_id) {
        patchMessage(pendingDelivery.output_id, { error: undefined });
        messagesRef.current = messagesRef.current.map(item => item.id === pendingDelivery.output_id ? { ...item, error: undefined } : item);
        await deliverAgentCheckpoint(task); return;
      }
      if (task.status === "failed" || task.status === "cancelled" || pendingDelivery?.status === "interrupted" || pendingDelivery?.status === "stopped" && pendingDelivery.awaiting_answer) {
        ({ task } = await assistantTaskJson<{ task: AssistantTask }>(await fetch(`/api/assistant/tasks/${taskId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "retry", attempt: task.attempt }),
        })));
      }
      if (currentConversation(epoch) && !controller.signal.aborted) acceptTasks([task]);
    } catch (error) { if (currentConversation(epoch) && !controller.signal.aborted) toast.error(error instanceof Error ? error.message : "重试失败，请稍后再试。"); }
    finally { finishController(controller); if (currentConversation(epoch)) { sendLockRef.current = false; setSending(false); taskSubscriptionRef.current?.refresh(); } }
  }

  async function stopTask(taskId = activity().activeTaskId) {
    if (!taskId || !conversationId || sendLockRef.current || saveLockRef.current) return;
    const epoch = conversationEpochRef.current;
    const controller = newController();
    try {
      const current = knownTasksRef.current.find(task => task.id === taskId) || (await assistantTaskJson<{ task: AssistantTask }>(await fetch(`/api/assistant/tasks/${taskId}`, { cache: "no-store", signal: controller.signal }))).task;
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      const { task } = await cancelAssistantTaskCheckpoint(current, fetch, controller.signal);
      if (currentConversation(epoch) && !controller.signal.aborted) acceptTasks([task]);
    } catch (error) { if (currentConversation(epoch) && !controller.signal.aborted) toast.error(error instanceof Error ? error.message : "停止失败，请重试。"); }
    finally { finishController(controller); }
  }

  function resetTasks() {
    taskSubscriptionRef.current?.stop(); submittingTasksRef.current.clear();
    knownTasksRef.current = []; setTasks([]); setTasksReady(false); setTaskConnectionError("");
  }

  return { tasks, tasksReady, taskConnectionError, taskSubscriptionRef, knownTasksRef, submitTask, continueAgentCheckpoint, deliverAgentCheckpoint, retryTask, stopTask, resetTasks };
}

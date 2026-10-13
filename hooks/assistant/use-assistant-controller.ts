"use client";

import { toast } from "@/hooks/use-toast";
import { assistantProcessFromTask } from "@/lib/assistant-process";
import { assistantImageProgressText, assistantMemberChoiceTarget as memberChoiceTarget, restoreAssistantAgent, restoreAssistantApprovalHistory, type AssistantConversationMessage as Message } from "@/lib/assistant-task-client";
import { assistantTaskActive, type AssistantTask } from "@/lib/assistant-task-types";
import { useAssistantActions } from "./use-assistant-actions";
import { useAssistantFeed } from "./use-assistant-feed";
import { useAssistantInput } from "./use-assistant-input";
import { useAssistantSend } from "./use-assistant-send";
import { useAssistantSession } from "./use-assistant-session";
import { useAssistantTasks } from "./use-assistant-tasks";

export type AssistantActivity = { busy: boolean; requestBusy: boolean; taskBusy: boolean; recoveringTasks: boolean; activeTaskId?: string; activeTask?: AssistantTask; imageProgressText: string | null };

export function useAssistantController() {
  const session = useAssistantSession(resetModules);
  const taskRuntime = useAssistantTasks(session, getActivity, decideAction);
  const media = useAssistantInput(session, getActivity);
  const { messages, conversationId, sending, outbox, draft, actionPending, savingId, input, setInput, composerRef, confirmations } = session;
  const { tasks, tasksReady } = taskRuntime;
  const activeTask = tasks.find(assistantTaskActive);
  const storedActiveMessage = messages.find(message => message.role === "user" && (message.taskStatus === "queued" || message.taskStatus === "running"));
  const activeTaskId = activeTask?.id || storedActiveMessage?.taskId;
  const taskBusy = !!activeTaskId;
  const recoveringTasks = !!conversationId && !tasksReady;
  const activeImageProgress = activeTask?.image_progress || (recoveringTasks ? storedActiveMessage?.image_progress : null);
  const imageProgressText = activeImageProgress ? assistantImageProgressText(activeImageProgress,
    recoveringTasks ? "recovering" : activeTask?.status || "running") : null;
  const requestBusy = sending || taskBusy || recoveringTasks || media.transcribing || media.voiceBusy || media.preparingImage;
  const busy = requestBusy || !!outbox;
  const activity: AssistantActivity = { busy, requestBusy, taskBusy, recoveringTasks, activeTaskId, activeTask, imageProgressText };
  const actions = useAssistantActions(session, taskRuntime, getActivity);
  const sender = useAssistantSend(session, taskRuntime, getActivity);
  const feedView = useAssistantFeed(session, actions.validationTarget, activity);
  const composerDisabled = !!actionPending || busy || draft.hasDraft || draft.status === "checking" || savingId !== null;
  // These callbacks run from events/effects, after all feature hooks have been composed.
  function resetModules(kind: "clear" | "logout") {
    taskRuntime.resetTasks(); media.resetInput(kind); actions.resetActions(kind);
  }
  function getActivity(): AssistantActivity { return activity; }
  function decideAction(message: Message, decision: "approve" | "cancel"): Promise<boolean | undefined> {
    return actions.decideConversationAction(message, decision);
  }
  function fillQuickPrompt(prompt: string) {
    if (composerDisabled) return;
    const next = input.trim() ? `${input}\n${prompt}` : prompt;
    if (next.length > 4000) { toast.info("输入内容过长，请先整理后再添加快捷提问。"); return; }
    setInput(next); media.setQuickToolsOpen(false); composerRef.current?.focus();
  }
  const activeMemberChoice = [...messages].reverse().find(m => m.memberChoice && memberChoiceTarget(m.memberChoice, messages));
  const detachedConfirmations = confirmations.filter(c => !messages.some(m => m.id === c.id && m.status === "pending" && m.commit));
  // The provisional reply uses the final task ID and the same message subtree,
  // so finishing a reply updates it in place instead of removing/recreating it.
  const activeOutputId = activeTask ? restoreAssistantAgent(activeTask.agent || activeTask.result?.agent)?.output_id || activeTask.id : undefined;
  const streamingMessage: Message | null = activeTask && !messages.some(message => message.id === activeOutputId)
    ? { id: activeOutputId!, role: "assistant", taskId: activeTask.id, text: activeTask.text || "", agent: restoreAssistantAgent(activeTask.agent || activeTask.result?.agent), approvalHistory: restoreAssistantApprovalHistory(activeTask.approval_history), process: assistantProcessFromTask(activeTask) } : null;
  const displayMessages = streamingMessage ? messages.flatMap(message => message.id === activeTask!.user_message_id ? [message, streamingMessage] : [message]) : messages;
  function downloadExport(message: Message) {
    if (!message.exportFile) return;
    const url = URL.createObjectURL(new Blob([message.exportFile.csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = message.exportFile.name; link.click(); URL.revokeObjectURL(url);
  }

  const unresolved = messages.filter(m => m.status === "pending").reduce((n, m) => n + (m.drafts?.filter(d => !d.ignored && !d.softRemoved).length || 0), 0);
  return { ...session, ...taskRuntime, ...media, ...actions, ...sender, ...feedView, ...activity, composerDisabled, fillQuickPrompt, activeMemberChoice, detachedConfirmations, streamingMessage, displayMessages, downloadExport, unresolved, draftChecking: draft.status === "checking" };
}
export type AssistantController = ReturnType<typeof useAssistantController>;

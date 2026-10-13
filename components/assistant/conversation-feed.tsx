"use client";

import { Button } from "@/components/ui/button";
import type { AssistantController } from "@/hooks/assistant/use-assistant-controller";
import { cn } from "@/lib/utils";
import { ArrowUp, Loader2 } from "lucide-react";
import { buttonClass, capabilitiesPrompt, contentWidthClass } from "./page-styles";

import { AssistantConversationMessage } from "./conversation-message";

type Props = { assistant: Pick<AssistantController, "messages" | "sending" | "feedRef" | "followReplyRef" | "liveRef" | "taskBusy" | "recoveringTasks" | "imageProgressText" | "composerDisabled" | "fillQuickPrompt" | "streamingMessage" | "displayMessages" | "setMessages" | "input" | "setInput" | "categories" | "members" | "configured" | "loadError" | "isInitializing" | "actionPending" | "actionPendingRef" | "savingId" | "images" | "undos" | "composerRef" | "saveLockRef" | "sendLockRef" | "draft" | "reloadSetup" | "patchMessage" | "taskConnectionError" | "knownTasksRef" | "deliverAgentCheckpoint" | "retryTask" | "stopTask" | "setPreviewImage" | "expandedDrafts" | "setExpandedDrafts" | "decideConversationAction" | "chooseMember" | "selectReplacementMember" | "confirm" | "undoSaved" | "updateDraft" | "cycleDraftSort" | "deleteDrafts" | "send" | "highlightedCard" | "jumpToDraftCard" | "busy" | "requestBusy" | "activeTaskId" | "activeMemberChoice" | "downloadExport" | "draftChecking"> };

export function AssistantConversationFeed({ assistant }: Props) {
  const { messages, sending, feedRef, followReplyRef, taskBusy, recoveringTasks, imageProgressText, composerDisabled, fillQuickPrompt, streamingMessage, displayMessages } = assistant;
  return <div ref={feedRef} onScroll={event => { const element = event.currentTarget; followReplyRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable_both-edges] [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]" aria-live="polite" aria-relevant="additions text">
    <div className={contentWidthClass}>
      {!messages.length && <div className="mx-auto mt-[clamp(16px,6dvh,60px)] mb-7 w-full max-w-[380px]">
        <span className="text-[12px] font-medium text-primary">你的日常账本</span>
        <h2 className="mt-2.5 text-[25px] leading-[1.4] font-[650] tracking-[-0.8px] [@media(max-width:360px)]:text-[23px]">今天的钱，花到哪了？</h2>
        <p className="mt-3 mb-[26px] text-[13px] leading-[1.8] text-muted-foreground">用文字、语音或截图记录收支，<br />我来整理，你来确认。</p>
        <Button type="button" variant="ghost" className={cn(buttonClass, "mt-2.5 flex w-full items-center justify-between gap-3 rounded-[14px] border border-border bg-card px-4 py-3.5 text-left text-[13px] hover:border-primary")} disabled={composerDisabled} onClick={() => fillQuickPrompt("这个月主要花在哪些分类？")}><span className="min-w-0"><span className="mb-[5px] block text-[11px] text-muted-foreground">看看消费情况</span><span>这个月主要花在哪些分类？</span></span><ArrowUp size={16} className="shrink-0 text-muted-foreground" /></Button>
        <Button type="button" variant="ghost" className={cn(buttonClass, "mt-2.5 flex w-full items-center justify-between gap-3 rounded-[14px] border border-border bg-card px-4 py-3.5 text-left text-[13px] hover:border-primary")} disabled={composerDisabled} onClick={() => fillQuickPrompt(capabilitiesPrompt)}><span className="min-w-0"><span className="mb-[5px] block text-[11px] text-muted-foreground">了解账本助手</span><span>你可以做什么？</span></span><ArrowUp size={16} className="shrink-0 text-muted-foreground" /></Button>
      </div>}
      {displayMessages.map(message => <AssistantConversationMessage key={message.id} message={message} assistant={assistant} />)}
      {/* Contain the rotating SVG so its transformed bounds cannot change the feedRef's scrollHeight. */}
      <div className="min-h-5" data-reply-status>{!streamingMessage && (sending || taskBusy || recoveringTasks) && <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground" role="status"><span className="grid size-5 shrink-0 place-items-center overflow-hidden" aria-hidden="true"><Loader2 size={17} className="animate-spin" /></span>{imageProgressText || (recoveringTasks ? "正在恢复处理进度…" : sending && !taskBusy ? "正在发送…" : "正在整理…")}</div>}</div>
    </div>
  </div>;
}

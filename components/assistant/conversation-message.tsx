"use client";

import { AssistantActionCard, AssistantActionControls } from "@/components/assistant/action-card";
import { AssistantAgentTaskStatus } from "@/components/assistant/agent-task-status";
import { AssistantDraftCard, AssistantDraftRow } from "@/components/assistant/draft-card";
import { AssistantDraftMatchCard } from "@/components/assistant/draft-match-card";
import { AssistantReadResultCards } from "@/components/assistant/read-result-cards";
import { AssistantMemberPicker } from "@/components/assistant/member-picker";
import { AssistantProcessingDetails } from "@/components/assistant/processing-details";
import { assistantChoiceClass, AssistantReplyCard, AssistantReplyNotice, AssistantReplyShell } from "@/components/assistant/reply-primitives";
import { Button } from "@/components/ui/button";
import { markdownTableComponents } from "@/components/ui/markdown-table";
import type { AssistantController } from "@/hooks/assistant/use-assistant-controller";
import { memberBatchQuestionText, unassignedMemberDrafts } from "@/lib/assistant";
import { eventActionPreview, summaryActionPreview, withoutApprovalExpiry } from "@/lib/assistant-action-preview";
import { assistantCardTarget } from "@/lib/assistant-card-updates";
import { invalidDraftFields, money } from "@/lib/assistant-draft-editor";
import { assistantDraftSort, sortedAssistantDrafts } from "@/lib/assistant-draft-sort";
import { draftReplyView, recordReplyView, resultReplyView } from "@/lib/assistant-reply-view";
import { assistantAgentActionSettled, assistantDraftMatchTarget, assistantImageProgressText, assistantTaskRetryLabel, assistantMemberChoiceTarget as memberChoiceTarget, resolveAssistantDraftMatch, toggleAssistantDraftRemoval, type AssistantConversationMessage as Message } from "@/lib/assistant-task-client";
import { eventCashflowCents, eventKinds, eventType, ledgerEventMemberChoices } from "@/lib/ledger-event";
import { cn } from "@/lib/utils";
import { ArrowDown, Check, Loader2, Search, Trash2, Undo2 } from "lucide-react";
import NextImage from "next/image";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { bubbleClass, buttonClass } from "./page-styles";

import { AssistantDraftEditor } from "./draft-editor";

type Props = { message: Message; assistant: Pick<AssistantController, "messages" | "setMessages" | "setInput" | "categories" | "members" | "configured" | "loadError" | "isInitializing" | "sending" | "actionPending" | "actionPendingRef" | "savingId" | "undos" | "composerRef" | "saveLockRef" | "sendLockRef" | "draft" | "reloadSetup" | "patchMessage" | "taskConnectionError" | "knownTasksRef" | "deliverAgentCheckpoint" | "retryTask" | "stopTask" | "setPreviewImage" | "expandedDrafts" | "setExpandedDrafts" | "decideConversationAction" | "chooseMember" | "selectReplacementMember" | "confirm" | "undoSaved" | "updateDraft" | "cycleDraftSort" | "deleteDrafts" | "send" | "highlightedCard" | "jumpToDraftCard" | "busy" | "requestBusy" | "activeTaskId" | "composerDisabled" | "activeMemberChoice" | "streamingMessage" | "downloadExport" | "draftChecking"> };

export function AssistantConversationMessage({ assistant, message }: Props) {
  const { messages, setMessages, setInput, categories, members, configured, loadError, isInitializing, sending, actionPending, actionPendingRef, savingId, undos, composerRef, saveLockRef, sendLockRef, draft, reloadSetup, patchMessage, taskConnectionError, knownTasksRef, deliverAgentCheckpoint, retryTask, stopTask, setPreviewImage, expandedDrafts, setExpandedDrafts, decideConversationAction, chooseMember, selectReplacementMember, confirm, undoSaved, updateDraft, cycleDraftSort, deleteDrafts, send, highlightedCard, jumpToDraftCard, busy, requestBusy, activeTaskId, composerDisabled, activeMemberChoice, streamingMessage, downloadExport, draftChecking } = assistant;
  const cardTarget = assistantCardTarget(message);
  if (cardTarget) {
    const target = messages.find(item => item.id === cardTarget && item.role === "assistant" && !assistantCardTarget(item));
    return <div key={message.id} className="mb-5" data-message-role="assistant" data-message-id={message.id}>
      {!!message.text && <div className={`${bubbleClass} mb-2 text-foreground`}><ReactMarkdown components={markdownTableComponents} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} disallowedElements={["img"]}>{message.text}</ReactMarkdown></div>}
      <Button type="button" variant="ghost" className={cn(buttonClass, "gap-2 rounded-xl border border-border bg-muted/35 px-3 py-2.5 text-[13px] text-muted-foreground hover:bg-muted")} disabled={!target}
        onClick={() => jumpToDraftCard(cardTarget)} aria-label="已更新，查看最新卡片">
        <Check size={14} aria-hidden="true" /><span>已更新</span><span className="text-primary">查看最新卡片</span><ArrowDown size={14} aria-hidden="true" />
      </Button>
    </div>;
  }
  const visibleDrafts = sortedAssistantDrafts(message.drafts || [], message.draftSort);
  const activeDrafts = visibleDrafts.filter(d => !d.ignored && !d.softRemoved);
  const sortMode = assistantDraftSort(message.draftSort);
  const replacement = message.id === activeMemberChoice?.id ? memberChoiceTarget(message.memberChoice, messages) : undefined;
  const unassigned = message.memberFlow && message.status === "pending" && !message.commit && activeMemberChoice?.memberChoice?.batch_id !== message.id ? unassignedMemberDrafts(visibleDrafts, members) : [];
  const question = unassigned[0];
  const pendingPhase = actionPending?.id === message.id ? actionPending.phase : undefined;
  const hasAction = !!(message.approval || message.confirmChoice || message.removeChoice || message.clearChoice || message.undoChoice);
  const actionPreview = draftReplyView(message, messages, members, categories) || (message.clearChoice ? { title: "清空当前对话", metrics: [], sections: [], notices: [{ text: message.text, tone: "attention" as const }] } : undefined) || message.actionPreview || message.approval?.preview || (hasAction
    ? message.approval && message.eventContext ? eventActionPreview(message.eventContext.input, message.approval.summary) : summaryActionPreview(message.approval?.summary || message.text)
    : undefined);
  const visibleApprovalHistory = message.approvalHistory?.filter(entry => entry.approval.id !== (message.approval?.id || message.actionResult?.id)
    && !message.taskHistory?.some(output => (output.actionResult?.id || output.approval?.id) === entry.approval.id)
    && !messages.some(other => other.id !== message.id && !assistantCardTarget(other) && (other.approval?.id || other.actionResult?.id) === entry.approval.id));
  const actionControls = (hasAction || pendingPhase) ? <AssistantActionControls pending={pendingPhase} executing={message.actionResult?.status === "executing"} disabled={composerDisabled || messages.some(m => m.cardUpdatedLink === message.id && m.supersededApproval && !m.supersededApproval.settled)}
    approveLabel={message.undoChoice ? `确认撤销 ${message.undoChoice.draft_ids.length} 笔` : message.approval?.preview?.approveLabel} canRead={!!message.approval} onDecide={phase => void decideConversationAction(message, phase === "cancel" ? "cancel" : "approve", phase === "read")}
    error={message.error} resultText={message.actionResult?.status === "pending" ? "尚未执行，等待你的确认。" : message.actionResult?.status === "executing" ? message.actionResult.text : undefined} /> : null;
  const replyView = !actionPreview && (!message.readResults?.length || message.replyView?.kind === "draft_matches") ? message.replyView || (message.ledgerContext ? recordReplyView(message.ledgerContext.resource, message.ledgerContext.rows, undefined, members, categories)
    : message.replyKind ? resultReplyView(message.text)
      : message.navigateTo ? resultReplyView(message.text, "页面入口")
        : message.exportFile ? resultReplyView(message.text, "导出已准备好") : undefined) : undefined;
  const eventMembers = ledgerEventMemberChoices(message.eventContext, message.eventChoices);
  const memberEvent = eventMembers ? message.eventContext!.input : undefined;
  const imageReply = question && message.text !== memberBatchQuestionText(unassigned) && messages.some(input => input.role === "user" && input.taskId === message.id && input.images?.length);
  const questionTotal = unassigned.every(d => /^\d{1,10}(\.\d{1,2})?$/.test(d.amount))
    ? money(unassigned.reduce((sum, d) => sum + Math.round(Number(d.amount) * 100), 0)) : "—";
  const agentSettled = !!message.actionResult && assistantAgentActionSettled(message.actionResult) || message.status === "saved";
  const agentRunning = message.agent?.status === "running" || message.agent?.status === "waiting_approval" && agentSettled;
  const agentStatus = message.agent && <AssistantAgentTaskStatus agent={message.agent} process={agentRunning ? message.process : undefined}
    disconnected={!!taskConnectionError && (message === streamingMessage || message.taskId === activeTaskId)}
    error={!hasAction && !message.drafts?.length && !message.incomplete ? message.error : undefined} settled={agentSettled}
    hasPreview={!!actionPreview || !!message.drafts?.length || !!message.eventChoices?.length}
    disabled={!!actionPending || sending || savingId !== null} onStop={() => void stopTask(message.taskId || message.id)}
    onContinue={() => void retryTask(message)} onEdit={() => { setInput(message.agent!.goal); composerRef.current?.focus(); }} />;
  return <div key={message.id} tabIndex={message.drafts?.length || actionPreview || replyView || message.readResults?.length || message.eventContext ? -1 : undefined} className={cn("mb-5 flex outline-none", message.role === "user" && "justify-end")} data-message-role={message.role} data-message-id={message.id} data-streaming-reply={message === streamingMessage || undefined} aria-busy={message === streamingMessage || undefined}>
    <div className={cn("min-w-0 max-w-full", message.role === "user" && "max-w-[88%]", (question || replacement) && "w-[400px]", (actionPreview || replyView || !!message.readResults?.length || !!message.eventChoices?.length || (!!message.drafts?.length && !question)) && "w-[520px]", highlightedCard === message.id && "rounded-2xl ring-2 ring-primary/40 ring-offset-2 ring-offset-background")}>
      {message.role === "assistant" && agentRunning && agentStatus}
      {message.role === "assistant" && message.process && !message.agent && <AssistantProcessingDetails process={message.process}
        disconnected={!!taskConnectionError && (message === streamingMessage || message.taskId === activeTaskId)} />}
      {message.role === "assistant" && message.agent && !agentRunning && message.process && <AssistantProcessingDetails process={message.process} quiet />}
      {message.role === "assistant" && !!visibleApprovalHistory?.length && <div className="mb-3 space-y-3" aria-label="任务操作记录">{visibleApprovalHistory.map(entry => <AssistantActionCard key={entry.approval.id}
        preview={entry.approval.preview || summaryActionPreview(entry.approval.summary)} status={entry.result?.status || "executing"} resultText={entry.result?.text.split("\n")[0] || "原操作结果待核对。"} />)}</div>}
      {message.role === "assistant" && !!message.taskHistory?.length && <div className="mb-3 space-y-3" aria-label="任务先前结果">{message.taskHistory.map(output => {
        const preview = output.actionPreview || output.approval?.preview;
        const view = output.replyView || (output.drafts?.length ? {
          title: output.status === "saved" ? "已入账账目" : "先前账目", metrics: [], sections: [], notices: [],
          records: (output.savedDrafts || output.drafts).map(draft => ({ title: draft.description || "未填写用途", amount: `¥${(draft.amount_cents / 100).toFixed(2)}`, subtitle: `${draft.transaction_date} · ${draft.type === "income" ? "收入" : "支出"}` }))
        }
          : output.ledgerContext ? recordReplyView(output.ledgerContext.resource, output.ledgerContext.rows, undefined, members, categories) : undefined);
        return <div key={`${output.attempt}:${output.actionResult?.id || output.approval?.id || "reply"}`}>{preview ? <AssistantActionCard preview={preview} status={output.actionResult?.status || "executing"} resultText={output.actionResult?.text.split("\n")[0]} />
          : output.readResults?.length ? <AssistantReadResultCards results={output.readResults} members={members} categories={categories} /> : view ? <AssistantReplyCard preview={view}>{output.analysis && <details><summary className="cursor-pointer text-xs text-primary">查看分析说明</summary><ReactMarkdown components={markdownTableComponents} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} disallowedElements={["img"]}>{output.analysis}</ReactMarkdown></details>}</AssistantReplyCard> : <p className="text-[13px] leading-6 text-muted-foreground whitespace-pre-wrap wrap-anywhere">{withoutApprovalExpiry(output.text)}</p>}
          {output.exportFile && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => downloadExport({ ...message, exportFile: output.exportFile })}>下载 {output.exportFile.name}</Button>}
        </div>;
      })}</div>}

      <div className={cn(bubbleClass, message.role === "user" ? "rounded-[17px_17px_5px_17px] bg-[color-mix(in_srgb,var(--color-primary)_9%,var(--color-background))] px-[15px] py-[11px] text-foreground" : "text-foreground")}>
        {!!message.images?.length && <div className={cn("mb-2 grid gap-2", message.images.length > 1 && "grid-cols-2")} aria-label="已发送的截图">{message.images.map((image, index) => <Button key={index} type="button" variant="ghost" className={cn(buttonClass, "relative block max-w-full overflow-hidden rounded-[10px] hover:bg-transparent")} aria-label={`查看第 ${index + 1} 张图片：${image.name}`} onClick={() => setPreviewImage(image)}><NextImage src={image.data} alt={image.name} width={240} height={240} unoptimized className="h-auto max-h-[260px] w-auto max-w-full object-contain" /></Button>)}</div>}
        {!actionPreview && !replyView && (!message.readResults?.length || message.agent?.status !== "completed" || message.agent.operations?.some(operation => operation.effect !== "read")) && (!message.eventChoices?.length || eventMembers) && <ReactMarkdown components={markdownTableComponents} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} disallowedElements={["img"]}>{question ? `${imageReply ? `${message.text}\n\n` : ""}${memberBatchQuestionText(unassigned)}` : withoutApprovalExpiry(message.text)}</ReactMarkdown>}
      </div>
      {message.incomplete && ((message.role === "assistant") || (!message.taskId && message.role === "user") || message.taskStatus === "missing") && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status">
        <AssistantReplyNotice tone={message.incomplete === "stopped" ? "info" : "error"}>{message.error || (message.incomplete === "stopped" ? "已停止生成" : "上次处理未完成")}</AssistantReplyNotice>
        {message.image_progress && (message.taskStatus === "failed" || message.taskStatus === "cancelled") && <span>{assistantImageProgressText(message.image_progress, message.taskStatus)}</span>}
        <Button type="button" variant="ghost" className={cn(buttonClass, "text-xs text-primary underline")} disabled={requestBusy || savingId !== null || draft.hasDraft || draftChecking} onClick={() => void retryTask(message)}>{assistantTaskRetryLabel(message)}</Button>
      </div>}
      {message.analysis && !replyView?.analysis && <div className="mt-3 text-[13px] leading-6 text-muted-foreground" aria-label="分析说明">
        <p className="mb-1 text-xs">分析说明</p>
        <ReactMarkdown components={markdownTableComponents} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} disallowedElements={["img"]}>{message.analysis}</ReactMarkdown>
      </div>}
      {eventMembers && memberEvent && <AssistantMemberPicker heading={<p className="mb-3 flex items-baseline gap-2 text-[13px]"><span className="min-w-0 wrap-anywhere">{memberEvent.kind ? eventKinds[memberEvent.kind] : "这笔账"}{memberEvent.counterparty ? ` · ${memberEvent.counterparty}` : ""}</span><strong className="ml-auto whitespace-nowrap text-[16px]">¥{eventCashflowCents(memberEvent) === null ? "—" : money(eventCashflowCents(memberEvent)!)}</strong><span className="shrink-0 text-[11px] text-muted-foreground">{memberEvent.kind && eventType(memberEvent.kind) === "income" ? "收入" : "支出"}</span></p>}
        members={members} disabled={composerDisabled} loading={isInitializing} loadError={!!loadError} onReload={reloadSetup}
        onSelect={member => void send(`${memberEvent.kind && eventType(memberEvent.kind) === "income" ? "收入所属人" : "支出人"}是「${member.name}」`, { ...memberEvent, member_id: member.id }, undefined, message.id)}
        footer={<p className="mt-3 text-[11px] text-muted-foreground">点击名字，自动回复；核对后再确认入账</p>} />}
      {!eventMembers && !!message.eventChoices?.length && <AssistantReplyShell label="补充事项信息" title="请选择下一步">
        <div className="space-y-3 p-4"><div className={bubbleClass}><ReactMarkdown components={markdownTableComponents} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} disallowedElements={["img"]}>{message.text}</ReactMarkdown></div>
          <div className="flex flex-col gap-2">{message.eventChoices.map((choice, index) => <Button key={index} type="button" variant="ghost" className={assistantChoiceClass} disabled={composerDisabled} onClick={() => void send(choice.label, choice.input, undefined, message.id)}>{choice.label}</Button>)}</div></div>
      </AssistantReplyShell>}
      {actionPreview ? <AssistantActionCard preview={actionPreview} status={message.actionResult?.status || (message.agent?.status === "stopped" ? "executing" : "pending")} pending={pendingPhase}
        resultText={message.actionResult?.text.split("\n")[0]}
        renderRecordAction={message.removeChoice ? record => record.id && <Button type="button" variant="outline" size="sm" className="h-7 min-h-7 shrink-0 rounded-md px-2 text-[11px]" disabled={composerDisabled || !!savingId || !!pendingPhase}
          onClick={() => {
            if (busy || saveLockRef.current || sendLockRef.current || actionPendingRef.current) return;
            setMessages(current => toggleAssistantDraftRemoval(current, message.id, record.id!));
          }}>{record.excluded ? "恢复" : "不移除"}</Button> : undefined}>{actionControls}</AssistantActionCard> : actionControls}
      {!!message.readResults?.length && <AssistantReadResultCards results={message.readResults} members={members} categories={categories} />}
      {replyView?.kind === "draft_matches" && !replyView.draftComparison ? <AssistantReplyShell label="历史核对结果" title="核对规则已更新">
        <div className="space-y-3 p-4"><AssistantReplyNotice>旧结果仅按金额和日期召回，可能包含无关记录。请按当前草稿重新核对。</AssistantReplyNotice>
          <Button type="button" size="sm" variant="outline" disabled={composerDisabled} onClick={() => void send("重新核对当前草稿是否已经入账，排除仅金额相同的无关记录")}>重新核对</Button></div>
      </AssistantReplyShell> : replyView?.draftComparison ? <AssistantDraftMatchCard preview={replyView} disabled={composerDisabled || !!savingId}
        state={draftId => messages.find(m => m.id === replyView.draftComparison!.batch_id)?.drafts?.find(d => d.id === draftId)?.softRemoved ? "removed" : message.draftMatchDecisions?.[draftId] === "removed" ? "changed" : assistantDraftMatchTarget(messages, message.id, draftId) ? message.draftMatchDecisions?.[draftId] || "pending" : "changed"}
        onReview={() => jumpToDraftCard(replyView.draftComparison!.batch_id)}
        onDecision={(draftId, decision) => {
          if (busy || saveLockRef.current || sendLockRef.current) return;
          setMessages(current => resolveAssistantDraftMatch(current, message.id, draftId, decision));
        }} /> : replyView && <AssistantReplyCard preview={replyView} footer={(message.navigateTo || message.exportFile) ? <>
          {message.navigateTo && <Link href={message.navigateTo} onClick={() => {
            const delivery = { action: "navigate" as const, status: "succeeded" as const };
            patchMessage(message.id, { delivery });
            const task = knownTasksRef.current.find(task => task.id === message.taskId);
            if (task) void deliverAgentCheckpoint(task, { ...message, delivery });
          }} className="inline-flex min-h-9 items-center rounded-xl border border-border px-3 text-sm text-primary hover:bg-muted">打开对应页面</Link>}
          {message.exportFile && <Button type="button" variant="outline" size="sm" className="max-w-full whitespace-normal wrap-anywhere" onClick={() => downloadExport(message)}>下载 {message.exportFile.name}</Button>}
        </> : undefined}>
          {replyView.analysis && <details className="border-t border-border pt-3"><summary className="cursor-pointer text-xs text-primary">查看分析说明</summary><div className={`${bubbleClass} mt-3 text-foreground`}><ReactMarkdown components={markdownTableComponents} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} disallowedElements={["img"]}>{message.analysis || message.text}</ReactMarkdown></div></details>}
        </AssistantReplyCard>}
      {message.importSummary && <div className="w-[520px] max-w-full" aria-label="截图合并结果"><AssistantReplyCard preview={{
        title: "截图识别结果", metrics: [
          { label: "已识别截图", value: `${message.importSummary.image_count} 张` }, { label: "待核对账目", value: `${message.importSummary.retained_count} 笔`, primary: true },
        ], sections: [{ title: "整理结果", rows: [{ label: "衔接去重", value: `${message.importSummary.removed_duplicates} 笔` }, { label: "跳过零金额", value: `${message.importSummary.skipped_zero_amounts || 0} 行` }] }],
        notices: [{ text: "以上为原始识别汇总，当前入账状态以下方账目卡片为准。", tone: "info" }, ...message.importSummary.warnings.map(text => ({ text, tone: "attention" as const }))]
      }} /></div>}
      {replacement && <AssistantMemberPicker label="修改记账成员" heading={<p className="mb-3 flex items-baseline justify-between gap-3 text-[13px]"><span className="min-w-0 wrap-anywhere">{replacement.drafts.length === 1 ? replacement.drafts[0].description || "这笔账" : `修改这 ${replacement.drafts.length} 笔账目的人员`}</span>{replacement.drafts.length === 1 && <strong className="shrink-0 text-[16px]">¥{replacement.drafts[0].amount}</strong>}</p>} members={members} disabled={composerDisabled} loading={isInitializing} loadError={!!loadError}
        onReload={reloadSetup} onSelect={member => void selectReplacementMember(message, member)} footer={<div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground"><span>点击人员，自动回复并更新</span><Button type="button" variant="ghost" className={cn(buttonClass, "shrink-0 py-1 underline")} disabled={composerDisabled} onClick={() => patchMessage(message.id, { memberChoice: undefined })}>取消修改</Button></div>} />}
      {question && <AssistantMemberPicker heading={<p className="mb-3 flex items-baseline gap-2 text-[13px]"><span className="min-w-0 wrap-anywhere">{unassigned.length > 1 ? `${unassigned.length} 笔待选成员` : question.description || "这笔账"}</span><strong className="ml-auto whitespace-nowrap text-[16px]">¥{questionTotal}</strong>{unassigned.length === 1 && <span className="shrink-0 text-[11px] text-muted-foreground">{question.type === "expense" ? "支出" : "收入"}</span>}</p>} members={members} disabled={composerDisabled} loading={isInitializing} loadError={!!loadError}
        onReload={reloadSetup} onSelect={member => void chooseMember(message, member)} footer={<div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[11px] text-muted-foreground"><span>点击名字，自动回复</span><div className="flex flex-wrap gap-3">{unassigned.length === 1 && <Button type="button" variant="ghost" className={cn(buttonClass, "py-[3px] text-xs font-normal text-muted-foreground hover:text-destructive")} disabled={composerDisabled} onClick={() => deleteDrafts(message.id, question.id)}>移除这笔草稿</Button>}{message.drafts!.length > 1 && <Button type="button" variant="ghost" className={cn(buttonClass, "py-[3px] text-xs font-normal text-muted-foreground hover:text-destructive")} disabled={composerDisabled} onClick={() => deleteDrafts(message.id)}>{activeDrafts.length ? "移除本组" : "恢复本组"}</Button>}</div></div>}>
        {unassigned.length > 1 && <p className="mt-2.5 text-[11px] leading-[1.6] text-muted-foreground">选一次应用到这 {unassigned.length} 笔，确认前可逐笔修改。</p>}
        {(unassigned.length > 1 || visibleDrafts.some(d => d.softRemoved)) && <ul className="mt-3.5 grid list-none gap-[9px] p-0" aria-label="待选成员的账目">{visibleDrafts.filter(d => d.softRemoved || unassigned.some(row => row.id === d.id)).map(d => <li key={d.id} className="flex items-center gap-2 text-[12px]">
          <span className={cn("min-w-0 flex-1 wrap-anywhere", d.softRemoved && "text-muted-foreground line-through")}>{d.description.trim() ? d.description : d.type === "expense" ? "支出" : "收入"}<small className="mt-px block text-[10px] text-muted-foreground">{d.transaction_date}</small></span>
          <span className={cn("shrink-0 tabular-nums", d.softRemoved && "text-muted-foreground line-through")}>¥{d.amount}</span>
          <Button type="button" variant="ghost" className={cn(buttonClass, "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-muted hover:text-destructive")} aria-label={d.softRemoved ? "恢复这笔草稿" : "移除这笔草稿"} title={d.softRemoved ? "恢复这笔草稿" : "移除这笔草稿"} disabled={composerDisabled} onClick={() => deleteDrafts(message.id, d.id)}>{d.softRemoved ? <Undo2 size={16} /> : <Trash2 size={16} />}</Button>
        </li>)}</ul>}
        <Button type="button" variant="outline" className="mt-3.5 min-h-10 w-full gap-2 rounded-xl whitespace-normal text-xs" disabled={composerDisabled || !!savingId || configured !== true}
          onClick={() => void send("核对这组待确认账目是否存在重复记录，请逐笔对照已保存账本，只查询，不修改草稿或账本。", undefined, message.id)}><Search size={15} />核对是否存在重复记录</Button>
      </AssistantMemberPicker>}
      {!!message.drafts?.length && !question && <AssistantDraftCard drafts={visibleDrafts} status={message.status}
        pending={savingId === message.id} checking={!!message.commit} error={message.error} sortMode={sortMode}
        sortDisabled={busy || !!savingId || !!actionPending} onSort={() => cycleDraftSort(message.id)} footer={<>
          {message.status === "pending" && <div className="space-y-3"><p className="text-xs leading-5 text-muted-foreground">{message.commit ? "本组结果待核对，请重试原操作。" : "尚未入账，核对后确认。"}</p><div className="flex items-center gap-2 flex-wrap">
            {!message.commit && <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs font-normal text-muted-foreground hover:text-destructive" disabled={!!actionPending || !!savingId || busy} onClick={() => deleteDrafts(message.id)}>{activeDrafts.length ? "移除本组" : "恢复本组"}</Button>}
            {message.commit && <span className="text-xs text-muted-foreground">重试将核对原批次</span>}
            <Button type="button" className="ml-auto min-w-[120px]" disabled={!!actionPending || !!savingId || busy || activeMemberChoice?.memberChoice?.batch_id === message.id || (!message.commit && !activeDrafts.length)} onClick={() => void confirm(message)}>
              {savingId === message.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{savingId === message.id ? "正在确认" : message.commit ? "重试确认" : `确认 ${activeDrafts.length} 笔`}
            </Button>
          </div></div>}
          {message.status === "saved" && <div className="flex items-center flex-wrap gap-2 text-[12px] text-primary"><Check size={16} className="shrink-0" /><span>已记入账本</span><Button type="button" variant="ghost" className="ml-auto h-8 gap-1 px-2 text-[12px] font-normal text-muted-foreground" aria-label="撤销入账" title="撤销本组入账并恢复草稿" disabled={!!actionPending || !!savingId || busy || undos.some(operation => operation.batch_id === message.id)} onClick={() => void undoSaved(message)}>{savingId === message.id ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}{savingId === message.id ? "正在撤销…" : "撤销入账"}</Button><Link className="shrink-0 underline" href="/dashboard">查看记录</Link></div>}
          {message.status === "conflict" && <p className="py-1 text-[12px] text-muted-foreground"><Link href="/dashboard">核对原批次的交易记录</Link></p>}
        </>}>
        {visibleDrafts.map(d => {
          const category = categories.find(c => c.id === d.category_id);
          const member = members.find(m => m.id === d.member_id);
          const locked = message.status !== "pending" || !!message.commit || !!savingId || busy || !!actionPending;
          const canDelete = message.status === "pending" && !message.commit;
          const needsReview = message.status === "pending" && !message.commit && !d.softRemoved;
          const fields = invalidDraftFields(d, categories, members);
          const invalid = {
            amount: needsReview && fields.amount, category: needsReview && fields.category,
            member: needsReview && fields.member, date: needsReview && fields.date
          };
          const needsCompletion = Object.values(invalid).some(Boolean);
          return <AssistantDraftRow key={d.id} draft={d} category={category} member={member} canDelete={canDelete} locked={locked}
            open={!d.softRemoved && (expandedDrafts[d.id] ?? needsCompletion)} onToggle={open => setExpandedDrafts(current => current[d.id] === open ? current : { ...current, [d.id]: open })}
            onDelete={() => deleteDrafts(message.id, d.id)}>
            <AssistantDraftEditor draft={d} invalid={invalid} locked={locked} categories={categories} members={members} onUpdate={update => updateDraft(message.id, d.id, update)} />
          </AssistantDraftRow>;
        })}
      </AssistantDraftCard>}
      {message.role === "assistant" && !agentRunning && !message.incomplete && agentStatus}
    </div>
  </div>;

}

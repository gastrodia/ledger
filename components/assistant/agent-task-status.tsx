"use client";

import { Loader2 } from "lucide-react";
import type { AssistantPlan } from "@/lib/assistant";
import type { AssistantProcess } from "@/lib/assistant-process";
import { Button } from "@/components/ui/button";
import { AssistantProcessingDetails } from "@/components/assistant/processing-details";

/** Only show state that helps the user act; the reply and preview own the result. */
export function AssistantAgentTaskStatus({ agent, process, disconnected, disabled, onStop, onEdit, error, settled, hasPreview, onContinue }: {
  agent: NonNullable<AssistantPlan["agent"]>; process?: AssistantProcess; disconnected?: boolean;
  disabled?: boolean; onStop: () => void; onEdit: () => void; error?: string; settled?: boolean; hasPreview?: boolean; onContinue?: () => void;
}) {
  const continuing = agent.status === "waiting_approval" && settled;
  const running = agent.status === "running" || continuing;
  const waiting = agent.status === "waiting_approval" && !settled;
  const stopped = agent.status === "stopped";
  const interrupted = agent.status === "interrupted";
  const pausedQuestion = stopped && agent.awaiting_answer;
  const needsInput = (agent.status === "needs_input" || stopped) && agent.awaiting_answer;
  const operations = agent.operations;
  if (!running && !waiting && !stopped && !needsInput && !interrupted && !error && !operations?.length) return null;

  return <div className={`${running ? "mb-2" : "mt-2"} max-w-full text-xs leading-5 text-muted-foreground`} data-assistant-agent-status>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 [&>[data-assistant-process]]:mb-0">
      {running && (process ? <AssistantProcessingDetails process={process} disconnected={disconnected} summaryLabel={continuing ? "正在继续核对…" : undefined} />
        : <span className="inline-flex items-center gap-2" role="status"><span className="grid size-4 shrink-0 place-items-center overflow-hidden" aria-hidden="true"><Loader2 size={12} className="animate-spin motion-reduce:animate-none" /></span>{disconnected ? "正在重新连接…" : continuing ? "正在继续核对…" : "正在处理…"}</span>)}
      {waiting && !hasPreview && <span role="status">等待你的确认</span>}
      {needsInput && <span role="status">请回答上面的问题，随后继续原任务</span>}
      {interrupted && <span role="status">处理暂时中断，原任务进度已保留</span>}
      {interrupted && agent.steps < 192 && onContinue && <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={disabled} onClick={onContinue}>继续处理</Button>}
      {stopped && !pausedQuestion && <span role="status">已停止后续处理</span>}
      {pausedQuestion && onContinue && <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={disabled} onClick={onContinue}>继续原任务</Button>}
      {running && <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs font-normal text-muted-foreground" aria-label="停止任务" disabled={disabled} onClick={onStop}>{running ? "停止" : "停止后续处理"}</Button>}
      {agent.awaiting_delivery && error && onContinue && <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={disabled} onClick={onContinue}>继续原任务</Button>}
      {(stopped && !pausedQuestion || interrupted && agent.steps >= 192) && <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs font-normal text-muted-foreground" disabled={disabled} onClick={onEdit}>修改原请求</Button>}
    </div>
    {operations && operations.length > 1 && <details className="mt-1">
      <summary className="cursor-pointer">任务进度 · {operations.filter(item => item.status === "completed").length}/{operations.length} 项</summary>
      <ol className="mt-1 space-y-0.5">{operations.map(item => <li key={item.id} className="flex gap-2"><span className="shrink-0">{({ pending: "待处理", running: "处理中", needs_input: "待回答", waiting_approval: "待确认", completed: "已完成", failed: "未完成", cancelled: "已取消" })[item.status]}</span><span>{item.label}</span></li>)}</ol>
    </details>}
    {error && <p role="alert" className="mt-1 text-xs leading-5 text-destructive">{error}</p>}
  </div>;
}

"use client";

import { Loader2 } from "lucide-react";
import type { AssistantPlan } from "@/lib/assistant";
import type { AssistantProcess } from "@/lib/assistant-process";
import { Button } from "@/components/ui/button";
import { AssistantProcessingDetails } from "@/components/assistant/processing-details";

/** Only show state that helps the user act; the reply and preview own the result. */
export function AssistantAgentTaskStatus({ agent, process, disconnected, disabled, onStop, onEdit, error, settled, hasPreview }: {
  agent: NonNullable<AssistantPlan["agent"]>; process?: AssistantProcess; disconnected?: boolean;
  disabled?: boolean; onStop: () => void; onEdit: () => void; error?: string; settled?: boolean; hasPreview?: boolean;
}) {
  const continuing = agent.status === "waiting_approval" && settled;
  const running = agent.status === "running" || continuing;
  const waiting = agent.status === "waiting_approval" && !settled;
  const stopped = agent.status === "stopped";
  if (!running && !waiting && !stopped && !error) return null;

  return <div className={`${running ? "mb-2" : "mt-2"} max-w-full text-xs leading-5 text-muted-foreground`} data-assistant-agent-status>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 [&>[data-assistant-process]]:mb-0">
      {running && (process ? <AssistantProcessingDetails process={process} disconnected={disconnected} summaryLabel={continuing ? "正在继续核对…" : undefined} />
        : <span className="inline-flex items-center gap-2" role="status"><span className="grid size-4 shrink-0 place-items-center overflow-hidden" aria-hidden="true"><Loader2 size={12} className="animate-spin motion-reduce:animate-none" /></span>{disconnected ? "正在重新连接…" : continuing ? "正在继续核对…" : "正在处理…"}</span>)}
      {waiting && !hasPreview && <span role="status">等待你的确认</span>}
      {stopped && <span role="status">已停止后续处理</span>}
      {(running || waiting) && <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs font-normal text-muted-foreground" aria-label="停止任务" disabled={disabled} onClick={onStop}>{running ? "停止" : "停止后续处理"}</Button>}
      {stopped && <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs font-normal text-muted-foreground" disabled={disabled} onClick={onEdit}>修改原请求</Button>}
    </div>
    {error && <p role="alert" className="mt-1 text-xs leading-5 text-destructive">{error}</p>}
  </div>;
}

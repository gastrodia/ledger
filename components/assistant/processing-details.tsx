"use client";

import { Check, ChevronRight, Circle, Loader2, Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { assistantProcessElapsed, assistantProcessView, type AssistantProcess } from "@/lib/assistant-process";

function ProcessElapsed({ process }: { process: AssistantProcess }) {
  const [now, setNow] = useState(() => Date.now());
  const active = process.status === "queued" || process.status === "running";
  useEffect(() => {
    if (!active || process.startedAt === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, process.startedAt]);
  const elapsed = assistantProcessElapsed(process, now);
  return elapsed ? <span className="inline-block text-[11px] font-normal tabular-nums opacity-70" aria-live="off" title="从任务提交起计算，包含等待和重试间隔">
    <span className="mx-1.5 opacity-50">·</span>{elapsed}
  </span> : null;
}

export function AssistantProcessingDetails({ process, disconnected = false, summaryLabel, quiet = false }: { process: AssistantProcess; disconnected?: boolean; summaryLabel?: string; quiet?: boolean }) {
  const { steps, summary, active } = assistantProcessView(process);
  return <details className="group/process mb-2 max-w-full text-[12px] leading-5 text-muted-foreground" data-assistant-process>
    <summary className="flex min-h-8 w-fit max-w-full cursor-pointer list-none items-center gap-1.5 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <ChevronRight size={13} className="shrink-0 transition-transform group-open/process:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
      {active && !disconnected && <span className="grid size-4 shrink-0 place-items-center overflow-hidden" aria-hidden="true"><Loader2 size={12} className="animate-spin motion-reduce:animate-none" /></span>}
      <span className="min-w-0">处理过程{(!quiet || active) && <><span className="mx-1.5 opacity-50">·</span>{disconnected && active ? "正在重新连接…" : summaryLabel || summary}</>}<ProcessElapsed process={process} /></span>
    </summary>
    <div className="ml-1.5 mt-1 border-l border-border/70 py-1 pl-4">
      <ol className="space-y-2.5" aria-label="处理步骤">
        {steps.map((step, index) => {
          const Icon = step.state === "done" ? Check : step.state === "failed" ? X : step.state === "stopped" ? Minus : Circle;
          return <li key={index} className="flex items-start gap-2">
            <Icon size={12} className="mt-1 shrink-0 opacity-70" aria-hidden="true" />
            <div className="min-w-0 wrap-anywhere">
              <div className="flex flex-wrap items-center gap-x-2"><span>{step.label}</span>{(step.tool || step.kind) && <span className="text-[10px] opacity-70">{step.kind === "model" ? "模型" : step.kind === "check" ? "校验" : "工具"}</span>}<span className="text-[10px] opacity-70">{step.state === "done" ? "已完成" : step.state === "failed" ? "未完成" : step.state === "stopped" ? "已停止" : disconnected ? "等待同步" : step.state === "waiting" ? "等待中" : "进行中"}</span>{step.duration && <span className="text-[10px] tabular-nums opacity-70">· {step.duration}</span>}</div>
              {step.details?.map((detail, detailIndex) => <p key={detailIndex} className="text-[11px] opacity-80">{detail}</p>)}
              {step.detail && <p className="text-[11px] opacity-80">{step.detail}</p>}
            </div>
          </li>;
        })}
      </ol>
      {process.attempt > 1 && <p className="mt-2 text-[11px] opacity-70">第 {process.attempt} 次尝试</p>}
      {active && <p className="mt-2 text-[11px] opacity-70">{disconnected ? "显示上次获取的进度，连接恢复后更新" : "离开页面后会继续处理"}</p>}
    </div>
  </details>;
}

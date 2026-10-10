"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AssistantActionPreview } from "@/lib/assistant-action-preview";
import type { AssistantActionResult } from "@/lib/assistant-commands";

import { AssistantReplyShell, AssistantReplyBody, AssistantReplyNotice, AssistantReplyBadge, type AssistantBadgeTone, type AssistantNoticeTone, type AssistantRecordAction } from "@/components/assistant/reply-primitives";

export type AssistantActionPhase = "approve" | "cancel" | "read";
const progressText = { approve: "正在执行…", cancel: "正在取消…", read: "正在核对…" };

export function AssistantActionControls({ pending, executing, disabled, canRead, onDecide, error, resultText, approveLabel }: {
  approveLabel?: string; pending?: AssistantActionPhase; executing?: boolean; disabled: boolean; canRead: boolean;
  onDecide: (phase: AssistantActionPhase) => void; error?: string; resultText?: string;
}) {
  return <div className="space-y-2" aria-label="待确认操作" aria-busy={!!pending}>
    <div className="flex flex-wrap gap-2">
      {(["approve", "cancel", ...(canRead ? ["read"] : [])] as AssistantActionPhase[]).map(phase => <Button key={phase} type="button" size="sm"
        variant={phase === "approve" ? "default" : "ghost"} className="min-h-9 gap-1.5" disabled={disabled || !!pending || (executing && phase !== "read")}
        aria-busy={pending === phase} onClick={() => onDecide(phase)}>
        {pending === phase && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {pending === phase ? progressText[phase] : { approve: approveLabel || "确认执行", cancel: "取消", read: "核对执行状态" }[phase]}
      </Button>)}
    </div>
    {(pending || executing || resultText) && <p className="text-xs leading-5 text-muted-foreground" role="status">{pending ? `${progressText[pending]}${pending === "approve" ? "正在保存并核对结果，请稍候。" : pending === "cancel" ? "正在核对取消结果。" : "正在获取最新执行结果。"}` : executing ? resultText || "操作执行中，结果待核对。" : resultText}</p>}
    {error && <p role="alert" className="text-xs leading-5 text-destructive">{error}</p>}
  </div>;
}

export function AssistantActionCard({ preview, status = "pending", pending, resultText, children, renderRecordAction }: {
  preview: AssistantActionPreview; status?: AssistantActionResult["status"]; pending?: AssistantActionPhase; resultText?: string; children?: ReactNode; renderRecordAction?: AssistantRecordAction;
}) {
  const labels = { pending: "待确认", executing: "结果待核对", succeeded: "已完成", cancelled: "已取消", failed: "未完成", expired: "需重新核对" };
  const tones = { pending: "pending", executing: "warning", succeeded: "success", cancelled: "neutral", failed: "error", expired: "warning" } satisfies Record<AssistantActionResult["status"], AssistantBadgeTone>;
  const resultTones = { pending: "info", executing: "attention", succeeded: "success", cancelled: "neutral", failed: "error", expired: "attention" } satisfies Record<AssistantActionResult["status"], AssistantNoticeTone>;
  return <AssistantReplyShell label="操作确认卡片" busy={!!pending || status === "executing"} title={preview.title} subtitle={preview.subtitle}
    badge={<AssistantReplyBadge busy={!!pending} tone={tones[status]}>{pending ? progressText[pending] : labels[status]}</AssistantReplyBadge>} footer={children}>
    <AssistantReplyBody preview={preview} renderRecordAction={status === "pending" ? renderRecordAction : undefined}>
      {status === "pending" && !pending && <p className="text-xs text-muted-foreground">尚未执行。核对后确认，或直接告诉我要修改的内容。</p>}
      {resultText && status !== "pending" && <div role="status"><AssistantReplyNotice tone={resultTones[status]}>{resultText}</AssistantReplyNotice></div>}
    </AssistantReplyBody>
  </AssistantReplyShell>;
}

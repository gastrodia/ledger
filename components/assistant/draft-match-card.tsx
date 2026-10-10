"use client";

import Link from "next/link";
import { Check, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssistantReplyShell, AssistantReplyBadge, AssistantReplyMetrics, AssistantReplyNotice } from "@/components/assistant/reply-primitives";
import type { AssistantReplyView } from "@/lib/assistant-reply-view";

export function AssistantDraftMatchCard({ preview, state, onDecision, onReview, disabled }: {
  preview: AssistantReplyView;
  state: (draftId: string) => "kept" | "removed" | "changed" | "pending";
  onDecision: (draftId: string, decision: "kept" | "removed") => void;
  onReview: () => void;
  disabled?: boolean;
}) {
  const comparison = preview.draftComparison!;
  return <AssistantReplyShell label="重复入账核对" title={preview.title} subtitle={preview.subtitle}
    footer={<Button type="button" variant="outline" size="sm" onClick={onReview}>查看最新草稿</Button>}>
    <AssistantReplyMetrics metrics={preview.metrics} />
    <ol className="divide-y divide-border px-4">{preview.records?.map((record, index) => {
      const row = comparison.rows[index];
      if (!row) return null;
      const status = state(row.draft_id);
      const resolved = status === "kept" || status === "removed";
      return <li key={row.draft_id} className="space-y-3 py-4" aria-label={`${index + 1}. ${record.title}`}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="text-sm font-semibold wrap-anywhere">{index + 1}. {record.title}</h4><p className="mt-1 text-xs text-muted-foreground wrap-anywhere">{record.subtitle}</p></div><strong className="shrink-0 text-base tabular-nums">{record.amount}</strong></div>
        <AssistantReplyBadge tone={resolved ? "success" : status === "changed" ? "neutral" : record.badge?.tone}>
          {status === "removed" ? "已移除草稿" : status === "kept" ? "已保留 · 尚未入账" : status === "changed" ? "草稿已变化，请重新核对" : record.badge?.label}
        </AssistantReplyBadge>
        {row.candidates.map(candidate => <article key={candidate.id} className="space-y-2 rounded-xl border border-border bg-muted/25 p-3" aria-label="关联的已入账记录">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[11px] text-muted-foreground">已入账</p><p className="mt-1 text-sm font-semibold wrap-anywhere">{candidate.description}</p></div><strong className="text-sm tabular-nums">{candidate.amount}</strong></div>
          <div className="flex flex-wrap gap-2 text-xs"><time className="font-semibold tabular-nums">{candidate.date}</time><span>{candidate.member}</span><span>{candidate.category}</span></div>
          <div className="flex flex-wrap items-center gap-2 text-xs"><strong className="text-foreground">{candidate.reason}</strong><span className={candidate.dateDifference ? "rounded-md bg-amber-500/15 px-2 py-1 font-semibold text-amber-800 dark:text-amber-200" : "rounded-md bg-muted px-2 py-1 font-medium"}>{candidate.dateDifference === 0 ? "日期一致" : `比草稿${candidate.dateDifference < 0 ? "早" : "晚"} ${Math.abs(candidate.dateDifference)} 天`}</span></div>
          <Link href={`/dashboard?${new URLSearchParams({ startDate: candidate.date, endDate: candidate.date, ...(candidate.description !== "未填写用途" ? { q: candidate.description } : {}) })}`} className="inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-primary"><ExternalLink size={13} />查看原账</Link>
        </article>)}
        {!row.candidates.length && <p className="text-xs leading-5 text-muted-foreground">{record.rows?.[0]?.value}</p>}
        {!!row.candidates.length && status === "pending" && <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal text-xs text-destructive" disabled={disabled} onClick={() => onDecision(row.draft_id, "removed")}><Trash2 size={14} />移除这笔草稿</Button>
          <Button type="button" size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal text-xs" disabled={disabled} onClick={() => onDecision(row.draft_id, "kept")}><Check size={14} />保留这笔草稿</Button>
        </div>}
        {record.rows?.some(r => r.label === "更多候选") && <p className="text-xs text-muted-foreground">{record.rows.find(r => r.label === "更多候选")?.value}</p>}
      </li>;
    })}</ol>
    <div className="space-y-2 border-t border-border p-4"><AssistantReplyNotice>“移除”只处理本组待确认草稿；“保留”仍需确认入账。</AssistantReplyNotice>
      <details className="text-xs"><summary className="min-h-8 cursor-pointer text-primary">查看判断规则</summary><div className="mt-2 space-y-2">{preview.notices.map((notice, i) => <AssistantReplyNotice key={i} tone={notice.tone}>{notice.text}</AssistantReplyNotice>)}</div></details>
    </div>
  </AssistantReplyShell>;
}

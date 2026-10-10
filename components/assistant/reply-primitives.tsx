"use client";

import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Check, Clock3, Info, Loader2, Minus, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssistantActionPreview } from "@/lib/assistant-action-preview";

export const assistantCardClass = "mt-3 w-full max-w-[520px] overflow-hidden rounded-2xl border border-border bg-card shadow-sm";
export const assistantChoiceClass = "h-auto min-h-11 w-full justify-start whitespace-normal rounded-xl border border-border bg-card px-3 py-2.5 text-left text-[13px] hover:border-primary hover:bg-primary/5";

export type AssistantBadgeTone = "pending" | "processing" | "success" | "warning" | "error" | "neutral";
const badgeTones = {
  pending: "bg-amber-500/10 text-amber-800",
  processing: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-700",
  warning: "bg-amber-500/10 text-amber-800",
  error: "bg-destructive/10 text-red-700",
  neutral: "bg-muted text-muted-foreground",
} satisfies Record<AssistantBadgeTone, string>;
const badgeIcons = { pending: Clock3, processing: Clock3, success: Check, warning: CircleAlert, error: XCircle, neutral: Minus };

export function AssistantReplyBadge({ children, busy, tone = "neutral" }: { children: ReactNode; busy?: boolean; tone?: AssistantBadgeTone }) {
  const activeTone = busy ? "processing" : tone;
  const Icon = busy ? Loader2 : badgeIcons[activeTone];
  return <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium", badgeTones[activeTone])}><Icon size={12} className={busy ? "animate-spin motion-reduce:animate-none" : undefined} aria-hidden="true" />{children}</span>;
}

export function AssistantReplyShell({ label, title, subtitle, badge, children, footer, busy, className }: {
  label: string; title?: ReactNode; subtitle?: ReactNode; badge?: ReactNode; children: ReactNode; footer?: ReactNode; busy?: boolean; className?: string;
}) {
  return <section aria-label={label} aria-busy={busy} className={cn(assistantCardClass, className)}>
    {(title || badge) && <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5">
      <div className="min-w-0"><h3 className="text-sm font-semibold text-foreground wrap-anywhere">{title}</h3>{subtitle && <p className="mt-1 text-xs leading-5 text-muted-foreground wrap-anywhere">{subtitle}</p>}</div>{badge}
    </header>}
    {children}
    {footer && <footer className="border-t border-border px-4 py-3">{footer}</footer>}
  </section>;
}

export function AssistantReplyMetrics({ metrics }: { metrics: AssistantActionPreview["metrics"] }) {
  if (!metrics.length) return null;
  return <div className="grid grid-cols-2 gap-3 bg-muted/35 px-4 py-4">{metrics.map((metric, index) => <div key={index} className="min-w-0"><p className="text-xs text-muted-foreground">{metric.label}</p><p className={cn("mt-1 text-xl font-semibold tabular-nums break-all", metric.primary ? "text-primary" : "text-foreground")}>{metric.value}</p></div>)}</div>;
}

export type AssistantNoticeTone = "info" | "success" | "attention" | "error" | "neutral";
const noticeTones = {
  info: "bg-muted text-muted-foreground",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  attention: "bg-amber-500/10 text-amber-800 dark:text-amber-200",
  error: "bg-destructive/5 text-destructive",
  neutral: "bg-muted text-muted-foreground",
} satisfies Record<AssistantNoticeTone, string>;
const noticeIcons = { info: Info, success: CircleCheck, attention: CircleAlert, error: XCircle, neutral: Minus };

export function AssistantReplyNotice({ children, tone = "info" }: { children: ReactNode; tone?: AssistantNoticeTone }) {
  const Icon = noticeIcons[tone];
  return <div className={cn("flex items-start gap-2 rounded-lg p-2.5 text-xs leading-5", noticeTones[tone])}>
    <Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><div className="min-w-0 wrap-anywhere whitespace-pre-wrap">{children}</div>
  </div>;
}

export function AssistantReplyFields({ rows, stackOnMobile = false }: { rows: AssistantActionPreview["sections"][number]["rows"]; stackOnMobile?: boolean }) {
  return <dl className="space-y-2">{rows.map((row, index) => <div key={index} className={cn("grid text-[13px] leading-5", stackOnMobile ? "grid-cols-1 gap-1 sm:grid-cols-[minmax(0,100px)_minmax(0,1fr)] sm:gap-3" : "grid-cols-[minmax(0,100px)_minmax(0,1fr)] gap-3")}><dt className="text-muted-foreground wrap-anywhere">{row.label}</dt><dd className="min-w-0 text-foreground wrap-anywhere whitespace-pre-wrap">{row.value.length > 180 ? <details><summary className="cursor-pointer">{row.value.slice(0, 100)}… <span className="text-primary">展开全文</span></summary><p className="mt-2">{row.value}</p></details> : row.value}</dd></div>)}</dl>;
}

export type AssistantRecordAction = (record: NonNullable<AssistantActionPreview["records"]>[number]) => ReactNode;
export function AssistantReplyRecords({ records, renderRecordAction }: { records: NonNullable<AssistantActionPreview["records"]>; renderRecordAction?: AssistantRecordAction }) {
  const render = (items: typeof records, start: number) => <ol start={start + 1} className="divide-y divide-border">{items.map((record, index) => <li key={record.id || index} className="py-3 first:pt-0 last:pb-0">
    <div className="flex items-start gap-3"><span className={cn("mt-0.5 text-xs tabular-nums text-muted-foreground", record.excluded && "line-through")}>{start + index + 1}.</span><div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-2"><p className={cn("min-w-0 flex-1 text-[13px] font-medium wrap-anywhere", record.excluded ? "text-muted-foreground line-through" : "text-foreground")}>{record.title}</p>
        <div className="flex max-w-[55%] shrink-0 items-center gap-2">{record.amount && <strong className={cn("min-w-0 text-right text-[13px] tabular-nums wrap-anywhere", record.excluded && "text-muted-foreground line-through")}>{record.amount}</strong>}{renderRecordAction && renderRecordAction(record)}</div>
      </div>
      {record.subtitle && <p className={cn("mt-1 text-xs leading-5 text-muted-foreground wrap-anywhere", record.excluded && "line-through")}>{record.subtitle}</p>}{record.badge && <div className="mt-2"><AssistantReplyBadge tone={record.badge.tone}>{record.badge.label}</AssistantReplyBadge></div>}
    </div></div>
    {!!record.rows?.length && <div className="mt-2 pl-5"><AssistantReplyFields rows={record.rows} stackOnMobile={!!record.badge} /></div>}
  </li>)}</ol>;
  return <div aria-label="记录明细">{render(records.slice(0, 5), 0)}{records.length > 5 && <details className="mt-3 border-t border-border pt-3"><summary className="cursor-pointer text-xs text-primary">展开其余 {records.length - 5} 条</summary><div className="mt-3">{render(records.slice(5), 5)}</div></details>}</div>;
}

export function AssistantReplyBody({ preview, children, renderRecordAction }: { preview: AssistantActionPreview; children?: ReactNode; renderRecordAction?: AssistantRecordAction }) {
  return <><AssistantReplyMetrics metrics={preview.metrics} /><div className="space-y-4 p-4">
    {!!preview.records?.length && <section>{preview.recordsTitle && <h4 className="mb-2 text-xs font-semibold text-muted-foreground">{preview.recordsTitle}</h4>}<AssistantReplyRecords records={preview.records} renderRecordAction={renderRecordAction} /></section>}
    {preview.sections.map((section, index) => <section key={index} className="min-w-0"><h4 className="mb-2 text-xs font-semibold text-muted-foreground">{section.title}</h4><AssistantReplyFields rows={section.rows} /></section>)}
    {!!preview.notices.length && <div className="space-y-2">{preview.notices.map((notice, index) => <AssistantReplyNotice key={index} tone={notice.tone}>{notice.text}</AssistantReplyNotice>)}</div>}{children}
  </div></>;
}

export function AssistantReplyCard({ preview, children, footer }: { preview: AssistantActionPreview; children?: ReactNode; footer?: ReactNode }) {
  return <AssistantReplyShell label="结构化回复" title={preview.title} subtitle={preview.subtitle} footer={footer}><AssistantReplyBody preview={preview}>{children}</AssistantReplyBody></AssistantReplyShell>;
}

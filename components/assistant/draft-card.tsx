"use client";

import type { ReactNode } from "react";
import { ArrowDownUp, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryIcon } from "@/components/icons/entity-icon";
import { AssistantReplyShell, AssistantReplyMetrics, AssistantReplyNotice, AssistantReplyBadge } from "@/components/assistant/reply-primitives";
import { ASSISTANT_DRAFT_SORT_LABELS, nextAssistantDraftSort, type AssistantDraftSort } from "@/lib/assistant-draft-sort";
import type { AssistantCategory, AssistantMember } from "@/lib/assistant";
import { MAX_AMOUNT_CENTS } from "@/lib/assistant";
import type { AssistantConversationMessage, EditableAssistantDraft } from "@/lib/assistant-task-client";
import { cn } from "@/lib/utils";

export function AssistantDraftCard({ drafts, status, pending, checking, error, sortMode, sortDisabled, onSort, children, footer }: {
  drafts: EditableAssistantDraft[]; status: AssistantConversationMessage["status"]; pending: boolean; checking: boolean; error?: string;
  sortMode: AssistantDraftSort; sortDisabled: boolean; onSort: () => void; children: ReactNode; footer: ReactNode;
}) {
  const totals = { income: 0, expense: 0 }, valid = { income: true, expense: true };
  for (const draft of drafts.filter(draft => !draft.ignored)) {
    const cents = Math.round(Number(draft.amount) * 100);
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(draft.amount) || cents <= 0 || cents > MAX_AMOUNT_CENTS) valid[draft.type] = false;
    else totals[draft.type] += cents;
  }
  const state = pending ? status === "saved" ? "正在撤销…" : "正在确认…" : checking ? "结果待核对" : status === "saved" ? "已入账" : status === "conflict" ? "需核对" : "待确认";
  return <AssistantReplyShell label="记账卡片" title={status === "saved" ? "已确认账目" : "核对账目"}
    subtitle={`${drafts.length} 笔 · ${status === "saved" ? "展开查看完整信息" : "点击账目展开核对与修改"}`}
    badge={<AssistantReplyBadge busy={pending} tone={checking || status === "conflict" ? "warning" : status === "saved" ? "success" : "pending"}>{state}</AssistantReplyBadge>}
    busy={pending} footer={footer}>
    <AssistantReplyMetrics metrics={(["income", "expense"] as const).map(type => ({ label: `${type === "income" ? "收入" : "支出"}合计`, value: valid[type] ? `¥${(totals[type] / 100).toFixed(2)}` : "金额待核对", primary: type === "expense" }))} />
    <div className="px-4 pt-3 pb-1">
      <div className="mb-1 flex items-center justify-between gap-2"><h4 className="text-xs font-semibold text-muted-foreground">逐笔明细</h4><Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs font-normal text-muted-foreground"
        aria-label={`账目排序：${ASSISTANT_DRAFT_SORT_LABELS[sortMode]}`} title={`点击切换为${ASSISTANT_DRAFT_SORT_LABELS[nextAssistantDraftSort(sortMode)]}`} disabled={sortDisabled || drafts.length < 2} onClick={onSort}><ArrowDownUp size={13} />{ASSISTANT_DRAFT_SORT_LABELS[sortMode]}</Button></div>
      <div className="divide-y divide-border">{children}</div>
    </div>
    {error && <div className="px-4 pb-3" role="alert"><AssistantReplyNotice tone="error">{error}</AssistantReplyNotice></div>}
  </AssistantReplyShell>;
}

export function AssistantDraftRow({ draft, category, member, canDelete, locked, open, onToggle, onDelete, children }: {
  draft: EditableAssistantDraft; category?: AssistantCategory; member?: AssistantMember; canDelete: boolean; locked: boolean;
  open: boolean; onToggle: (open: boolean) => void; onDelete: () => void; children: ReactNode;
}) {
  return <div className="relative" aria-label={`账目：${draft.description || "未填写用途"}`}>
    <details className="group/draft" open={open} onToggle={event => onToggle(event.currentTarget.open)}>
      <summary className={cn("flex min-h-[88px] cursor-pointer list-none items-start gap-2.5 py-4 focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden", canDelete && "pr-10")}>
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-primary"><CategoryIcon icon={category?.icon} className="size-4" /></span>
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium leading-5 text-foreground wrap-anywhere">{draft.description.trim() || (draft.type === "expense" ? "支出" : "收入")}</span>{" "}
          <span className="mt-1 block text-xs leading-5 text-muted-foreground wrap-anywhere">{draft.transaction_date || "待选日期"} · {category?.name || "待选分类"} · {member?.name || "待选成员"}</span>
        </span>
        <span className="max-w-[35%] shrink-0 text-right"><strong className="block text-[13px] font-semibold leading-5 tabular-nums text-foreground wrap-anywhere">¥{draft.amount || "—"}</strong><span className="mt-1 flex items-center justify-end gap-1 text-xs leading-5 text-muted-foreground">{draft.type === "expense" ? "支出" : "收入"}<ChevronRight size={13} className="shrink-0 transition-transform group-open/draft:rotate-90 motion-reduce:transition-none" /></span></span>
      </summary>
      <div className="mb-4 rounded-xl border border-border bg-muted/25 p-3">{children}</div>
    </details>
    {canDelete && <Button type="button" variant="ghost" className="absolute -right-2 top-3 flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="删除这笔草稿" title="删除这笔草稿" disabled={locked} onClick={onDelete}><Trash2 size={16} /></Button>}
  </div>;
}

"use client";

import { buttonClass, contentWidthClass, iconButtonClass } from "@/components/assistant/page-styles";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { DraftNotice } from "@/components/ui/draft-notice";
import { cn } from "@/lib/utils";
import { MessageCircle, Trash2 } from "lucide-react";

import { AssistantComposer } from "@/components/assistant/composer";
import { AssistantConversationFeed } from "@/components/assistant/conversation-feed";
import { useAssistantController } from "@/hooks/assistant/use-assistant-controller";

export default function AssistantPage() {
  const assistant = useAssistantController();
  const { configured, loadError, savingId, undos, draft, reloadSetup, clearConversation, taskConnectionError, taskSubscriptionRef, confirmingIds, undoingIds, confirm, undoSaved, busy, detachedConfirmations, unresolved } = assistant;
  return <DashboardLayout viewport contentClassName="px-0 pb-1.5 md:px-0 md:pb-1.5 lg:px-0 lg:pb-7"><section className="flex h-full min-h-0 w-full flex-col text-foreground [&_*]:motion-reduce:scroll-auto [&_*]:motion-reduce:transition-none" aria-label="AI 记账">
    <div className={cn(contentWidthClass, "shrink-0")}>
    <header className="mb-3.5 flex shrink-0 items-center gap-3">
      <div className="flex size-[42px] shrink-0 items-center justify-center rounded-[14px] bg-[color-mix(in_srgb,var(--color-primary)_9%,var(--color-background))] text-primary"><MessageCircle size={22} /></div>
      <div className="min-w-0 flex-1"><h1 className="text-[20px] leading-[26px] font-semibold tracking-[-0.5px]">AI 记账</h1><p className="mt-[3px] text-[12px] leading-[18px] text-muted-foreground">{unresolved ? `${unresolved} 笔待确认` : "随手记录，清楚每一笔"}</p></div>
      <Button type="button" variant="ghost" className={cn(buttonClass, iconButtonClass)} aria-label="清空对话" onClick={clearConversation} title="清空对话"><Trash2 size={19} /></Button>
    </header>
    <DraftNotice draft={draft} hideSaved hidePending />
    {!!detachedConfirmations.length && <div className="mb-3 max-h-32 shrink-0 overflow-y-auto rounded-[10px] bg-muted px-3 py-2.5 text-[12px]" aria-label="入账结果核对">
      {detachedConfirmations.map(c => <div key={c.id} className="flex items-center justify-between gap-3 py-1">
        <span>{c.drafts.length} 笔入账结果待核对{c.error ? <span className="mt-1 block text-[11px] text-muted-foreground">{c.error}</span> : null}</span>
        <Button type="button" variant="ghost" className={cn(buttonClass, "shrink-0 text-primary underline")} disabled={busy || savingId !== null || confirmingIds.includes(c.id)} onClick={() => void confirm({ id: c.id, role: "assistant", text: "", status: "pending", commit: c.drafts })}>{confirmingIds.includes(c.id) ? "正在核对…" : "核对原批次"}</Button>
      </div>)}
    </div>}
    {!!undos.length && <div className="mb-3 max-h-32 shrink-0 overflow-y-auto rounded-[10px] bg-muted px-3 py-2.5 text-[12px]" aria-label="撤销结果核对">
      {undos.map(operation => <div key={operation.id} className="flex items-center justify-between gap-3 py-1">
        <span>{operation.draft_ids.length} 笔撤销结果{undoingIds.includes(operation.id) ? "正在核对" : "待核对"}{operation.error && <span className="mt-1 block text-[11px] text-muted-foreground">{operation.error}</span>}</span>
        <Button type="button" variant="ghost" className={cn(buttonClass, "shrink-0 text-primary underline")} aria-label="核对撤销结果" disabled={busy || savingId !== null || undoingIds.includes(operation.id)} onClick={() => void undoSaved(undefined, undefined, operation)}>{undoingIds.includes(operation.id) ? "正在核对…" : "核对原操作"}</Button>
      </div>)}
    </div>}
    {taskConnectionError && <div className="mb-3 flex items-center gap-3 rounded-[10px] bg-muted px-3 py-2.5 text-[13px]" role="status"><span>{taskConnectionError}</span><Button type="button" variant="ghost" className={cn(buttonClass, "ml-auto whitespace-nowrap underline")} onClick={() => taskSubscriptionRef.current?.refresh()}>重新连接</Button></div>}
    {loadError && <div className="mb-3 flex items-center gap-3 rounded-[10px] bg-muted px-3 py-2.5 text-[13px]" role="alert">{loadError}<Button type="button" variant="ghost" className={cn(buttonClass, "ml-auto whitespace-nowrap underline")} onClick={reloadSetup}>重新加载</Button></div>}
    {configured === false && <div className="mb-3 flex items-center gap-3 rounded-[10px] bg-muted px-3 py-2.5 text-[13px]" role="status">AI 尚未配置，请完成百炼服务端配置。仍可手动填写确认卡片。</div>}
    </div>
    <AssistantConversationFeed assistant={assistant} />
    <AssistantComposer assistant={assistant} />
  </section></DashboardLayout>;
}

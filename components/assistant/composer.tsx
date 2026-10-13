"use client";

import { SortableAssistantImages } from "@/components/assistant/sortable-images";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { AssistantController } from "@/hooks/assistant/use-assistant-controller";
import { toast } from "@/hooks/use-toast";
import { MAX_AUDIO_SECONDS } from "@/lib/assistant-audio";
import { MAX_ASSISTANT_IMAGES } from "@/lib/assistant-images";
import { cn } from "@/lib/utils";
import { ArrowUp, BarChart3, ImagePlus, LayoutGrid, Loader2, Mic, Plus, Square } from "lucide-react";
import NextImage from "next/image";
import Link from "next/link";
import { buttonClass, composerHintClass, contentWidthClass, iconButtonClass, quickTools, shortcutButtonClass } from "./page-styles";

type Props = { assistant: Pick<AssistantController, "outbox" | "input" | "setInput" | "categories" | "members" | "configured" | "loadError" | "isInitializing" | "sending" | "actionPending" | "savingId" | "images" | "setImages" | "composerRef" | "draft" | "stopTask" | "transcribing" | "speechPhase" | "recording" | "voiceBusy" | "seconds" | "preparingImage" | "previewImage" | "setPreviewImage" | "quickToolsOpen" | "setQuickToolsOpen" | "imageInputRef" | "audioInputRef" | "toggleRecording" | "selectImages" | "pasteImage" | "transcribe" | "send" | "manualEntry" | "busy" | "taskBusy" | "recoveringTasks" | "composerDisabled" | "fillQuickPrompt"> };

export function AssistantComposer({ assistant }: Props) {
  const { outbox, input, setInput, categories, members, configured, loadError, isInitializing, sending, actionPending, savingId, images, setImages, composerRef, draft, stopTask, transcribing, speechPhase, recording, voiceBusy, seconds, preparingImage, previewImage, setPreviewImage, quickToolsOpen, setQuickToolsOpen, imageInputRef, audioInputRef, toggleRecording, selectImages, pasteImage, transcribe, send, manualEntry, busy, taskBusy, recoveringTasks, composerDisabled, fillQuickPrompt } = assistant;
  return <>
    <footer className={cn(contentWidthClass, "shrink-0 pt-3")}>
      <div className="mb-2.5 grid grid-cols-2 gap-2 min-[400px]:grid-cols-4 lg:flex [@media(max-width:360px)]:gap-1.5">
        <Button type="button" variant="ghost" className={cn(buttonClass, shortcutButtonClass)} disabled={composerDisabled} onClick={() => imageInputRef.current?.click()}><ImagePlus size={16} />识别截图</Button>
        <Button type="button" variant="ghost" className={cn(buttonClass, shortcutButtonClass)} disabled={composerDisabled} onClick={manualEntry}><Plus size={16} />手动记账</Button>
        <Button type="button" variant="ghost" className={cn(buttonClass, shortcutButtonClass)} disabled={composerDisabled} onClick={() => fillQuickPrompt("这个月收入、支出和结余各是多少？主要花在哪些分类？")}><BarChart3 size={16} />本月统计</Button>
        <Button type="button" variant="ghost" className={cn(buttonClass, shortcutButtonClass)} disabled={composerDisabled} aria-haspopup="dialog" onClick={() => setQuickToolsOpen(true)}><LayoutGrid size={16} />更多工具</Button>
      </div>
      {!!images.length && <div className="mb-2.5 min-w-0" aria-label="待识别截图">
        <p className="mb-1.5 text-[11px] text-muted-foreground">{images.length} / {MAX_ASSISTANT_IMAGES} 张 · 按顺序合并识别，自动衔接去重</p>
        {images.length > 1 && <p className="mb-1 text-[10px] text-muted-foreground">长按或拖动截图调整顺序</p>}
        <SortableAssistantImages images={images} disabled={busy || savingId !== null || draft.hasDraft || draft.status === "checking"}
          onReorder={setImages} onPreview={setPreviewImage} onRemove={image => setImages(current => current.filter(item => item !== image))} />
      </div>}
      <div className="flex items-end gap-1 rounded-[18px] border border-input bg-card p-1.5 shadow-[0_2px_8px_rgb(15_23_42_/_0.035)] focus-within:border-primary focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary)_9%,transparent)]">
        <Button type="button" variant="ghost" className={cn(buttonClass, iconButtonClass, recording && "bg-muted text-destructive")} aria-label={speechPhase === "starting" ? "取消语音连接" : recording ? "结束录音" : "语音输入"} disabled={!!actionPending || !!savingId || sending || taskBusy || recoveringTasks || !!outbox || transcribing || speechPhase === "finishing" || preparingImage || draft.hasDraft || draft.status === "checking" || configured === false} onClick={() => void toggleRecording()}>{transcribing || speechPhase === "starting" || speechPhase === "finishing" ? <Loader2 size={22} className="animate-spin" /> : recording ? <Square size={20} /> : <Mic size={24} />}</Button>
        <Textarea ref={composerRef} readOnly={voiceBusy} aria-busy={voiceBusy} className="min-h-10 max-h-[120px] min-w-0 flex-1 resize-none border-0 bg-transparent px-1.5 py-[9px] text-base md:text-[15px] leading-[22px] rounded-none shadow-none focus-visible:ring-0 [field-sizing:content] placeholder:text-muted-foreground focus-visible:outline-none" aria-label="记一笔，或问问账本" title="支持文字和粘贴多张图片" value={input} disabled={!!actionPending || sending || taskBusy || recoveringTasks || !!outbox || transcribing || draft.hasDraft || draft.status === "checking"} maxLength={4000} rows={1} placeholder={speechPhase === "starting" ? "正在连接语音…" : recording ? "请说话，文字会实时显示…" : "记一笔，或问问账本"} onChange={e => setInput(e.target.value)} onPaste={pasteImage} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        {taskBusy ? <Button type="button" size="icon" className={cn(buttonClass, "flex size-10 shrink-0 items-center justify-center rounded-[12px]")} aria-label="停止生成" title="停止生成" onClick={() => void stopTask()}><Square size={18} className="fill-current" /></Button>
          : <Button type="button" size="icon" className={cn(buttonClass, "[&_svg]:size-6 flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100")} aria-label="发送" disabled={composerDisabled || !!outbox || (!input.trim() && !images.length) || configured === false || configured === null} onClick={() => void send()}>{sending ? <Loader2 size={22} className="animate-spin" /> : <ArrowUp size={25} />}</Button>}
      </div>
      <p className={composerHintClass} role="status">{speechPhase === "starting" ? "正在连接语音，点击可取消…" : recording ? `正在听写 ${seconds} / ${MAX_AUDIO_SECONDS} 秒 · 点击停止` : speechPhase === "finishing" ? "正在确认末尾文字…" : transcribing ? "正在识别语音…" : preparingImage ? "正在准备截图…" : isInitializing ? "正在加载成员和分类…" : "AI 识别仅供参考，确认后才入账"}</p>
      {!isInitializing && !loadError && !categories.length && configured !== null && <p className={composerHintClass}><Link href="/dashboard/categories">先添加收支分类</Link></p>}
      {!isInitializing && !loadError && !members.length && configured !== null && <p className={composerHintClass}><Link href="/dashboard/members">先添加家庭成员</Link></p>}
      <input ref={imageInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="选择账单截图" onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ""; void selectImages(files); }} />
      <input ref={audioInputRef} type="file" accept="audio/*" className="sr-only" aria-label="选择录音" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file && file.size <= 10_000_000) void transcribe(file); else if (file) toast.error("音频文件过大。"); }} />
    </footer>
    <Dialog open={!!previewImage} onOpenChange={open => { if (!open) setPreviewImage(null); }}>
      <DialogContent className="max-w-3xl" aria-describedby={undefined}>
        <DialogTitle className="pr-8 text-[14px]">{previewImage?.name || "账单截图"}</DialogTitle>
        {previewImage && <div className="min-h-0 overflow-auto"><NextImage src={previewImage.data} alt={previewImage.name} width={1600} height={1600} unoptimized className="mx-auto h-auto max-h-[70dvh] w-auto max-w-full object-contain" /></div>}
      </DialogContent>
    </Dialog>
    <Dialog open={quickToolsOpen} onOpenChange={setQuickToolsOpen}>
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); composerRef.current?.focus(); }}>
        <div className="shrink-0 pr-8 space-y-2"><DialogTitle className="text-base">更多工具</DialogTitle><DialogDescription className="text-xs leading-5">选择一个提问示例，补充细节后发送。保存、修改或删除都会先让你确认。</DialogDescription></div>
        <DialogBody className="space-y-2">
          {quickTools.map(({ label, description, icon: Icon, prompt }) => <Button key={label} type="button" variant="ghost" disabled={composerDisabled} className="h-auto min-h-14 w-full justify-start gap-3 whitespace-normal rounded-xl border border-border px-3 py-3 text-left hover:border-primary" onClick={() => fillQuickPrompt(prompt)}>
            <Icon size={18} className="shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{label}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{description}</span></span><ArrowUp size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          </Button>)}
        </DialogBody>
      </DialogContent>
    </Dialog>
  </>;
}

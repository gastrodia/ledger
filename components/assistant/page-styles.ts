"use client";

import { ArrowLeftRight, Copy, Gift, MessageCircle, Search, StickyNote, Users } from "lucide-react";
export const buttonClass = "h-auto p-0 whitespace-normal motion-reduce:transition-none";
export const iconButtonClass = "[&_svg]:size-5 flex size-10 shrink-0 items-center justify-center rounded-[12px] text-muted-foreground hover:bg-muted";
export const fieldLabelClass = "min-w-0 space-y-2 [&_label]:text-xs [&_label]:font-medium [&_label]:text-muted-foreground";
export const fieldClass = "min-w-0";
export const incompleteFieldClass = "border-destructive bg-destructive/5 hover:border-destructive focus-visible:ring-destructive focus:ring-destructive";
export const shortcutButtonClass = "flex min-h-9 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[12px] border border-border bg-card p-2 text-[12px] hover:bg-muted lg:px-3.5 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";
export const composerHintClass = "mt-[3px] text-center text-[10px] leading-[14px] text-muted-foreground [&_a]:underline";
export const contentWidthClass = "mx-auto w-full max-w-[1064px] px-4 md:px-6 lg:px-8";
export const capabilitiesPrompt = "你可以做什么？请介绍你能帮我处理的账本事项，并举几个使用例子。";
export const quickTools = [
  { label: "查账单", description: "按时间、成员或分类查收支", icon: Search, prompt: "查询这个月的收支明细，按日期从近到远列出。" },
  { label: "借还查询", description: "看看我欠谁、谁还欠我", icon: ArrowLeftRight, prompt: "帮我查一下还没结清的借还，区分我欠别人的和别人欠我的。" },
  { label: "人情往来", description: "查询送礼、收礼和礼簿", icon: Gift, prompt: "帮我看看这个月的送礼和收礼记录。" },
  { label: "便利贴", description: "查看保存的备忘事项", icon: StickyNote, prompt: "查看我当前未归档的便利贴。" },
  { label: "查重复", description: "找出疑似重复的账目供核对", icon: Copy, prompt: "检查这个月有没有疑似重复的收支记录，列出让我核对，先不要删除。" },
  { label: "成员与分类", description: "查看家庭成员和收支分类", icon: Users, prompt: "查看目前的家庭成员和收支分类。" },
  { label: "你可以做什么", description: "了解能力和提问方式", icon: MessageCircle, prompt: capabilitiesPrompt },
];
export const bubbleClass = "text-[14px] leading-[1.75] wrap-anywhere [&_p+p]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li+li]:mt-1 [&_strong]:font-semibold [&_strong]:text-foreground [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-muted [&_pre]:p-3 [&_h2]:mt-2.5 [&_h2]:mb-[5px] [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-2.5 [&_h3]:mb-[5px] [&_h3]:font-semibold [&_h3]:text-foreground [&_a]:text-primary [&_a]:underline [&_table]:border-collapse [&_table]:text-[12px] [&_th]:border-b [&_th]:border-border [&_th]:px-[9px] [&_th]:py-1.5 [&_td]:border-b [&_td]:border-border [&_td]:px-[9px] [&_td]:py-1.5";

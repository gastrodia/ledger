"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { AssistantMember } from "@/lib/assistant";
import { MemberAvatar } from "@/components/icons/entity-icon";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRegion } from "@/components/ui/loading-skeleton";

import { AssistantReplyShell } from "@/components/assistant/reply-primitives";

export function AssistantMemberLabel({ member }: { member: AssistantMember }) {
  return <span className="inline-flex min-w-0 items-center gap-2">
    <MemberAvatar avatar={member.avatar} name={member.name} memberId={member.id} className="size-5" />
    <span className="min-w-0 wrap-anywhere">{member.name}</span>
  </span>;
}

/** Shared selection surface for ordinary drafts, member corrections and ledger events. */
export function AssistantMemberPicker({ label = "选择记账成员", heading, members, disabled, loading, loadError, onReload, onSelect, children, footer }: {
  label?: string; heading: ReactNode; members: AssistantMember[]; disabled: boolean; loading: boolean; loadError: boolean;
  onReload: () => void; onSelect: (member: AssistantMember) => void; children?: ReactNode; footer: ReactNode;
}) {
  return <AssistantReplyShell label={label} className="max-w-[400px] shadow-none"><div className="p-3.5">
    {heading}
    {members.length ? <div className="flex flex-wrap gap-2">{members.map(member => <Button type="button" variant="ghost" key={member.id}
      className="h-auto whitespace-normal motion-reduce:transition-none flex min-h-11 max-w-full items-center gap-[7px] rounded-[12px] border border-[color-mix(in_srgb,var(--color-primary)_24%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-primary)_4%,var(--color-card))] px-3.5 py-2.5 text-[14px] hover:border-primary hover:bg-[color-mix(in_srgb,var(--color-primary)_9%,var(--color-card))]"
      disabled={disabled} onClick={() => onSelect(member)}><AssistantMemberLabel member={member} /></Button>)}</div>
      : loading ? <SkeletonRegion label="正在加载家庭成员…"><div className="flex gap-2"><Skeleton className="h-11 w-24 rounded-[12px]" /><Skeleton className="h-11 w-24 rounded-[12px]" /></div></SkeletonRegion>
      : loadError ? <p className="text-[13px] text-muted-foreground">成员信息未能加载，请重新加载后选择。</p>
      : <p className="text-[13px] text-muted-foreground">还没有可选成员，<Link className="ml-1.5 underline" href="/dashboard/members">先添加成员</Link><Button type="button" variant="ghost" className="ml-1.5 h-auto p-0 whitespace-normal underline" disabled={disabled} onClick={onReload}>刷新成员</Button></p>}
    {children}
    {footer}
  </div></AssistantReplyShell>;
}

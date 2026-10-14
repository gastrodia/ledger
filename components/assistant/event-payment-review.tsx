"use client";

import { AssistantDraftCard, AssistantDraftRow } from "@/components/assistant/draft-card";
import { AssistantDraftEditor } from "@/components/assistant/draft-editor";
import { AssistantMemberPicker } from "@/components/assistant/member-picker";
import { Button } from "@/components/ui/button";
import { unassignedMemberDrafts, type AssistantCategory, type AssistantMember } from "@/lib/assistant";
import { editDraft, invalidDraftFields, money } from "@/lib/assistant-draft-editor";
import { sortedAssistantDrafts, type AssistantDraftSort } from "@/lib/assistant-draft-sort";
import { eventCashflowCents, eventKinds, eventType, type LedgerEventInput } from "@/lib/ledger-event";

/** Reuse the bookkeeping review UI; execution remains one atomic ledger event. */
export function AssistantEventPaymentReview({ id, input, indexes, members, categories, disabled, loading, loadError, onReload, onChange, onSubmit, sortMode, onSort, expanded, onToggle }: {
  id: string; input: LedgerEventInput; indexes: number[]; members: AssistantMember[]; categories: AssistantCategory[];
  disabled: boolean; loading: boolean; loadError: boolean; onReload: () => void;
  onChange: (input: LedgerEventInput) => void; onSubmit: () => void;
  sortMode: AssistantDraftSort; onSort: () => void; expanded: Record<string, boolean>; onToggle: (id: string, open: boolean) => void;
}) {
  const payments = input.payments ?? [{ amount_cents: eventCashflowCents(input), member_id: input.member_id, category_id: input.category_id,
    date: input.date, description: `${eventKinds[input.kind!]} · ${input.counterparty}` }];
  const drafts = payments.map((payment, index) => editDraft({ id: `${id}:${input.payments ? index : -1}`, type: eventType(input.kind!),
    amount_cents: payment.amount_cents!, transaction_date: payment.date!, member_id: payment.member_id, category_id: payment.category_id,
    description: payment.description, payment_method: null, note: "" }));
  const indexById = new Map(drafts.map((draft, index) => [draft.id, input.payments ? index : -1]));
  const editable = drafts.filter(draft => indexes.includes(indexById.get(draft.id)!));
  const missing = unassignedMemberDrafts(editable, members);
  const update = (targets: number[], patch: { member_id?: string | null; category_id?: string | null }) => onChange(input.payments
    ? { ...input, payments: input.payments.map((payment, index) => targets.includes(index) ? { ...payment, ...patch } : payment) }
    : { ...input, ...patch });
  if (missing.length) return <AssistantMemberPicker
    heading={<p className="mb-3 flex items-baseline gap-2 text-[13px]"><span>{missing.length > 1 ? `${missing.length} 笔待选成员` : missing[0].description}</span><strong className="ml-auto whitespace-nowrap">¥{money(missing.reduce((sum, draft) => sum + draft.amount_cents, 0))}</strong></p>}
    members={members} disabled={disabled} loading={loading} loadError={loadError} onReload={onReload}
    onSelect={member => update(missing.map(draft => indexById.get(draft.id)!), { member_id: member.id })}
    footer={<p className="mt-3 text-[11px] text-muted-foreground">选择后核对账目，确认前可逐笔修改。</p>} />;
  const invalid = editable.some(draft => Object.values(invalidDraftFields(draft, categories, members)).some(Boolean));
  return <AssistantDraftCard drafts={drafts} status="pending" pending={false} checking={false} sortMode={sortMode} sortDisabled={disabled} onSort={onSort}
    footer={<div className="space-y-3"><p className="text-xs text-muted-foreground">付款将与{eventKinds[input.kind!]}事项一起核对并确认；关联的原流水不会重复入账。</p>
      <Button type="button" disabled={disabled || invalid} onClick={onSubmit}>核对事项</Button></div>}>
    {sortedAssistantDrafts(drafts, sortMode).map(draft => {
      const locked = disabled || !indexes.includes(indexById.get(draft.id)!);
      const fields = invalidDraftFields(draft, categories, members);
      return <AssistantDraftRow key={draft.id} draft={draft} member={members.find(member => member.id === draft.member_id)} category={categories.find(category => category.id === draft.category_id)}
        canDelete={false} locked={locked} open={expanded[draft.id] ?? (!locked && fields.category)} onToggle={open => onToggle(draft.id, open)} onDelete={() => {}}>
        <AssistantDraftEditor draft={draft} invalid={fields} locked={locked} members={members} categories={categories}
          fields={["category_id", "member_id"]}
          onUpdate={patch => update([indexById.get(draft.id)!], patch)} />
      </AssistantDraftRow>;
    })}
  </AssistantDraftCard>;
}

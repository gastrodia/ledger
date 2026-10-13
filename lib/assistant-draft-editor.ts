import { isCalendarDate, MAX_AMOUNT_CENTS, type AssistantCategory, type AssistantDraft, type AssistantMember } from "@/lib/assistant";
import { type EditableAssistantDraft as EditableDraft } from "@/lib/assistant-task-client";
export const money = (cents: number) => (cents / 100).toFixed(2);
export const editDraft = (d: AssistantDraft): EditableDraft => ({ ...d, amount: money(d.amount_cents) });
export type DraftValidationField = "amount" | "category" | "member" | "date";
export function invalidDraftFields(draft: EditableDraft, categories: AssistantCategory[], members: AssistantMember[]) {
  return {
    amount: !/^\d{1,10}(\.\d{1,2})?$/.test(draft.amount) || Number(draft.amount) <= 0 || Math.round(Number(draft.amount) * 100) > MAX_AMOUNT_CENTS,
    category: !categories.some(category => category.id === draft.category_id && category.type === draft.type),
    member: !members.some(member => member.id === draft.member_id),
    date: !isCalendarDate(draft.transaction_date),
  };
}

export function submittedDrafts(drafts: EditableDraft[]): AssistantDraft[] {
  return drafts.filter(d => !d.ignored && !d.softRemoved).map(d => {
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(d.amount)) throw new Error("请填写大于0、最多两位小数的金额。");
    return {
      id: d.id, type: d.type, amount_cents: Math.round(Number(d.amount) * 100), category_id: d.category_id, member_id: d.member_id,
      transaction_date: d.transaction_date, description: d.description, payment_method: d.payment_method, note: d.note
    };
  });
}

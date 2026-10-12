/** Candidate evidence is literal recorded data; it never decides duplication. */
export type DraftMatchReason = "merchant" | "missing_description";
export type DraftMatchIdentity = { description: string; member_id?: string | null; category_id?: string | null };
export function normalizeDraftMerchant(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}
export function draftMatchReason(draft: DraftMatchIdentity, saved: DraftMatchIdentity & { date_difference_days: number }): DraftMatchReason | null {
  if (draft.member_id && saved.member_id && draft.member_id !== saved.member_id) return null;
  const a = normalizeDraftMerchant(draft.description), b = normalizeDraftMerchant(saved.description);
  if (a && b && a === b) return "merchant";
  if (Math.abs(saved.date_difference_days) > 1) return null;
  if (!b && draft.category_id && draft.category_id === saved.category_id) return "missing_description";
  return null;
}
export const draftMatchReasonLabel: Record<DraftMatchReason, string> = {
  merchant: "描述一致 · 金额相同 · 仍需确认", missing_description: "分类相同 · 原账缺少用途 · 无法确认重复",
};

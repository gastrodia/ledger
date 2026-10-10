/** Conservative recall rules: a coincidental amount is never matching evidence. */
export type DraftMatchReason = "merchant" | "purpose" | "missing_description";
export type DraftMatchIdentity = { description: string; member_id?: string | null; category_id?: string | null };
export function normalizeDraftMerchant(value: string) {
  return value.toLowerCase().replace(/^(?:扫收钱码付款|扫码付款|付款|消费)[-：:]*/, "").replace(/[\s\p{P}\p{S}]/gu, "");
}
function purpose(value: string) {
  if (/蚂蚁财富|基金|纳斯达克|定投/.test(value)) return "fund";
  if (/阿里云|腾讯云|云服务|云服务器|域名/.test(value)) return "cloud";
  return null;
}
export function draftMatchReason(draft: DraftMatchIdentity, saved: DraftMatchIdentity & { date_difference_days: number }, specificCategories: Set<string>): DraftMatchReason | null {
  if (draft.member_id && saved.member_id && draft.member_id !== saved.member_id) return null;
  const rawA = normalizeDraftMerchant(draft.description), rawB = normalizeDraftMerchant(saved.description);
  const informative = (value: string) => /^(其他|其它|消费|购物|未填写用途|无备注|未填写|付款|转账)$/.test(value) ? "" : value;
  const a = informative(rawA), b = informative(rawB);
  // Punctuation and genuine truncated merchant labels can differ; short generic labels cannot match prefixes.
  if (a && b && (a === b || (Math.min(a.length, b.length) >= 6 && (a.startsWith(b) || b.startsWith(a))))) return "merchant";
  if (Math.abs(saved.date_difference_days) > 1) return null;
  if (draft.category_id && saved.category_id && draft.category_id !== saved.category_id) return null;
  if (purpose(a) && purpose(a) === purpose(b)) return "purpose";
  if (!b && draft.category_id && draft.category_id === saved.category_id && specificCategories.has(draft.category_id)) return "missing_description";
  return null;
}
export const draftMatchReasonLabel: Record<DraftMatchReason, string> = {
  merchant: "商户名称一致 · 金额相同", purpose: "用途相关 · 金额相同 · 仍需确认", missing_description: "分类相同 · 原账缺少用途 · 无法确认重复",
};

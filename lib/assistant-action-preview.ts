import { eventCashflowCents, eventIsLoan, eventKinds, eventType, type LedgerEventInput } from "@/lib/ledger-event";

export type AssistantActionPreview = {
  title: string;
  approveLabel?: string;
  subtitle?: string;
  recordsTitle?: string;
  records?: { id?: string; excluded?: boolean; title: string; subtitle?: string; amount?: string; badge?: { label: string; tone: "warning" | "neutral" }; rows?: { label: string; value: string }[] }[];
  metrics: { label: string; value: string; primary?: boolean }[];
  sections: { title: string; rows: { label: string; value: string }[] }[];
  notices: { text: string; tone: "info" | "attention" }[];
};
const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
export const withoutApprovalExpiry = (text: string) => text.replace(/确认有效期为\s*15\s*分钟[。.]?/g, "").trim();

/** Older approvals retain their literal summary without reconstructing fields or risk from prose. */
export function summaryActionPreview(summary: string): AssistantActionPreview {
  return { title: "核对操作", metrics: [], sections: [], notices: [{ text: withoutApprovalExpiry(summary), tone: "info" }] };
}

/** Primary amounts come from validated event fields, never from generated prose. */
export function eventActionPreview(input: LedgerEventInput, summary: string, scope?: { rows: { label: string; value: string }[] }): AssistantActionPreview {
  const fallback = summaryActionPreview(summary);
  if (!input.kind) return fallback;
  const kind = input.kind;
  const paid = eventCashflowCents(input);
  const hasFlow = input.payments != null ? input.payments.length > 0 : input.cashflow !== "none";
  const gift = kind === "gift_given";
  const knownValues = (input.items || []).every(item => item.estimated_value !== null);
  const giftValue = (input.amount_cents || 0) + (input.items || []).reduce((sum, item) => sum + Math.round((item.estimated_value || 0) * 100), 0);
  const sections: AssistantActionPreview["sections"] = [];
  if (gift) sections.push({ title: "送礼明细", rows: [
    { label: "礼金", value: money(input.amount_cents || 0) },
    ...(input.items || []).map(item => ({ label: item.item_name, value: `${item.quantity}${item.unit || "件"} · ${item.estimated_value === null ? "未估值" : `价值 ${money(Math.round(item.estimated_value * 100))}`}` })),
  ] });
  sections.push({ title: input.operation === "undo" ? "撤销范围" : "保存与关联", rows: scope?.rows || [
    { label: "台账", value: input.operation === "undo" ? "撤销原事项" : input.operation === "update" ? "修改原事项" : "新增事项" },
    { label: "资金流水", value: !hasFlow ? "仅登记台账，不产生收支" : input.cashflow === "existing" ? "关联原流水，不重复入账" : "核对资金流水及关联" },
  ] });
  const notices: AssistantActionPreview["notices"] = scope ? [] : fallback.notices;
  if (hasFlow && input.payment_recipient) notices.push({ text: `按“转给${input.payment_recipient}代办给${input.counterparty}的送礼”关联，请核对。`, tone: "info" });
  if (gift && hasFlow && paid !== null && knownValues && paid !== giftValue) notices.push({ text: `实际付款比送礼价值${paid > giftValue ? "多" : "少"} ${money(Math.abs(paid - giftValue))}。保留差额，不自动补记。`, tone: "attention" });
  if (eventIsLoan(kind) && hasFlow) notices.push({ text: "借还本金只计资金流动，不计日常收入与消费。", tone: "info" });
  return {
    title: `${input.operation === "undo" ? "撤销" : input.operation === "update" ? "修改" : "记录"}${eventKinds[kind]}${input.counterparty ? ` · ${input.counterparty}` : ""}`,
    subtitle: [input.date, input.occasion].filter(Boolean).join(" · "),
    metrics: [
      { label: hasFlow ? `实际${eventType(kind) === "income" ? "收入" : "支出"}` : "资金收支", value: hasFlow && paid !== null ? money(paid) : "不计收支", primary: true },
      ...(gift ? [{ label: "送礼合计价值", value: knownValues ? money(giftValue) : "部分未估值" }] : []),
    ], sections, notices,
  };
}

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

/** Compatibility for stored approvals and the ordinary management operations. */
export function summaryActionPreview(summary: string): AssistantActionPreview {
  const lines = withoutApprovalExpiry(summary).split("\n").map(line => line.trim()).filter(Boolean);
  const title = (lines.shift() || "核对操作").replace(/[：:]$/, "");
  const rows: { label: string; value: string }[] = [];
  const notices: AssistantActionPreview["notices"] = [];
  for (const line of lines) {
    if (line.startsWith("尚未执行")) continue;
    if (/删除后无法|同时删除/.test(line)) { notices.push({ text: line, tone: "attention" }); continue; }
    const text = line.replace(/^-\s*/, "");
    const split = text.indexOf("：");
    rows.push(split > 0 && split < 30 ? { label: text.slice(0, split), value: text.slice(split + 1) } : { label: "明细", value: text });
  }
  return { title, metrics: [], sections: rows.length ? [{ title: "操作明细", rows }] : [], notices };
}

/** Primary amounts come from validated event fields, never from generated prose. */
export function eventActionPreview(input: LedgerEventInput, summary: string): AssistantActionPreview {
  const fallback = summaryActionPreview(summary);
  if (!input.kind) return fallback;
  const kind = input.kind;
  const paid = eventCashflowCents(input);
  const hasFlow = input.cashflow !== "none";
  const gift = kind === "gift_given";
  const knownValues = (input.items || []).every(item => item.estimated_value !== null);
  const giftValue = (input.amount_cents || 0) + (input.items || []).reduce((sum, item) => sum + Math.round((item.estimated_value || 0) * 100), 0);
  const rows = fallback.sections.flatMap(section => section.rows);
  const retained = rows.filter(row => !["日期", "事由", "礼金", "物品", "送礼合计价值", "付款用途待核对", "金额差异"].includes(row.label));
  const sections: AssistantActionPreview["sections"] = [];
  if (gift) sections.push({ title: "送礼明细", rows: [
    { label: "礼金", value: money(input.amount_cents || 0) },
    ...(input.items || []).map(item => ({ label: item.item_name, value: `${item.quantity}${item.unit || "件"} · ${item.estimated_value === null ? "未估值" : `价值 ${money(Math.round(item.estimated_value * 100))}`}` })),
  ] });
  sections.push({ title: input.operation === "undo" ? "撤销范围" : "保存与关联", rows: retained });
  const notices: AssistantActionPreview["notices"] = [];
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

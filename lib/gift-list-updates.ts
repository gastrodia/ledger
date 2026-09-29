import type { GiftRecord } from "@/types";

/** Matches the existing SQL ILIKE '%query%' search, including its wildcard semantics. */
export function matchesGiftSearch(value: string, query: string) {
  let pattern = "^";
  const escape = (char: string) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const chars = [...`%${query.trim()}%`];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === "\\" && i + 1 < chars.length) pattern += escape(chars[++i]);
    else pattern += char === "%" ? ".*" : char === "_" ? "." : escape(char);
  }
  return new RegExp(`${pattern}$`, "isu").test(value);
}

export function giftSummary(rows: { cash_amount?: number | null; items_estimated_total?: number }[]) {
  return {
    cashTotal: rows.reduce((sum, row) => sum + Math.round((row.cash_amount ?? 0) * 100), 0) / 100,
    itemEstimatedTotal: rows.reduce((sum, row) => sum + Math.round((row.items_estimated_total ?? 0) * 100), 0) / 100,
    recordCount: rows.length,
  };
}

export function groupGiftRecords(rows: GiftRecord[]) {
  const first = rows[0];
  const cash = rows.filter(row => row.gift_type === "cash");
  const items = rows.filter(row => row.gift_type === "item");
  const attachment = rows.find(row => row.attachment_key);
  return {
    id: first.group_id || first.id, counterparty_name: first.counterparty_name,
    gift_date: first.gift_date, notes: first.notes ?? null,
    cash_amount: cash.reduce((sum, row) => sum + Math.round((row.amount ?? 0) * 100), 0) / 100 || null,
    currency: cash[0]?.currency ?? null, items_count: items.length,
    items_estimated_total: items.reduce((sum, row) => sum + Math.round((row.estimated_value ?? 0) * 100), 0) / 100,
    attachment_key: attachment?.attachment_key ?? null, attachment_name: attachment?.attachment_name ?? null,
    attachment_type: attachment?.attachment_type ?? null,
  };
}

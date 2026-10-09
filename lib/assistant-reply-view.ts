import type { AssistantActionPreview } from "@/lib/assistant-action-preview";
import type { AssistantCategory, AssistantMember, AssistantQuery } from "@/lib/assistant";
import { fieldNames, resourceNames, type LedgerCommand, type LedgerResource } from "@/lib/assistant-commands";

export type AssistantReplyView = AssistantActionPreview & { analysis?: boolean };
const money = (value: unknown) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? `${Number(value) < 0 ? "-" : ""}¥${Math.abs(Number(value)).toFixed(2)}` : "金额待核对";
const day = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || "").slice(0, 10);
const names: Record<string, string> = { income: "收入", expense: "支出", lent: "借出", owed: "借入", money: "钱款", item: "物品", cash: "礼金", unpaid: "未还", partial: "部分归还", outstanding: "未结清", settled: "已结清", archived: "已归档", active: "未归档", pinned: "已置顶" };
const display = (value: unknown): string => value == null || value === "" ? "未填写" : typeof value === "boolean" ? value ? "是" : "否" : names[String(value)] || String(value);

/** Display only user-facing fields. IDs and internal metadata remain in record_context. */
export function recordReplyView(resource: string, rows: Record<string, unknown>[], command?: LedgerCommand | null, members: AssistantMember[] = [], categories: AssistantCategory[] = []): AssistantReplyView {
  const duplicate = command?.operation === "duplicates";
  const title = duplicate ? "疑似重复记录" : `${resourceNames[resource as LedgerResource] || "记录"}查询`;
  const sum = (values: unknown[]) => values.every(value => value != null && Number.isFinite(Number(value))) ? money(values.reduce<number>((total, value) => total + Math.round(Number(value) * 100), 0) / 100) : "金额待核对";
  const metrics: AssistantActionPreview["metrics"] = resource === "transactions" && !duplicate ? [
    { label: "本次收入", value: sum(rows.filter(row => row.type === "income").map(row => row.amount)) },
    { label: "本次支出", value: sum(rows.filter(row => row.type === "expense").map(row => row.amount)), primary: true },
  ] : resource === "gifts_given" || resource === "gift_records" ? [{ label: "礼金合计（不含物品估值）", value: sum(rows.filter(row => resource === "gifts_given" || row.gift_type === "cash").map(row => resource === "gifts_given" ? row.cash_amount ?? 0 : row.amount)), primary: true }] : [];
  if (resource === "loans") for (const direction of ["lent", "owed"]) metrics.push({ label: direction === "lent" ? "别人欠我（钱款）" : "我欠别人（钱款）", value: sum(rows.filter(row => row.subject_type === "money" && row.direction === direction).map(row => Math.max(0, Number(row.amount) - Number(row.repaid_total || 0)))) });
  return { title, subtitle: [`${rows.length} 条${duplicate ? "候选，尚未删除" : "记录"}`, command?.filter?.start_date && `从 ${command.filter.start_date}`, command?.filter?.end_date && `至 ${command.filter.end_date}`, command?.filter?.keyword && `包含“${command.filter.keyword}”`, command?.filter?.status && display(command.filter.status), command?.parent_name].filter(Boolean).join(" · "), metrics, sections: [],
    notices: rows.length ? duplicate ? [{ text: "类型、日期、金额和用途相同的记录仅作为候选，核对后再决定是否删除。", tone: "attention" }] : [] : [{ text: "没有找到符合条件的记录，可以调整日期、名称或筛选条件。", tone: "info" }],
    records: rows.map(row => {
      const headline = (resource === "transactions" ? row.description : resource === "notes" ? row.title : row.name || row.counterparty_name || row.recipient_name || row.item_name) || (resource === "notes" ? "未命名便签" : "记录");
      const amount = row.subject_type === "item" || row.gift_type === "item" ? `${row.item_quantity ?? row.quantity ?? ""}${row.item_unit || row.unit || "件"}`
        : row.amount != null ? money(row.amount) : row.cash_amount != null ? `礼金 ${money(row.cash_amount)}` : row.repaid_amount != null ? money(row.repaid_amount) : row.repaid_quantity != null ? `归还 ${row.repaid_quantity} 件` : undefined;
      const detailRows: { label: string; value: string }[] = [];
      for (const key of ["description", "occasion", "event_type", "location", "item_name", "notes", "content", "archived", "pinned"]) if (row[key] != null && row[key] !== "" && row[key] !== headline) detailRows.push({ label: key === "description" && resource !== "transactions" ? "说明" : fieldNames[key], value: display(row[key]) });
      if (row.archived_at) detailRows.push({ label: "状态", value: "已归档" });
      if (row.pinned_at) detailRows.push({ label: "置顶", value: "是" });
      if (Array.isArray(row.items)) for (const item of row.items as Record<string, unknown>[]) detailRows.push({ label: String(item.item_name || "礼品"), value: `${item.quantity ?? ""}${item.unit || "件"}${item.estimated_value != null ? ` · 价值 ${money(item.estimated_value)}` : " · 未估值"}` });
      if (row.estimated_value != null) detailRows.push({ label: "物品估值", value: money(row.estimated_value) });
      if (row.repaid_total != null) {
        const item = row.subject_type === "item";
        detailRows.push({ label: "已还", value: item ? `${row.repaid_total}${row.item_unit || "件"}` : money(row.repaid_total) });
        detailRows.push({ label: "未还", value: item ? `${Math.max(0, Number(row.item_quantity) - Number(row.repaid_total))}${row.item_unit || "件"}` : money(Math.max(0, Number(row.amount) - Number(row.repaid_total))) });
      }
      return { title: String(headline), amount, subtitle: [day(row.transaction_date || row.gift_date || row.occurred_at || row.repaid_at || row.event_date), row.type ? display(row.type) : row.direction ? display(row.direction) : "", categories.find(c => c.id === row.category_id)?.name, members.find(m => m.id === row.member_id)?.name].filter(Boolean).join(" · "), rows: detailRows };
    }) };
}

export function queryReplyView(query: AssistantQuery, facts: { summary: Record<string, unknown>; breakdown: Record<string, unknown>[]; largest_records: Record<string, unknown>[] }, members: AssistantMember[], categories: AssistantCategory[]): AssistantReplyView {
  const cashflow = query.scope === "cashflow";
  const summary = facts.summary || {};
  return { title: cashflow ? "资金流水统计" : "日常收支统计", subtitle: [ `${query.start_date} 至 ${query.end_date}`, query.type && display(query.type), categories.find(c => c.id === query.category_id)?.name, members.find(m => m.id === query.member_id)?.name, query.keyword && `包含“${query.keyword}”` ].filter(Boolean).join(" · "), analysis: true,
    metrics: [{ label: cashflow ? "流入" : "收入", value: money(summary.income) }, { label: cashflow ? "流出" : "支出", value: money(summary.expense), primary: true }, { label: cashflow ? "净流入" : "结余", value: money(summary.balance) }, { label: "记录数", value: summary.count == null ? "待核对" : `${summary.count} 笔` }],
    sections: facts.breakdown.length ? [{ title: "分类汇总（金额从高到低，最多 20 类）", rows: facts.breakdown.map(row => ({ label: `${row.category} · ${display(row.type)}`, value: `${money(row.amount)} · ${row.count} 笔` })) }] : [],
    recordsTitle: "大额明细", records: facts.largest_records.map(row => ({ title: String(row.description || row.category || "未填写用途"), subtitle: [row.date, display(row.type), row.category, row.member].filter(Boolean).join(" · "), amount: money(row.amount) })),
    notices: [{ text: `${cashflow ? "包含借还本金的资金流动。" : "不含借还本金。"}结余不代表账户余额。${Number(summary.count) > facts.largest_records.length ? "明细仅列金额最大的 20 笔，汇总包含筛选范围内全部记录。" : Number(summary.count) === 0 ? "该范围暂无记录。" : ""}`, tone: "info" }] };
}

export function resultReplyView(text: string, title = "处理结果"): AssistantReplyView {
  return { title, metrics: [], sections: [], notices: [{ text, tone: "info" }] };
}

export function draftReplyView(message: import("@/lib/assistant-task-client").AssistantConversationMessage, messages: import("@/lib/assistant-task-client").AssistantConversationMessage[], members: AssistantMember[], categories: AssistantCategory[]): AssistantActionPreview | undefined {
  const choice = message.confirmChoice || message.removeChoice || message.undoChoice;
  if (!choice) return;
  const target = messages.find(item => item.id === choice.batch_id);
  let selected = target?.drafts?.filter(draft => choice.draft_ids.includes(draft.id)) || [];
  if ("snapshot" in choice && typeof choice.snapshot === "string") { try { selected = JSON.parse(choice.snapshot); } catch { return; } }
  if (!Array.isArray(selected)) return;
  const totals = { income: 0, expense: 0 };
  let valid = true;
  for (const draft of selected) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(draft.amount) || !["income", "expense"].includes(draft.type)) { valid = false; continue; }
    totals[draft.type] += Math.round(Number(draft.amount) * 100);
  }
  return { title: message.undoChoice ? `撤销 ${selected.length} 笔入账` : message.removeChoice ? `删除 ${selected.length} 笔待确认草稿` : `准备将以下 ${selected.length} 笔草稿入账`, subtitle: "请核对以下明细", metrics: valid ? [{ label: "涉及收入", value: money(totals.income / 100) }, { label: "涉及支出", value: money(totals.expense / 100), primary: true }] : [], sections: [],
    records: selected.map(draft => ({ title: draft.description || "未填写用途", amount: money(draft.amount), subtitle: [draft.transaction_date, display(draft.type), members.find(member => member.id === draft.member_id)?.name || "未选成员", categories.find(category => category.id === draft.category_id)?.name || "未选分类"].join(" · ") })),
    notices: [{ text: message.undoChoice ? "确认后撤销所选入账，并恢复为待确认草稿。" : message.removeChoice ? `尚未删除，也不会影响已入账记录。确认后本组剩余 ${(target?.drafts?.length || selected.length) - selected.length} 笔。` : "尚未入账，仅保存本次选中的草稿。", tone: message.removeChoice || message.undoChoice ? "attention" : "info" }] };
}

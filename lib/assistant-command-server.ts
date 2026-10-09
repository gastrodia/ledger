import { summaryActionPreview, withoutApprovalExpiry, type AssistantActionPreview } from "@/lib/assistant-action-preview";
import type { LedgerEventContext } from "@/lib/ledger-event";
import type { PreparedLedgerEvent } from "@/lib/ledger-event-server";
import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { AssistantPlan } from "@/lib/assistant";
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { commandValues, fieldNames, resourceNames, validateCommandRow, validateLedgerCommand, type AssistantActionResult, type AssistantApproval, type LedgerCommand, type LedgerResource, type LedgerRow } from "@/lib/assistant-commands";

const resources: Record<LedgerResource, { table: string; text: string[]; date?: string; type?: string; amount?: string; parent?: string }> = {
  transactions: { table: "transactions", text: ["description"], date: "transaction_date", type: "type", amount: "amount" },
  categories: { table: "categories", text: ["name"], type: "type" }, members: { table: "members", text: ["name"] },
  loans: { table: "loans", text: ["counterparty_name", "notes", "item_name"], date: "occurred_at", type: "direction", amount: "amount" },
  repayments: { table: "loan_repayments", text: ["notes"], date: "repaid_at", amount: "repaid_amount", parent: "loan_id" },
  giftbooks: { table: "giftbooks", text: ["name", "location", "description"], date: "event_date", type: "event_type" },
  gift_records: { table: "gift_records", text: ["counterparty_name", "item_name", "notes"], date: "gift_date", type: "gift_type", amount: "amount", parent: "giftbook_id" },
  gifts_given: { table: "given_gifts", text: ["recipient_name", "occasion", "notes"], date: "gift_date", amount: "cash_amount" },
  notes: { table: "notes", text: ["title", "content"], date: "created_at" },
};
type CommandItem = { id: string; before: LedgerRow | null; values: Record<string, unknown> };
type Prepared = { preview?: AssistantActionPreview; command: LedgerCommand; items: CommandItem[]; dependencies: Array<{ resource: LedgerResource; row: LedgerRow }>; summary: string; links?: Array<{ source_type: string; source_id: string; transaction_id: string | null; group_rows?: LedgerRow[] }> };
type ActionRow = { id: string; user_id: string; conversation_id: string; status: AssistantActionResult["status"]; payload: Prepared | PreparedLedgerEvent; summary: string; expires_at: string; result: AssistantActionResult | null };
type AgentPreviewKey = { userId: string; conversationId: string; goalId: string; fingerprint: string; signal: AbortSignal };
const agentPreviewKeys = new AsyncLocalStorage<AgentPreviewKey>();
function agentPreviewId(key: AgentPreviewKey) {
  const hash = createHash("sha256").update(JSON.stringify([key.userId, key.conversationId, key.goalId, key.fingerprint])).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
function replayAgentPreview(row: ActionRow, key: AgentPreviewKey): { reply: string; approval: AssistantApproval; event_context?: LedgerEventContext } {
  const marker = (row.payload as unknown as { _agent_preview?: { goal_id: string; fingerprint: string } })._agent_preview;
  if (row.user_id !== key.userId || row.conversation_id !== key.conversationId || marker?.goal_id !== key.goalId || marker.fingerprint !== key.fingerprint) throw new Error("确认方案的任务范围不一致。");
  if (row.status !== "pending") throw new Error(row.result?.text || "原方案已经处理，请先核对结果，不要重复生成。");
  const payload = row.payload;
  return { reply: row.summary, approval: { id: row.id, summary: row.summary, count: "items" in payload ? payload.items.length : 1, expires_at: null, preview: payload.preview || summaryActionPreview(row.summary) },
    ...("event" in payload ? { event_context: { status: "pending" as const, event_id: payload.eventId, input: payload.input } } : {}) };
}
/** A lost response reuses the exact original preview, including server-generated record IDs. */
export async function prepareAssistantAgentPreview(userId: string, conversationId: string, goalId: string, fingerprint: string, signal: AbortSignal, work: () => Promise<Partial<AssistantPlan>>): Promise<Partial<AssistantPlan>> {
  if (!/^[0-9a-f-]{36}$/i.test(goalId) || !/^[0-9a-f]{64}$/i.test(fingerprint)) throw new Error("任务方案编号无效。");
  signal.throwIfAborted();
  await ensureAssistantActionsSchema();
  const key = { userId, conversationId, goalId, fingerprint, signal };
  if (await conversationCleared(userId, conversationId)) throw new Error("原对话已清空，本次操作未执行。");
  const rows = await sql.query("SELECT * FROM assistant_actions WHERE user_id=$1 AND id=$2", [userId, agentPreviewId(key)]);
  signal.throwIfAborted();
  if (rows[0]) return replayAgentPreview(rows[0] as ActionRow, key);
  return agentPreviewKeys.run(key, work);
}

/** Read the exact receipt targets; record presence alone does not prove a field update. */
export async function readAssistantAgentTargets(userId: string, targets: NonNullable<AssistantActionResult["targets"]>, actionId?: string) {
  const operations = ["create", "update", "delete", "reorder", "link", "unlink"];
  if (!Array.isArray(targets) || !targets.length || targets.length > 6 || targets.some(target => !Object.hasOwn(resources, target.resource) || !operations.includes(target.operation)
    || !Array.isArray(target.ids) || !target.ids.length || target.ids.length > 50 || new Set(target.ids).size !== target.ids.length || target.ids.some(id => !/^[0-9a-f-]{36}$/i.test(id)))) throw new Error("执行结果的核对范围无效。");
  let prepared: ActionRow["payload"] | undefined;
  if (actionId) {
    await ensureAssistantActionsSchema();
    const actions = await sql.query("SELECT * FROM assistant_actions WHERE user_id=$1 AND id=$2", [userId, actionId]);
    if (actions[0]?.status === "succeeded") prepared = (actions[0] as ActionRow).payload;
  }
  const equal = (key: string, actual: unknown, expected: unknown): boolean => {
    if (key === "pinned" || key === "archived") return Boolean(actual) === expected;
    if (/(?:^amount$|_amount$|estimated_value$|quantity$|sort_order$)/.test(key)) return expected == null ? actual == null : Number(actual) === Number(expected);
    if (/date$|_at$/.test(key) && typeof expected === "string" && /^\d{4}-\d{2}-\d{2}$/.test(expected)) return (typeof actual === "string" ? actual.slice(0, 10) : actual instanceof Date ? actual.toISOString().slice(0, 10) : "") === expected;
    if (key === "items") {
      const normalize = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value) as unknown;
      return commandFingerprint(normalize(actual)) === commandFingerprint(normalize(expected));
    }
    return expected == null ? actual == null : actual === expected;
  };
  const expectedFor = (resource: LedgerResource, rowId: string): Record<string, unknown> | undefined => {
    if (!prepared) return undefined;
    if ("items" in prepared && prepared.command.resource === resource) {
      if (prepared.command.operation === "reorder") return { sort_order: prepared.command.ids.indexOf(rowId) };
      if (["create", "update"].includes(prepared.command.operation)) return (prepared.command.operation === "create" ? prepared.items[0] : prepared.items.find(item => item.id === rowId))?.values;
    }
    if (!("event" in prepared)) return undefined;
    if (prepared.input.operation === "undo") return resource === "transactions" && rowId === prepared.transactionId && !prepared.ownsTransaction ? { flow_kind: prepared.previousFlowKind || "daily" } : undefined;
    const input = prepared.input, amount = Number(input.amount_cents) / 100;
    if (rowId === prepared.transactionId && resource === "transactions") {
      const flow_kind = ["loan_lent", "loan_borrowed", "repayment_received", "repayment_paid"].includes(input.kind || "") ? "loan" : "daily";
      if (!prepared.ownsTransaction) return { flow_kind };
      return { amount: Number(input.transaction_amount_cents ?? input.amount_cents) / 100, transaction_date: input.date, category_id: input.category_id, member_id: input.member_id, flow_kind };
    }
    if (rowId !== prepared.sourceId) return undefined;
    if (resource === "gifts_given") return { recipient_name: input.counterparty, cash_amount: amount, items: input.items || [], occasion: input.occasion, gift_date: input.date, notes: input.note };
    if (resource === "gift_records") return { giftbook_id: input.book_id, counterparty_name: input.counterparty, amount, gift_date: input.date, notes: input.note };
    if (resource === "repayments") return { loan_id: input.loan_id, repaid_amount: amount, repaid_at: input.date, notes: input.note };
    if (resource === "loans") return { direction: input.kind === "loan_lent" ? "lent" : "owed", subject_type: "money", counterparty_name: input.counterparty, amount, occurred_at: input.date, notes: input.note };
    return undefined;
  };
  let verified = true;
  const records: Array<{ resource: LedgerResource; operation: NonNullable<AssistantActionResult["targets"]>[number]["operation"]; ids: string[]; rows: Record<string, unknown>[] }> = [];
  for (const target of targets) {
    await ensureResource(target.resource);
    const dateColumn = resources[target.resource].date;
    const dateField = dateColumn ? `,TO_CHAR(${dateColumn},'YYYY-MM-DD') AS ${dateColumn}` : "";
    const rows = await sql.query(`SELECT *${dateField} FROM ${resources[target.resource].table} WHERE user_id=$1 AND id=ANY($2::varchar[])`, [userId, target.ids]) as LedgerRow[];
    if (target.operation === "delete") verified &&= rows.length === 0;
    else verified &&= target.ids.every(id => rows.some(row => row.id === id));
    for (const row of rows) {
      const expected = expectedFor(target.resource, row.id);
      if (expected) verified &&= Object.entries(expected).every(([key, value]) => equal(key, row[key === "pinned" ? "pinned_at" : key === "archived" ? "archived_at" : key], value));
    }
    if (prepared && "items" in prepared && ["link", "unlink"].includes(target.operation)) {
      const sourceType = ({ loans: "loan", repayments: "repayment", gifts_given: "given_gift", gift_records: "gift_group" } as Record<string, string>)[target.resource];
      for (const item of prepared.items) {
        const links = await sql.query("SELECT transaction_id FROM transaction_links WHERE user_id=$1 AND source_type=$2 AND source_id=$3", [userId, sourceType, item.before?.group_id || item.id]);
        verified &&= target.operation === "unlink" ? links.length === 0 : links.length === 1 && links[0].transaction_id === item.values.transaction_id;
      }
    }
    if (prepared && "event" in prepared && target.ids.includes(prepared.sourceId)) {
      const sourceType = ({ loans: "loan", repayments: "repayment", gifts_given: "given_gift", gift_records: "gift_group" } as Record<string, string>)[target.resource];
      const links = await sql.query("SELECT transaction_id FROM transaction_links WHERE user_id=$1 AND source_type=$2 AND source_id=$3", [userId, sourceType, prepared.sourceId]);
      verified &&= prepared.input.operation === "undo" || !prepared.transactionId ? links.length === 0 : links.length === 1 && links[0].transaction_id === prepared.transactionId;
    }
    // Keep actual field evidence small; attachment keys and account columns never enter the model.
    const keys = ["id", "name", "title", "type", "direction", "amount", "cash_amount", "repaid_amount", "transaction_date", "gift_date", "occurred_at", "repaid_at", "description", "category_id", "member_id", "counterparty_name", "recipient_name", "flow_kind", "loan_id", "giftbook_id"];
    records.push({ ...target, rows: rows.map(row => Object.fromEntries(keys.filter(key => key in row).map(key => [key, typeof row[key] === "string" ? (row[key] as string).slice(0, 160) : row[key]]))) });
  }
  return { verified, records };
}

async function conversationCleared(userId: string, conversationId: string) {
  try {
    const rows = await sql.query("SELECT cleared_at FROM assistant_task_conversations WHERE user_id=$1 AND id=$2", [userId, conversationId]);
    return !!rows[0]?.cleared_at;
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return false;
    throw error;
  }
}

export function commandFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest("hex");
}
export async function ensureAssistantActionsSchema() {
  try { await sql.query("SELECT id FROM assistant_actions LIMIT 0"); }
  catch (error) {
    if ((error as { code?: string }).code !== "42P01") throw error;
    await sql.query(`CREATE TABLE IF NOT EXISTS assistant_actions (
      id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id VARCHAR(36) NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payload JSONB NOT NULL,
      summary TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  }
}
async function ensureResource(resource: LedgerResource) {
  if (resource === "loans" || resource === "repayments") await (await import("@/lib/loans-schema")).ensureLoansSchema();
  if (resource === "gifts_given") await (await import("@/lib/gifts-given-schema")).ensureGiftsGivenSchema();
  if (resource === "giftbooks" || resource === "gift_records") await (await import("@/lib/giftbooks-schema")).ensureGiftBooksSchema();
  if (resource === "notes") await (await import("@/lib/notes-schema")).ensureNotesSchema();
  if (resource === "categories") await (await import("@/lib/categories-schema")).ensureCategoriesSchema();
}
async function byId(userId: string, resource: LedgerResource, id: string): Promise<LedgerRow | null> {
  const rows = await sql.query(`SELECT *${resource === "transactions" ? ",TO_CHAR(transaction_date,'YYYY-MM-DD') AS transaction_date" : ""} FROM ${resources[resource].table} WHERE user_id=$1 AND id=$2`, [userId, id]);
  return rows[0] as LedgerRow || null;
}
async function resolveParent(userId: string, command: LedgerCommand) {
  if (!resources[command.resource].parent) {
    if (command.parent_id || command.parent_name) throw new Error("该操作不需要指定上级记录。");
    return null;
  }
  const resource = command.resource === "repayments" ? "loans" : "giftbooks";
  if (command.parent_id) {
    const row = await byId(userId, resource, command.parent_id);
    if (!row) throw new Error("所属记录不存在或已变化。");
    return { resource, row } as const;
  }
  if (command.parent_name) {
    const name = resource === "loans" ? "counterparty_name" : "name";
    const rows = await sql.query(`SELECT * FROM ${resources[resource].table} WHERE user_id=$1 AND ${name}=$2`, [userId, command.parent_name]);
    if (rows.length !== 1) throw new Error(rows.length ? "找到多条同名记录，请先查询并指定具体哪一条。" : "没有找到指定的借还记录或礼簿，请核对名称。");
    command.parent_id = String(rows[0].id);
    return { resource, row: rows[0] as LedgerRow } as const;
  }
  if (command.operation === "create") throw new Error("请指定所属借还记录或礼簿。");
  return null;
}
export function buildCommandSelection(userId: string, c: LedgerCommand) {
  const config = resources[c.resource];
  const params: unknown[] = [userId];
  const where = ["r.user_id=$1"];
  const add = (expression: string, value: unknown) => { params.push(value); where.push(expression.replaceAll("?", `$${params.length}`)); };
  if (c.ids.length) add("r.id=ANY(?::varchar[])", c.ids);
  if (c.filter.keyword) add(`STRPOS(LOWER(CONCAT_WS(' ', ${config.text.map(k => `r.${k}`).join(",")})),LOWER(?::text))>0`, c.filter.keyword);
  if (c.parent_id && config.parent) add(`r.${config.parent}=?`, c.parent_id);
  if (c.resource === "gift_records") where.push("r.direction='received'");
  for (const [value, column, comparison] of [[c.filter.start_date, config.date, ">="], [c.filter.end_date, config.date, "<="], [c.filter.type, config.type, "="], [c.filter.amount_min, config.amount, ">="], [c.filter.amount_max, config.amount, "<="]] as const) {
    if (value != null) { if (!column) throw new Error("该记录不支持这项筛选条件。"); add(`r.${column}${column === config.date ? "::date" : ""}${comparison}?`, value); }
  }
  for (const key of ["category_id", "member_id"] as const) if (c.filter[key]) {
    if (c.resource !== "transactions") throw new Error("只有收支记录支持分类和成员筛选。");
    add(`r.${key}=?`, c.filter[key]);
  }
  let extra = "";
  if (c.resource === "loans") {
    extra = `,COALESCE((SELECT SUM(CASE WHEN r.subject_type='money' THEN p.repaid_amount ELSE p.repaid_quantity END) FROM loan_repayments p WHERE p.user_id=r.user_id AND p.loan_id=r.id),0) AS repaid_total`;
    if (c.filter.status) {
      if (!["unpaid", "partial", "outstanding", "settled"].includes(c.filter.status)) throw new Error("借还状态应为未还、部分归还或结清。");
      const repaid = `COALESCE((SELECT SUM(CASE WHEN r.subject_type='money' THEN p.repaid_amount ELSE p.repaid_quantity END) FROM loan_repayments p WHERE p.user_id=r.user_id AND p.loan_id=r.id),0)`;
      const due = "CASE WHEN r.subject_type='money' THEN r.amount ELSE r.item_quantity END";
      where.push(c.filter.status === "unpaid" ? `${repaid}<=0` : c.filter.status === "settled" ? `${repaid}>=(${due})` : c.filter.status === "outstanding" ? `${repaid}<(${due})` : `${repaid}>0 AND ${repaid}<(${due})`);
    }
  } else if (c.filter.status) {
    if (c.resource !== "notes" || !["archived", "active", "pinned"].includes(c.filter.status)) throw new Error("该记录不支持指定的状态筛选。");
    where.push(c.filter.status === "pinned" ? "r.pinned_at IS NOT NULL" : `r.archived_at IS ${c.filter.status === "active" ? "NULL" : "NOT NULL"}`);
  }
  // Calendar dates are not instants: preserve the database day before JSON serialization.
  // Transaction write snapshots use the same calendar representation as byId for fingerprint checks.
  if (config.date && (c.resource === "transactions" || (c.resource !== "notes" && ["list", "export", "duplicates"].includes(c.operation)))) extra += `,TO_CHAR(r.${config.date},'YYYY-MM-DD') AS ${config.date}`;
  return { text: `SELECT r.*${extra},COUNT(*) OVER()::int AS match_count FROM ${config.table} r WHERE ${where.join(" AND ")} ORDER BY ${config.date ? `r.${config.date} DESC,` : ""}r.id LIMIT 51`, params };
}
function originalRow(row: LedgerRow) {
  const copy = { ...row }; delete copy.match_count; delete copy.repaid_total; return copy;
}
function label(row: Record<string, unknown>) {
  return String(row.name || row.title || row.description || row.counterparty_name || row.recipient_name || row.notes || "未命名记录").slice(0, 150).replace(/[\n\r|]/g, " ");
}
const displayValues: Record<string, string> = { income: "收入", expense: "支出", owed: "我欠对方", lent: "对方欠我", money: "钱款", item: "物品", cash: "礼金", yellow: "黄色", pink: "粉色", green: "绿色", blue: "蓝色", purple: "紫色" };
function display(value: unknown) { return value == null ? "空" : typeof value === "boolean" ? value ? "是" : "否" : typeof value === "object" ? JSON.stringify(value) : displayValues[String(value)] || String(value); }
function calendar(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? "日期待核对" : parsed.toISOString().slice(0, 10);
}
function describe(row: Record<string, unknown>) {
  const date = row.transaction_date || row.occurred_at || row.repaid_at || row.gift_date || row.event_date;
  const amount = row.amount ?? row.cash_amount ?? row.repaid_amount;
  const qty = row.item_quantity ?? row.repaid_quantity ?? row.quantity;
  return `${label(row)}${row.direction || row.type ? ` · ${display(row.direction || row.type)}` : ""}${date ? ` · ${calendar(date)}` : ""}${amount != null ? ` · ¥${Number(amount).toFixed(2)}` : ""}${row.item_name ? ` · ${row.item_name}` : ""}${qty != null ? ` · ${qty}${row.item_unit || row.unit || "件"}` : ""}${Array.isArray(row.items) && row.items.length ? ` · 礼品：${row.items.map(item => `${item.item_name} ${item.quantity}${item.unit}`).join("、")}` : ""}`;
}
function csvCell(value: unknown) {
  let text = display(value); if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function totals(resource: LedgerResource, rows: LedgerRow[]) {
  const sum = (values: unknown[]) => (values.reduce<number>((total, value) => total + Math.round(Number(value || 0) * 100), 0) / 100).toFixed(2);
  if (resource === "transactions") return `\n本次范围合计：收入 ¥${sum(rows.filter(r => r.type === "income").map(r => r.amount))}，支出 ¥${sum(rows.filter(r => r.type === "expense").map(r => r.amount))}。`;
  if (resource === "loans") return `\n钱款未还合计：别人欠我 ¥${sum(rows.filter(r => r.subject_type === "money" && r.direction === "lent").map(r => Math.max(0, Number(r.amount) - Number(r.repaid_total))))}，我欠别人 ¥${sum(rows.filter(r => r.subject_type === "money" && r.direction === "owed").map(r => Math.max(0, Number(r.amount) - Number(r.repaid_total))))}。物品按各自数量查看，不折算现金。`;
  if (resource === "gift_records") return `\n本次范围礼金合计 ¥${sum(rows.filter(r => r.gift_type === "cash").map(r => r.amount))}；礼品估值另计。`;
  if (resource === "gifts_given") return `\n本次范围礼金合计 ¥${sum(rows.map(r => r.cash_amount))}；礼品估值另计。`;
  return "";
}
async function dependenciesFor(userId: string, c: LedgerCommand, items: CommandItem[]) {
  const dependencies: Prepared["dependencies"] = [];
  for (const item of items) {
    const merged = { ...item.before, ...item.values };
    if (c.resource === "transactions") {
      const category = await byId(userId, "categories", String(merged.category_id));
      const member = await byId(userId, "members", String(merged.member_id));
      if (c.operation !== "delete" && (!category || category.type !== merged.type || !member)) throw new Error("请指定有效且匹配收支类型的分类和成员。");
      if (category) dependencies.push({ resource: "categories", row: category });
      if (member) dependencies.push({ resource: "members", row: member });
    }
    if (c.operation === "delete" && ["categories", "members"].includes(c.resource)) {
      const column = c.resource === "categories" ? "category_id" : "member_id";
      const used = await sql.query(`SELECT id FROM transactions WHERE user_id=$1 AND ${column}=$2 LIMIT 1`, [userId, item.id]);
      if (used.length) throw new Error("该分类或成员仍被收支使用。请先通过对话迁移相关账目，再删除。");
    }
    if (c.operation === "delete" && ["loans", "giftbooks"].includes(c.resource)) {
      const resource: LedgerResource = c.resource === "loans" ? "repayments" : "gift_records";
      const column = c.resource === "loans" ? "loan_id" : "giftbook_id";
      const children = await sql.query(`SELECT * FROM ${resources[resource].table} WHERE user_id=$1 AND ${column}=$2 ORDER BY id`, [userId, item.id]);
      if (children.length > 100) throw new Error("关联明细超过 100 条，请先分批处理关联记录。");
      dependencies.push(...children.map(row => ({ resource, row: row as LedgerRow })));
    }
  }
  return dependencies;
}
export async function prepareLedgerCommand(userId: string, conversationId: string, raw: unknown): Promise<{ reply: string; event_context?: LedgerEventContext; approval?: AssistantApproval; export_file?: { name: string; csv: string }; record_context?: { resource: string; rows: Record<string, unknown>[] } }> {
  const command = validateLedgerCommand(raw);
  await ensureResource(command.resource);
  const parent = await resolveParent(userId, command);
  const selection = buildCommandSelection(userId, command);
  const rows = command.operation === "create" ? [] : await sql.query(selection.text, selection.params) as LedgerRow[];
  const count = Number(rows[0]?.match_count || 0);
  if (count > 50) throw new Error(`匹配到 ${count} 条记录。请补充日期、名称或其他条件，将单次范围缩小至 50 条以内；本次尚未执行。`);
  if (command.ids.length && rows.length !== command.ids.length) throw new Error("部分目标记录不存在或已变化，请重新查询。");
  if (["list", "export", "duplicates"].includes(command.operation)) {
    let listed = rows;
    if (command.operation === "duplicates") {
      if (command.resource !== "transactions") throw new Error("重复检查仅支持普通收支记录。");
      const groups = new Map<string, LedgerRow[]>();
      for (const row of rows) { const key = JSON.stringify([row.type, Number(row.amount), calendar(row.transaction_date), row.description]); groups.set(key, [...(groups.get(key) || []), row]); }
      listed = [...groups.values()].filter(group => group.length > 1).flat();
    }
    const fields = ["id", ...new Set(rows.flatMap(row => Object.keys(row)).filter(key => key !== "id" && key !== "attachment_key" && key in fieldNames))];
    const reply = listed.length ? `${command.operation === "duplicates" ? "以下是相同类型、日期、金额和用途的疑似重复候选，尚未删除" : `找到 ${count} 条${resourceNames[command.resource]}`}：\n${listed.map((row, i) => `${i + 1}. ${describe(row)}${row.repaid_total != null ? `，已还 ${row.repaid_total}，未还 ${Math.max(0, Number(row.amount ?? row.item_quantity) - Number(row.repaid_total))}` : ""}${command.resource === "notes" ? `\n   ${String(row.content).slice(0, 2000)}` : ""}`).join("\n")}` : "没有找到符合条件的记录。";
    return { reply: reply + (listed.length && command.operation !== "duplicates" ? totals(command.resource, listed) : ""), record_context: { resource: command.resource, rows: listed.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "attachment_key" && (key === "id" || key in fieldNames || ["loan_id", "giftbook_id", "group_id", "repaid_total", "archived_at", "pinned_at"].includes(key))))) }, ...(command.operation === "export" ? { export_file: { name: `${resourceNames[command.resource]}.csv`, csv: "\uFEFF" + fields.map(key => csvCell(fieldNames[key] || key)).join(",") + "\r\n" + rows.map(row => fields.map(key => csvCell(row[key])).join(",")).join("\r\n") } } : {}) };
  }
  // An event-owned source/flow must be changed as a unit, even when found through a normal ledger query.
  const eventTable = await sql.query("SELECT to_regclass('public.ledger_events') IS NOT NULL AS present");
  if (eventTable[0]?.present && rows.length) {
    const sourceType = ({ loans: "loan", repayments: "repayment", gift_records: "gift_group", gifts_given: "given_gift" } as Record<string, string>)[command.resource];
    const ids = rows.map(row => String(row.group_id || row.id));
    const events = command.resource === "transactions"
      ? await sql.query("SELECT id,input FROM ledger_events WHERE user_id=$1 AND state='saved' AND transaction_id=ANY($2::varchar[])", [userId, ids])
      : sourceType ? await sql.query("SELECT id,input FROM ledger_events WHERE user_id=$1 AND state='saved' AND source_type=$2 AND source_id=ANY($3::varchar[])", [userId, sourceType, ids]) : [];
    if (command.resource === "giftbooks" && command.operation === "delete") {
      const linked = await sql.query("SELECT e.id FROM ledger_events e JOIN gift_records r ON r.id=e.source_id AND r.user_id=e.user_id WHERE e.user_id=$1 AND e.state='saved' AND e.source_type='gift_group' AND r.giftbook_id=ANY($2::varchar[]) LIMIT 1", [userId, ids]);
      if (linked.length) throw new Error("礼簿中包含联动事项，请先逐件整体撤销收礼，再删除礼簿，避免留下孤立流水。");
    }
    if (events.length) {
      if (events.length !== 1 || rows.length !== 1 || !["update", "delete"].includes(command.operation)) throw new Error("这些记录属于联动事项，请一次明确一件要整体修改或撤销的事项，台账与流水会一起处理。");
      const values = commandValues(command);
      const keys: Record<string, string> = { amount: "amount_cents", cash_amount: "amount_cents", repaid_amount: "amount_cents", transaction_date: "date", gift_date: "date", occurred_at: "date", repaid_at: "date", notes: "note", category_id: "category_id", member_id: "member_id", counterparty_name: "counterparty", recipient_name: "counterparty" };
      if (Object.keys(values).some(key => !keys[key])) throw new Error("这项修改涉及联动事项，请说明整件事的新金额、日期、对方、备注或成员，以便同步修改台账与流水。");
      const patch = Object.fromEntries(Object.entries(values).map(([key, value]) => [keys[key], keys[key] === "amount_cents" ? Math.round(Number(value) * 100) : value]));
      const { prepareLedgerEvent } = await import("@/lib/ledger-event-server");
      return prepareLedgerEvent(userId, conversationId, { ...patch, event_id: events[0].id, operation: command.operation === "delete" ? "undo" : "update" });
    }
  }
  if (command.operation !== "create" && !rows.length) throw new Error("没有找到符合条件的记录，尚未执行。请核对名称或筛选条件。");
  if (command.operation !== "create" && command.scope === "one" && rows.length > 1) throw new Error(`找到 ${rows.length} 条相似记录，请指定日期、描述，或者明确说“全部”。\n${rows.map(row => `${describe(row)}`).join("\n")}`);
  if (["link", "unlink"].includes(command.operation) && rows.length !== 1) throw new Error("每次请明确指定一条来源记录进行关联。");
  const values = commandValues(command);
  const items: CommandItem[] = command.operation === "create" ? [{ id: randomUUID(), before: null, values }] : rows.map(row => ({ id: row.id, before: originalRow(row), values }));
  if (command.operation === "reorder") {
    if (!command.ids.length || !["income", "expense"].includes(command.filter.type || "")) throw new Error("请提供该收支类型下完整的分类顺序。");
    const all = await sql.query("SELECT id FROM categories WHERE user_id=$1 AND type=$2", [userId, command.filter.type]);
    if (all.length !== command.ids.length || all.some(row => !command.ids.includes(String(row.id)))) throw new Error("分类顺序需要包含该类型下的所有分类，请先查询分类。");
  }
  if (["create", "update"].includes(command.operation)) for (const item of items) validateCommandRow(command.resource, { ...item.before, ...values });
  const dependencies = await dependenciesFor(userId, command, items);
  if (parent) dependencies.push(parent);
  let links: Prepared["links"];
  if (["link", "unlink"].includes(command.operation)) {
    await (await import("@/lib/transaction-links-schema")).ensureTransactionLinksSchema();
    const source_type = { loans: "loan", repayments: "repayment", gifts_given: "given_gift", gift_records: "gift_group" }[command.resource as "loans"];
    const source_id = String(rows[0].group_id || rows[0].id);
    const existing = await sql.query("SELECT transaction_id FROM transaction_links WHERE user_id=$1 AND source_type=$2 AND source_id=$3", [userId, source_type, source_id]);
    links = [{ source_type, source_id, transaction_id: existing[0]?.transaction_id as string || null }];
    if (command.resource === "gift_records") {
      const group = await sql.query("SELECT * FROM gift_records WHERE user_id=$1 AND COALESCE(group_id,id)=$2 ORDER BY id LIMIT 101", [userId, source_id]) as LedgerRow[];
      if (group.length > 100) throw new Error("该收礼组明细过多，请先核对并缩小范围。");
      links[0].group_rows = group;
    }
    if (command.operation === "link") {
      const transaction = await byId(userId, "transactions", String(values.transaction_id));
      if (!transaction) throw new Error("要关联的收支记录不存在，请先查询具体记录。");
      dependencies.push({ resource: "transactions", row: transaction });
    }
  }
  const names = new Map(dependencies.map(dep => [dep.row.id, label(dep.row)]));
  const show = (value: unknown) => names.get(String(value)) || display(value);
  const verb = { create: "新增", update: "修改", delete: "删除", reorder: "重新排序", list: "查询", export: "导出", duplicates: "检查重复", link: "关联收支", unlink: "解除关联" }[command.operation];
  const preview = items.map((item, i) => `${i + 1}. ${describe(item.before || values)}${["create", "update", "link"].includes(command.operation) ? `\n${Object.entries(values).map(([key, value]) => `   ${fieldNames[key]}：${item.before ? `${show(key === "pinned" ? !!item.before.pinned_at : key === "archived" ? !!item.before.archived_at : key === "attachment_key" ? item.before[key] ? "已有附件" : null : item.before[key])} → ` : ""}${show(value)}`).join("\n")}` : ""}`).join("\n");
  const children = dependencies.filter(dep => ["repayments", "gift_records"].includes(dep.resource));
  const groupScope = links?.[0]?.group_rows;
  const summary = `将${verb} ${items.length} 条${resourceNames[command.resource]}：\n${preview}${parent ? `\n所属：${describe(parent.row)}` : ""}${groupScope?.length ? `\n收礼按整组关联，影响本组 ${groupScope.length} 条明细：\n${groupScope.map(row => `- ${describe(row)}`).join("\n")}` : ""}${command.operation === "reorder" ? `\n新顺序：${command.ids.map(id => label(rows.find(row => row.id === id)!)).join(" → ")}` : ""}${children.length ? `\n同时删除 ${children.length} 条关联明细：\n${children.map(dep => `- ${describe(dep.row)}`).join("\n")}` : ""}${command.operation === "delete" ? "\n删除后无法通过本次对话恢复；记录附带的附件也可能被删除。" : ""}${["loans", "repayments", "giftbooks", "gift_records", "gifts_given"].includes(command.resource) ? "\n这只更新相应台账，不会自动新增或改动普通收支记录。" : ""}\n尚未执行。回复“确认执行”批准，或回复“取消”。`;
  const actionPreview: AssistantActionPreview = command.resource === "notes" && command.operation === "create" ? {
    title: "创建便利贴", approveLabel: "创建便利贴", metrics: [],
    sections: [{ title: "便利贴内容", rows: Object.entries(values).map(([key, value]) => ({ label: fieldNames[key], value: show(value) })) }],
    notices: [{ text: "便利贴仅保存文字备忘，不会定时提醒或发送通知。", tone: "info" }],
  } : command.resource === "transactions" && command.operation === "update" ? {
    title: "修改已入账账目", approveLabel: "确认修改", metrics: [],
    records: items.map(item => ({ title: label(item.before!), subtitle: [calendar(item.before!.transaction_date), show(item.before!.category_id), show(item.before!.member_id)].join(" · "),
      rows: Object.entries(values).map(([key, value]) => {
        const format = (input: unknown) => key === "amount" ? `¥${Number(input).toFixed(2)}` : key === "transaction_date" ? calendar(input) : show(input);
        return { label: fieldNames[key], value: `${format(item.before![key])} → ${format(value)}` };
      }) })), sections: [], notices: [{ text: "确认后修改原记录，其余信息保持不变，不会新增账目。", tone: "info" }],
  } : summaryActionPreview(summary);
  return saveAssistantApproval(userId, conversationId, { command, items, dependencies, summary, links }, summary, items.length, actionPreview);
}

export async function saveAssistantApproval(userId: string, conversationId: string, payload: unknown, summary: string, count = 1, preview: AssistantActionPreview = summaryActionPreview(summary)) {
  const key = agentPreviewKeys.getStore();
  if (key && (key.userId !== userId || key.conversationId !== conversationId)) throw new Error("任务方案的账号或对话范围不一致。");
  key?.signal.throwIfAborted();
  const id = key ? agentPreviewId(key) : randomUUID();
  // Keep the legacy NOT NULL column compatible; infinity means no time-based expiry.
  const expires = "infinity";
  await ensureAssistantActionsSchema();
  if (await conversationCleared(userId, conversationId)) throw new Error("原对话已清空，本次操作未执行。");
  // Each preview remains independently reviewable until explicitly decided.
  if (key) {
    const storedPayload = { ...(payload as object), preview, _agent_preview: { goal_id: key.goalId, fingerprint: key.fingerprint } };
    await sql.query("INSERT INTO assistant_actions(id,user_id,conversation_id,payload,summary,expires_at) VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT (id) DO NOTHING", [id, userId, conversationId, JSON.stringify(storedPayload), summary, expires]);
    if (key.signal.aborted) {
      await sql.query("UPDATE assistant_actions SET status='cancelled',updated_at=NOW() WHERE user_id=$1 AND id=$2 AND status='pending'", [userId, id]);
      key.signal.throwIfAborted();
    }
    const rows = await sql.query("SELECT * FROM assistant_actions WHERE user_id=$1 AND id=$2", [userId, id]);
    if (!rows[0]) throw new Error("确认方案暂未保存，请重试。");
    return replayAgentPreview(rows[0] as ActionRow, key);
  }
  await sql.query("INSERT INTO assistant_actions(id,user_id,conversation_id,payload,summary,expires_at) VALUES($1,$2,$3,$4::jsonb,$5,$6)", [id, userId, conversationId, JSON.stringify({ ...(payload as object), preview }), summary, expires]);
  return { reply: summary, approval: { id, summary, count, expires_at: null, preview } };
}

type Handler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
async function dispatch(c: LedgerCommand, item: CommandItem): Promise<Response> {
  if (c.operation === "link" || c.operation === "unlink") {
    const api = await import("@/app/api/transaction-links/route");
    const sourceType = { loans: "loan", repayments: "repayment", gifts_given: "given_gift", gift_records: "gift_group" }[c.resource as "loans"];
    return (c.operation === "link" ? api.PUT : api.DELETE)(new NextRequest("http://ledger.internal/assistant-operation", { method: c.operation === "link" ? "PUT" : "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceType, sourceId: item.before?.group_id || item.id, transactionId: item.values.transaction_id }) }));
  }
  const create = c.operation === "create";
  const routes = {
    transactions: () => import("@/app/api/transactions/[id]/route"),
    categories: () => create ? import("@/app/api/categories/route") : c.operation === "reorder" ? import("@/app/api/categories/reorder/route") : import("@/app/api/categories/[id]/route"),
    members: () => create ? import("@/app/api/members/route") : import("@/app/api/members/[id]/route"),
    loans: () => create ? import("@/app/api/loans/route") : import("@/app/api/loans/[id]/route"),
    repayments: () => create ? import("@/app/api/loans/[id]/repayments/route") : import("@/app/api/loan-repayments/[id]/route"),
    giftbooks: () => create ? import("@/app/api/giftbooks/route") : import("@/app/api/giftbooks/[id]/route"),
    gift_records: () => create ? import("@/app/api/giftbooks/[id]/records/route") : import("@/app/api/gift-records/[id]/route"),
    gifts_given: () => create ? import("@/app/api/gifts-given/route") : import("@/app/api/gifts-given/[id]/route"),
    notes: () => create ? import("@/app/api/notes/route") : import("@/app/api/notes/[id]/route"),
  };
  const route = await routes[c.resource]() as unknown as Record<string, Handler>;
  const method = create ? "POST" : c.operation === "delete" ? "DELETE" : "PATCH";
  const body = c.operation === "reorder" ? { type: c.filter.type, ids: c.ids } : item.values;
  return route[method](new NextRequest("http://ledger.internal/assistant-operation", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: create && c.parent_id ? c.parent_id : item.id }) });
}
export async function getAssistantAction(userId: string, id: string): Promise<AssistantActionResult> {
  await ensureAssistantActionsSchema();
  const rows = await sql.query("SELECT * FROM assistant_actions WHERE user_id=$1 AND id=$2", [userId, id]);
  if (!rows.length) throw new Error("该确认方案不存在。");
  const row = rows[0] as ActionRow;
  if (row.status === "pending" && await conversationCleared(userId, row.conversation_id)) {
    await sql.query("UPDATE assistant_actions SET status='cancelled',updated_at=NOW() WHERE user_id=$1 AND id=$2 AND status='pending'", [userId, id]);
    return { id, status: "cancelled", text: "原对话已清空，本次操作已取消。" };
  }
  const result = { preview: row.payload.preview || summaryActionPreview(row.summary), ...(row.result || { id, status: row.status, text: row.status === "pending" ? withoutApprovalExpiry(row.summary) : row.status === "executing" ? "操作正在执行或结果待核对，请查询本次操作状态，不要重复创建同一操作。" : "本次操作已取消，未执行。" }) };
  if (result.transaction_updates?.length) result.transaction_updates = await (await import("@/lib/assistant-saved-records")).savedTransactionUpdates(userId, result.transaction_updates.map(row => row.transaction_id));
  return result;
}
export async function decideAssistantAction(userId: string, id: string, decision: "approve" | "cancel"): Promise<AssistantActionResult> {
  await ensureAssistantActionsSchema();
  if (decision === "cancel") {
    await sql.query("UPDATE assistant_actions SET status='cancelled',updated_at=NOW() WHERE user_id=$1 AND id=$2 AND status='pending'", [userId, id]);
    return getAssistantAction(userId, id);
  }
  const current = await getAssistantAction(userId, id);
  if (current.status !== "pending") return current;
  const stored = await sql.query("SELECT * FROM assistant_actions WHERE user_id=$1 AND id=$2", [userId, id]);
  const eventPayload = (stored[0] as ActionRow | undefined)?.payload;
  const agentKey = (eventPayload as unknown as { _agent_preview?: { goal_id: string } } | undefined)?._agent_preview;
  if (agentKey) {
    const tasks = await sql.query(`SELECT t.id FROM assistant_tasks t JOIN assistant_task_conversations c ON c.user_id=t.user_id AND c.id=t.conversation_id
      WHERE t.user_id=$1 AND t.id=$2 AND t.conversation_id=$3 AND t.status='succeeded' AND c.cleared_at IS NULL
        AND t.agent_checkpoint->>'status'='waiting_approval' AND t.agent_checkpoint->'pending_approval'->>'action_id'=$4`, [userId, agentKey.goal_id, (stored[0] as ActionRow).conversation_id, id]);
    if (!tasks.length) throw new Error("该方案所属任务已停止或尚未准备完成，请刷新任务后重新核对。");
  }
  if (eventPayload && "event" in eventPayload) {
    const { executeLedgerEvent } = await import("@/lib/ledger-event-server");
    return executeLedgerEvent(userId, id, eventPayload);
  }
  // Only this conditional claim authorizes a write; model generation cannot call it.
  const claimed = agentKey ? (await sql.transaction([
    sql.query("SELECT id FROM assistant_task_conversations WHERE user_id=$1 AND id=$2 FOR UPDATE", [userId, (stored[0] as ActionRow).conversation_id]),
    sql.query("SELECT id FROM assistant_tasks WHERE user_id=$1 AND id=$2 FOR SHARE", [userId, agentKey.goal_id]),
    sql.query(`UPDATE assistant_actions SET status='executing',updated_at=NOW() WHERE user_id=$1 AND id=$2 AND status='pending'
      AND EXISTS (SELECT 1 FROM assistant_tasks t JOIN assistant_task_conversations c ON c.user_id=t.user_id AND c.id=t.conversation_id
        WHERE t.user_id=$1 AND t.id=$3 AND t.conversation_id=assistant_actions.conversation_id AND t.status='succeeded' AND c.cleared_at IS NULL
          AND t.agent_checkpoint->>'status'='waiting_approval' AND t.agent_checkpoint->'pending_approval'->>'action_id'=$2) RETURNING *`, [userId, id, agentKey.goal_id]),
  ], { isolationLevel: "ReadCommitted" }))[2] : await sql.query("UPDATE assistant_actions SET status='executing',updated_at=NOW() WHERE user_id=$1 AND id=$2 AND status='pending' RETURNING *", [userId, id]);
  if (!claimed.length) return getAssistantAction(userId, id);
  const payload = (claimed[0] as ActionRow).payload as Prepared;
  let completed = 0;
  let recordsChanged = false;
  let result: AssistantActionResult;
  const affectedIds: string[] = [];
  try {
    for (const item of payload.items) if (item.before && commandFingerprint(await byId(userId, payload.command.resource, item.id)) !== commandFingerprint(item.before)) { recordsChanged = true; throw new Error("目标记录在确认期间已变化，请重新核对最新内容。"); }
    for (const dep of payload.dependencies) if (commandFingerprint(await byId(userId, dep.resource, dep.row.id)) !== commandFingerprint(dep.row)) throw new Error("相关分类、成员或明细已变化，请重新生成预览。");
    // Recheck cascades and usage so new child rows cannot be silently deleted.
    const currentDeps = await dependenciesFor(userId, payload.command, payload.items);
    const expectedChildren = payload.dependencies.filter(dep => ["repayments", "gift_records"].includes(dep.resource));
    const currentChildren = currentDeps.filter(dep => ["repayments", "gift_records"].includes(dep.resource));
    if (commandFingerprint(currentChildren) !== commandFingerprint(expectedChildren)) throw new Error("关联明细已变化，请重新核对删除范围。");
    for (const link of payload.links || []) {
      const current = await sql.query("SELECT transaction_id FROM transaction_links WHERE user_id=$1 AND source_type=$2 AND source_id=$3", [userId, link.source_type, link.source_id]);
      if (link.group_rows) {
        const group = await sql.query("SELECT * FROM gift_records WHERE user_id=$1 AND COALESCE(group_id,id)=$2 ORDER BY id LIMIT 101", [userId, link.source_id]);
        if (commandFingerprint(group) !== commandFingerprint(link.group_rows)) throw new Error("收礼组明细已变化，请重新核对整组关联范围。");
      }
      if ((current[0]?.transaction_id || null) !== link.transaction_id) throw new Error("原收支关联已变化，请重新确认。");
    }
    for (const item of payload.command.operation === "reorder" ? payload.items.slice(0, 1) : payload.items) {
      if (item.before && commandFingerprint(await byId(userId, payload.command.resource, item.id)) !== commandFingerprint(item.before)) throw new Error("该条记录已变化，已停止后续操作。");
      const response = await dispatch(payload.command, item);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "操作失败，请检查记录状态。");
      const responseRow = body.data && !Array.isArray(body.data) && typeof body.data === "object" ? body.data as Record<string, unknown> : null;
      const changedId = payload.command.operation === "create" ? responseRow?.id : item.id;
      if (typeof changedId === "string") affectedIds.push(changedId);
      completed += payload.command.operation === "reorder" ? payload.items.length : 1;
      await sql.query("UPDATE assistant_actions SET result=$3::jsonb,updated_at=NOW() WHERE user_id=$1 AND id=$2", [userId, id, JSON.stringify({ id, status: "executing", completed, text: `已完成 ${completed}/${payload.items.length} 条，正在核对结果。` })]);
    }
    result = { id, status: "succeeded", completed, text: `已完成：${{ create: "新增", update: "修改", delete: "删除", reorder: "排序", list: "查询", export: "导出", duplicates: "检查重复", link: "关联收支", unlink: "解除关联" }[payload.command.operation]} ${completed} 条${resourceNames[payload.command.resource]}。` };
    result.targets = [{ resource: payload.command.resource, operation: payload.command.operation as NonNullable<AssistantActionResult["targets"]>[number]["operation"], ids: payload.command.operation === "reorder" ? payload.items.map(item => item.id) : affectedIds }];
  } catch (error) {
    result = { id, status: "failed", completed, text: `${completed ? `已完成 ${completed} 条，其余未继续。` : "操作未完整完成。"}${error instanceof Error ? error.message : "结果暂未确认，请核对原记录。"}请先查询核对，不要重复提交已完成的记录。` };
  }
  if (payload.command.resource === "transactions" && payload.command.operation === "update") {
    try {
      result.transaction_updates = await (await import("@/lib/assistant-saved-records")).savedTransactionUpdates(userId, payload.items.map(item => item.id));
      if (recordsChanged && !completed) {
        const refreshed = await prepareLedgerCommand(userId, (claimed[0] as ActionRow & { conversation_id: string }).conversation_id, payload.command);
        if (refreshed.approval) {
          result.replacement_approval = refreshed.approval;
          result.text = "原记录在确认期间发生变化，本次没有修改。已按最新记录重新生成预览，请再次核对并确认。";
          refreshed.approval.preview?.notices.unshift({ text: result.text, tone: "attention" });
        }
      }
    } catch { result.text += " 最新记录未能同步到对话卡片，请查询交易记录核对。"; }
  }
  await sql.query("UPDATE assistant_actions SET status=$3,result=$4::jsonb,updated_at=NOW() WHERE user_id=$1 AND id=$2", [userId, id, result.status, JSON.stringify(result)]);
  return result;
}

import { sql } from "@/lib/db";
import { ensureAssistantSchema } from "@/lib/assistant-schema";
import { validateDraftEdit } from "@/lib/assistant-draft-actions";
import type { AssistantCategory, AssistantMember, AssistantSavedBatch } from "@/lib/assistant";
import type { LedgerCommand, SavedTransactionUpdate } from "@/lib/assistant-commands";

/** Translate only IDs from the reviewed batch, using the owner's durable mapping. */
export async function normalizeSavedRecordEdit(userId: string, raw: unknown, batch: AssistantSavedBatch, categories: AssistantCategory[], members: AssistantMember[]) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const output = raw as Record<string, unknown>;
  let command = output.command as LedgerCommand | undefined;
  if (output.action === "edit") {
    if ((output.edit as { batch_id?: string } | null)?.batch_id !== batch.batch_id) return raw;
    const edit = validateDraftEdit(output.edit, { ...batch, status: "pending" }, categories, members);
    const values = edit.edits.map(({ draft_id: _id, amount_cents, ...rest }) => {
      void _id;
      if ("payment_method" in rest || "note" in rest) throw new Error("已入账记录请修改用途说明；支付方式和识别备注不能作为独立字段修改。");
      return { ...rest, ...(amount_cents === undefined ? {} : { amount: amount_cents / 100 }) };
    });
    const canonical = (value: object) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    if (values.some(value => canonical(value) !== canonical(values[0]))) throw new Error("这些已入账记录需要改成不同内容，请逐笔说明并确认修改。");
    command = { resource: "transactions", operation: "update", scope: edit.edits.length === 1 ? "one" : "all", ids: edit.edits.map(edit => edit.draft_id), parent_id: null, parent_name: null,
      filter: { keyword: null, start_date: null, end_date: null, type: null, category_id: null, member_id: null, status: null, amount_min: null, amount_max: null }, values_json: JSON.stringify(values[0]) };
  }
  if (!command || !["edit", "manage"].includes(String(output.action)) || command.resource !== "transactions" || command.operation !== "update" || !Array.isArray(command.ids)) return raw;
  const draftIds = new Set(batch.drafts.map(draft => draft.id));
  if (!command.ids.some(id => draftIds.has(id))) return raw;
  await ensureAssistantSchema();
  const rows = await sql.query("SELECT draft_transactions,undone_draft_ids,revoked_at FROM assistant_batches WHERE user_id=$1 AND id=$2", [userId, batch.batch_id]);
  const stored = rows[0];
  if (!stored || stored.revoked_at) throw new Error("原入账批次不存在或已撤销，请核对交易记录后重新选择。");
  const mappings = stored.draft_transactions as { draft_id: string; transaction_id: string }[] | null;
  const undone = new Set(stored.undone_draft_ids as string[] || []);
  const ids = command.ids.map(id => {
    if (!draftIds.has(id)) return id;
    const mapping = mappings?.find(mapping => mapping.draft_id === id);
    if (!mapping || undone.has(id)) throw new Error("这笔账已撤销或缺少原记录映射，请在交易记录中重新选择。");
    return mapping.transaction_id;
  });
  return { ...output, action: "manage", drafts: [], query: null, edit: null, update: null, undo: null, remove: null, command: { ...command, ids } };
}

/** Read actual saved values; never update conversation cards from model prose. */
export async function savedTransactionUpdates(userId: string, ids: string[]): Promise<SavedTransactionUpdate[]> {
  if (!ids.length) return [];
  await ensureAssistantSchema();
  const rows = await sql.query(`SELECT b.id AS batch_id,m->>'draft_id' AS draft_id,t.id AS transaction_id,
    t.type,t.amount,t.category_id,t.member_id,TO_CHAR(t.transaction_date,'YYYY-MM-DD') AS transaction_date,t.description
    FROM assistant_batches b CROSS JOIN LATERAL jsonb_array_elements(b.draft_transactions) m
    JOIN transactions t ON t.id=m->>'transaction_id' AND t.user_id=b.user_id
    WHERE b.user_id=$1 AND b.revoked_at IS NULL AND t.id=ANY($2::varchar[])
      AND NOT b.undone_draft_ids @> jsonb_build_array(m->>'draft_id')`, [userId, ids]);
  return rows.map(row => ({ batch_id: String(row.batch_id), draft_id: String(row.draft_id), transaction_id: String(row.transaction_id), type: row.type as "income" | "expense",
    amount_cents: Math.round(Number(row.amount) * 100), category_id: row.category_id as string | null, member_id: row.member_id as string | null,
    transaction_date: String(row.transaction_date), description: String(row.description || "") }));
}

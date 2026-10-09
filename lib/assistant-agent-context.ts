import { sql } from "@/lib/db";
import { UUID_PATTERN } from "@/lib/assistant";

export type AssistantAgentContext = {
  provenance: "server_history_not_authorization";
  tasks: Array<{ task_id: string; request: string; action: string; reply: string; status: string; records?: { resource: string; rows: Record<string, string | number | boolean | null>[] } }>;
  actions: Array<{ action_id: string; status: string; text: string; completed?: number }>;
};
const resources = new Set(["transactions", "categories", "members", "loans", "repayments", "giftbooks", "gift_records", "gifts_given", "notes"]);
const fields = new Set(["id", "name", "title", "type", "direction", "amount", "amount_cents", "transaction_date", "description", "category_id", "member_id", "counterparty_name", "recipient_name", "occurred_at", "repaid_at", "repaid_amount", "repaid_quantity", "repaid_total", "subject_type", "item_name", "item_quantity", "item_unit", "gift_date", "gift_type", "cash_amount", "estimated_value", "quantity", "unit", "loan_id", "giftbook_id", "group_id", "event_date", "status"]);
const text = (value: unknown, limit: number) => typeof value === "string" ? value.slice(0, limit) : "";
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Only bounded application data enters future context, never raw requests or checkpoints. */
export function assistantAgentContextFromRows(taskRows: unknown[], actionRows: unknown[]): AssistantAgentContext {
  const tasks: AssistantAgentContext["tasks"] = [];
  for (const raw of taskRows.slice(0, 6).reverse()) {
    const row = object(raw), result = object(row?.result), input = object(row?.display_input);
    if (!row || typeof row.id !== "string" || !UUID_PATTERN.test(row.id) || row.status !== "succeeded" || !result) continue;
    const agent = object(result.agent);
    const status = text(agent?.status, 24) || "returned";
    const entry: AssistantAgentContext["tasks"][number] = { task_id: row.id, request: text(input?.message, 1000), action: text(result.action, 24), reply: text(result.reply, 1200), status };
    // References help resolve “those records”, but are explicitly stale snapshots.
    const records = object(result.record_context);
    if (records && typeof records.resource === "string" && resources.has(records.resource) && Array.isArray(records.rows)) {
      entry.records = { resource: records.resource, rows: records.rows.slice(0, 20).flatMap(rawRow => {
        const record = object(rawRow);
        if (!record || typeof record.id !== "string" || !UUID_PATTERN.test(record.id)) return [];
        return [Object.fromEntries(Object.entries(record).filter(([key, value]) => fields.has(key) && (value === null || ["string", "number", "boolean"].includes(typeof value)))
          .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 200) : value])) as Record<string, string | number | boolean | null>];
      }) };
    }
    tasks.push(entry);
  }
  const actions: AssistantAgentContext["actions"] = actionRows.slice(0, 12).flatMap(raw => {
    const row = object(raw), result = object(row?.result);
    if (!row || typeof row.id !== "string" || !UUID_PATTERN.test(row.id) || !["succeeded", "failed", "cancelled", "executing"].includes(String(row.status))) return [];
    return [{ action_id: row.id, status: String(row.status), text: text(result?.text, 800), ...(typeof result?.completed === "number" && Number.isSafeInteger(result.completed) && result.completed >= 0 ? { completed: result.completed } : {}) }];
  });
  return { provenance: "server_history_not_authorization", tasks, actions };
}

export async function loadAssistantAgentContext(userId: string, conversationId: string, currentTaskId?: string): Promise<AssistantAgentContext> {
  if (!UUID_PATTERN.test(conversationId) || (currentTaskId !== undefined && !UUID_PATTERN.test(currentTaskId))) throw new Error("对话或任务编号无效。");
  const taskRows = await sql.query(`SELECT t.id,t.status,t.display_input,t.result FROM assistant_tasks t
    JOIN assistant_task_conversations c ON c.user_id=t.user_id AND c.id=t.conversation_id
    WHERE t.user_id=$1 AND t.conversation_id=$2 AND c.cleared_at IS NULL AND t.status='succeeded'
      AND ($3::text IS NULL OR t.id<>$3)
    ORDER BY t.created_at DESC,t.id DESC LIMIT 6`, [userId, conversationId, currentTaskId ?? null]);
  let actionRows: unknown[] = [];
  try {
    actionRows = await sql.query(`SELECT a.id,a.status,a.result FROM assistant_actions a
      JOIN assistant_task_conversations c ON c.user_id=a.user_id AND c.id=a.conversation_id
      WHERE a.user_id=$1 AND a.conversation_id=$2 AND c.cleared_at IS NULL AND a.status IN ('succeeded','failed','cancelled','executing')
      ORDER BY a.updated_at DESC,a.id DESC LIMIT 12`, [userId, conversationId]);
  } catch (error) { if ((error as { code?: string }).code !== "42P01") throw error; }
  return assistantAgentContextFromRows(taskRows, actionRows);
}

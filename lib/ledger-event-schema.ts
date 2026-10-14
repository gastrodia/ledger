import { sql } from "@/lib/db";
import { ensureTransactionLinksSchema } from "@/lib/transaction-links-schema";
import { ensureAssistantActionsSchema } from "@/lib/assistant-command-server";

export async function ensureCashflowSchema() {
  try { await sql.query("SELECT flow_kind FROM transactions LIMIT 0"); }
  catch (error) {
    if ((error as { code?: string }).code !== "42703") throw error;
    await sql.query("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS flow_kind VARCHAR(20) NOT NULL DEFAULT 'daily' CHECK (flow_kind IN ('daily','loan'))");
  }
}
export async function ensureLedgerEventsSchema() {
  await ensureCashflowSchema();
  await ensureTransactionLinksSchema();
  await ensureAssistantActionsSchema();
}

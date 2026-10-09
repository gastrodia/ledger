import { sql } from "@/lib/db";
import { ensureTransactionLinksSchema } from "@/lib/transaction-links-schema";

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
  const present = await sql.query("SELECT to_regclass('public.ledger_events') IS NOT NULL AS present");
  if (present[0]?.present) return;
  await sql.query(`CREATE TABLE IF NOT EXISTS ledger_events (
    id VARCHAR(36) PRIMARY KEY,user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,source_type TEXT NOT NULL,source_id VARCHAR(36) NOT NULL,
    transaction_id VARCHAR(36),owns_transaction BOOLEAN NOT NULL,
    state TEXT NOT NULL DEFAULT 'saved' CHECK(state IN ('saved','undone')),input JSONB NOT NULL,
    original_flow_kind TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id,source_type,source_id)
  )`);
}

import { sql } from "@/lib/db";

export async function ensureAssistantSchema() {
  try { await sql`SELECT payload_hash,draft_snapshot,draft_transactions,undone_draft_ids,revoked_at FROM assistant_batches LIMIT 0`; }
  catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "42P01" && code !== "42703") throw error;
    await sql`CREATE TABLE IF NOT EXISTS assistant_batches (
      user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id VARCHAR(36) NOT NULL, payload_hash TEXT NOT NULL,
      transaction_ids JSONB NOT NULL, draft_snapshot JSONB, draft_transactions JSONB,
      undone_draft_ids JSONB NOT NULL DEFAULT '[]'::jsonb, revoked_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(), PRIMARY KEY (user_id, id)
    )`;
    await sql`ALTER TABLE assistant_batches
      ADD COLUMN IF NOT EXISTS draft_snapshot JSONB,
      ADD COLUMN IF NOT EXISTS draft_transactions JSONB,
      ADD COLUMN IF NOT EXISTS undone_draft_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP`;
  }
  try { await sql`SELECT payload_hash FROM assistant_undos LIMIT 0`; }
  catch (error) {
    if ((error as { code?: string }).code !== "42P01") throw error;
    await sql`CREATE TABLE IF NOT EXISTS assistant_undos (
      user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id VARCHAR(36) NOT NULL, batch_id VARCHAR(36) NOT NULL,
      payload_hash TEXT NOT NULL, restored_batch_id VARCHAR(36) NOT NULL,
      drafts JSONB NOT NULL, undone_draft_ids JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(), PRIMARY KEY (user_id, id),
      FOREIGN KEY (user_id,batch_id) REFERENCES assistant_batches(user_id,id) ON DELETE CASCADE
    )`;
  }
}

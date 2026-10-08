import { sql } from "@/lib/db";

export async function ensureAssistantSchema() {
  try { await sql`SELECT payload_hash FROM assistant_batches LIMIT 0`; }
  catch (error) {
    if ((error as { code?: string }).code !== "42P01") throw error;
    await sql`CREATE TABLE IF NOT EXISTS assistant_batches (
      user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id VARCHAR(36) NOT NULL, payload_hash TEXT NOT NULL,
      transaction_ids JSONB NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, id)
    )`;
  }
}

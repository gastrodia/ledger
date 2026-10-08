import { sql } from "@/lib/db";

export async function ensureAssistantTaskSchema() {
  try { await sql.query("SELECT t.id FROM assistant_tasks t, assistant_task_conversations c LIMIT 0"); }
  catch (error) {
    if ((error as { code?: string }).code !== "42P01") throw error;
    await sql.query(`-- A cleared conversation stays closed even when an earlier POST arrives late.
CREATE TABLE IF NOT EXISTS assistant_task_conversations (
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id VARCHAR(36) NOT NULL,
  cleared_at TIMESTAMPTZ,
  PRIMARY KEY (user_id,id)
)`);
    await sql.query(`-- AI generation tasks never write transactions. A task ID is its stable reply/batch ID.
CREATE TABLE IF NOT EXISTS assistant_tasks (
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id VARCHAR(36) NOT NULL,
  conversation_id VARCHAR(36) NOT NULL,
  user_message_id VARCHAR(36) NOT NULL,
  request_hash TEXT NOT NULL,
  payload JSONB,
  display_input JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  phase TEXT NOT NULL CHECK (phase IN ('thinking','images','query')),
  partial_text TEXT NOT NULL DEFAULT '',
  result JSONB,
  error TEXT,
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id,id)
)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS assistant_tasks_conversation_idx ON assistant_tasks (user_id,conversation_id,created_at)`);
  }
}

import { sql } from "@/lib/db";

// Read first: installations with the column already present need no DDL rights.
// An unsuccessful migration is never cached; the next request can retry.
export async function ensureNotesSchema() {
  try {
    await sql`SELECT color FROM notes LIMIT 0`;
  } catch (error) {
    if ((error as { code?: string }).code !== "42703") throw error;
    await sql`ALTER TABLE notes ADD COLUMN IF NOT EXISTS color VARCHAR(16) NOT NULL DEFAULT 'yellow' CHECK (color IN ('yellow', 'pink', 'green', 'blue', 'purple'))`;
  }
}

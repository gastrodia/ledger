import { sql } from "@/lib/db";

// Existing installations retain their creation-time order until first reordered.
export async function ensureCategoriesSchema() {
  try {
    await sql`SELECT sort_order FROM categories LIMIT 0`;
  } catch (error) {
    if ((error as { code?: string }).code !== "42703") throw error;
    await sql`ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order INTEGER`;
  }
}

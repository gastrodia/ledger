import { sql } from "@/lib/db";

/**
 * Ensure gifts-given tables exist.
 * This is idempotent (CREATE TABLE/INDEX IF NOT EXISTS).
 *
 * Note: On hosted DBs where the role lacks DDL privileges, this will fail; in that case
 * run the SQL in `scripts/init-db.sql` manually with an admin role.
 */
export async function ensureGiftsGivenSchema() {
  // given_gifts (master)
  await sql`
    CREATE TABLE IF NOT EXISTS given_gifts (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      recipient_name VARCHAR(128) NOT NULL,
      gift_date TIMESTAMP NOT NULL,
      occasion VARCHAR(255),
      notes TEXT,
      cash_amount DECIMAL(15, 2),
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      attachment_key VARCHAR(255),
      attachment_name VARCHAR(255),
      attachment_type VARCHAR(50),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `;

  // Columns added later (safe for existing DBs)
  await sql`ALTER TABLE given_gifts ADD COLUMN IF NOT EXISTS occasion VARCHAR(255)`;
  await sql`ALTER TABLE given_gifts ADD COLUMN IF NOT EXISTS cash_amount DECIMAL(15, 2)`;
  await sql`ALTER TABLE given_gifts ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE given_gifts ADD COLUMN IF NOT EXISTS attachment_key VARCHAR(255)`;
  await sql`ALTER TABLE given_gifts ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255)`;
  await sql`ALTER TABLE given_gifts ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(50)`;

  await sql`CREATE INDEX IF NOT EXISTS idx_given_gifts_user_id ON given_gifts(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_given_gifts_gift_date ON given_gifts(gift_date)`;

  // Backfill from legacy `given_gift_items` table (if exists) into `given_gifts.items`.
  // Then try to drop the legacy table (if permissions allow).
  try {
    const legacy = await sql`SELECT to_regclass('public.given_gift_items') as name`;
    const legacyName = (legacy[0] as any)?.name as string | null | undefined;
    if (legacyName) {
      // Fill items from legacy detail rows. Safe for cash-only gifts (subquery returns null -> []).
      await sql`
        UPDATE given_gifts g
        SET items = COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'item_name', i.item_name,
                'quantity', i.quantity,
                'unit', i.unit,
                'estimated_value', i.estimated_value
              )
              ORDER BY i.created_at ASC
            )
            FROM given_gift_items i
            WHERE i.gift_id = g.id AND i.user_id = g.user_id
          ),
          '[]'::jsonb
        )
      `;

      // Attempt to drop legacy table to keep "single table" expectation.
      // If DB role lacks privileges, we just leave it unused.
      try {
        await sql`DROP TABLE IF EXISTS given_gift_items`;
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}


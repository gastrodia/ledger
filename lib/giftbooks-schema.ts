import { sql } from "@/lib/db";

/**
 * Ensure giftbook tables exist.
 * This is idempotent (CREATE TABLE/INDEX IF NOT EXISTS).
 *
 * Note: On hosted DBs where the role lacks DDL privileges, this will fail; in that case
 * run the SQL in `scripts/init-db.sql` manually with an admin role.
 */
export async function ensureGiftBooksSchema() {
  // giftbooks
  await sql`
    CREATE TABLE IF NOT EXISTS giftbooks (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      name VARCHAR(128) NOT NULL,
      event_type VARCHAR(30),
      event_date DATE,
      location VARCHAR(255),
      description TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_giftbooks_user_id ON giftbooks(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_giftbooks_created_at ON giftbooks(created_at)`;

  // gift_records
  await sql`
    CREATE TABLE IF NOT EXISTS gift_records (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      giftbook_id VARCHAR(36) NOT NULL,
      direction VARCHAR(20) NOT NULL DEFAULT 'received' CHECK (direction IN ('received', 'given')),
      gift_type VARCHAR(20) NOT NULL CHECK (gift_type IN ('cash', 'item')),
      counterparty_name VARCHAR(128) NOT NULL,
      amount DECIMAL(15, 2),
      currency VARCHAR(10) DEFAULT 'CNY',
      attachment_key VARCHAR(255),
      attachment_name VARCHAR(255),
      attachment_type VARCHAR(50),
      item_name VARCHAR(255),
      quantity DECIMAL(15, 2),
      estimated_value DECIMAL(15, 2),
      gift_date TIMESTAMP NOT NULL,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (giftbook_id) REFERENCES giftbooks(id) ON DELETE CASCADE
    )
  `;

  // If the table already existed before we added columns, ensure columns are present.
  await sql`ALTER TABLE gift_records ADD COLUMN IF NOT EXISTS attachment_key VARCHAR(255)`;
  await sql`ALTER TABLE gift_records ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255)`;
  await sql`ALTER TABLE gift_records ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(50)`;

  await sql`CREATE INDEX IF NOT EXISTS idx_gift_records_user_id ON gift_records(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_gift_records_giftbook_id ON gift_records(giftbook_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_gift_records_gift_date ON gift_records(gift_date)`;
}


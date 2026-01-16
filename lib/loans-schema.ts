import { sql } from "@/lib/db";

/**
 * Ensure loans tables exist.
 * This is idempotent (CREATE TABLE/INDEX IF NOT EXISTS).
 *
 * Note: On hosted DBs where the role lacks DDL privileges, this will fail; in that case
 * run the SQL in `scripts/init-db.sql` manually with an admin role.
 */
export async function ensureLoansSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS loans (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      direction VARCHAR(20) NOT NULL CHECK (direction IN ('owed', 'lent')),
      subject_type VARCHAR(20) NOT NULL CHECK (subject_type IN ('money', 'item')),
      counterparty_name VARCHAR(128) NOT NULL,
      amount DECIMAL(15, 2),
      item_name VARCHAR(255),
      item_quantity DECIMAL(15, 3),
      item_unit VARCHAR(32),
      occurred_at TIMESTAMP NOT NULL,
      notes TEXT,
      attachment_key VARCHAR(255),
      attachment_name VARCHAR(255),
      attachment_type VARCHAR(50),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `;

  // Columns added later (safe for existing DBs)
  await sql`ALTER TABLE loans ADD COLUMN IF NOT EXISTS attachment_key VARCHAR(255)`;
  await sql`ALTER TABLE loans ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255)`;
  await sql`ALTER TABLE loans ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(50)`;

  await sql`CREATE INDEX IF NOT EXISTS idx_loans_user_id ON loans(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_loans_direction ON loans(direction)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_loans_occurred_at ON loans(occurred_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS loan_repayments (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      loan_id VARCHAR(36) NOT NULL,
      repaid_amount DECIMAL(15, 2),
      repaid_quantity DECIMAL(15, 3),
      repaid_at TIMESTAMP NOT NULL,
      notes TEXT,
      attachment_key VARCHAR(255),
      attachment_name VARCHAR(255),
      attachment_type VARCHAR(50),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE
    )
  `;

  await sql`ALTER TABLE loan_repayments ADD COLUMN IF NOT EXISTS attachment_key VARCHAR(255)`;
  await sql`ALTER TABLE loan_repayments ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255)`;
  await sql`ALTER TABLE loan_repayments ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(50)`;

  await sql`CREATE INDEX IF NOT EXISTS idx_loan_repayments_user_id ON loan_repayments(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_loan_repayments_loan_id ON loan_repayments(loan_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_loan_repayments_repaid_at ON loan_repayments(repaid_at)`;
}


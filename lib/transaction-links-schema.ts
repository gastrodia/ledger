import { sql } from "@/lib/db";
import { ensureGiftBooksSchema } from "@/lib/giftbooks-schema";
import { ensureGiftsGivenSchema } from "@/lib/gifts-given-schema";
import { ensureLoansSchema } from "@/lib/loans-schema";

/** Existing installations can apply scripts/transaction-links.sql with an admin role. */
export async function ensureTransactionLinksSchema() {
  const present = await sql`SELECT to_regclass('public.transaction_links') IS NOT NULL AS present`;
  if (present[0]?.present === true) return;
  await ensureGiftBooksSchema();
  await ensureGiftsGivenSchema();
  await ensureLoansSchema();
  await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(1818584946, 2)`,
    sql`CREATE TABLE IF NOT EXISTS transaction_links (
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('given_gift', 'gift_group', 'loan', 'repayment')),
  source_id VARCHAR(36) NOT NULL,
  transaction_id VARCHAR(36) NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  given_gift_id VARCHAR(36) REFERENCES given_gifts(id) ON DELETE CASCADE,
  loan_id VARCHAR(36) REFERENCES loans(id) ON DELETE CASCADE,
  repayment_id VARCHAR(36) REFERENCES loan_repayments(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, source_type, source_id),
  CHECK (
    (source_type = 'given_gift' AND given_gift_id IS NOT NULL AND given_gift_id = source_id AND loan_id IS NULL AND repayment_id IS NULL) OR
    (source_type = 'loan' AND loan_id IS NOT NULL AND loan_id = source_id AND given_gift_id IS NULL AND repayment_id IS NULL) OR
    (source_type = 'repayment' AND repayment_id IS NOT NULL AND repayment_id = source_id AND given_gift_id IS NULL AND loan_id IS NULL) OR
    (source_type = 'gift_group' AND given_gift_id IS NULL AND loan_id IS NULL AND repayment_id IS NULL)
  )
)`,
    sql`CREATE OR REPLACE FUNCTION cleanup_gift_group_transaction_link() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM transaction_links l
  WHERE l.user_id = OLD.user_id AND l.source_type = 'gift_group'
    AND l.source_id = COALESCE(OLD.group_id, OLD.id)
    AND NOT EXISTS (
      SELECT 1 FROM gift_records r WHERE r.user_id = l.user_id
        AND r.direction = 'received' AND COALESCE(r.group_id, r.id) = l.source_id
    );
  RETURN NULL;
END;
$$`,
    sql`DROP TRIGGER IF EXISTS gift_group_transaction_link_cleanup ON gift_records`,
    sql`CREATE CONSTRAINT TRIGGER gift_group_transaction_link_cleanup
AFTER DELETE OR UPDATE ON gift_records DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cleanup_gift_group_transaction_link()`,
  ]);
}

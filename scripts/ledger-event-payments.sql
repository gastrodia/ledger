-- Add multiple actual payments to gift events. Existing amounts and approvals are unchanged.
BEGIN;
SELECT pg_advisory_xact_lock(1818584946, 2);
ALTER TABLE ledger_events ADD COLUMN IF NOT EXISTS payments JSONB;
ALTER TABLE transaction_links DROP CONSTRAINT transaction_links_pkey,
  ADD PRIMARY KEY (user_id,source_type,source_id,transaction_id);
CREATE UNIQUE INDEX IF NOT EXISTS transaction_links_single_source
  ON transaction_links(user_id,source_type,source_id) WHERE source_type <> 'given_gift';
COMMIT;

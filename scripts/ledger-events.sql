-- Apply after init-db.sql (or existing loans, gifts and transaction-links migrations).
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS flow_kind VARCHAR(20) NOT NULL DEFAULT 'daily' CHECK (flow_kind IN ('daily','loan'));
CREATE TABLE IF NOT EXISTS ledger_events (
    id VARCHAR(36) PRIMARY KEY,user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,source_type TEXT NOT NULL,source_id VARCHAR(36) NOT NULL,
    transaction_id VARCHAR(36),owns_transaction BOOLEAN NOT NULL,
    state TEXT NOT NULL DEFAULT 'saved' CHECK(state IN ('saved','undone')),input JSONB NOT NULL,
    original_flow_kind TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id,source_type,source_id)
  );

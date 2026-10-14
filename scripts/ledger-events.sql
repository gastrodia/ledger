-- Cashflow classification used by linked bookkeeping operations.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS flow_kind VARCHAR(20) NOT NULL DEFAULT 'daily' CHECK (flow_kind IN ('daily','loan'));
-- Execution identity, ownership and restore data are stored in assistant_actions.

-- 创建用户表
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(128) NOT NULL UNIQUE,
    password TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 创建邮箱索引
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 创建用户名索引
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 创建分类表
CREATE TABLE IF NOT EXISTS categories (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    name VARCHAR(128) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
    color VARCHAR(20),
    icon VARCHAR(50),
    sort_order INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 创建分类的用户ID索引
CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);

-- 创建家庭成员表
CREATE TABLE IF NOT EXISTS members (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    name VARCHAR(128) NOT NULL,
    avatar VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 创建成员的用户ID索引
CREATE INDEX IF NOT EXISTS idx_members_user_id ON members(user_id);

-- 创建交易记录表
CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    category_id VARCHAR(36),
    member_id VARCHAR(36),
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
    amount DECIMAL(15, 2) NOT NULL,
    description TEXT,
    attachment_key VARCHAR(255),
    attachment_name VARCHAR(255),
    attachment_type VARCHAR(50),
    transaction_date TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
);

-- 创建交易记录的索引
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_member_id ON transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);

-- =========================
-- 留言 / 笔记模块
-- =========================

CREATE TABLE IF NOT EXISTS notes (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    title VARCHAR(255),
    content TEXT NOT NULL,
    color VARCHAR(16) NOT NULL DEFAULT 'yellow' CHECK (color IN ('yellow', 'pink', 'green', 'blue', 'purple')),
    pinned_at TIMESTAMP,
    archived_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_pinned_at ON notes(pinned_at);
CREATE INDEX IF NOT EXISTS idx_notes_archived_at ON notes(archived_at);

-- =========================
-- 礼簿模块
-- =========================

-- 创建礼簿表（一个礼簿对应一次事件/一本台账）
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
);

CREATE INDEX IF NOT EXISTS idx_giftbooks_user_id ON giftbooks(user_id);
CREATE INDEX IF NOT EXISTS idx_giftbooks_created_at ON giftbooks(created_at);

-- 创建礼簿记录表
CREATE TABLE IF NOT EXISTS gift_records (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    giftbook_id VARCHAR(36) NOT NULL,
    group_id VARCHAR(36),
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
    unit VARCHAR(32),
    estimated_value DECIMAL(15, 2),
    gift_date TIMESTAMP NOT NULL,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (giftbook_id) REFERENCES giftbooks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gift_records_user_id ON gift_records(user_id);
CREATE INDEX IF NOT EXISTS idx_gift_records_giftbook_id ON gift_records(giftbook_id);
CREATE INDEX IF NOT EXISTS idx_gift_records_gift_date ON gift_records(gift_date);
CREATE INDEX IF NOT EXISTS idx_gift_records_group_id ON gift_records(group_id);

-- =========================
-- 送礼模块（独立台账：我送给别人的）
-- =========================

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
);

CREATE INDEX IF NOT EXISTS idx_given_gifts_user_id ON given_gifts(user_id);
CREATE INDEX IF NOT EXISTS idx_given_gifts_gift_date ON given_gifts(gift_date);

-- =========================
-- 欠款 / 借款模块（借还）
-- =========================

-- 借还单（欠款/借款）
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
);

CREATE INDEX IF NOT EXISTS idx_loans_user_id ON loans(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_direction ON loans(direction);
CREATE INDEX IF NOT EXISTS idx_loans_occurred_at ON loans(occurred_at);

-- 归还记录（支持部分归还）
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
);

CREATE INDEX IF NOT EXISTS idx_loan_repayments_user_id ON loan_repayments(user_id);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_loan_id ON loan_repayments(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_repaid_at ON loan_repayments(repaid_at);

-- Manual associations; no ledger amounts are changed.
CREATE TABLE IF NOT EXISTS transaction_links (
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
);

-- Check the final transaction state: replacing all rows of a group must retain its link.
CREATE OR REPLACE FUNCTION cleanup_gift_group_transaction_link() RETURNS TRIGGER
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
$$;
DROP TRIGGER IF EXISTS gift_group_transaction_link_cleanup ON gift_records;
CREATE CONSTRAINT TRIGGER gift_group_transaction_link_cleanup
AFTER DELETE OR UPDATE ON gift_records DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cleanup_gift_group_transaction_link();

-- AI assistant confirmation batches: the marker and its transactions commit together.
CREATE TABLE IF NOT EXISTS assistant_batches (
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id VARCHAR(36) NOT NULL,
    payload_hash TEXT NOT NULL,
    transaction_ids JSONB NOT NULL,
    draft_snapshot JSONB,
    draft_transactions JSONB,
    undone_draft_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, id)
);
ALTER TABLE assistant_batches
    ADD COLUMN IF NOT EXISTS draft_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS draft_transactions JSONB,
    ADD COLUMN IF NOT EXISTS undone_draft_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;

-- Keep undo receipts so retrying after a lost response restores the same drafts.
CREATE TABLE IF NOT EXISTS assistant_undos (
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(36) NOT NULL,
    payload_hash TEXT NOT NULL,
    restored_batch_id VARCHAR(36) NOT NULL,
    drafts JSONB NOT NULL,
    undone_draft_ids JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id, batch_id) REFERENCES assistant_batches(user_id, id) ON DELETE CASCADE
);

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

-- A cleared conversation stays closed even when an earlier POST arrives late.
CREATE TABLE IF NOT EXISTS assistant_task_conversations (
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id VARCHAR(36) NOT NULL,
  cleared_at TIMESTAMPTZ,
  PRIMARY KEY (user_id,id)
);
-- AI generation tasks never write transactions. A task ID is its stable reply/batch ID.
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
  run_token VARCHAR(36),
  image_progress JSONB,
  image_checkpoint JSONB,
  execution_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  agent_checkpoint JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id,id)
);
CREATE INDEX IF NOT EXISTS assistant_tasks_conversation_idx ON assistant_tasks (user_id,conversation_id,created_at);

-- Additive migration for installations with the original task table.
ALTER TABLE assistant_tasks
  ADD COLUMN IF NOT EXISTS run_token VARCHAR(36),
  ADD COLUMN IF NOT EXISTS image_progress JSONB,
  ADD COLUMN IF NOT EXISTS image_checkpoint JSONB,
      ADD COLUMN IF NOT EXISTS execution_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS agent_checkpoint JSONB;

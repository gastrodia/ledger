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
);

CREATE INDEX IF NOT EXISTS idx_gift_records_user_id ON gift_records(user_id);
CREATE INDEX IF NOT EXISTS idx_gift_records_giftbook_id ON gift_records(giftbook_id);
CREATE INDEX IF NOT EXISTS idx_gift_records_gift_date ON gift_records(gift_date);

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
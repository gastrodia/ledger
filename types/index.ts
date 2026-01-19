// 用户类型
export interface User {
  id: string;
  email: string;
  username: string;
  created_at: string;
  updated_at: string;
}

// 交易类型
export type TransactionType = 'income' | 'expense';

// 交易记录
export interface Transaction {
  id: string;
  user_id: string;
  category_id?: string;
  member_id?: string;
  type: TransactionType;
  amount: number;
  description?: string;
  attachment_key?: string;
  attachment_name?: string;
  attachment_type?: string;
  transaction_date: string;
  created_at: string;
  updated_at: string;
  category?: Category;
  member?: Member;
}

// 分类
export interface Category {
  id: string;
  user_id: string;
  name: string;
  type: TransactionType;
  color?: string;
  icon?: string;
  created_at: string;
}

// 家庭成员
export interface Member {
  id: string;
  user_id: string;
  name: string;
  avatar?: string;
  created_at: string;
}

// 统计摘要
export interface Summary {
  totalIncome: number;
  totalExpense: number;
  balance: number;
}

// 交易列表响应
export interface TransactionsResponse {
  data: Transaction[];
  summary: Summary;
}

// 分页响应
export interface PaginatedResponse<T> {
  data: T[];
  total?: number;
  page?: number;
  pageSize?: number;
}

// =========================
// 留言 / 笔记模块
// =========================

export interface Note {
  id: string;
  user_id: string;
  title?: string | null;
  content: string;
  pinned_at?: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
}

// =========================
// 礼簿模块
// =========================

export type GiftRecordType = 'cash' | 'item';

export interface GiftBook {
  id: string;
  user_id: string;
  name: string;
  event_type?: string | null;
  event_date?: string | null; // YYYY-MM-DD
  location?: string | null;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface GiftBookSummary {
  cashTotal: number;
  itemEstimatedTotal: number;
  recordCount: number;
}

export interface GiftRecord {
  id: string;
  user_id: string;
  giftbook_id: string;
  group_id?: string | null;
  gift_type: GiftRecordType;
  counterparty_name: string;
  amount?: number | null;
  currency?: string | null;
  attachment_key?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  item_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  estimated_value?: number | null;
  gift_date: string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

// =========================
// 送礼模块（独立台账：我送给别人的）
// =========================

export interface GivenGiftItem {
  item_name: string;
  quantity: number;
  unit: string;
  estimated_value: number; // 该行总估值
}

export interface GivenGift {
  id: string;
  user_id: string;
  recipient_name: string;
  gift_date: string;
  occasion?: string | null;
  notes?: string | null;
  cash_amount?: number | null;
  attachment_key?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  created_at: string;
  updated_at: string;
}

export interface GivenGiftListItem extends GivenGift {
  items_count: number;
  items_estimated_total: number;
}

export interface GiftsGivenSummary {
  cashTotal: number;
  itemEstimatedTotal: number;
  recordCount: number;
}

export interface GiftsGivenResponse {
  data: GivenGiftListItem[];
  summary: GiftsGivenSummary;
}

export interface GivenGiftDetail extends GivenGift {
  items: GivenGiftItem[];
}

// =========================
// 欠款 / 借款（借还）模块
// =========================

export type LoanDirection = "owed" | "lent"; // owed=我欠别人；lent=别人欠我
export type LoanSubjectType = "money" | "item";
export type LoanStatus = "unpaid" | "partial" | "settled";

export interface Loan {
  id: string;
  user_id: string;
  direction: LoanDirection;
  subject_type: LoanSubjectType;
  counterparty_name: string;
  amount?: number | null;
  item_name?: string | null;
  item_quantity?: number | null;
  item_unit?: string | null;
  occurred_at: string;
  notes?: string | null;
  attachment_key?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoanWithComputed extends Loan {
  repaid_amount_total: number;
  repaid_quantity_total: number;
  remaining_amount: number | null;
  remaining_quantity: number | null;
  status: LoanStatus;
  repayment_count: number;
}

export interface LoanRepayment {
  id: string;
  user_id: string;
  loan_id: string;
  repaid_amount?: number | null;
  repaid_quantity?: number | null;
  repaid_at: string;
  notes?: string | null;
  attachment_key?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  created_at: string;
  updated_at: string;
}
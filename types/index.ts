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

import type { Transaction, Summary, Category, Loan, LoanWithComputed } from "@/types";
import type { TransactionFilters } from "@/lib/transaction-navigation";
import { upsertRow } from "@/lib/list-resource";

export type TransactionList = { data: Transaction[]; summary: Summary; hasAnyTransactions: boolean | null };

export function updateTransactions(current: TransactionList, filters: TransactionFilters, saved?: Transaction, deletedId?: string): TransactionList {
  let data = current.data.filter(row => row.id !== deletedId && row.id !== saved?.id);
  if (saved) {
    // The API's TIMESTAMP/date filters compare the stored calendar day.
    const date = saved.transaction_date.slice(0, 10);
    const matchesId = (filter: string, id?: string) => filter === "__all__" || !filter || (filter === "none" ? !id : id === filter);
    if ((!filters.startDate || date >= filters.startDate) && (!filters.endDate || date <= filters.endDate)
      && (!filters.flowKind || (saved.flow_kind || "daily") === filters.flowKind)
      && (filters.type === "all" || saved.type === filters.type)
      && matchesId(filters.categoryId, saved.category_id) && matchesId(filters.memberId, saved.member_id)
      && (saved.description ?? "").toLowerCase().includes(filters.q.trim().toLowerCase())) data = [...data, saved];
  }
  data.sort((a, b) => Date.parse(b.transaction_date) - Date.parse(a.transaction_date) || Date.parse(b.created_at) - Date.parse(a.created_at));
  let income = 0, expense = 0;
  for (const row of data) {
    if (row.type === "income") income += Math.round(row.amount * 100);
    else expense += Math.round(row.amount * 100);
  }
  return { data, summary: { totalIncome: income / 100, totalExpense: expense / 100, balance: (income - expense) / 100 },
    hasAnyTransactions: saved || data.length ? true : null };
}

export function updateCategories(rows: Category[], saved: Category) {
  return upsertRow(rows, saved).sort((a, b) =>
    (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity)
    || Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id));
}

export function updateLoan(rows: LoanWithComputed[], saved: Loan): LoanWithComputed[] {
  const previous = rows.find(row => row.id === saved.id);
  const repaidAmount = previous?.repaid_amount_total ?? 0;
  const repaidQuantity = previous?.repaid_quantity_total ?? 0;
  const remainingAmount = saved.subject_type === "money" ? Math.max(0, Math.round(((saved.amount ?? 0) - repaidAmount) * 100) / 100) : null;
  const remainingQuantity = saved.subject_type === "item" ? Math.max(0, Math.round(((saved.item_quantity ?? 0) - repaidQuantity) * 1000) / 1000) : null;
  const repaid = saved.subject_type === "money" ? repaidAmount : repaidQuantity;
  const row: LoanWithComputed = { ...saved, repaid_amount_total: repaidAmount, repaid_quantity_total: repaidQuantity,
    remaining_amount: remainingAmount, remaining_quantity: remainingQuantity,
    status: (remainingAmount ?? remainingQuantity) === 0 ? "settled" : repaid > 0 ? "partial" : "unpaid",
    repayment_count: previous?.repayment_count ?? 0 };
  return upsertRow(rows, row).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || Date.parse(b.created_at) - Date.parse(a.created_at));
}

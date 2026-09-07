import type { Transaction } from '@/types';

export function groupTransactionsByDay(transactions: Transaction[]) {
  const groups = new Map<string, { date: string; transactions: Transaction[]; incomeCents: number; expenseCents: number }>();
  for (const transaction of transactions) {
    const date = new Date(transaction.transaction_date);
    const key = Number.isNaN(date.getTime()) ? '日期未知'
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const group = groups.get(key) ?? { date: key, transactions: [], incomeCents: 0, expenseCents: 0 };
    group.transactions.push(transaction);
    const cents = Math.round(transaction.amount * 100);
    if (transaction.type === 'income') group.incomeCents += cents;
    else group.expenseCents += cents;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date)).map((group) => ({
    date: group.date, transactions: group.transactions, income: group.incomeCents / 100, expense: group.expenseCents / 100,
  }));
}

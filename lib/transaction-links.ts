export const transactionLinkSourceTypes = ['given_gift', 'gift_group', 'loan', 'repayment'] as const;
export type TransactionLinkSourceType = typeof transactionLinkSourceTypes[number];

export function isTransactionLinkSourceType(value: unknown): value is TransactionLinkSourceType {
  return typeof value === 'string' && transactionLinkSourceTypes.some((type) => type === value);
}

export function isTransactionLinkId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 36 && /^[A-Za-z0-9_-]+$/.test(value);
}

// All identifiers are constants. User values are always passed as SQL parameters.
export function sourceRelation(type: TransactionLinkSourceType) {
  switch (type) {
    case 'given_gift': return { table: 'given_gifts', id: 's.id', extra: '' };
    case 'gift_group': return { table: 'gift_records', id: 'COALESCE(s.group_id, s.id)', extra: "AND s.direction = 'received'" };
    case 'loan': return { table: 'loans', id: 's.id', extra: '' };
    case 'repayment': return { table: 'loan_repayments', id: 's.id', extra: 'AND EXISTS (SELECT 1 FROM loans p WHERE p.id = s.loan_id AND p.user_id = s.user_id)' };
  }
}

export function formatLinkedTransaction(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    type: row.type as 'income' | 'expense',
    amount: Number(row.amount),
    description: (row.description as string | null) ?? null,
    transaction_date: row.transaction_date,
  };
}

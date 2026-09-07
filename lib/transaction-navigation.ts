export type TransactionFilters = {
  startDate: string; endDate: string; type: 'all' | 'income' | 'expense';
  categoryId: string; memberId: string; q: string;
};
export const transactionFilterKeys = ['startDate', 'endDate', 'type', 'categoryId', 'memberId', 'q'] as const;
const emptyFilters: TransactionFilters = { startDate: '', endDate: '', type: 'all', categoryId: '__all__', memberId: '__all__', q: '' };
export function hasTransactionFilters(search: string) {
  const params = new URLSearchParams(search);
  return transactionFilterKeys.some((key) => params.has(key));
}
export function parseTransactionFilters(search: string, defaults: TransactionFilters): TransactionFilters {
  if (!hasTransactionFilters(search)) return { ...defaults };
  const params = new URLSearchParams(search);
  const type = params.get('type');
  return {
    ...emptyFilters,
    startDate: params.get('startDate') || '', endDate: params.get('endDate') || '',
    type: type === 'income' || type === 'expense' ? type : 'all',
    categoryId: params.get('categoryId') || '__all__', memberId: params.get('memberId') || '__all__',
    q: params.get('q') || '',
  };
}
export function serializeTransactionFilters(filters: TransactionFilters) {
  const params = new URLSearchParams();
  for (const key of transactionFilterKeys) {
    const value = filters[key];
    if (!value || (key === 'type' && value === 'all') || ((key === 'categoryId' || key === 'memberId') && value === '__all__')) continue;
    params.set(key, value);
  }
  return params.toString();
}
type Snapshot = { filters: TransactionFilters; ready: boolean; restoreScroll: number | null };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export class TransactionNavigationSession {
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private search = '';
  private userId: string | null = null;
  private storage?: StorageLike;
  private scroll = 0;
  private stopped = false;
  constructor(private defaults: TransactionFilters) {
    this.snapshot = { filters: defaults, ready: false, restoreScroll: null };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private publish(next: Snapshot) { this.snapshot = next; this.listeners.forEach((listener) => listener()); }
  private read() {
    if (!this.storage || !this.userId) return null;
    try {
      const value = JSON.parse(this.storage.getItem(`ledger:transactions:v1:${encodeURIComponent(this.userId)}`) || 'null');
      if (value?.userId !== this.userId || typeof value.search !== 'string' || !Number.isFinite(value.scroll) || value.scroll < 0) return null;
      // An empty stored search means all records, rather than this month's defaults.
      return { filters: value.search ? parseTransactionFilters(value.search, this.defaults) : { ...emptyFilters }, scroll: value.scroll as number };
    } catch { return null; }
  }
  setLocation(search: string) {
    if (search === this.search) return;
    this.search = search;
    if (!this.snapshot.ready || this.stopped) return;
    const saved = this.read();
    const filters = hasTransactionFilters(search) ? parseTransactionFilters(search, this.defaults) : saved?.filters ?? this.defaults;
    const scroll = saved && serializeTransactionFilters(saved.filters) === serializeTransactionFilters(filters) ? saved.scroll : 0;
    this.publish({ filters, ready: true, restoreScroll: scroll });
  }
  initialize(userId: string | null, storage?: StorageLike) {
    if (this.stopped) return;
    this.userId = userId;
    this.storage = storage;
    const saved = this.read();
    const filters = hasTransactionFilters(this.search)
      ? parseTransactionFilters(this.search, this.defaults) : saved?.filters ?? this.defaults;
    const scroll = saved && serializeTransactionFilters(saved.filters) === serializeTransactionFilters(filters) ? saved.scroll : 0;
    this.scroll = scroll;
    this.publish({ filters, ready: true, restoreScroll: scroll });
  }
  updateFilters(update: TransactionFilters | ((current: TransactionFilters) => TransactionFilters)) {
    if (this.stopped || !this.snapshot.ready) return;
    const filters = typeof update === 'function' ? update(this.snapshot.filters) : update;
    this.search = serializeTransactionFilters(filters);
    this.publish({ filters, ready: true, restoreScroll: null });
    this.persist();
  }
  saveScroll(scroll: number) {
    if (this.stopped || !this.snapshot.ready || this.snapshot.restoreScroll !== null) return;
    this.scroll = Math.max(0, scroll);
    this.persist();
  }
  finishScrollRestore() {
    if (this.snapshot.restoreScroll === null) return;
    this.scroll = this.snapshot.restoreScroll;
    this.publish({ ...this.snapshot, restoreScroll: null });
    this.persist();
  }
  private persist() {
    if (!this.userId || !this.storage || this.stopped) return;
    try {
      this.storage.setItem(`ledger:transactions:v1:${encodeURIComponent(this.userId)}`, JSON.stringify({
        userId: this.userId, search: serializeTransactionFilters(this.snapshot.filters), scroll: this.scroll,
      }));
    } catch { /* Storage being disabled must not prevent filtering. */ }
  }
  stop() {
    this.stopped = true;
    this.publish({ filters: this.defaults, ready: false, restoreScroll: null });
  }
}

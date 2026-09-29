export type ListSnapshot<T> = {
  key: string;
  data: T | null;
  loading: boolean;
  error: string | null;
};

/** Keeps successful data mounted and rejects reads superseded by a write or query change. */
export class ListResource<T> {
  private snapshot: ListSnapshot<T> = { key: "", data: null, loading: true, error: null };
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private version = 0;
  private loader: ((signal: AbortSignal) => Promise<T>) | null = null;

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(next: ListSnapshot<T>) {
    this.snapshot = next;
    this.listeners.forEach(listener => listener());
  }
  stop = () => {
    this.version++;
    this.controller?.abort();
    this.loader = null;
  };
  start(key: string, loader: (signal: AbortSignal) => Promise<T>) {
    this.stop();
    this.loader = loader;
    if (this.snapshot.key !== key) this.publish({ key, data: null, loading: true, error: null });
    void this.refresh();
  }
  refresh = async () => {
    if (!this.loader) return;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const version = ++this.version;
    this.publish({ ...this.snapshot, loading: true, error: null });
    try {
      const data = await this.loader(controller.signal);
      if (controller.signal.aborted || version !== this.version) return;
      this.publish({ ...this.snapshot, data, loading: false, error: null });
    } catch (error) {
      if (controller.signal.aborted || version !== this.version) return;
      this.publish({ ...this.snapshot, loading: false, error: error instanceof Error ? error.message : "加载失败，请重试" });
    }
  };
  /** A server-confirmed write invalidates even a read which is already decoding its response. */
  update(key: string, updater: (current: T) => T, revalidate = true) {
    if (!this.loader) return;
    this.version++;
    this.controller?.abort();
    const data = this.snapshot.key === key && this.snapshot.data !== null
      ? updater(this.snapshot.data) : this.snapshot.data;
    this.publish({ ...this.snapshot, data, loading: false, error: null });
    if (revalidate) void this.refresh();
  }
}

export function upsertRow<T extends { id: string }>(rows: T[], row: T): T[] {
  return rows.some(item => item.id === row.id)
    ? rows.map(item => item.id === row.id ? row : item)
    : [row, ...rows];
}

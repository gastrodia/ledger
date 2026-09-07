export const DRAFT_PREFIX = "ledger:draft:v1:";
const LOGOUT_KEY = "ledger:draft:logout";
export type DraftStatus = "checking" | "ready" | "saved" | "unavailable" | "error";
export type DraftSnapshot = { hasDraft: boolean; status: DraftStatus; error: string | null; persistedValue?: string };
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export function draftProtection(snapshot: DraftSnapshot, value: unknown, dirty: boolean) {
  let isPersisted = false;
  try {
    isPersisted = snapshot.status === "saved" && !snapshot.hasDraft && snapshot.persistedValue === JSON.stringify(value);
  } catch { /* Non-serializable input must keep leave protection enabled. */ }
  return { isPersisted, needsProtection: dirty && !isPersisted };
}


export function draftKey(userId: string, scope: string) {
  return `${DRAFT_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(scope)}`;
}

export function clearStoredDrafts(storage: DraftStorage) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}

/** A session never writes over an unresolved draft, even when the user starts typing. */
export class FormDraftSession<T> {
  private pending: T | undefined;
  private stopped = false;
  private suppressed: string | null = null;
  private awaitingRestore: string | null = null;
  private lastWritten: string | null = null;
  private listeners = new Set<() => void>();
  private snapshot: DraftSnapshot = { hasDraft: false, status: "ready", error: null };
  private key: string;

  constructor(private storage: DraftStorage, private userId: string, scope: string) {
    this.key = draftKey(userId, scope);
    try {
      const raw = storage.getItem(this.key);
      if (raw) {
        const record = JSON.parse(raw);
        if (record.version !== 1 || record.userId !== userId || !("value" in record)) throw new Error("invalid draft");
        this.pending = record.value;
        this.snapshot = { hasDraft: true, status: "ready", error: null };
      }
    } catch {
      this.stopped = true;
      this.snapshot = { hasDraft: false, status: "error", error: "无法读取本机草稿，仍可继续编辑并直接保存。" };
    }
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private publish(next: DraftSnapshot) {
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
  save(value: T, dirty: boolean) {
    if (this.stopped || this.snapshot.hasDraft) return;
    try {
      const serialized = JSON.stringify(value);
      if (this.awaitingRestore !== null && this.awaitingRestore !== serialized) return;
      this.awaitingRestore = null;
      if (!dirty) {
        this.suppressed = null;
        if (this.lastWritten !== null) this.discard();
        return;
      }
      if (serialized === this.suppressed) {
        if (this.lastWritten !== null) this.discard();
        return;
      }
      if (serialized === this.lastWritten) {
        this.publish({ hasDraft: false, status: "saved", error: null, persistedValue: serialized });
        return;
      }
      this.storage.setItem(this.key, JSON.stringify({ version: 1, userId: this.userId, value, updatedAt: Date.now() }));
      this.lastWritten = serialized;
      this.publish({ hasDraft: false, status: "saved", error: null, persistedValue: serialized });
    } catch {
      this.publish({ hasDraft: false, status: "error", error: "本机草稿保存失败，请在离开前保存表单。" });
    }
  }
  restore(): T | undefined {
    if (this.stopped || !this.snapshot.hasDraft) return undefined;
    const value = this.pending;
    this.awaitingRestore = JSON.stringify(value);
    this.lastWritten = this.awaitingRestore;
    this.pending = undefined;
    this.publish({ hasDraft: false, status: "saved", error: null, persistedValue: this.awaitingRestore });
    return value;
  }
  discard() {
    if (this.stopped) return;
    try {
      this.storage.removeItem(this.key);
      this.pending = undefined;
      this.lastWritten = null;
      this.awaitingRestore = null;
      this.publish({ hasDraft: false, status: "ready", error: null });
    } catch {
      this.publish({ ...this.snapshot, status: "error", error: "草稿清除失败，请检查浏览器存储权限。" });
    }
  }
  clear(value: T) {
    this.suppressed = JSON.stringify(value);
    this.discard();
  }
  stop() { this.stopped = true; }
  revoke() {
    this.stopped = true;
    this.pending = undefined;
    this.publish({ hasDraft: false, status: "unavailable", error: "登录状态已变更，本页已停止保存本机草稿。" });
  }
}

let epoch = 0;
let initialized = false;
let channel: BroadcastChannel | undefined;
const logoutListeners = new Set<() => void>();
export const getDraftEpoch = () => epoch;
function revokeDraftSessions() {
  epoch++;
  logoutListeners.forEach((listener) => listener());
  try { clearStoredDrafts(window.localStorage); } catch { /* Storage may be disabled. */ }
}
function initializeLogoutSync() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("storage", (event) => {
    if (event.key === LOGOUT_KEY) revokeDraftSessions();
  });
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel("ledger-draft-session");
      channel.onmessage = () => revokeDraftSessions();
    } catch { /* Some privacy modes disable cross-tab messaging. */ }
  }
}
export function subscribeDraftLogout(listener: () => void) {
  initializeLogoutSync();
  logoutListeners.add(listener);
  return () => { logoutListeners.delete(listener); };
}
/** Call only after the logout request succeeds. Also invalidates in-flight identity checks. */
export function clearDraftsOnLogout(): boolean {
  initializeLogoutSync();
  epoch++;
  logoutListeners.forEach((listener) => listener());
  let cleared = true;
  try { clearStoredDrafts(window.localStorage); } catch { cleared = false; }
  try { window.localStorage.setItem(LOGOUT_KEY, `${Date.now()}:${Math.random()}`); } catch { /* BroadcastChannel still works without storage. */ }
  try { channel?.postMessage("logout"); } catch { /* The storage event is the fallback. */ }
  return cleared;
}

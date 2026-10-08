"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FormDraftSession, draftProtection, getDraftEpoch, serializeDraftValue, subscribeDraftLogout, type DraftReplacement, type DraftReplacementDirty, type DraftSnapshot } from "@/lib/form-drafts";

const checking: DraftSnapshot = { hasDraft: false, status: "checking", error: null };
const idle: DraftSnapshot = { hasDraft: false, status: "ready", error: null };
const noopSubscribe = () => () => {};
type ClearIntent<T> = { scope: string; epoch: number; value: T; replacement?: DraftReplacement<T>; dirty: DraftReplacementDirty<T> };

function applyClearIntent<T>(session: FormDraftSession<T>, intent: ClearIntent<T>, onRestore?: (value: T) => T | void) {
  const replacement = session.clear(intent.value, intent.replacement, intent.dirty);
  if (replacement !== undefined && onRestore) {
    const normalized = onRestore(replacement);
    if (normalized !== undefined && normalized !== replacement) session.clear(intent.value, normalized, intent.dirty);
  }
}

export function useFormDraft<T>({ scope, value, onRestore, dirty, enabled = true, autoRestore = false }: {
  scope: string;
  value: T;
  onRestore: (value: T) => T | void;
  dirty: boolean;
  enabled?: boolean;
  autoRestore?: boolean;
}) {
  const cleared = useRef<ClearIntent<T> | null>(null);
  const initializedSession = useRef<{ scope: string; session: FormDraftSession<T> } | null>(null);
  const restoreCallback = useRef(onRestore);
  const [state, setState] = useState<{ scope: string; session?: FormDraftSession<T>; error?: string }>({ scope: "" });
  const session = enabled && state.scope === scope ? state.session : undefined;
  const snapshot = useSyncExternalStore(session?.subscribe ?? noopSubscribe, session?.getSnapshot ?? (() => enabled ? checking : idle), () => checking);

  useEffect(() => { restoreCallback.current = onRestore; }, [onRestore]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const startedEpoch = getDraftEpoch();
    let activeSession: FormDraftSession<T> | undefined;
    let disposed = false;
    let detachedClear: typeof cleared.current = null;
    const unsubscribe = subscribeDraftLogout(() => {
      controller.abort();
      detachedClear = null;
      if (cleared.current?.epoch === startedEpoch) cleared.current = null;
      activeSession?.revoke();
      if (!activeSession && !disposed) setState({ scope, error: "登录状态已变更，本页已停止保存本机草稿。" });
    });
    const initialize = async () => {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("无法确认登录账户，本机草稿暂不可用；仍可继续编辑。");
        const { user } = await response.json();
        if (typeof user?.id !== "string" || !user.id) throw new Error("无法确认登录账户，本机草稿暂不可用。");
        if (controller.signal.aborted || startedEpoch !== getDraftEpoch()) return;
        const clearIntent = detachedClear ?? (cleared.current?.scope === scope && cleared.current.epoch === startedEpoch ? cleared.current : null);
        if (disposed && !clearIntent) return;
        let storage: Storage;
        try { storage = window.localStorage; }
        catch { throw new Error("浏览器存储不可用，草稿不会保存；仍可继续编辑并直接保存表单。"); }
        activeSession = new FormDraftSession<T>(storage, user.id, scope);
        if (clearIntent) {
          applyClearIntent(activeSession, clearIntent, disposed ? undefined : saved => restoreCallback.current(saved));
          if (cleared.current === clearIntent) cleared.current = null;
        }
        // A clear requested during identity checking still finishes after leaving
        // the page. It only touches that verified account and never restores UI.
        if (disposed) { activeSession.stop(); return; }
        initializedSession.current = { scope, session: activeSession };
        if (autoRestore) activeSession.restore(saved => restoreCallback.current(saved) ?? saved);
        setState({ scope, session: activeSession });
      } catch (error) {
        if (!controller.signal.aborted && !disposed) setState({ scope, error: error instanceof Error ? error.message : "本机草稿不可用，仍可继续编辑并直接保存。" });
      }
    };
    void initialize();
    return () => {
      disposed = true;
      if (!activeSession && cleared.current?.scope === scope && cleared.current.epoch === startedEpoch) {
        detachedClear = cleared.current;
        cleared.current = null;
      } else controller.abort();
      if (initializedSession.current?.session === activeSession) initializedSession.current = null;
      activeSession?.stop();
      unsubscribe();
    };
  }, [scope, enabled, autoRestore]);

  useEffect(() => { session?.save(value, dirty); }, [session, value, dirty]);
  const protection = draftProtection(snapshot, value, dirty);
  useEffect(() => {
    if (!enabled || !protection.needsProtection) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [enabled, protection.needsProtection]);
  const error = enabled && state.scope === scope ? state.error ?? snapshot.error : null;
  return {
    ...protection,
    hasDraft: snapshot.hasDraft,
    status: error && !session ? "unavailable" as const : snapshot.status,
    error,
    // setItem is atomic: unlike clear(), a failed large snapshot must preserve
    // the previous conversation and its server recovery identifier.
    persist: (next: T, nextDirty = true) => {
      const currentSession = session ?? (initializedSession.current?.scope === scope ? initializedSession.current.session : undefined);
      if (!currentSession) return false;
      currentSession.save(next, nextDirty);
      const saved = currentSession.getSnapshot();
      try { return saved.status === "saved" && saved.persistedValue === serializeDraftValue(next); }
      catch { return false; }
    },
    restore: () => { session?.restore(saved => restoreCallback.current(saved) ?? saved); },
    discard: () => { session?.discard(); session?.save(value, dirty); },
    clear: (replacement?: DraftReplacement<T>, replacementDirty: DraftReplacementDirty<T> = false) => {
      const currentSession = session ?? (initializedSession.current?.scope === scope ? initializedSession.current.session : undefined);
      const intent: ClearIntent<T> = { scope, epoch: getDraftEpoch(), value, replacement, dirty: replacementDirty };
      if (currentSession) { applyClearIntent(currentSession, intent, saved => restoreCallback.current(saved)); cleared.current = null; }
      else cleared.current = intent;
    },
  };
}

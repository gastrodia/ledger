"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FormDraftSession, draftProtection, getDraftEpoch, subscribeDraftLogout, type DraftSnapshot } from "@/lib/form-drafts";

const checking: DraftSnapshot = { hasDraft: false, status: "checking", error: null };
const idle: DraftSnapshot = { hasDraft: false, status: "ready", error: null };
const noopSubscribe = () => () => {};

export function useFormDraft<T>({ scope, value, onRestore, dirty, enabled = true }: {
  scope: string;
  value: T;
  onRestore: (value: T) => void;
  dirty: boolean;
  enabled?: boolean;
}) {
  const cleared = useRef<{ scope: string; value: T } | null>(null);
  const [state, setState] = useState<{ scope: string; session?: FormDraftSession<T>; error?: string }>({ scope: "" });
  const session = enabled && state.scope === scope ? state.session : undefined;
  const snapshot = useSyncExternalStore(session?.subscribe ?? noopSubscribe, session?.getSnapshot ?? (() => enabled ? checking : idle), () => checking);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const startedEpoch = getDraftEpoch();
    let activeSession: FormDraftSession<T> | undefined;
    const unsubscribe = subscribeDraftLogout(() => {
      controller.abort();
      activeSession?.revoke();
      if (!activeSession) setState({ scope, error: "登录状态已变更，本页已停止保存本机草稿。" });
    });
    const initialize = async () => {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("无法确认登录账户，本机草稿暂不可用；仍可继续编辑。");
        const { user } = await response.json();
        if (typeof user?.id !== "string" || !user.id) throw new Error("无法确认登录账户，本机草稿暂不可用。");
        if (controller.signal.aborted || startedEpoch !== getDraftEpoch()) return;
        let storage: Storage;
        try { storage = window.localStorage; }
        catch { throw new Error("浏览器存储不可用，草稿不会保存；仍可继续编辑并直接保存表单。"); }
        activeSession = new FormDraftSession<T>(storage, user.id, scope);
        if (cleared.current?.scope === scope) {
          activeSession.clear(cleared.current.value);
          cleared.current = null;
        }
        setState({ scope, session: activeSession });
      } catch (error) {
        if (!controller.signal.aborted) setState({ scope, error: error instanceof Error ? error.message : "本机草稿不可用，仍可继续编辑并直接保存。" });
      }
    };
    void initialize();
    return () => { controller.abort(); activeSession?.stop(); unsubscribe(); };
  }, [scope, enabled]);

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
    restore: () => { const draft = session?.restore(); if (draft !== undefined) onRestore(draft); },
    discard: () => { session?.discard(); session?.save(value, dirty); },
    clear: () => {
      if (session) { session.clear(value); cleared.current = null; }
      else cleared.current = { scope, value };
    },
  };
}

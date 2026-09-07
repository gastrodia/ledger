"use client";

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { getDraftEpoch, subscribeDraftLogout } from '@/lib/form-drafts';
import { serializeTransactionFilters, TransactionNavigationSession, type TransactionFilters } from '@/lib/transaction-navigation';

export function useTransactionNavigation(defaults: TransactionFilters) {
  const search = useSearchParams().toString();
  const [session] = useState(() => new TransactionNavigationSession(defaults));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => { session.setLocation(search); }, [search, session]);
  useEffect(() => {
    const controller = new AbortController();
    const epoch = getDraftEpoch();
    const unsubscribe = subscribeDraftLogout(() => { controller.abort(); session.stop(); });
    const initialize = async () => {
      let userId: string | null = null;
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store', signal: controller.signal });
        if (response.ok) {
          const body = await response.json();
          if (typeof body.user?.id === 'string') userId = body.user.id;
        }
      } catch { /* Loading the ledger remains possible without local restoration. */ }
      if (controller.signal.aborted || epoch !== getDraftEpoch()) return;
      let storage: Storage | undefined;
      try { storage = window.sessionStorage; } catch { /* Optional persistence. */ }
      session.initialize(userId, storage);
    };
    void initialize();
    const onScroll = () => { if (window.location.pathname === '/dashboard') session.saveScroll(window.scrollY); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { controller.abort(); unsubscribe(); window.removeEventListener('scroll', onScroll); };
  }, [session]);
  const setFilters = (update: TransactionFilters | ((current: TransactionFilters) => TransactionFilters)) => {
    session.updateFilters(update);
    const query = serializeTransactionFilters(session.getSnapshot().filters);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  };
  return { ...snapshot, setFilters, session };
}

export function useTransactionScrollRestore(session: TransactionNavigationSession, ready: boolean) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    if (!ready || snapshot.restoreScroll === null) return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: snapshot.restoreScroll ?? 0, behavior: 'instant' });
      session.finishScrollRestore();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ready, snapshot.restoreScroll, session]);
}

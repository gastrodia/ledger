"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ListResource } from "@/lib/list-resource";

export function useListResource<T>(key: string, loader: (signal: AbortSignal) => Promise<T>) {
  const [resource] = useState(() => new ListResource<T>());
  const snapshot = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  useEffect(() => {
    if (!key) return;
    resource.start(key, loader);
    return resource.stop;
  }, [key, loader, resource]);
  const matches = snapshot.key === key;
  const data = matches ? snapshot.data : null;
  const error = matches ? snapshot.error : null;
  const update = useCallback((updater: (current: T) => T, revalidate = true) => {
    resource.update(key, updater, revalidate);
  }, [key, resource]);
  return {
    data,
    isLoading: data === null && (!matches || snapshot.loading),
    loadError: data === null ? error : null,
    refreshError: data !== null ? error : null,
    isRefreshing: data !== null && snapshot.loading,
    refresh: resource.refresh,
    update,
  };
}

export function useJsonLoader<T>(url: string) {
  const router = useRouter();
  return useCallback(async (signal: AbortSignal): Promise<T> => {
    const response = await fetch(url, { signal, cache: "no-store" });
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (response.status === 401) router.push("/login");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "加载失败，请重试");
    return result;
  }, [url, router]);
}

export function usePendingRows() {
  const pending = useRef(new Set<string>());
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const run = async (id: string, action: () => Promise<void>) => {
    if (pending.current.has(id)) return;
    pending.current.add(id);
    setIds(new Set(pending.current));
    try { await action(); }
    finally { pending.current.delete(id); setIds(new Set(pending.current)); }
  };
  return { has: (id: string) => ids.has(id), run };
}

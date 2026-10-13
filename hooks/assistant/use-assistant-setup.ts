"use client";

import type { AssistantCategory, AssistantMember } from "@/lib/assistant";
import { assistantResponseJson } from "@/lib/assistant-task-client";
import { useCallback, useEffect, useState, type RefObject } from "react";

export function useAssistantSetup(controllersRef: RefObject<Set<AbortController>>) {
  const [setup, setSetup] = useState({
    categories: [] as AssistantCategory[], members: [] as AssistantMember[], configured: null as boolean | null,
    loadError: "", isInitializing: true, revision: 0,
  });
  useEffect(() => {
    const controller = new AbortController();
    const pending = controllersRef.current;
    pending.add(controller);
    fetch("/api/assistant", { cache: "no-store", signal: controller.signal }).then(assistantResponseJson).then(data => {
      if (controller.signal.aborted) return;
      setSetup(current => ({ ...current, loadError: "", categories: data.categories, members: data.members, configured: data.configured, isInitializing: false }));
    }).catch(error => {
      if (!controller.signal.aborted) setSetup(current => ({ ...current, loadError: error.message, isInitializing: false }));
    });
    return () => { controller.abort(); pending.delete(controller); };
  }, [setup.revision, controllersRef]);

  function reloadSetup() {
    setSetup(current => ({ ...current, loadError: "", isInitializing: true, revision: current.revision + 1 }));
  }
  const resetSetup = useCallback(() => {
    setSetup(current => ({
      ...current, categories: [], members: [], configured: false, isInitializing: false,
      loadError: "登录状态已变更，请重新登录后使用助手。"
    }));
  }, []);
  return { ...setup, reloadSetup, resetSetup };
}

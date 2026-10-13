"use client";

import { type DraftValidationField } from "@/lib/assistant-draft-editor";
import { useEffect, useLayoutEffect, useState } from "react";
import type { AssistantActivity } from "./use-assistant-controller";
import type { AssistantSession } from "./use-assistant-session";

export function useAssistantFeed(session: Pick<AssistantSession, "messages" | "sending" | "feedRef" | "followReplyRef">, validationTarget: { draftId: string; field: DraftValidationField } | null, activity: AssistantActivity) {
  const { messages, sending, feedRef, followReplyRef } = session;
  const [highlightedCard, setHighlightedCard] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightedCard) return;
    const timer = setTimeout(() => setHighlightedCard(null), 2000);
    return () => clearTimeout(timer);
  }, [highlightedCard]);

  function jumpToDraftCard(batchId: string) {
    const scroller = feedRef.current;
    const target = scroller && Array.from(scroller.querySelectorAll<HTMLElement>("[data-message-id]")).find(element => element.dataset.messageId === batchId);
    if (!scroller || !target) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
    scroller.scrollTo({ top: Math.max(0, top), behavior: reducedMotion ? "instant" : "smooth" });
    target.focus({ preventScroll: true });
    setHighlightedCard(batchId);
  }

  useEffect(() => {
    if (!validationTarget) return;
    let animation: Animation | undefined;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(`${validationTarget.draftId}-${validationTarget.field}`);
      if (!element || !feedRef.current?.contains(element)) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: reducedMotion ? "instant" : "smooth" });
      if (!reducedMotion) {
        const color = getComputedStyle(element).getPropertyValue("--color-destructive").trim();
        animation = element.animate([
          { borderColor: color, boxShadow: `0 0 0 2px ${color}` },
          { borderColor: "transparent", boxShadow: "0 0 0 0 transparent" },
          { borderColor: color, boxShadow: `0 0 0 2px ${color}` },
        ], { duration: 700, iterations: 3, easing: "ease-in-out" });
      }
    });
    return () => { cancelAnimationFrame(frame); animation?.cancel(); };
  }, [validationTarget, feedRef]);
  const { taskBusy, recoveringTasks, imageProgressText, activeTask } = activity;
  // Keep the new text and its scroll position in the same paint. A passive
  // effect briefly shows the old position on every streamed update.
  useLayoutEffect(() => {
    if (followReplyRef.current) feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "instant" });
  }, [messages.length, sending, taskBusy, recoveringTasks, activeTask?.text, imageProgressText, feedRef, followReplyRef]);

  return { highlightedCard, jumpToDraftCard };
}

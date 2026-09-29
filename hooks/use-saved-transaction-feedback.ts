"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";

type SavedTarget = { id: string; scope: string; keepFormFocus: boolean };

export function useSavedTransactionFeedback({ transactions, scope, ready, dialogOpen }: {
  transactions: readonly { id: string }[];
  scope: string;
  ready: boolean;
  dialogOpen: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const pending = useRef<SavedTarget | null>(null);
  const handled = useRef<SavedTarget | null>(null);
  const [target, setTarget] = useState<SavedTarget | null>(null);
  const isPresent = transactions.some(row => row.id === target?.id);

  const queueSaved = (id: string, keepFormFocus = false) => {
    const saved = { id, scope, keepFormFocus };
    pending.current = saved;
    if (keepFormFocus) setTarget(saved);
  };
  const onCloseAutoFocus = (event: Event) => {
    const saved = pending.current;
    pending.current = null;
    if (!saved || saved.scope !== scope) return;
    // Radix otherwise focuses the add button and scrolls back to the page header.
    if (transactions.some(row => row.id === saved.id)) event.preventDefault();
    setTarget({ ...saved, keepFormFocus: false });
  };

  useEffect(() => {
    if (!target || handled.current === target) return;
    if (target.scope !== scope) {
      handled.current = target;
      return;
    }
    if (!ready || (dialogOpen && !target.keepFormFocus)) return;
    if (!isPresent) {
      handled.current = target;
      toast.info("已保存，该记录不在当前筛选范围内");
      return;
    }

    let animation: Animation | undefined;
    let observer: IntersectionObserver | undefined;
    const frame = window.requestAnimationFrame(() => {
      // Desktop rows and mobile cards coexist; only reveal the visible layout.
      const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-transaction-id]") ?? [])
        .find(element => element.dataset.transactionId === target.id && element.getClientRects().length > 0);
      if (!row) return;
      handled.current = target;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const highlight = () => {
        observer?.disconnect();
        const color = "color-mix(in srgb, var(--color-primary) 16%, var(--color-background))";
        animation = row.animate(reducedMotion
          ? [{ backgroundColor: color }, { backgroundColor: color }]
          : [{ backgroundColor: "transparent" }, { backgroundColor: color, offset: 0.25 },
            { backgroundColor: color, offset: 0.6 }, { backgroundColor: "transparent" }], {
          duration: reducedMotion ? 2200 : 1100,
          iterations: reducedMotion ? 1 : 2,
          easing: "ease-in-out",
        });
      };
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.75)) highlight();
      }, { threshold: 0.75 });
      observer.observe(row);
      // Save-and-continue keeps the dialog's amount input focused for the next entry.
      if (!dialogOpen) row.focus({ preventScroll: true });
      row.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "center", inline: "nearest" });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      animation?.cancel();
    };
  }, [target, scope, ready, dialogOpen, isPresent]);

  return { listRef, queueSaved, onCloseAutoFocus };
}

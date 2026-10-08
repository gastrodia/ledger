"use client";

import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Fade only the edges that still have content beyond the scroll viewport. */
export function HorizontalScroll({ children, className, keyboardFocusable = true, ...props }: HTMLAttributes<HTMLDivElement> & { keyboardFocusable?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const update = () => {
      const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      // RTL scrollLeft is negative; convert it to a physical left-edge offset.
      const offset = getComputedStyle(scroller).direction === "rtl"
        ? maxScroll + scroller.scrollLeft
        : scroller.scrollLeft;
      const leftOffset = Math.max(0, Math.min(maxScroll, offset));
      const visible = scroller.clientWidth > 0;
      const left = visible && leftOffset > 1;
      const right = visible && maxScroll - leftOffset > 1;
      setEdges(previous => previous.left === left && previous.right === right ? previous : { left, right });
    };
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    const observedChildren = new Set<Element>();
    const observeChildren = () => {
      for (const child of observedChildren) {
        if (child.parentElement !== scroller) {
          resizeObserver.unobserve(child);
          observedChildren.delete(child);
        }
      }
      for (const child of scroller.children) {
        if (!observedChildren.has(child)) {
          resizeObserver.observe(child);
          observedChildren.add(child);
        }
      }
    };
    resizeObserver.observe(scroller);
    observeChildren();
    const mutationObserver = new MutationObserver(() => {
      observeChildren();
      scheduleUpdate();
    });
    mutationObserver.observe(scroller, { childList: true, characterData: true, subtree: true });
    scroller.addEventListener("scroll", scheduleUpdate, { passive: true });
    scheduleUpdate();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      scroller.removeEventListener("scroll", scheduleUpdate);
    };
  }, []);

  const overflow = edges.left || edges.right;
  const maskImage = overflow
    ? `linear-gradient(to right, ${edges.left ? "transparent, #000 40px" : "#000 0"}, ${edges.right ? "#000 calc(100% - 40px), transparent" : "#000 100%"})`
    : undefined;

  return <div {...props} className={cn("relative min-w-0 max-w-full", className)}>
    <div
      ref={scrollRef}
      className="min-w-0 max-w-full overflow-x-auto rounded-[inherit]"
      data-horizontal-scroll
      data-can-scroll-left={edges.left}
      data-can-scroll-right={edges.right}
      style={{ maskImage, WebkitMaskImage: maskImage }}
      role={overflow && keyboardFocusable ? "region" : undefined}
      aria-label={overflow && keyboardFocusable ? "可左右滚动的表格" : undefined}
      tabIndex={keyboardFocusable ? (overflow ? 0 : undefined) : -1}
    >{children}</div>
    {edges.left && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 rounded-l-[inherit] bg-linear-to-r from-foreground/20 to-transparent" />}
    {edges.right && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 rounded-r-[inherit] bg-linear-to-l from-foreground/20 to-transparent" />}
  </div>;
}

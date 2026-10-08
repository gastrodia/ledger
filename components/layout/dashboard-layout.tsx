"use client";

import { ReactNode, useEffect, useRef } from "react";
import { DashboardNav } from "./dashboard-nav";
import { cn } from "@/lib/utils";
import { clearLegacyFormDrafts } from "@/lib/form-drafts";

interface DashboardLayoutProps {
  children: ReactNode;
  contentClassName?: string;
  viewport?: boolean;
}

export function DashboardLayout({ children, contentClassName, viewport = false }: DashboardLayoutProps) {
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { clearLegacyFormDrafts(window.localStorage); }
    catch { /* Storage may be disabled; entry forms no longer use local drafts. */ }
  }, []);

  useEffect(() => {
    if (!viewport) return;
    const root = viewportRef.current;
    const visualViewport = window.visualViewport;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    const updateViewport = () => {
      if (!root) return;
      const mobile = window.innerWidth < 1024;
      const element = document.activeElement;
      const editing = element instanceof HTMLElement &&
        (element.matches("input, textarea, select") || element.isContentEditable);
      const keyboardOpen = mobile && editing && !!visualViewport && window.innerHeight - visualViewport.height > 120;
      root.style.height = mobile && visualViewport ? `${visualViewport.height}px` : "100dvh";
      root.style.top = mobile && visualViewport ? `${visualViewport.offsetTop}px` : "0px";
      root.style.setProperty("--dashboard-bottom-space", keyboardOpen ? "0px" : "calc(4rem + env(safe-area-inset-bottom))");
    };
    updateViewport();
    visualViewport?.addEventListener("resize", updateViewport);
    visualViewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    document.addEventListener("focusin", updateViewport);
    document.addEventListener("focusout", updateViewport);
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      visualViewport?.removeEventListener("resize", updateViewport);
      visualViewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
      document.removeEventListener("focusin", updateViewport);
      document.removeEventListener("focusout", updateViewport);
    };
  }, [viewport]);

  return (
    <div ref={viewportRef} className={cn("bg-slate-50/70", viewport ? "fixed inset-x-0 top-0 h-dvh overflow-hidden overscroll-none" : "min-h-screen")}>
      <DashboardNav />
      <main className={cn("min-w-0 lg:ml-18 min-[90rem]:ml-56", viewport && "h-full min-h-0")}>
        <div className={cn(viewport ? "h-full min-h-0 pb-[var(--dashboard-bottom-space,calc(4rem+env(safe-area-inset-bottom)))]" : "pb-[calc(4rem+env(safe-area-inset-bottom))]", "lg:pb-0")}>
          <div className={cn("px-4 py-5 md:p-6 lg:px-8 lg:py-7 mx-auto", viewport ? "flex h-full min-h-0 flex-col overflow-hidden" : "min-h-[calc(100dvh-4rem)] lg:min-h-screen", contentClassName)}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

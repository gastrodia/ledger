"use client";

import { ReactNode } from "react";
import { DashboardNav } from "./dashboard-nav";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50/70">
      <DashboardNav />
      <main className="min-w-0 lg:ml-56">
        <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
          <div className="min-h-[calc(100dvh-4rem)] lg:min-h-screen px-4 py-5 md:p-6 lg:px-8 lg:py-7 max-w-[1440px] mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

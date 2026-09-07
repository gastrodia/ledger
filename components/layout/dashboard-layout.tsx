"use client";

import { ReactNode } from "react";
import { DashboardNav } from "./dashboard-nav";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <DashboardNav />
      <main className="lg:ml-64 transition-all duration-300">
        <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
          <div className="min-h-[calc(100dvh-4rem)] lg:min-h-screen p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

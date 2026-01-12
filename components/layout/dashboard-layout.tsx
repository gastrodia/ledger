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
        <div className="pt-16 lg:pt-0">
          <div className="min-h-[calc(100vh-4rem)] p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

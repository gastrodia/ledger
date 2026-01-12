"use client";

import { ReactNode } from "react";
import { ConfirmProvider } from "@/hooks/use-confirm";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfirmProvider>
      {children}
    </ConfirmProvider>
  );
}

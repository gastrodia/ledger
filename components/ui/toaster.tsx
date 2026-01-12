"use client";

import { useToast } from "@/hooks/use-toast";
import { Toast } from "./toast";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div className="fixed top-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:top-auto sm:bottom-0 sm:right-0 sm:flex-col md:max-w-[420px] pointer-events-none">
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} onClose={dismiss} />
      ))}
    </div>
  );
}

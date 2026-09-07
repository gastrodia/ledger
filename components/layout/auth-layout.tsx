import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AuthLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
}

export function AuthLayout({ children, title }: AuthLayoutProps) {
  return (
    <div className="min-h-dvh bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-[400px]">

        {/* Card */}
        <Card>
          <CardHeader className="pb-6 pt-7 sm:pt-8">
            {title && (
              <CardTitle className="text-2xl text-center">{title}</CardTitle>
            )}
          </CardHeader>
          <CardContent className="px-5 pb-6 sm:px-7 sm:pb-7">
            {children}
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          © 2026 钱钱去哪了 · 让记账更简单 ✨
        </p>
      </div>
    </div>
  );
}

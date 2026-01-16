import { ReactNode } from "react";
import { Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AuthLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Card */}
        <Card>
          <CardHeader>
            {title && (
              <CardTitle className="text-2xl text-center">{title}</CardTitle>
            )}
          </CardHeader>
          <CardContent>
            {children}
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-8">
          © 2026 钱钱去哪了 · 让记账更简单 ✨
        </p>
      </div>
    </div>
  );
}

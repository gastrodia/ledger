"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  FolderTree,
  Users,
  Wallet,
  LogOut,
  Menu,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

const navItems = [
  {
    href: "/dashboard",
    label: "交易记录",
    icon: LayoutDashboard,
  },
  {
    href: "/dashboard/stats",
    label: "统计分析",
    icon: BarChart3,
  },
  {
    href: "/dashboard/categories",
    label: "分类管理",
    icon: FolderTree,
  },
  {
    href: "/dashboard/members",
    label: "家庭成员",
    icon: Users,
  },
];

export function DashboardNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('退出登录失败');
      }

      toast.success("您已成功退出登录");

      // 跳转到登录页
      router.push('/login');
    } catch (error) {
      console.error('退出登录错误:', error);
      toast.error("退出登录失败，请重试");
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <>
      {/* Mobile menu button - 仅在菜单关闭时显示 */}
      {!isMobileMenuOpen && (
        <Button
          variant="outline"
          size="icon"
          className="lg:hidden fixed top-4 left-4 z-50"
          onClick={() => setIsMobileMenuOpen(true)}
          aria-label="打开菜单"
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 h-full w-64 bg-card border-r z-40 shadow-lg lg:shadow-none",
          "transition-transform duration-300 ease-out",
          "lg:translate-x-0",
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 h-16 px-6 border-b">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary shadow-md">
            <Wallet className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg">
              钱钱去哪了
            </h1>
            <p className="text-xs text-muted-foreground">智能记账助手</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg transition-all",
                  "hover:bg-accent",
                  isActive
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span className="text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t">
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            <span className="text-sm font-medium">
              {isLoggingOut ? "退出中..." : "退出登录"}
            </span>
          </button>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-label="关闭菜单"
        />
      )}
    </>
  );
}

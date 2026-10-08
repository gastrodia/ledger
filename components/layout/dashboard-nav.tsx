"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  FolderTree,
  Users,
  LogOut,
  Menu,
  BarChart3,
  Gift,
  BookHeart,
  StickyNote,
  HandCoins,
  Download,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { dashboardNavigationGroups, getMobileNavigationSection, isDashboardRouteActive } from "@/lib/dashboard-navigation";
import { toast } from "@/hooks/use-toast";
import { clearDraftsOnLogout } from "@/lib/form-drafts";
import { BrandLogo, BrandMark } from "@/components/brand/brand-logo";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

const navigationIcons = {
  transactions: LayoutDashboard,
  assistant: MessageSquare,
  stats: BarChart3,
  categories: FolderTree,
  members: Users,
  loans: HandCoins,
  giftbooks: BookHeart,
  gifts: Gift,
  notes: StickyNote,
};

export function DashboardNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuPath, setMobileMenuPath] = useState<string | null>(null);
  const [lastPathname, setLastPathname] = useState(pathname);
  const isMobileMenuOpen = mobileMenuPath === pathname;
  const mobileSection = getMobileNavigationSection(pathname);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);

  // Clear the remembered open route as well, so browser Back never reopens an old drawer.
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setMobileMenuPath(null);
  }

  const isIOS =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    // @ts-expect-error iOS Safari only
    !window.MSStream;
  // @ts-expect-error iOS Safari only
  const isIOSStandalone = typeof navigator !== "undefined" && !!navigator.standalone;
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)")?.matches ?? false);

  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      // 允许我们用自定义按钮触发安装
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setDeferredPrompt(null);
      toast.success("已安装到桌面/主屏幕");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const updateKeyboard = () => {
      const element = document.activeElement;
      const isEditing = element instanceof HTMLElement &&
        (element.matches("input, textarea, select") || element.isContentEditable);
      setIsKeyboardOpen(!!viewport && isEditing && window.innerHeight - viewport.height > 120);
    };
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktopQuery.matches) setMobileMenuPath(null);
    };
    viewport?.addEventListener("resize", updateKeyboard);
    document.addEventListener("focusin", updateKeyboard);
    document.addEventListener("focusout", updateKeyboard);
    desktopQuery.addEventListener("change", closeOnDesktop);
    return () => {
      viewport?.removeEventListener("resize", updateKeyboard);
      document.removeEventListener("focusin", updateKeyboard);
      document.removeEventListener("focusout", updateKeyboard);
      desktopQuery.removeEventListener("change", closeOnDesktop);
    };
  }, []);

  const handleInstall = async () => {
    if (isIOS) {
      if (isIOSStandalone || isStandalone) {
        toast.success("已在主屏幕模式运行");
        return;
      }

      toast.info("iPhone 请用 Safari 打开后：分享 → 添加到主屏幕");
      return;
    }

    if (!("serviceWorker" in navigator)) {
      toast.info("当前浏览器不支持 PWA 安装");
      return;
    }

    if (!deferredPrompt) {
      toast.info("若要安装，请使用浏览器菜单“添加到主屏幕/安装应用”");
      return;
    }

    try {
      setIsInstalling(true);
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;

      if (choice.outcome === "accepted") {
        toast.success("已发起安装");
      } else {
        toast.info("已取消安装");
      }
    } catch {
      toast.error("安装失败，请重试");
    } finally {
      setDeferredPrompt(null);
      setIsInstalling(false);
    }
  };

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('退出登录失败');
      }

      if (!clearDraftsOnLogout()) toast.warning("已退出登录，但本机草稿清理失败，请清理此站点的浏览器存储。");
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

  const renderNavigation = (compactOnDesktop = false) => (
    <nav
      aria-label="全部功能"
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-5",
        compactOnDesktop ? "p-3 min-[90rem]:p-4" : "p-4"
      )}
    >
      {dashboardNavigationGroups.map((group) => (
        <div key={group.label}>
          <p className={cn("mb-2 px-3 text-xs font-medium text-muted-foreground", compactOnDesktop && "hidden min-[90rem]:block")}>{group.label}</p>
          <div className="space-y-1">
            {group.items.map((item) => {
              const isActive = isDashboardRouteActive(pathname, item.href);
              const Icon = navigationIcons[item.icon];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuPath(null)}
                  aria-label={item.label}
                  title={item.label}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center py-2 rounded-md transition-colors",
                    compactOnDesktop
                      ? "justify-center gap-0 px-0 min-[90rem]:justify-start min-[90rem]:gap-3 min-[90rem]:px-3"
                      : "gap-3 px-3",
                    isActive
                      ? "bg-primary/10 text-primary font-semibold hover:bg-primary/15"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className={cn("text-sm", compactOnDesktop && "hidden min-[90rem]:inline")}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const renderBranding = (compactOnDesktop = false) => (
    <div className={cn(
      "flex h-20 shrink-0 flex-col justify-center gap-2 border-b",
      compactOnDesktop ? "items-center px-3 min-[90rem]:items-start min-[90rem]:px-5" : "items-start px-5"
    )}>
      {compactOnDesktop && (
        <span role="img" aria-label={BRAND_NAME} title={BRAND_NAME} className="inline-flex min-[90rem]:hidden">
          <BrandMark className="h-6 w-auto text-[#6257e8]" />
        </span>
      )}
      <BrandLogo className={cn("text-2xl leading-none", compactOnDesktop && "hidden min-[90rem]:inline-flex")} />
      <p className={cn("text-[11px] leading-4 text-muted-foreground", compactOnDesktop && "hidden min-[90rem]:block")}>{BRAND_TAGLINE}</p>
    </div>
  );

  const renderAccountActions = (compactOnDesktop = false) => (
    <div className={cn(
      "shrink-0 border-t pb-[max(1rem,env(safe-area-inset-bottom))] space-y-2",
      compactOnDesktop ? "px-3 pt-3 min-[90rem]:px-4 min-[90rem]:pt-4" : "px-4 pt-4"
    )}>
      <button
        onClick={handleInstall}
        disabled={isInstalling}
        aria-label={isInstalling ? "安装中..." : "安装"}
        title={isInstalling ? "安装中..." : "安装"}
        className={cn(
          "flex min-h-11 items-center py-2 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors w-full disabled:opacity-50 disabled:cursor-not-allowed",
          compactOnDesktop
            ? "justify-center gap-0 px-0 min-[90rem]:justify-start min-[90rem]:gap-3 min-[90rem]:px-3"
            : "gap-3 px-3"
        )}
      >
        <Download className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className={cn("text-sm font-medium", compactOnDesktop && "hidden min-[90rem]:inline")}>{isInstalling ? "安装中..." : "安装"}</span>
      </button>
      <button
        onClick={handleLogout}
        disabled={isLoggingOut}
        aria-label={isLoggingOut ? "退出中..." : "退出登录"}
        title={isLoggingOut ? "退出中..." : "退出登录"}
        className={cn(
          "flex min-h-11 items-center py-2 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors w-full disabled:opacity-50 disabled:cursor-not-allowed",
          compactOnDesktop
            ? "justify-center gap-0 px-0 min-[90rem]:justify-start min-[90rem]:gap-3 min-[90rem]:px-3"
            : "gap-3 px-3"
        )}
      >
        <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className={cn("text-sm font-medium", compactOnDesktop && "hidden min-[90rem]:inline")}>{isLoggingOut ? "退出中..." : "退出登录"}</span>
      </button>
    </div>
  );

  return (
    <>
      <aside aria-label="侧栏导航" className="fixed inset-y-0 left-0 z-30 hidden w-18 flex-col border-r bg-card lg:flex min-[90rem]:w-56">
        {renderBranding(true)}
        {renderNavigation(true)}
        {renderAccountActions(true)}
      </aside>

      <DialogPrimitive.Root open={isMobileMenuOpen} onOpenChange={(open) => setMobileMenuPath(open ? pathname : null)}>
        <nav
          aria-label="主要导航"
          className={cn(
            "fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgb(0_0_0/0.04)] lg:hidden",
            isKeyboardOpen && "hidden"
          )}
        >
          <Link
            href="/dashboard/assistant"
            aria-label="AI 记账"
            aria-current={mobileSection === "assistant" ? "page" : undefined}
            className={cn("flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium", mobileSection === "assistant" ? "text-primary bg-primary/5" : "text-muted-foreground hover:bg-accent")}
          >
            <MessageSquare className="size-5" aria-hidden="true" />
            AI 记账
          </Link>
          <Link
            href="/dashboard"
            aria-label="记账"
            aria-current={mobileSection === "transactions" ? "page" : undefined}
            className={cn("flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium", mobileSection === "transactions" ? "text-primary bg-primary/5" : "text-muted-foreground hover:bg-accent")}
          >
            <LayoutDashboard className="size-5" aria-hidden="true" />
            记账
          </Link>
          <Link
            href="/dashboard/stats"
            aria-label="查账"
            aria-current={mobileSection === "stats" ? "page" : undefined}
            className={cn("flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium", mobileSection === "stats" ? "text-primary bg-primary/5" : "text-muted-foreground hover:bg-accent")}
          >
            <BarChart3 className="size-5" aria-hidden="true" />
            查账
          </Link>
          <DialogPrimitive.Trigger asChild>
            <button
              type="button"
              aria-label="更多功能"
              aria-current={mobileSection === "more" ? "page" : undefined}
              className={cn("flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium", mobileSection === "more" || isMobileMenuOpen ? "text-primary bg-primary/5" : "text-muted-foreground hover:bg-accent")}
            >
              <Menu className="size-5" aria-hidden="true" />
              更多
            </button>
          </DialogPrimitive.Trigger>
        </nav>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-30 bg-black/50 lg:hidden" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-40 flex h-dvh w-72 max-w-[85vw] flex-col border-r bg-card shadow-xl lg:hidden"
          >
            <DialogPrimitive.Title className="sr-only">更多功能</DialogPrimitive.Title>
            {renderBranding()}
            <DialogPrimitive.Close className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent" aria-label="关闭菜单">
              <X className="size-4" aria-hidden="true" />
            </DialogPrimitive.Close>
            {renderNavigation()}
            {renderAccountActions()}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

export const dashboardNavigationGroups = [
  {
    label: "日常账本",
    items: [
      { href: "/dashboard", label: "交易记录", icon: "transactions" },
      { href: "/dashboard/stats", label: "统计分析", icon: "stats" },
      { href: "/dashboard/loans", label: "欠款/借款", icon: "loans" },
      { href: "/dashboard/notes", label: "笔记", icon: "notes" },
    ],
  },
  {
    label: "人情往来",
    items: [
      { href: "/dashboard/giftbooks", label: "礼簿", icon: "giftbooks" },
      { href: "/dashboard/gifts-given", label: "送礼", icon: "gifts" },
    ],
  },
  {
    label: "设置",
    items: [
      { href: "/dashboard/categories", label: "分类管理", icon: "categories" },
      { href: "/dashboard/members", label: "家庭成员", icon: "members" },
    ],
  },
] as const;

export function isDashboardRouteActive(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
}

export function getMobileNavigationSection(pathname: string): "transactions" | "stats" | "more" {
  if (isDashboardRouteActive(pathname, "/dashboard")) return "transactions";
  if (isDashboardRouteActive(pathname, "/dashboard/stats")) return "stats";
  return "more";
}

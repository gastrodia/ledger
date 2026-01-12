"use client";

import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { 
  TrendingUp, 
  TrendingDown, 
  Calendar,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useRouter } from "next/navigation";

interface CategoryStat {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  total: number;
  count: number;
}

interface MemberStat {
  id: string;
  name: string;
  avatar?: string;
  total: number;
  count: number;
}

interface StatsData {
  categoryStats: {
    income: CategoryStat[];
    expense: CategoryStat[];
  };
  memberStats: {
    income: MemberStat[];
    expense: MemberStat[];
  };
  summary: {
    totalIncome: number;
    totalExpense: number;
    balance: number;
  };
}

export default function StatsPage() {
  const router = useRouter();
  
  // 获取当前年月 (YYYY-MM)
  const getCurrentMonth = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  };

  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth());
  const [statsData, setStatsData] = useState<StatsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 加载统计数据
  const loadStats = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/stats?month=${selectedMonth}`);
      
      if (!response.ok) {
        if (response.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("获取统计数据失败");
      }

      const result = await response.json();
      setStatsData(result.data);
    } catch (error) {
      console.error("加载统计数据失败:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  // 计算百分比
  const calculatePercentage = (amount: number, total: number): number => {
    if (total === 0) return 0;
    return Math.round((amount / total) * 100);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              统计分析
            </h1>
            <p className="text-muted-foreground mt-1">
              查看您的收支统计，了解资金流向
            </p>
          </div>
          <div className="w-full sm:w-auto">
            <Input
              id="month-picker"
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full sm:w-[200px]"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>加载中...</p>
          </div>
        ) : !statsData ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>暂无数据</p>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">总收入</p>
                      <p className="text-2xl font-bold text-green-600">
                        {formatCurrency(statsData.summary.totalIncome)}
                      </p>
                    </div>
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100">
                      <TrendingUp className="h-6 w-6 text-green-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">总支出</p>
                      <p className="text-2xl font-bold text-red-600">
                        {formatCurrency(statsData.summary.totalExpense)}
                      </p>
                    </div>
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100">
                      <TrendingDown className="h-6 w-6 text-red-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">结余</p>
                      <p className="text-2xl font-bold text-primary">
                        {formatCurrency(statsData.summary.balance)}
                      </p>
                    </div>
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
                      <Calendar className="h-6 w-6 text-primary" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 四个独立的统计卡片 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 按分类统计 - 支出 */}
              <Card>
                <CardHeader className="border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle>支出分类</CardTitle>
                    <span className="text-sm text-muted-foreground">
                      {statsData.categoryStats.expense.length} 个分类
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  {statsData.categoryStats.expense.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      暂无支出记录
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {statsData.categoryStats.expense.map((stat) => {
                        const percentage = calculatePercentage(
                          stat.total,
                          statsData.summary.totalExpense
                        );
                        return (
                          <div key={stat.id} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="text-xl">{stat.icon || "📂"}</span>
                                <span className="font-medium truncate">
                                  {stat.name || "未分类"}
                                </span>
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {stat.count} 笔
                                </span>
                              </div>
                              <div className="text-right shrink-0 ml-2">
                                <p className="font-bold text-red-600">
                                  {formatCurrency(stat.total)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {percentage}%
                                </p>
                              </div>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2">
                              <div
                                className="bg-red-500 h-2 rounded-full transition-all"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 按分类统计 - 收入 */}
              <Card>
                <CardHeader className="border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle>收入分类</CardTitle>
                    <span className="text-sm text-muted-foreground">
                      {statsData.categoryStats.income.length} 个分类
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  {statsData.categoryStats.income.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      暂无收入记录
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {statsData.categoryStats.income.map((stat) => {
                        const percentage = calculatePercentage(
                          stat.total,
                          statsData.summary.totalIncome
                        );
                        return (
                          <div key={stat.id} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="text-xl">{stat.icon || "📂"}</span>
                                <span className="font-medium truncate">
                                  {stat.name || "未分类"}
                                </span>
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {stat.count} 笔
                                </span>
                              </div>
                              <div className="text-right shrink-0 ml-2">
                                <p className="font-bold text-green-600">
                                  {formatCurrency(stat.total)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {percentage}%
                                </p>
                              </div>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2">
                              <div
                                className="bg-green-500 h-2 rounded-full transition-all"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 按成员统计 - 支出 */}
              <Card>
                <CardHeader className="border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle>支出成员</CardTitle>
                    <span className="text-sm text-muted-foreground">
                      {statsData.memberStats.expense.length} 个成员
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  {statsData.memberStats.expense.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      暂无支出记录
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {statsData.memberStats.expense.map((stat) => {
                        const percentage = calculatePercentage(
                          stat.total,
                          statsData.summary.totalExpense
                        );
                        return (
                          <div key={stat.id} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="text-xl">{stat.avatar || "👤"}</span>
                                <span className="font-medium truncate">
                                  {stat.name || "未分配"}
                                </span>
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {stat.count} 笔
                                </span>
                              </div>
                              <div className="text-right shrink-0 ml-2">
                                <p className="font-bold text-red-600">
                                  {formatCurrency(stat.total)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {percentage}%
                                </p>
                              </div>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2">
                              <div
                                className="bg-red-500 h-2 rounded-full transition-all"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 按成员统计 - 收入 */}
              <Card>
                <CardHeader className="border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle>收入成员</CardTitle>
                    <span className="text-sm text-muted-foreground">
                      {statsData.memberStats.income.length} 个成员
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  {statsData.memberStats.income.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      暂无收入记录
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {statsData.memberStats.income.map((stat) => {
                        const percentage = calculatePercentage(
                          stat.total,
                          statsData.summary.totalIncome
                        );
                        return (
                          <div key={stat.id} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="text-xl">{stat.avatar || "👤"}</span>
                                <span className="font-medium truncate">
                                  {stat.name || "未分配"}
                                </span>
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {stat.count} 笔
                                </span>
                              </div>
                              <div className="text-right shrink-0 ml-2">
                                <p className="font-bold text-green-600">
                                  {formatCurrency(stat.total)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {percentage}%
                                </p>
                              </div>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2">
                              <div
                                className="bg-green-500 h-2 rounded-full transition-all"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

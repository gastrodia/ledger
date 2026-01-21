"use client";

import { useEffect, useRef, useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { 
  TrendingUp, 
  TrendingDown, 
  Calendar,
  Eye,
  EyeOff,
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
  const [showIncome, setShowIncome] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);

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

  const stopAiSummary = () => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setIsAiLoading(false);
  };

  const getErrorMessage = (e: unknown) => {
    if (e instanceof Error) return e.message;
    return "AI 总结失败";
  };

  const generateAiSummary = async () => {
    try {
      setAiError(null);
      setAiSummary("");
      setIsAiLoading(true);

      // 若上一次还在跑，先终止
      aiAbortRef.current?.abort();
      const controller = new AbortController();
      aiAbortRef.current = controller;

      const resp = await fetch(`/api/stats/ai-summary?month=${selectedMonth}`, {
        method: "GET",
        signal: controller.signal,
      });

      if (!resp.ok) {
        if (resp.status === 401) {
          router.push("/login");
          return;
        }
        const text = await resp.text().catch(() => "");
        throw new Error(text || "AI 总结失败");
      }

      if (!resp.body) {
        throw new Error("浏览器不支持流式响应");
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setAiSummary(acc);
      }
    } catch (e: unknown) {
      if (
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError")
      ) {
        // 用户手动停止，不当作错误
        return;
      }
      console.error("AI 总结失败:", e);
      setAiError(getErrorMessage(e));
    } finally {
      aiAbortRef.current = null;
      setIsAiLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  // 切换月份时，清空上一次 AI 总结并中断流
  useEffect(() => {
    stopAiSummary();
    setAiSummary("");
    setAiError(null);
  }, [selectedMonth]);

  // 组件卸载时，确保终止请求
  useEffect(() => {
    return () => stopAiSummary();
  }, []);

  // 计算百分比
  const calculatePercentage = (amount: number, total: number): number => {
    if (total === 0) return 0;
    return Math.round((amount / total) * 100);
  };

  const formatIncome = (value: number) => (showIncome ? formatCurrency(value) : "****");

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
          <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-2 sm:items-center">
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
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-muted-foreground">总收入</p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setShowIncome((v) => !v)}
                          aria-label={showIncome ? "隐藏收入金额" : "显示收入金额"}
                        >
                          {showIncome ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-2xl font-bold text-green-600">
                        {formatIncome(statsData.summary.totalIncome)}
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
                        {showIncome ? formatCurrency(statsData.summary.balance) : "****"}
                      </p>
                    </div>
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
                      <Calendar className="h-6 w-6 text-primary" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* AI Summary */}
            <Card>
              <CardHeader className="border-b">
                <div className="flex items-center justify-between gap-4">
                  <CardTitle>AI总结</CardTitle>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      onClick={generateAiSummary}
                      disabled={isLoading || !statsData || isAiLoading}
                    >
                      AI总结
                    </Button>
                    {isAiLoading ? (
                      <Button type="button" variant="outline" onClick={stopAiSummary}>
                        停止
                      </Button>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {aiError ? (
                  <div className="text-sm text-red-600 whitespace-pre-wrap">
                    {aiError}
                  </div>
                ) : isAiLoading && !aiSummary ? (
                  <div className="text-sm text-muted-foreground">AI 正在生成总结...</div>
                ) : aiSummary ? (
                  <div className="text-sm leading-6">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeSanitize]}
                      components={{
                        h1: (props) => (
                          <h1 className="text-lg font-semibold mb-3" {...props} />
                        ),
                        h2: (props) => (
                          <h2 className="text-base font-semibold mt-4 mb-2" {...props} />
                        ),
                        h3: (props) => (
                          <h3 className="text-sm font-semibold mt-3 mb-2" {...props} />
                        ),
                        p: (props) => <p className="my-2 whitespace-pre-wrap" {...props} />,
                        ul: (props) => <ul className="list-disc pl-5 my-2 space-y-1" {...props} />,
                        ol: (props) => <ol className="list-decimal pl-5 my-2 space-y-1" {...props} />,
                        li: (props) => <li className="whitespace-pre-wrap" {...props} />,
                        strong: (props) => <strong className="font-semibold" {...props} />,
                        a: (props) => (
                          <a className="underline underline-offset-4" target="_blank" rel="noreferrer" {...props} />
                        ),
                      }}
                    >
                      {aiSummary}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    点击右上角【AI总结】，生成当前月份的收支总结（流式输出）。
                  </div>
                )}
              </CardContent>
            </Card>

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
                                  {formatIncome(stat.total)}
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
                                  {formatIncome(stat.total)}
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

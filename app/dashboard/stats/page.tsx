"use client";

import { useEffect, useRef, useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import Link from "next/link";
import { describeAmountChange, getStatsPeriod, localCalendarDate, statsDetailHref, type StatsPeriod } from "@/lib/stats-period";

interface CategoryStat {
  id: string | null;
  name: string;
  icon?: string;
  color?: string;
  total: number;
  count: number;
}

interface MemberStat {
  id: string | null;
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
  monthlyStats?: MonthlyStat[];
  period?: StatsPeriod;
  comparison?: { totalIncome: number; totalExpense: number };
  dailyExpense?: number | null;
}

interface MonthlyStat {
  month: number;
  income: number;
  expense: number;
}

function YearlyBarChart({
  monthlyStats,
  showIncome,
}: {
  monthlyStats: MonthlyStat[];
  showIncome: boolean;
}) {
  const visibleValues = monthlyStats.flatMap((stat) =>
    showIncome ? [stat.expense, stat.income] : [stat.expense]
  );
  const maxAmount = Math.max(...visibleValues, 0);
  const axisMax = maxAmount > 0 ? maxAmount : 1;
  const halfAmount = axisMax / 2;

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <CardTitle>年度收支趋势</CardTitle>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-red-500" />
              支出
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-green-500" />
              {showIncome ? "收入" : "收入已隐藏"}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4 sm:pt-5">
        {maxAmount === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            暂无年度收支记录
          </div>
        ) : (
          <div className="overflow-x-auto pb-2">
            <div className="min-w-[680px]">
              <div className="grid grid-cols-[64px_1fr] gap-3">
                <div className="relative h-56 text-xs text-muted-foreground">
                  <span className="absolute right-0 top-0">
                    {formatCurrency(axisMax)}
                  </span>
                  <span className="absolute right-0 top-1/2 -translate-y-1/2">
                    {formatCurrency(halfAmount)}
                  </span>
                  <span className="absolute right-0 bottom-0">
                    {formatCurrency(0)}
                  </span>
                </div>
                <div className="relative h-56 border-l border-b border-border">
                  <div className="absolute inset-x-0 top-0 border-t border-dashed border-muted" />
                  <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-muted" />
                  <div className="absolute inset-0 grid grid-cols-12 items-end gap-3 px-3">
                    {monthlyStats.map((stat) => {
                      const expenseHeight = `${Math.max((stat.expense / axisMax) * 100, stat.expense > 0 ? 2 : 0)}%`;
                      const incomeHeight = `${Math.max((stat.income / axisMax) * 100, stat.income > 0 ? 2 : 0)}%`;
                      const title = showIncome
                        ? `${stat.month}月：支出 ${formatCurrency(stat.expense)}，收入 ${formatCurrency(stat.income)}`
                        : `${stat.month}月：支出 ${formatCurrency(stat.expense)}，收入已隐藏`;

                      return (
                        <div
                          key={stat.month}
                          className="flex h-full items-end justify-center gap-1"
                          title={title}
                          aria-label={title}
                        >
                          <div
                            className="w-3 rounded-t-sm bg-red-500 transition-all"
                            style={{ height: expenseHeight }}
                          />
                          {showIncome ? (
                            <div
                              className="w-3 rounded-t-sm bg-green-500 transition-all"
                              style={{ height: incomeHeight }}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-[64px_1fr] gap-3 pt-2">
                <div />
                <div className="grid grid-cols-12 gap-3 px-3 text-center text-xs text-muted-foreground">
                  {monthlyStats.map((stat) => (
                    <span key={stat.month}>{stat.month}月</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
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

  // 获取当前年份 (YYYY)
  const getCurrentYear = () => {
    return String(new Date().getFullYear());
  };

  const yearOptions = (() => {
    const current = new Date().getFullYear();
    // 默认提供近 20 年（含今年）
    return Array.from({ length: 20 }, (_, i) => String(current - i));
  })();

  const [asOfDate] = useState(() => localCalendarDate());
  const [viewMode, setViewMode] = useState<"month" | "year">("month");
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth());
  const [selectedYear, setSelectedYear] = useState<string>(getCurrentYear());
  const [statsData, setStatsData] = useState<StatsData | null>(null);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [showIncome, setShowIncome] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);

  const isValidYear = (y: string) => /^\d{4}$/.test(y);
  const isValidMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

  const query = viewMode === "year"
    ? `year=${encodeURIComponent(selectedYear)}&asOf=${asOfDate}`
    : `month=${encodeURIComponent(selectedMonth)}&asOf=${asOfDate}`;
  const validPeriod = viewMode === "year" ? isValidYear(selectedYear) : isValidMonth(selectedMonth);
  const isLoading = validPeriod && loadedQuery !== query;

  useEffect(() => {
    if (!validPeriod) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/stats?${query}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401) { router.push("/login"); return; }
          throw new Error("获取统计数据失败");
        }
        const result = await response.json();
        if (!controller.signal.aborted) {
          setStatsData(result.data);
          setLoadError(null);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("加载统计数据失败:", error);
          setLoadError("统计数据加载失败，请检查网络后重试");
        }
      } finally {
        if (!controller.signal.aborted) setLoadedQuery(query);
      }
    };
    void load();
    return () => controller.abort();
  }, [query, router, validPeriod, reload]);

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
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    const isCurrent = () => aiAbortRef.current === controller && !controller.signal.aborted;
    try {
      if (viewMode === "year" && !isValidYear(selectedYear)) {
        setAiError("年份格式错误，应为 YYYY");
        setAiSummary("");
        setIsAiLoading(false);
        return;
      }
      if (viewMode === "month" && !isValidMonth(selectedMonth)) {
        setAiError("月份格式错误，应为 YYYY-MM");
        setAiSummary("");
        setIsAiLoading(false);
        return;
      }

      setAiError(null);
      setAiSummary("");
      setIsAiLoading(true);

      const query =
        viewMode === "year"
          ? `year=${encodeURIComponent(selectedYear)}`
          : `month=${encodeURIComponent(selectedMonth)}`;

      const resp = await fetch(`/api/stats/ai-summary?${query}`, {
        method: "GET",
        signal: controller.signal,
      });

      if (!isCurrent()) return;
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
        if (!isCurrent()) return;
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setAiSummary(acc);
      }
    } catch (e: unknown) {
      if (!isCurrent()) return;
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
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null;
        setIsAiLoading(false);
      }
    }
  };

  const resetPeriod = () => {
    setLoadError(null);
    stopAiSummary();
    setAiSummary("");
    setAiError(null);
    setStatsData(null);
    setLoadedQuery(null);
  };

  useEffect(() => {
    return () => {
      aiAbortRef.current?.abort();
      aiAbortRef.current = null;
    };
  }, [query]);

  // 计算百分比
  const calculatePercentage = (amount: number, total: number): number => {
    if (total === 0) return 0;
    return Math.round((amount / total) * 100);
  };

  const formatIncome = (value: number) => (showIncome ? formatCurrency(value) : "****");
  const activePeriod = statsData?.period ?? getStatsPeriod(viewMode, viewMode === "month" ? selectedMonth : selectedYear, asOfDate);
  const detailHref = (type: "income" | "expense", dimension: "categoryId" | "memberId", id: string | null) =>
    activePeriod ? statsDetailHref(activePeriod, type, dimension, id) : "/dashboard";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              统计分析
            </h1>
            <p className="text-sm leading-6 text-muted-foreground mt-1">
              统计仅包含收支记录；礼簿、送礼和借还台账保持独立，不会自动计入。
            </p>
          </div>
          <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={viewMode === "month" ? "default" : "outline"}
                onClick={() => { if (viewMode !== "month") { resetPeriod(); setViewMode("month"); } }}
              >
                按月
              </Button>
              <Button
                type="button"
                variant={viewMode === "year" ? "default" : "outline"}
                onClick={() => { if (viewMode !== "year") { resetPeriod(); setViewMode("year"); } }}
              >
                按年
              </Button>
            </div>

            {viewMode === "month" ? (
              <Input
                id="month-picker"
                type="month"
                value={selectedMonth}
                onChange={(e) => { if (selectedMonth !== e.target.value) { resetPeriod(); setSelectedMonth(e.target.value); } }}
                className="w-full sm:w-[200px]"
              />
            ) : (
              <Select value={selectedYear} onValueChange={(value) => { if (selectedYear !== value) { resetPeriod(); setSelectedYear(value); } }}>
                <SelectTrigger className="w-full sm:w-[200px]" id="year-picker">
                  <SelectValue placeholder="选择年份" />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y} 年
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>加载中...</p>
          </div>
        ) : loadError ? (
          <Card>
            <CardContent className="py-12 text-center space-y-4" role="alert">
              <p className="font-medium">{loadError}</p>
              <Button variant="outline" onClick={() => {
                setLoadError(null);
                setLoadedQuery(null);
                setReload((value) => value + 1);
              }}>重新加载</Button>
            </CardContent>
          </Card>
        ) : !statsData ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>{validPeriod ? "所选期间暂无收支记录" : "请选择有效的月份或年份"}</p>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-4 sm:pt-5">
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
                    <div className="flex items-center justify-center w-10 h-10 rounded-md bg-green-100">
                      <TrendingUp className="h-6 w-6 text-green-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4 sm:pt-5">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">总支出</p>
                      <p className="text-2xl font-bold text-red-600">
                        {formatCurrency(statsData.summary.totalExpense)}
                      </p>
                    </div>
                    <div className="flex items-center justify-center w-10 h-10 rounded-md bg-red-100">
                      <TrendingDown className="h-6 w-6 text-red-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4 sm:pt-5">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">结余</p>
                      <p className="text-2xl font-bold text-primary">
                        {showIncome ? formatCurrency(statsData.summary.balance) : "****"}
                      </p>
                    </div>
                    <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10">
                      <Calendar className="h-6 w-6 text-primary" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {activePeriod && statsData.comparison ? (
              <Card>
                <CardHeader className="border-b space-y-2">
                  <CardTitle>上期对比与日均支出</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    本期 {activePeriod.startDate} 至 {activePeriod.endDate}，上期 {activePeriod.previousStartDate} 至 {activePeriod.previousEndDate}。
                    按两个完整日历期间内已记录的金额比较，包含未来日期记录。
                    {activePeriod.state === "current" ? "本期尚未结束，此处不是同期进度对比。" : activePeriod.state === "future" ? "本期尚未开始，暂不计算变化或日均。" : ""}
                  </p>
                </CardHeader>
                <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-3 gap-5">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">收入对比</p>
                    <p className="font-semibold">{!showIncome ? "****" : activePeriod.state === "future" ? "暂无对比" : describeAmountChange(statsData.summary.totalIncome, statsData.comparison.totalIncome)}</p>
                    <p className="text-sm text-muted-foreground">上期 {formatIncome(statsData.comparison.totalIncome)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">支出对比</p>
                    <p className="font-semibold">{activePeriod.state === "future" ? "暂无对比" : describeAmountChange(statsData.summary.totalExpense, statsData.comparison.totalExpense)}</p>
                    <p className="text-sm text-muted-foreground">上期 {formatCurrency(statsData.comparison.totalExpense)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">日均支出</p>
                    <p className="font-semibold">{statsData.dailyExpense == null ? "暂无" : formatCurrency(statsData.dailyExpense)}</p>
                    <p className="text-sm text-muted-foreground">
                      {activePeriod.state === "future" ? "所选期间尚未开始" : activePeriod.state === "current"
                        ? `截至 ${activePeriod.asOfDate}，按已过 ${activePeriod.elapsedDays} 天计算；不含未来日期支出`
                        : `按完整期间 ${activePeriod.totalDays} 天计算`}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {viewMode === "year" ? (
              <YearlyBarChart
                monthlyStats={statsData.monthlyStats || []}
                showIncome={showIncome}
              />
            ) : null}

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
              <CardContent className="pt-4 sm:pt-5">
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
                    点击右上角【AI总结】，生成当前{viewMode === "month" ? "月份" : "年份"}的收支总结。
                  </div>
                )}
              </CardContent>
            </Card>

            <p className="text-sm text-muted-foreground">点击分类或成员，可查看所选期间的对应收支明细。</p>
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
                <CardContent className="pt-4 sm:pt-5">
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
                          <Link key={stat.id || "none"} href={detailHref("expense", "categoryId", stat.id)}
                            aria-label={`查看${stat.name || "未分类"}的支出明细`}
                            className="block space-y-2 rounded-md p-2 -mx-2 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
                          </Link>
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
                <CardContent className="pt-4 sm:pt-5">
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
                          <Link key={stat.id || "none"} href={detailHref("income", "categoryId", stat.id)}
                            aria-label={`查看${stat.name || "未分类"}的收入明细`}
                            className="block space-y-2 rounded-md p-2 -mx-2 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
                          </Link>
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
                <CardContent className="pt-4 sm:pt-5">
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
                          <Link key={stat.id || "none"} href={detailHref("expense", "memberId", stat.id)}
                            aria-label={`查看${stat.name || "未分配"}的支出明细`}
                            className="block space-y-2 rounded-md p-2 -mx-2 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
                          </Link>
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
                <CardContent className="pt-4 sm:pt-5">
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
                          <Link key={stat.id || "none"} href={detailHref("income", "memberId", stat.id)}
                            aria-label={`查看${stat.name || "未分配"}的收入明细`}
                            className="block space-y-2 rounded-md p-2 -mx-2 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
                          </Link>
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

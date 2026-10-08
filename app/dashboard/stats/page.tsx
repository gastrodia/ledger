"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, ArrowUpRight, CalendarDays } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { CategoryIcon, MemberAvatar } from "@/components/icons/entity-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton, SkeletonRegion } from "@/components/ui/loading-skeleton";
import { AiAnalysis } from "@/components/stats/ai-analysis";
import { PeriodTrend } from "@/components/stats/period-trend";
import { cn, formatCurrency } from "@/lib/utils";
import { describeAmountChange, getStatsPeriod, localCalendarDate, statsDetailHref, type StatsPeriod } from "@/lib/stats-period";
import { isStatsMonth, readStatsNavigation, statsNavigationHref, stepStatsDate, type StatsNavigation } from "@/lib/stats-navigation";

interface RankedStat {
  id: string | null;
  name: string;
  icon?: string;
  avatar?: string;
  total: number | string;
  count: number | string;
}
interface StatsData {
  categoryStats: { income: RankedStat[]; expense: RankedStat[] };
  memberStats: { income: RankedStat[]; expense: RankedStat[] };
  summary: { totalIncome: number; totalExpense: number; balance: number; count: number; futureCount: number };
  period: StatsPeriod;
  comparison: {
    totalIncome: number; totalExpense: number; currentIncome: number; currentExpense: number;
    previousCount: number; currentCount: number; previousEndExclusive: string;
  } | null;
  dailyExpense: number | null;
  monthlyStats: Array<{ month: number; income: number; expense: number }>;
  dailyStats: Array<{ day: number; income: number; expense: number }>;
}

const amountColors = { expense: "text-red-600", income: "text-green-600", balance: "text-primary" };

function SummaryAmount({ value, kind, prominent = false }: { value: string; kind: keyof typeof amountColors; prominent?: boolean }) {
  return <p className={cn("mt-2 whitespace-nowrap font-semibold leading-tight tracking-tight tabular-nums sm:[--amount-size:2rem]", prominent ? "[--amount-size:1.875rem]" : "[--amount-size:1.5rem]")}
    style={{ fontSize: `min(var(--amount-size), calc(100cqi / ${Math.max(value.length, 1) * 0.7}))` }}>
    {value.startsWith("¥") ? <><span className="mr-0.5 text-[0.6em]">¥</span><span className={amountColors[kind]}>{value.slice(1)}</span></> : value}
  </p>;
}

function BreakdownList({ title, rows, total, type, group, period, showIncome }: {
  title: string; rows: RankedStat[]; total: number; type: "income" | "expense";
  group: "category" | "member"; period: StatsPeriod; showIncome: boolean;
}) {
  return <Card role="region" aria-label={title} className="min-w-0">
    <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b py-4 sm:py-4">
      <CardTitle className="flex items-center gap-2"><span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", type === "expense" ? "bg-rose-400" : "bg-emerald-400")} />{title}</CardTitle>
      <span className="shrink-0 text-xs text-muted-foreground">{rows.length} 个{group === "category" ? "分类" : "成员"}</span>
    </CardHeader>
    <CardContent className="pb-0 sm:pb-0">
      {rows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">本期暂无{type === "income" ? "收入" : "支出"}记录</p> : <ul className="divide-y divide-border/60">
      {rows.map(row => {
        const name = row.name || (group === "category" ? "未分类" : "未分配");
        const percentage = total > 0 ? Number(row.total) / total * 100 : 0;
        const displayPercentage = percentage > 0 && percentage < 0.1 ? "<0.1" : Number(percentage.toFixed(1)).toString();
        return <li key={row.id || "none"}><Link href={statsDetailHref(period, type, group === "category" ? "categoryId" : "memberId", row.id)} aria-label={`查看${name}的${type === "expense" ? "支出" : "收入"}明细`}
          className="-mx-2 block rounded-md px-2 py-4 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex items-center gap-3">
            {group === "member" ? <MemberAvatar avatar={row.avatar} name={name} memberId={row.id || undefined} className="size-9" /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><CategoryIcon icon={row.icon} className="size-4" /></span>}
            <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{name}</p><p className="mt-0.5 text-xs text-muted-foreground">{row.count} 笔 · {displayPercentage}%</p></div>
            <p className="max-w-[48%] break-all text-right text-sm font-semibold tabular-nums">{type === "income" && !showIncome ? "••••" : <><span className="mr-0.5 text-[0.75em]">¥</span><span className={amountColors[type]}>{formatCurrency(row.total)}</span></>}</p><ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          </div>
          <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", type === "expense" ? "bg-rose-400" : "bg-emerald-400")} style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }} /></div>
        </Link></li>;
      })}
      </ul>}
    </CardContent>
  </Card>;
}

function StatsSkeleton({ periodLabel = "0000年00月", mode = "month", period, showIncome = false }: {
  periodLabel?: string; mode?: "month" | "year"; period?: StatsPeriod | null; showIncome?: boolean;
}) {
  return <SkeletonRegion label="正在加载统计数据…">
    <div className="space-y-5">
      <div className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Skeleton className="size-4" /><Skeleton className="font-medium"><span className="invisible">{periodLabel}</span></Skeleton>
          <Skeleton className={cn("h-4", period?.state === "future" ? "w-52" : !period || period.state === "current" ? "w-44" : "w-32")} />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-6">
          {[0, 1, 2].map(index => <div key={index} className="min-w-0">
            <div className="flex h-7 items-center"><Skeleton className="h-4 w-16" /></div>
            <Skeleton className={cn("mt-2 w-32 max-w-full sm:h-10", index === 0 ? "h-[2.34375rem]" : "h-[1.875rem]")} /><Skeleton className="mt-2 h-5 w-28 max-w-full" />
          </div>)}
        </div>
      </div>
      <Card>
        <CardHeader className="gap-3 space-y-0 pb-3">
          <Skeleton className="h-[22px] w-24" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <Skeleton><span className="invisible">{periodLabel} · {mode === "year" ? "1—12月" : `1—${period?.totalDays ?? 31}日`}</span></Skeleton>
            {period?.state !== "future" && <Skeleton className="h-4 w-28" />}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Skeleton className="h-4 w-[38px]" />{showIncome && <Skeleton className="h-4 w-[38px]" />}
            {(!period || period.endDate > period.asOfDate) && <Skeleton className="h-4 w-[62px]" />}
            <Skeleton className="ml-auto h-4 w-12" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-1.5">
            <div className="flex h-40 flex-col items-end justify-between sm:h-44"><Skeleton className="h-3 w-8" /><Skeleton className="h-3 w-8" /><Skeleton className="h-3 w-4" /></div>
            <Skeleton className="h-40 w-full sm:h-44" />
            <div className="pt-2"><Skeleton className="ml-auto h-[16.5px] w-3" /></div><div className="pt-2"><Skeleton className="h-3 w-full" /></div>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><Skeleton className="h-6 w-24" /><Skeleton className="h-4 w-52 max-w-full" /></div>
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {[0, 1, 2, 3].map(group => <Card key={group} className="min-w-0">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b py-4 sm:py-4"><Skeleton className="h-[22px] w-24" /><Skeleton className="h-3 w-12" /></CardHeader>
            <CardContent className="pb-0 sm:pb-0">
              {[0, 1].map(row => <div key={row} className="border-b py-4 last:border-0">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-9 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-0.5"><Skeleton className="h-5 w-20 max-w-full" /><Skeleton className="h-4 w-16 max-w-full" /></div>
                  <Skeleton className="h-4 w-16 shrink-0" />
                </div>
                <Skeleton className="mt-3 h-1.5 w-full" />
              </div>)}
            </CardContent>
          </Card>)}
        </div>
      </div>
      <div className="flex min-h-14 items-center gap-2 rounded-lg border bg-card px-4 py-3 sm:px-5"><Skeleton className="size-4" /><Skeleton className="h-4 w-16" /></div>
      <div className="flex h-8 items-center px-1"><Skeleton className="h-3 w-36" /></div>
    </div>
  </SkeletonRegion>;
}

function Segment<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string;
}) {
  return <div role="group" aria-label={label} className="inline-flex shrink-0 gap-0.5 rounded-md bg-muted/70 p-0.5">
    {options.map(option => <Button key={option.value} type="button" size="sm" variant={value === option.value ? "default" : "ghost"} aria-pressed={value === option.value}
      onClick={() => onChange(option.value)}
      className={cn("h-8 px-3", value !== option.value && "text-muted-foreground")}>
      {option.label}
    </Button>)}
  </div>;
}

function inclusiveEnd(exclusive: string) {
  return new Date(Date.parse(`${exclusive}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

function StatsHeader() {
  return <header className="flex flex-wrap items-end justify-between gap-3">
    <div><h1 className="text-2xl font-semibold tracking-tight">统计分析</h1><p className="mt-1 text-sm text-muted-foreground">看清收支变化，了解钱花在哪里。</p></div>
    <span className="text-xs text-muted-foreground">仅统计收支记录</span>
  </header>;
}

function StatsPageSkeleton() {
  return <DashboardLayout>
    <div className="space-y-5">
      <StatsHeader />
      <SkeletonRegion label="正在加载统计周期…">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
          <Skeleton className="h-9 w-[6.375rem]" />
          <div className="order-3 flex w-full items-center gap-1 sm:order-none sm:w-auto"><Skeleton className="size-8" /><Skeleton className="h-9 w-40" /><Skeleton className="size-8" /></div>
          <Skeleton className="ml-auto h-8 w-18" />
        </div>
      </SkeletonRegion>
      <StatsSkeleton />
    </div>
  </DashboardLayout>;
}

export default function StatsPage() {
  return <Suspense fallback={<StatsPageSkeleton />}><StatsContent /></Suspense>;
}

function StatsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [asOfDate] = useState(() => localCalendarDate());
  const selection = readStatsNavigation(params, asOfDate);
  const { view, date } = selection;
  const year = date.slice(0, 4);
  const month = Number(date.slice(5));
  const periodLabel = view === "month" ? `${Number(year)}年${month}月` : `${Number(year)}年`;
  const query = `${view === "month" ? `month=${date}` : `year=${year}`}&asOf=${asOfDate}`;
  const [reload, setReload] = useState(0);
  const [showIncome, setShowIncome] = useState(false);
  const [resource, setResource] = useState<{ key: string; data?: StatsData; error?: string } | null>(null);
  const requestKey = `${query}:${reload}`;
  const data = resource?.key === requestKey ? resource.data : undefined;
  const error = resource?.key === requestKey ? resource.error : undefined;
  const loading = !data && !error;

  // Persist the default period too, so a later return restores exactly the viewed month.
  useEffect(() => {
    if (!params.has("date")) {
      window.history.replaceState(null, "", statsNavigationHref(readStatsNavigation(params, asOfDate)));
    }
  }, [params, asOfDate]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/stats?${query}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) { router.push("/login"); return; }
        if (!response.ok) throw new Error("统计数据加载失败，请检查网络后重试");
        const result = await response.json();
        if (!controller.signal.aborted) setResource({ key: requestKey, data: result.data });
      } catch (cause) {
        if (!controller.signal.aborted) setResource({ key: requestKey, error: cause instanceof Error ? cause.message : "统计数据加载失败，请重试" });
      }
    };
    void load();
    return () => controller.abort();
  }, [query, requestKey, router]);

  const navigate = (patch: Partial<StatsNavigation> | ((current: StatsNavigation) => Partial<StatsNavigation>)) => {
    // Read the latest URL so rapid clicks compose before React finishes rendering.
    const current = readStatsNavigation(new URLSearchParams(window.location.search), asOfDate);
    const next = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
    if (statsNavigationHref(next) === statsNavigationHref(current)) return;
    const href = statsNavigationHref(next);
    // Next's history integration carries its own routing state and updates useSearchParams.
    window.history.replaceState(null, "", href);
  };
  const previousDate = stepStatsDate(date, view, -1);
  const nextDate = stepStatsDate(date, view, 1);
  const currentPeriod = view === "month" ? date === asOfDate.slice(0, 7) : year === asOfDate.slice(0, 4);
  const years = [...new Set([Number(year), ...Array.from({ length: 21 }, (_, index) => Number(asOfDate.slice(0, 4)) + 1 - index)])].filter(value => value >= 2 && value <= 9998).sort((a, b) => b - a);
  const money = (amount: number | string, income = false) => income && !showIncome ? "••••" : `¥${formatCurrency(amount)}`;
  const change = (kind: "income" | "expense") => {
    if (kind === "income" && !showIncome) return "收入金额已隐藏";
    if (!data?.comparison) return "期间尚未开始，暂无对比";
    const comparison = data.comparison;
    if (comparison.previousCount === 0) return "上期无记录，暂无对比";
    const text = describeAmountChange(kind === "income" ? comparison.currentIncome : comparison.currentExpense,
      kind === "income" ? comparison.totalIncome : comparison.totalExpense);
    const previousLabel = view === "month" ? "上月" : "上年";
    return text.replaceAll("上期", `${previousLabel}${data.period.state === "current" ? "同期" : ""}`);
  };
  const points = data ? view === "year" ? data.monthlyStats.map(stat => ({
    key: String(stat.month), label: `${stat.month}月`, income: stat.income, expense: stat.expense,
    future: `${year}-${String(stat.month).padStart(2, "0")}-01` > asOfDate,
  })) : data.dailyStats.map(stat => ({
    key: String(stat.day), label: `${month}月${stat.day}日`, income: stat.income, expense: stat.expense,
    future: `${date}-${String(stat.day).padStart(2, "0")}` > asOfDate,
  })) : [];

  return <DashboardLayout>
    <div className="space-y-5">
      <StatsHeader />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        <Segment value={view} label="统计周期" options={[{ value: "month", label: "按月" }, { value: "year", label: "按年" }]} onChange={value => navigate({ view: value })} />
        <div className="order-3 flex w-full min-w-0 items-center gap-1 sm:order-none sm:w-auto">
          <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={view === "month" ? "上个月" : "上一年"} disabled={!previousDate} onClick={() => navigate(current => ({ date: stepStatsDate(current.date, current.view, -1) || current.date }))}><ChevronLeft /></Button>
          {view === "month" ? <Input type="month" aria-label="选择月份" value={date} min="0002-01" max="9998-12" className="h-9 w-40 min-w-0 text-sm" onInput={event => isStatsMonth(event.currentTarget.value) && navigate({ date: event.currentTarget.value })} onChange={event => isStatsMonth(event.target.value) && navigate({ date: event.target.value })} /> :
            <Select value={year} onValueChange={value => navigate(current => ({ date: `${value}-${current.date.slice(5)}` }))}>
              <SelectTrigger aria-label="选择年份" className="h-9 w-40 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{years.map(value => <SelectItem key={value} value={String(value).padStart(4, "0")}>{value} 年</SelectItem>)}</SelectContent>
            </Select>}
          <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={view === "month" ? "下个月" : "下一年"} disabled={!nextDate} onClick={() => navigate(current => ({ date: stepStatsDate(current.date, current.view, 1) || current.date }))}><ChevronRight /></Button>
        </div>
        <Button type="button" variant="ghost" size="sm" className="ml-auto h-8 text-muted-foreground" disabled={currentPeriod} onClick={() => navigate({ date: asOfDate.slice(0, 7) })}>{view === "month" ? "回到本月" : "回到今年"}</Button>
      </div>

      {loading ? <StatsSkeleton periodLabel={periodLabel} mode={view} period={getStatsPeriod(view, view === "month" ? date : year, asOfDate)} showIncome={showIncome} /> : error ? <div role="alert" className="rounded-lg border bg-card px-4 py-12 text-center"><p className="mb-4 text-sm">{error}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>重新加载</Button></div> : data ? <>
        <section aria-label={`${periodLabel}收支总览`} className="rounded-lg border bg-card p-4 sm:p-5">
          <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" /><h2 className="font-medium">{periodLabel}</h2>
            <span className="text-xs text-muted-foreground">{data.period.state === "current" ? `截至 ${asOfDate}` : data.period.state === "future" ? "尚未开始 · 已录入记录" : "完整期间"} · {data.summary.count} 笔记录</span>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-6">
            <div className="min-w-0 [container-type:inline-size]">
              <p className="flex h-7 items-center text-sm text-muted-foreground">支出</p>
              <SummaryAmount value={money(data.summary.totalExpense)} kind="expense" prominent />
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{change("expense")}</p>
            </div>
            <div className="min-w-0 [container-type:inline-size]">
              <div className="flex h-7 items-center gap-2 text-sm text-muted-foreground">收入<Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" aria-label={showIncome ? "隐藏收入与结余" : "显示收入与结余"} onClick={() => setShowIncome(value => !value)}>{showIncome ? <Eye /> : <EyeOff />}</Button></div>
              <SummaryAmount value={money(data.summary.totalIncome, true)} kind="income" />
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{change("income")}</p>
            </div>
            <div className="min-w-0 [container-type:inline-size]">
              <p className="flex h-7 items-center text-sm text-muted-foreground">记账结余</p>
              <SummaryAmount value={money(data.summary.balance, true)} kind="balance" />
              <p className="mt-2 text-xs leading-5 text-muted-foreground">收入 − 支出</p>
            </div>
          </div>
          {data.summary.futureCount > 0 && <p className="mt-5 border-t pt-3 text-xs leading-5 text-muted-foreground">期间总额含 {data.summary.futureCount} 笔未来日期记录{data.period.state === "current" ? "；同期对比与日均支出不含这些记录。" : "。"}</p>}
        </section>

        <PeriodTrend key={`trend:${query}`} mode={view} periodLabel={periodLabel} points={points} showIncome={showIncome} dailyExpense={data.dailyExpense} />

        <section aria-label="收支构成" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">收支构成</h2>
            <p className="text-xs text-muted-foreground">{periodLabel} · 点击分类或成员查看明细</p>
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <BreakdownList title="支出分类" rows={data.categoryStats.expense} total={data.summary.totalExpense} type="expense" group="category" period={data.period} showIncome={showIncome} />
            <BreakdownList title="收入分类" rows={data.categoryStats.income} total={data.summary.totalIncome} type="income" group="category" period={data.period} showIncome={showIncome} />
            <BreakdownList title="支出成员" rows={data.memberStats.expense} total={data.summary.totalExpense} type="expense" group="member" period={data.period} showIncome={showIncome} />
            <BreakdownList title="收入成员" rows={data.memberStats.income} total={data.summary.totalIncome} type="income" group="member" period={data.period} showIncome={showIncome} />
          </div>
        </section>

        <AiAnalysis key={`ai:${query}`} query={query} label={periodLabel} showIncome={showIncome} onReveal={() => setShowIncome(true)} onUnauthorized={() => router.push("/login")} empty={data.summary.count === 0} />

        <details className="group px-1 text-xs leading-6 text-muted-foreground">
          <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">统计范围与对比口径<ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
          <div className="space-y-1 pb-3">
            <p>期间总额、趋势与构成：{data.period.startDate} 至 {data.period.endDate}内全部已记录的收支，包含未来日期记录。</p>
            {data.comparison ? <p>{data.period.state === "current" ? "同期对比" : "完整期间对比"}：{data.period.startDate} 至 {data.period.state === "current" ? asOfDate : data.period.endDate}，与 {data.period.previousStartDate} 至 {inclusiveEnd(data.comparison.previousEndExclusive)}比较{data.period.state === "current" ? "；上期较短时截至上期末" : ""}。</p> : <p>所选期间尚未开始，暂不计算变化和日均支出。</p>}
            {data.dailyExpense !== null && <p>日均支出按{data.period.state === "current" ? `截至 ${asOfDate}已过的` : "完整期间的"} {data.period.elapsedDays} 天计算，不含未来日期支出。</p>}
            <p>礼簿、送礼和借还台账保持独立，不会自动计入；记账结余不代表账户余额。</p>
          </div>
        </details>
      </> : null}
    </div>
  </DashboardLayout>;
}

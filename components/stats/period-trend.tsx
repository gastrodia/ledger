"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getStatsTooltipPlacement } from "@/lib/stats-tooltip-position";
import { cn, formatCurrency } from "@/lib/utils";

interface TrendPoint {
  key: string;
  label: string;
  income: number;
  expense: number;
  future?: boolean;
}

interface PeriodTrendProps {
  mode: "month" | "year";
  periodLabel: string;
  points: TrendPoint[];
  showIncome: boolean;
  dailyExpense: number | null;
}

interface ChartInteraction {
  period: string;
  index: number;
  kind: "hover" | "touch" | "keyboard";
}

function axisAmount(amount: number) {
  if (amount >= 1000000000000) return `${Number((amount / 1000000000000).toFixed(1))}万亿`;
  if (amount >= 100000000) return `${Number((amount / 100000000).toFixed(1))}亿`;
  if (amount >= 10000) return `${Number((amount / 10000).toFixed(1))}万`;
  return Number(amount.toFixed(2)).toLocaleString("zh-CN");
}

function amountCeiling(amount: number) {
  if (amount <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(amount));
  return Math.ceil(amount / magnitude / 0.5) * magnitude * 0.5;
}

export function PeriodTrend({
  mode,
  periodLabel,
  points,
  showIncome,
  dailyExpense,
}: PeriodTrendProps) {
  const tooltipId = useId();
  const instructionsId = useId();
  const chartRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef(new Map<string, HTMLButtonElement>());
  const tooltipRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ index: number; x: number; y: number } | null>(null);
  const [interaction, setInteraction] = useState<ChartInteraction | null>(null);
  const periodKey = `${mode}:${periodLabel}`;
  const active = interaction?.period === periodKey && points[interaction.index] ? interaction : null;
  const activePoint = active ? points[active.index] : null;
  const fullPeriod = mode === "year" ? "全年" : "整月";
  const maximum = Math.max(0, ...points.flatMap((point) => showIncome ? [point.expense, point.income] : [point.expense]));
  const axisMax = amountCeiling(maximum);
  const hasFuture = points.some((point) => point.future);
  const onlyFuture = points.length > 0 && points.every((point) => point.future);

  useEffect(() => {
    if (active?.kind !== "touch") return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !chartRef.current?.contains(event.target)) setInteraction(null);
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [active?.kind]);

  useEffect(() => {
    if (!active?.kind) return;
    const dismissMovedChart = () => setInteraction(null);
    window.addEventListener("scroll", dismissMovedChart, { capture: true, passive: true });
    window.addEventListener("resize", dismissMovedChart);
    window.visualViewport?.addEventListener("resize", dismissMovedChart);
    window.visualViewport?.addEventListener("scroll", dismissMovedChart);
    return () => {
      window.removeEventListener("scroll", dismissMovedChart, true);
      window.removeEventListener("resize", dismissMovedChart);
      window.visualViewport?.removeEventListener("resize", dismissMovedChart);
      window.visualViewport?.removeEventListener("scroll", dismissMovedChart);
    };
  }, [active?.kind]);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    const column = activePoint ? columnRefs.current.get(activePoint.key) : undefined;
    if (!tooltip || !column) return;
    tooltip.style.visibility = "hidden";
    const placement = getStatsTooltipPlacement(column.getBoundingClientRect(), tooltip.getBoundingClientRect(), {
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
    });
    if (!placement) return;
    tooltip.style.left = `${placement.left}px`;
    tooltip.style.top = `${placement.top}px`;
    tooltip.style.visibility = "visible";
  }, [activePoint, showIncome]);

  function showPoint(index: number, kind: ChartInteraction["kind"]) {
    setInteraction({ period: periodKey, index, kind });
  }

  function handleChartKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setInteraction(null);
      return;
    }
    const index = active?.index;
    let next: number;
    if (event.key === "ArrowRight") next = index === undefined ? 0 : Math.min(points.length - 1, index + 1);
    else if (event.key === "ArrowLeft") next = index === undefined ? points.length - 1 : Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = points.length - 1;
    else return;
    event.preventDefault();
    showPoint(next, "keyboard");
  }

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="gap-3 space-y-0 pb-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <CardTitle>{fullPeriod}{showIncome ? "收支" : "支出"}趋势</CardTitle>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <p>{periodLabel} · {mode === "year" ? "1—12月" : `1—${points.length}日`}</p>
          {dailyExpense !== null && (
            <p className="whitespace-nowrap">
              日均支出 <span className="ml-1 whitespace-nowrap font-medium text-foreground"><span className="mr-0.5 text-[10px]">¥</span><span className="text-red-600">{formatCurrency(dailyExpense)}</span></span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-rose-500" />支出</span>
          {showIncome && <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-emerald-500" />收入</span>}
          {hasFuture && <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm border border-dashed border-slate-400" />未到{mode === "month" ? "日期" : "月份"}</span>}
          <span className="ml-auto">单位：元</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {maximum === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md bg-muted/40 px-4 text-center">
            <p className="text-sm text-muted-foreground">
              {onlyFuture ? "这个期间尚未开始" : `${periodLabel}暂无${showIncome ? "收支" : "支出"}记录`}
            </p>
            <p className="text-xs text-muted-foreground">
              {onlyFuture ? `有${showIncome ? "收支" : "支出"}记录后会在这里呈现趋势` : "可切换期间查看其他记录"}
            </p>
          </div>
        ) : (
          <div
            ref={chartRef}
            role="group"
            tabIndex={0}
            aria-label={`${periodLabel}${mode === "month" ? "每日" : "每月"}${showIncome ? "收支" : "支出"}趋势`}
            aria-describedby={activePoint ? `${instructionsId} ${tooltipId}` : instructionsId}
            className="relative rounded-sm"
            onKeyDown={handleChartKey}
            onFocus={(event) => {
              if (event.target === event.currentTarget && event.currentTarget.matches(":focus-visible")) showPoint(0, "keyboard");
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setInteraction(null);
            }}
          >
            <p id={instructionsId} className="sr-only">悬停或轻点柱形查看金额；使用左右方向键、Home 和 End 查看日期，Escape 关闭提示。</p>
            <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-1.5">
              <div aria-hidden="true" className="relative h-40 text-right text-[11px] leading-none text-muted-foreground sm:h-44 sm:text-xs">
                <span className="absolute right-0 top-0 -translate-y-1/2">{axisAmount(axisMax)}</span>
                <span className="absolute right-0 top-1/2 -translate-y-1/2">{axisAmount(axisMax / 2)}</span>
                <span className="absolute bottom-0 right-0 translate-y-1/2">0</span>
              </div>
              <div className="relative h-40 min-w-0 border-b border-border sm:h-44">
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border/80" />
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border/80" />
                <div className="relative grid h-full" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
                  {points.map((point, index) => {
                    const isActive = active?.index === index;
                    const visibleAmount = Math.max(point.expense, showIncome ? point.income : 0);
                    const readout = `${point.label}，支出 ${formatCurrency(point.expense)} 元${showIncome ? `，收入 ${formatCurrency(point.income)} 元` : ""}${point.future ? "，尚未到来" : ""}`;
                    return (
                      <button
                        key={point.key}
                        ref={(node) => {
                          if (node) columnRefs.current.set(point.key, node);
                          else columnRefs.current.delete(point.key);
                        }}
                        type="button"
                        tabIndex={-1}
                        aria-label={readout}
                        onPointerEnter={(event) => {
                          if (event.pointerType === "mouse") showPoint(index, "hover");
                        }}
                        onPointerLeave={(event) => {
                          if (event.pointerType === "mouse") setInteraction(current => current?.kind === "hover" && current.index === index ? null : current);
                        }}
                        onPointerDown={(event) => {
                          if (event.pointerType === "touch" || event.pointerType === "pen") touchStart.current = { index, x: event.clientX, y: event.clientY };
                        }}
                        onPointerCancel={() => { touchStart.current = null; }}
                        onPointerUp={(event) => {
                          const start = touchStart.current;
                          touchStart.current = null;
                          if (event.pointerType === "mouse" || !start || start.index !== index || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
                          setInteraction(current => current?.period === periodKey && current.kind === "touch" && current.index === index ? null : { period: periodKey, index, kind: "touch" });
                        }}
                        onClick={(event) => {
                          // Assistive technology can activate a button without pointer events.
                          if (event.detail === 0) showPoint(index, "keyboard");
                        }}
                        className={cn(
                          "group relative flex h-full min-w-0 items-end justify-center gap-px rounded-t-sm px-[1px] transition-colors hover:bg-muted/80 sm:gap-1 sm:px-1",
                          isActive && "bg-muted/80",
                          point.future && !isActive && "bg-muted/30",
                        )}
                      >
                        {point.future && visibleAmount === 0 ? (
                          <span className="mb-0.5 h-1 w-full max-w-5 rounded-sm border border-dashed border-slate-300" />
                        ) : (
                          <>
                            <span
                              className={cn("w-full max-w-8 rounded-t-sm bg-rose-500 transition-opacity", !isActive && "opacity-70 group-hover:opacity-100")}
                              style={{ height: `${(point.expense / axisMax) * 100}%`, minHeight: point.expense > 0 ? "2px" : "0" }}
                            />
                            {showIncome && (
                              <span
                                className={cn("w-full max-w-8 rounded-t-sm bg-emerald-500 transition-opacity", !isActive && "opacity-70 group-hover:opacity-100")}
                                style={{ height: `${(point.income / axisMax) * 100}%`, minHeight: point.income > 0 ? "2px" : "0" }}
                              />
                            )}
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <span aria-hidden="true" className="pt-2 text-right text-[11px] text-muted-foreground">{mode === "year" ? "月" : "日"}</span>
              <div aria-hidden="true" className="grid min-w-0 pt-2 text-center text-[11px] leading-none text-muted-foreground sm:text-xs" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
                {points.map((point, index) => (
                  <span key={point.key} className={cn(active?.index === index && "font-semibold text-foreground", point.future && active?.index !== index && "text-slate-400")}>
                    {mode === "year" || index === 0 || (index + 1) % 5 === 0 || (index === points.length - 1 && points.length % 5 > 1) ? index + 1 : ""}
                  </span>
                ))}
              </div>
            </div>
            {active && activePoint && createPortal(
              <div
                ref={tooltipRef}
                id={tooltipId}
                role="tooltip"
                className="pointer-events-none fixed z-50 w-max max-w-[calc(100vw-16px)] rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
                style={{ visibility: "hidden", left: 0, top: 0 }}
              >
                <p className="mb-1.5 font-medium">{activePoint.label}</p>
                <p className="flex items-baseline justify-between gap-4 whitespace-nowrap">
                  <span className="text-muted-foreground">支出</span>
                  <span><span className="mr-0.5 text-[10px]">¥</span><span className="font-semibold text-red-600">{formatCurrency(activePoint.expense)}</span></span>
                </p>
                {showIncome && <p className="mt-1 flex items-baseline justify-between gap-4 whitespace-nowrap">
                  <span className="text-muted-foreground">收入</span>
                  <span><span className="mr-0.5 text-[10px]">¥</span><span className="font-semibold text-green-600">{formatCurrency(activePoint.income)}</span></span>
                </p>}
                {activePoint.future && <p className="mt-1.5 text-muted-foreground">{activePoint.expense > 0 || (showIncome && activePoint.income > 0) ? "尚未到来 · 已记录金额" : "尚未到来"}</p>}
              </div>,
              document.body,
            )}
            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {active?.kind === "keyboard" && activePoint ? `${activePoint.label}，支出 ${formatCurrency(activePoint.expense)} 元${showIncome ? `，收入 ${formatCurrency(activePoint.income)} 元` : ""}${activePoint.future ? "，尚未到来" : ""}` : ""}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

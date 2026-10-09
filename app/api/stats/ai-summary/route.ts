import { ensureCashflowSchema } from "@/lib/ledger-event-schema";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getStatsPeriod, localCalendarDate } from "@/lib/stats-period";
import { buildSummaryPrompt, safeNumber, SUMMARY_SYSTEM_PROMPT, summaryComparisonEnd } from "@/lib/stats-ai-summary";
import { bailianConfig, bailianStream, bailianFailure, BAILIAN_SUMMARY_MODEL } from "@/lib/bailian";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  let cleanupUpstream: (() => void) | undefined;
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    bailianConfig();

    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get("month"); // YYYY-MM
    const year = searchParams.get("year"); // YYYY
    if ((month && year) || (!month && !year)) {
      return NextResponse.json(
        { error: "参数错误：month 与 year 需二选一" },
        { status: 400 }
      );
    }

    const period = getStatsPeriod(month ? "month" : "year", (month || year) as string,
      searchParams.get("asOf") || localCalendarDate());
    if (!period) {
      return NextResponse.json({ error: "月份、年份或统计日期格式错误" }, { status: 400 });
    }
    await ensureCashflowSchema();
    const { startDate, endExclusive } = period;
    const comparisonEnd = summaryComparisonEnd(period);
    const periodLabel = month || `${year} 年`;

    // 取 Top 数据（减少 prompt 体积）
    const [categoryIncomeStats, categoryExpenseStats, memberIncomeStats, memberExpenseStats, summaryResult, previousResult, trendResult, expenseChanges] =
      await Promise.all([
        sql`
          SELECT
            COALESCE(c.name, '未分类') as name,
            SUM(t.amount) as total,
            COUNT(t.id) as count
          FROM transactions t
          LEFT JOIN categories c ON t.category_id = c.id
          WHERE t.user_id = ${session.userId} AND t.flow_kind = 'daily'
            AND t.type = 'income'
            AND t.transaction_date >= ${startDate}
            AND t.transaction_date < ${endExclusive}
          GROUP BY COALESCE(c.name, '未分类')
          ORDER BY total DESC
          LIMIT 5
        `,
        sql`
          SELECT
            COALESCE(c.name, '未分类') as name,
            SUM(t.amount) as total,
            COUNT(t.id) as count
          FROM transactions t
          LEFT JOIN categories c ON t.category_id = c.id
          WHERE t.user_id = ${session.userId} AND t.flow_kind = 'daily'
            AND t.type = 'expense'
            AND t.transaction_date >= ${startDate}
            AND t.transaction_date < ${endExclusive}
          GROUP BY COALESCE(c.name, '未分类')
          ORDER BY total DESC
          LIMIT 5
        `,
        sql`
          SELECT
            COALESCE(m.name, '未分配') as name,
            SUM(t.amount) as total,
            COUNT(t.id) as count
          FROM transactions t
          LEFT JOIN members m ON t.member_id = m.id
          WHERE t.user_id = ${session.userId} AND t.flow_kind = 'daily'
            AND t.type = 'income'
            AND t.transaction_date >= ${startDate}
            AND t.transaction_date < ${endExclusive}
          GROUP BY COALESCE(m.name, '未分配')
          ORDER BY total DESC
          LIMIT 5
        `,
        sql`
          SELECT
            COALESCE(m.name, '未分配') as name,
            SUM(t.amount) as total,
            COUNT(t.id) as count
          FROM transactions t
          LEFT JOIN members m ON t.member_id = m.id
          WHERE t.user_id = ${session.userId} AND t.flow_kind = 'daily'
            AND t.type = 'expense'
            AND t.transaction_date >= ${startDate}
            AND t.transaction_date < ${endExclusive}
          GROUP BY COALESCE(m.name, '未分配')
          ORDER BY total DESC
          LIMIT 5
        `,
        sql`
          SELECT
            COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as "totalIncome",
            COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as "totalExpense",
            COUNT(id) as count,
            COALESCE(SUM(CASE WHEN type = 'income' AND transaction_date < ${period.dailyEndExclusive} THEN amount ELSE 0 END), 0) as "elapsedIncome",
            COALESCE(SUM(CASE WHEN type = 'expense' AND transaction_date < ${period.dailyEndExclusive} THEN amount ELSE 0 END), 0) as "elapsedExpense",
            COUNT(id) FILTER (WHERE transaction_date < ${period.dailyEndExclusive}) as "elapsedCount"
          FROM transactions
          WHERE user_id = ${session.userId} AND flow_kind = 'daily'
            AND transaction_date >= ${startDate}
            AND transaction_date < ${endExclusive}
        `,
        sql`
          SELECT
            COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as "totalIncome",
            COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as "totalExpense",
            COUNT(id) as count
          FROM transactions
          WHERE user_id = ${session.userId} AND flow_kind = 'daily'
            AND transaction_date >= ${period.previousStartDate}
            AND transaction_date < ${comparisonEnd}
        `,
        sql`
          SELECT
            TO_CHAR(transaction_date, ${month ? "YYYY-MM-DD" : "YYYY-MM"}) as date,
            COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
            COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense
          FROM transactions
          WHERE user_id = ${session.userId} AND flow_kind = 'daily'
            AND transaction_date >= ${startDate}
            AND transaction_date < ${endExclusive}
          GROUP BY 1
          ORDER BY 1
        `,
        sql`
          SELECT
            COALESCE(c.name, '未分类') as name,
            COALESCE(SUM(CASE WHEN t.transaction_date >= ${startDate} AND t.transaction_date < ${period.dailyEndExclusive} THEN t.amount ELSE 0 END), 0) as "currentTotal",
            COALESCE(SUM(CASE WHEN t.transaction_date < ${comparisonEnd} THEN t.amount ELSE 0 END), 0) as "previousTotal",
            COUNT(t.id) FILTER (WHERE t.transaction_date < ${comparisonEnd}) as "previousCount"
          FROM transactions t
          LEFT JOIN categories c ON t.category_id = c.id
          WHERE t.user_id = ${session.userId} AND t.flow_kind = 'daily'
            AND t.type = 'expense'
            AND t.transaction_date >= ${period.previousStartDate}
            AND t.transaction_date < ${endExclusive}
          GROUP BY COALESCE(c.name, '未分类')
          ORDER BY ABS(
            COALESCE(SUM(CASE WHEN t.transaction_date >= ${startDate} AND t.transaction_date < ${period.dailyEndExclusive} THEN t.amount ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN t.transaction_date < ${comparisonEnd} THEN t.amount ELSE 0 END), 0)
          ) DESC
          LIMIT 5
        `,
      ]);

    const summary = summaryResult[0] || {};
    if (safeNumber(summary.count) === 0) {
      return new Response(`所选期间（${periodLabel}）还没有收支记录，暂时无法生成分析。记录收支后再试。`, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    const previous = previousResult[0] || {};
    const rankedRows = (rows: Array<Record<string, unknown>>, fallback: string) => rows.map(row => ({
      name: String(row.name || fallback), total: safeNumber(row.total), count: safeNumber(row.count),
    }));
    const prompt = buildSummaryPrompt({
      label: periodLabel,
      period,
      summary: { totalIncome: safeNumber(summary.totalIncome), totalExpense: safeNumber(summary.totalExpense), count: safeNumber(summary.count) },
      elapsed: { totalIncome: safeNumber(summary.elapsedIncome), totalExpense: safeNumber(summary.elapsedExpense), count: safeNumber(summary.elapsedCount) },
      previous: { totalIncome: safeNumber(previous.totalIncome), totalExpense: safeNumber(previous.totalExpense), count: safeNumber(previous.count) },
      expenseCategories: rankedRows(categoryExpenseStats, "未分类"),
      incomeCategories: rankedRows(categoryIncomeStats, "未分类"),
      expenseMembers: rankedRows(memberExpenseStats, "未分配"),
      incomeMembers: rankedRows(memberIncomeStats, "未分配"),
      trend: trendResult.map(row => ({ date: String(row.date), income: safeNumber(row.income), expense: safeNumber(row.expense) })),
      expenseChanges: expenseChanges.map(row => ({
        name: String(row.name || "未分类"), currentTotal: safeNumber(row.currentTotal),
        previousTotal: safeNumber(row.previousTotal), previousCount: safeNumber(row.previousCount),
      })),
    });

    const upstreamController = new AbortController();
    const abortUpstream = () => upstreamController.abort();
    if (request.signal.aborted) abortUpstream();
    request.signal.addEventListener("abort", abortUpstream, { once: true });
    cleanupUpstream = () => request.signal.removeEventListener("abort", abortUpstream);

    const result = await bailianStream({
      model: process.env.BAILIAN_SUMMARY_MODEL?.trim() || BAILIAN_SUMMARY_MODEL,
      reasoningEffort: "low",
      maxOutputTokens: 8192,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }, upstreamController.signal);

    const encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let hasText = false;
        let truncated = false;
        try {
          for await (const chunk of result) {
            if (cancelled || request.signal.aborted) break;
            if (chunk.type === "finish" && chunk.finishReason === "length") truncated = true;
            const delta = chunk.type === "text-delta" ? chunk.text : "";
            if (delta) {
              hasText = true;
              controller.enqueue(encoder.encode(delta));
            }
          }
          if (!cancelled && !request.signal.aborted) {
            if (!hasText) controller.enqueue(encoder.encode("AI 没有返回有效总结，请重试。"));
            else if (truncated) controller.enqueue(encoder.encode("\n\n（本次总结未生成完整，请重试。）"));
          }
        } catch (error: unknown) {
          if (!cancelled && !upstreamController.signal.aborted && !request.signal.aborted) {
            console.error("AI 总结流中断");
            controller.enqueue(encoder.encode(`\n\n（生成中断：${bailianFailure(error).message}）`));
          }
        } finally {
          if (!cancelled) controller.close();
          cleanupUpstream?.();
        }
      },
      cancel() {
        cancelled = true;
        abortUpstream();
        cleanupUpstream?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    cleanupUpstream?.();
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("AI 总结失败");
    const failure = bailianFailure(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}

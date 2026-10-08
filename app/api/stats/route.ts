import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getComparisonEnd, getStatsPeriod, localCalendarDate } from "@/lib/stats-period";

export async function GET(request: NextRequest) {
  try {
    // 验证用户登录
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "未登录" },
        { status: 401 }
      );
    }

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get("month"); // 格式: YYYY-MM
    const year = searchParams.get("year"); // 格式: YYYY

    // month/year 二选一
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
    const { startDate, endExclusive } = period;
    const comparisonEnd = getComparisonEnd(period);

    // 按分类统计 - 收入
    const categoryIncomeStats = await sql`
      SELECT 
        c.id,
        c.name,
        c.icon,
        c.color,
        SUM(t.amount) as total,
        COUNT(t.id) as count
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.user_id = ${session.userId}
        AND t.type = 'income'
        AND t.transaction_date >= ${startDate}
        AND t.transaction_date < ${endExclusive}
      GROUP BY c.id, c.name, c.icon, c.color
      ORDER BY total DESC
    `;

    // 按分类统计 - 支出
    const categoryExpenseStats = await sql`
      SELECT 
        c.id,
        c.name,
        c.icon,
        c.color,
        SUM(t.amount) as total,
        COUNT(t.id) as count
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.user_id = ${session.userId}
        AND t.type = 'expense'
        AND t.transaction_date >= ${startDate}
        AND t.transaction_date < ${endExclusive}
      GROUP BY c.id, c.name, c.icon, c.color
      ORDER BY total DESC
    `;

    // 按成员统计 - 收入
    const memberIncomeStats = await sql`
      SELECT 
        m.id,
        m.name,
        m.avatar,
        SUM(t.amount) as total,
        COUNT(t.id) as count
      FROM transactions t
      LEFT JOIN members m ON t.member_id = m.id
      WHERE t.user_id = ${session.userId}
        AND t.type = 'income'
        AND t.transaction_date >= ${startDate}
        AND t.transaction_date < ${endExclusive}
      GROUP BY m.id, m.name, m.avatar
      ORDER BY total DESC
    `;

    // 按成员统计 - 支出
    const memberExpenseStats = await sql`
      SELECT 
        m.id,
        m.name,
        m.avatar,
        SUM(t.amount) as total,
        COUNT(t.id) as count
      FROM transactions t
      LEFT JOIN members m ON t.member_id = m.id
      WHERE t.user_id = ${session.userId}
        AND t.type = 'expense'
        AND t.transaction_date >= ${startDate}
        AND t.transaction_date < ${endExclusive}
      GROUP BY m.id, m.name, m.avatar
      ORDER BY total DESC
    `;

    // 总计
    const summaryResult = await sql`
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as "totalIncome",
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as "totalExpense",
        COUNT(id) as count,
        COALESCE(SUM(CASE WHEN type = 'income' AND transaction_date < ${period.dailyEndExclusive} THEN amount ELSE 0 END), 0) as "elapsedIncome",
        COALESCE(SUM(CASE WHEN type = 'expense' AND transaction_date < ${period.dailyEndExclusive} THEN amount ELSE 0 END), 0) as "elapsedExpense",
        COUNT(id) FILTER (WHERE transaction_date < ${period.dailyEndExclusive}) as "elapsedCount"
      FROM transactions
      WHERE user_id = ${session.userId}
        AND transaction_date >= ${startDate}
        AND transaction_date < ${endExclusive}
    `;

    // The overview and AI summary use the same elapsed-day comparison cutoff.
    const previousResult = await sql`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as "totalIncome",
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as "totalExpense",
        COUNT(id) as count
      FROM transactions
      WHERE user_id = ${session.userId}
        AND transaction_date >= ${period.previousStartDate}
        AND transaction_date < ${comparisonEnd}
    `;
    const previous = previousResult[0] || { totalIncome: 0, totalExpense: 0 };

    const summary = summaryResult[0] || { totalIncome: 0, totalExpense: 0 };
    let monthlyStats: Array<{ month: number; income: number; expense: number }> = [];
    let dailyStats: Array<{ day: number; income: number; expense: number }> = [];

    if (year) {
      const monthlyResult = await sql`
        SELECT
          EXTRACT(MONTH FROM transaction_date)::int as month,
          COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense
        FROM transactions
        WHERE user_id = ${session.userId}
          AND transaction_date >= ${startDate}
          AND transaction_date < ${endExclusive}
        GROUP BY month
        ORDER BY month ASC
      `;

      const monthlyMap = new Map(
        monthlyResult.map((row) => [
          Number(row.month),
          {
            income: Number(row.income) || 0,
            expense: Number(row.expense) || 0,
          },
        ])
      );

      monthlyStats = Array.from({ length: 12 }, (_, index) => {
        const monthNumber = index + 1;
        const monthData = monthlyMap.get(monthNumber);
        return {
          month: monthNumber,
          income: monthData?.income || 0,
          expense: monthData?.expense || 0,
        };
      });
    } else {
      const dailyResult = await sql`
        SELECT
          EXTRACT(DAY FROM transaction_date)::int as day,
          COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense
        FROM transactions
        WHERE user_id = ${session.userId}
          AND transaction_date >= ${startDate}
          AND transaction_date < ${endExclusive}
        GROUP BY day
        ORDER BY day ASC
      `;
      const dailyMap = new Map(dailyResult.map((row) => [Number(row.day), row]));
      dailyStats = Array.from({ length: period.totalDays }, (_, index) => {
        const day = index + 1;
        const row = dailyMap.get(day);
        return { day, income: Number(row?.income) || 0, expense: Number(row?.expense) || 0 };
      });
    }

    return NextResponse.json({
      data: {
        categoryStats: {
          income: categoryIncomeStats || [],
          expense: categoryExpenseStats || [],
        },
        memberStats: {
          income: memberIncomeStats || [],
          expense: memberExpenseStats || [],
        },
        summary: {
          totalIncome: Number(summary.totalIncome) || 0,
          totalExpense: Number(summary.totalExpense) || 0,
          balance: (Number(summary.totalIncome) || 0) - (Number(summary.totalExpense) || 0),
          count: Number(summary.count) || 0,
          futureCount: Math.max(0, (Number(summary.count) || 0) - (Number(summary.elapsedCount) || 0)),
        },
        period,
        comparison: period.state === "future" ? null : {
          totalIncome: Number(previous.totalIncome) || 0,
          totalExpense: Number(previous.totalExpense) || 0,
          currentIncome: Number(summary.elapsedIncome) || 0,
          currentExpense: Number(summary.elapsedExpense) || 0,
          previousCount: Number(previous.count) || 0,
          currentCount: Number(summary.elapsedCount) || 0,
          previousEndExclusive: comparisonEnd,
        },
        dailyExpense: period.elapsedDays > 0 ? (Number(summary.elapsedExpense) || 0) / period.elapsedDays : null,
        monthlyStats,
        dailyStats,
      },
    });
  } catch (error) {
    console.error("获取统计数据失败:", error);
    return NextResponse.json(
      { error: "获取统计数据失败" },
      { status: 500 }
    );
  }
}

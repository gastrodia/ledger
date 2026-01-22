import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

function isValidMonth(month: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

function isValidYear(year: string) {
  return /^\d{4}$/.test(year);
}

function getMonthRangeExclusive(month: string) {
  const [y, m] = month.split("-");
  const year = Number(y);
  const monthNum = Number(m); // 1-12
  const start = `${y}-${m}-01`;
  const next = new Date(year, monthNum, 1); // monthNum is 1-based; Date month is 0-based, so this is next month
  const nextY = next.getFullYear();
  const nextM = String(next.getMonth() + 1).padStart(2, "0");
  const endExclusive = `${nextY}-${nextM}-01`;
  return { start, endExclusive };
}

function getYearRangeExclusive(yearStr: string) {
  const year = Number(yearStr);
  const start = `${yearStr}-01-01`;
  const endExclusive = `${year + 1}-01-01`;
  return { start, endExclusive };
}

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

    // 计算时间范围（半开区间：>= start 且 < endExclusive）
    let startDate: string;
    let endExclusive: string;
    if (month) {
      if (!isValidMonth(month)) {
        return NextResponse.json(
          { error: "月份格式错误，应为 YYYY-MM" },
          { status: 400 }
        );
      }
      const r = getMonthRangeExclusive(month);
      startDate = r.start;
      endExclusive = r.endExclusive;
    } else {
      // year 必定存在
      if (!isValidYear(year as string)) {
        return NextResponse.json(
          { error: "年份格式错误，应为 YYYY" },
          { status: 400 }
        );
      }
      const r = getYearRangeExclusive(year as string);
      startDate = r.start;
      endExclusive = r.endExclusive;
    }

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
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as "totalExpense"
      FROM transactions
      WHERE user_id = ${session.userId}
        AND transaction_date >= ${startDate}
        AND transaction_date < ${endExclusive}
    `;

    const summary = summaryResult[0] || { totalIncome: 0, totalExpense: 0 };

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
        },
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

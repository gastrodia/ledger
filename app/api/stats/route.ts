import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

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

    if (!month) {
      return NextResponse.json(
        { error: "缺少月份参数" },
        { status: 400 }
      );
    }

    // 计算月份的开始和结束日期
    const [year, monthNum] = month.split("-");
    const startDate = `${year}-${monthNum}-01`;
    const endDate = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
    const endDateStr = `${year}-${monthNum}-${endDate.toString().padStart(2, '0')}`;

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
        AND t.transaction_date <= ${endDateStr}
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
        AND t.transaction_date <= ${endDateStr}
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
        AND t.transaction_date <= ${endDateStr}
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
        AND t.transaction_date <= ${endDateStr}
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
        AND transaction_date <= ${endDateStr}
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

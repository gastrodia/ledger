import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { GoogleGenerativeAI } from "@google/generative-ai";

function formatYuan(amount: number) {
  const n = Number.isFinite(amount) ? amount : 0;
  return `¥${n.toFixed(2)}`;
}

function safeNumber(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function buildPrompt(params: {
  month: string;
  totalIncome: number;
  totalExpense: number;
  balance: number;
  topExpenseCategories: Array<{ name: string; total: number; count: number }>;
  topIncomeCategories: Array<{ name: string; total: number; count: number }>;
  topExpenseMembers: Array<{ name: string; total: number; count: number }>;
  topIncomeMembers: Array<{ name: string; total: number; count: number }>;
}) {
  const {
    month,
    totalIncome,
    totalExpense,
    balance,
    topExpenseCategories,
    topIncomeCategories,
    topExpenseMembers,
    topIncomeMembers,
  } = params;

  const renderList = (rows: Array<{ name: string; total: number; count: number }>) =>
    rows.length
      ? rows
          .map(
            (r, i) =>
              `${i + 1}. ${r.name || "未分类"}：${formatYuan(r.total)}（${r.count} 笔）`
          )
          .join("\n")
      : "（无）";

  return [
    "你是一个记账助手，请用简体中文对指定月份的收支做“可读、可执行”的总结。",
    "",
    "要求：",
    "- 输出为纯文本，尽量使用小标题 + 要点列表。",
    "- 不要编造不存在的数据；只基于我提供的统计数据。",
    "- 给出 2-4 条可执行建议（控制支出、提升结余、异常波动提醒等）。",
    "",
    `月份：${month}`,
    `总收入：${formatYuan(totalIncome)}`,
    `总支出：${formatYuan(totalExpense)}`,
    `结余：${formatYuan(balance)}`,
    "",
    "支出 Top 分类：",
    renderList(topExpenseCategories),
    "",
    "收入 Top 分类：",
    renderList(topIncomeCategories),
    "",
    "支出 Top 成员：",
    renderList(topExpenseMembers),
    "",
    "收入 Top 成员：",
    renderList(topIncomeMembers),
    "",
  ].join("\n");
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "服务端未配置 GEMINI_API_KEY" },
        { status: 500 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get("month"); // YYYY-MM
    if (!month) {
      return NextResponse.json({ error: "缺少月份参数" }, { status: 400 });
    }

    const [year, monthNum] = month.split("-");
    if (!year || !monthNum) {
      return NextResponse.json({ error: "月份格式错误，应为 YYYY-MM" }, { status: 400 });
    }

    const startDate = `${year}-${monthNum}-01`;
    const endDate = new Date(parseInt(year, 10), parseInt(monthNum, 10), 0).getDate();
    const endDateStr = `${year}-${monthNum}-${endDate.toString().padStart(2, "0")}`;

    // 取 Top 数据（减少 prompt 体积）
    const [categoryIncomeStats, categoryExpenseStats, memberIncomeStats, memberExpenseStats, summaryResult] =
      await Promise.all([
        sql`
          SELECT 
            COALESCE(c.name, '未分类') as name,
            SUM(t.amount) as total,
            COUNT(t.id) as count
          FROM transactions t
          LEFT JOIN categories c ON t.category_id = c.id
          WHERE t.user_id = ${session.userId}
            AND t.type = 'income'
            AND t.transaction_date >= ${startDate}
            AND t.transaction_date <= ${endDateStr}
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
          WHERE t.user_id = ${session.userId}
            AND t.type = 'expense'
            AND t.transaction_date >= ${startDate}
            AND t.transaction_date <= ${endDateStr}
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
          WHERE t.user_id = ${session.userId}
            AND t.type = 'income'
            AND t.transaction_date >= ${startDate}
            AND t.transaction_date <= ${endDateStr}
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
          WHERE t.user_id = ${session.userId}
            AND t.type = 'expense'
            AND t.transaction_date >= ${startDate}
            AND t.transaction_date <= ${endDateStr}
          GROUP BY COALESCE(m.name, '未分配')
          ORDER BY total DESC
          LIMIT 5
        `,
        sql`
          SELECT 
            COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as "totalIncome",
            COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as "totalExpense"
          FROM transactions
          WHERE user_id = ${session.userId}
            AND transaction_date >= ${startDate}
            AND transaction_date <= ${endDateStr}
        `,
      ]);

    const summary = (summaryResult?.[0] || { totalIncome: 0, totalExpense: 0 }) as Record<
      string,
      unknown
    >;
    const totalIncome = safeNumber(summary.totalIncome);
    const totalExpense = safeNumber(summary.totalExpense);
    const balance = totalIncome - totalExpense;

    const prompt = buildPrompt({
      month,
      totalIncome,
      totalExpense,
      balance,
      topExpenseCategories: (categoryExpenseStats || []).map((r: unknown) => {
        const row = (r || {}) as Record<string, unknown>;
        return {
          name: String(row.name || "未分类"),
          total: safeNumber(row.total),
          count: safeNumber(row.count),
        };
      }),
      topIncomeCategories: (categoryIncomeStats || []).map((r: unknown) => {
        const row = (r || {}) as Record<string, unknown>;
        return {
          name: String(row.name || "未分类"),
          total: safeNumber(row.total),
          count: safeNumber(row.count),
        };
      }),
      topExpenseMembers: (memberExpenseStats || []).map((r: unknown) => {
        const row = (r || {}) as Record<string, unknown>;
        return {
          name: String(row.name || "未分配"),
          total: safeNumber(row.total),
          count: safeNumber(row.count),
        };
      }),
      topIncomeMembers: (memberIncomeStats || []).map((r: unknown) => {
        const row = (r || {}) as Record<string, unknown>;
        return {
          name: String(row.name || "未分配"),
          total: safeNumber(row.total),
          count: safeNumber(row.count),
        };
      }),
    });

    const upstreamController = new AbortController();
    const abortUpstream = () => upstreamController.abort();
    if (request.signal.aborted) abortUpstream();
    request.signal.addEventListener("abort", abortUpstream);

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel(
      { model: "gemini-2.0-flash" },
      { apiVersion: "v1beta" }
    );

    const result = await model.generateContentStream(
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
      },
      { signal: upstreamController.signal }
    );

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of result.stream) {
            let text = "";
            try {
              text = chunk.text();
            } catch {
              // prompt/candidate 被安全策略拦截等情况下，text() 可能抛错
              text = "";
            }
            if (text) controller.enqueue(encoder.encode(text));
          }
        } catch {
          // 客户端取消/网络中断等，直接结束即可
        } finally {
          controller.close();
          request.signal.removeEventListener("abort", abortUpstream);
        }
      },
      cancel() {
        abortUpstream();
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
    console.error("AI 总结失败:", error);
    return NextResponse.json({ error: "AI 总结失败" }, { status: 500 });
  }
}


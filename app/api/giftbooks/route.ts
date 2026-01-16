import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";
import { ensureGiftBooksSchema } from "@/lib/giftbooks-schema";

type GiftBookSummaryRow = {
  cashTotal: string | number | null;
  itemEstimatedTotal: string | number | null;
  recordCount: string | number | null;
};

type GiftBookListRow = {
  id: string;
  user_id: string;
  name: string;
  event_type: string | null;
  event_date: string | null;
  location: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
} & GiftBookSummaryRow;

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

function toInt(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * GET /api/giftbooks
 * 获取礼簿列表（含简单汇总）
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    await ensureGiftBooksSchema();

    const giftbooks = (await sql`
      SELECT
        gb.id,
        gb.user_id,
        gb.name,
        gb.event_type,
        gb.event_date,
        gb.location,
        gb.description,
        gb.created_at,
        gb.updated_at,
        COALESCE(SUM(CASE WHEN gr.gift_type = 'cash' AND gr.direction = 'received' THEN gr.amount ELSE 0 END), 0) as "cashTotal",
        COALESCE(SUM(CASE WHEN gr.gift_type = 'item' THEN gr.estimated_value ELSE 0 END), 0) as "itemEstimatedTotal",
        COALESCE(COUNT(gr.id), 0) as "recordCount"
      FROM giftbooks gb
      LEFT JOIN gift_records gr ON gr.giftbook_id = gb.id AND gr.user_id = ${session.userId}
      WHERE gb.user_id = ${session.userId}
      GROUP BY gb.id
      ORDER BY COALESCE(gb.event_date, gb.created_at::date) DESC, gb.created_at DESC
    `) as GiftBookListRow[];

    const formatted = giftbooks.map((gb) => {
      const cashTotal = toNumber(gb.cashTotal);
      const itemEstimatedTotal = toNumber(gb.itemEstimatedTotal);
      const recordCount = toInt(gb.recordCount);

      return {
        id: gb.id,
        user_id: gb.user_id,
        name: gb.name,
        event_type: gb.event_type,
        event_date: gb.event_date,
        location: gb.location,
        description: gb.description,
        created_at: gb.created_at,
        updated_at: gb.updated_at,
        summary: {
          cashTotal,
          itemEstimatedTotal,
          recordCount,
        },
      };
    });

    return NextResponse.json({ data: formatted });
  } catch (error) {
    console.error("获取礼簿列表错误:", error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes('relation "giftbooks" does not exist')) {
      return NextResponse.json(
        { error: "礼簿表不存在：请先初始化数据库（giftbooks/gift_records）" },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: "获取礼簿列表失败" }, { status: 500 });
  }
}

/**
 * POST /api/giftbooks
 * 创建礼簿
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    await ensureGiftBooksSchema();

    const body = await request.json();
    const { name, event_type, event_date, location, description } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "礼簿名为必填项" }, { status: 400 });
    }
    if (name.length > 128) {
      return NextResponse.json({ error: "礼簿名长度必须在1-128个字符之间" }, { status: 400 });
    }

    const id = uuidv4();
    const result = await sql`
      INSERT INTO giftbooks (
        id, user_id, name, event_type, event_date, location, description, created_at, updated_at
      )
      VALUES (
        ${id},
        ${session.userId},
        ${name.trim()},
        ${event_type || null},
        ${event_date || null},
        ${location || null},
        ${description || null},
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    return NextResponse.json(
      { message: "礼簿创建成功", data: result[0] },
      { status: 201 }
    );
  } catch (error) {
    console.error("创建礼簿错误:", error);
    return NextResponse.json({ error: "创建礼簿失败" }, { status: 500 });
  }
}


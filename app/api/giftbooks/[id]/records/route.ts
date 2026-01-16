import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";
import { ensureGiftBooksSchema } from "@/lib/giftbooks-schema";

type GiftRecordRow = {
  id: string;
  user_id: string;
  giftbook_id: string;
  direction: "received" | "given";
  gift_type: "cash" | "item";
  counterparty_name: string;
  amount: string | number | null;
  currency: string | null;
  attachment_key: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  item_name: string | null;
  quantity: string | number | null;
  estimated_value: string | number | null;
  gift_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/**
 * GET /api/giftbooks/[id]/records
 * 获取礼簿下记录列表
 * 查询参数：
 * - q: 按对方姓名/备注模糊搜索（可选）
 * - giftType: cash|item（可选）
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    await ensureGiftBooksSchema();

    const { id: giftbookId } = await context.params;

    // 确认礼簿属于当前用户
    const giftbooks = await sql`
      SELECT id FROM giftbooks
      WHERE id = ${giftbookId} AND user_id = ${session.userId}
      LIMIT 1
    `;
    if (giftbooks.length === 0) {
      return NextResponse.json({ error: "礼簿不存在" }, { status: 404 });
    }

    const searchParams = request.nextUrl.searchParams;
    const q = searchParams.get("q");
    const giftType = searchParams.get("giftType");

    // 动态查询（对齐 transactions 的写法）
    let query = `
      SELECT *
      FROM gift_records
      WHERE user_id = $1 AND giftbook_id = $2 AND direction = 'received'
    `;
    const params: unknown[] = [session.userId, giftbookId];
    let paramIndex = 3;

    if (giftType && (giftType === "cash" || giftType === "item")) {
      query += ` AND gift_type = $${paramIndex}`;
      params.push(giftType);
      paramIndex++;
    }

    if (q && q.trim().length > 0) {
      query += ` AND (counterparty_name ILIKE $${paramIndex} OR COALESCE(notes, '') ILIKE $${paramIndex})`;
      params.push(`%${q.trim()}%`);
      paramIndex++;
    }

    query += ` ORDER BY gift_date DESC, created_at DESC`;

    const rows = (await sql.query(query, params)) as GiftRecordRow[];

    const formatted = rows.map((r) => ({
      ...r,
      amount: toNumberOrNull(r.amount),
      quantity: toNumberOrNull(r.quantity),
      estimated_value: toNumberOrNull(r.estimated_value),
    }));

    return NextResponse.json({ data: formatted });
  } catch (error) {
    console.error("获取礼簿记录错误:", error);
    return NextResponse.json({ error: "获取礼簿记录失败" }, { status: 500 });
  }
}

/**
 * POST /api/giftbooks/[id]/records
 * 创建礼簿记录（记录必须归属礼簿）
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    await ensureGiftBooksSchema();

    const { id: giftbookId } = await context.params;

    const giftbooks = await sql`
      SELECT id FROM giftbooks
      WHERE id = ${giftbookId} AND user_id = ${session.userId}
      LIMIT 1
    `;
    if (giftbooks.length === 0) {
      return NextResponse.json({ error: "礼簿不存在" }, { status: 404 });
    }

    const body = await request.json();
    const {
      gift_type,
      counterparty_name,
      amount,
      currency,
      attachment_key,
      attachment_name,
      attachment_type,
      item_name,
      quantity,
      estimated_value,
      gift_date,
      notes,
    } = body;

    if (!gift_type || !counterparty_name || !gift_date) {
      return NextResponse.json({ error: "请填写必填字段" }, { status: 400 });
    }
    if (gift_type !== "cash" && gift_type !== "item") {
      return NextResponse.json({ error: "gift_type 必须是 cash 或 item" }, { status: 400 });
    }
    if (typeof counterparty_name !== "string" || counterparty_name.trim().length === 0) {
      return NextResponse.json({ error: "对方姓名为必填项" }, { status: 400 });
    }
    if (counterparty_name.length > 128) {
      return NextResponse.json({ error: "对方姓名长度必须在1-128个字符之间" }, { status: 400 });
    }

    // 礼金 vs 礼品的字段校验
    let amountNum: number | null = null;
    let qtyNum: number | null = null;
    let estimatedNum: number | null = null;
    const currencyVal = currency || "CNY";

    if (gift_type === "cash") {
      const parsed = parseFloat(amount);
      if (isNaN(parsed) || parsed <= 0) {
        return NextResponse.json({ error: "礼金金额必须大于0" }, { status: 400 });
      }
      amountNum = parsed;
    } else {
      if (!item_name || typeof item_name !== "string" || item_name.trim().length === 0) {
        return NextResponse.json({ error: "礼品名称为必填项" }, { status: 400 });
      }
      if (quantity !== undefined && quantity !== null && quantity !== "") {
        const parsedQty = parseFloat(quantity);
        if (isNaN(parsedQty) || parsedQty <= 0) {
          return NextResponse.json({ error: "数量必须大于0" }, { status: 400 });
        }
        qtyNum = parsedQty;
      }
      if (estimated_value !== undefined && estimated_value !== null && estimated_value !== "") {
        const parsedEstimated = parseFloat(estimated_value);
        if (isNaN(parsedEstimated) || parsedEstimated < 0) {
          return NextResponse.json({ error: "估值必须大于等于0" }, { status: 400 });
        }
        estimatedNum = parsedEstimated;
      }
    }

    const id = uuidv4();
    const result = await sql`
      INSERT INTO gift_records (
        id, user_id, giftbook_id,
        direction, gift_type, counterparty_name,
        amount, currency, attachment_key, attachment_name, attachment_type,
        item_name, quantity, estimated_value,
        gift_date, notes, created_at, updated_at
      )
      VALUES (
        ${id},
        ${session.userId},
        ${giftbookId},
        'received',
        ${gift_type},
        ${counterparty_name.trim()},
        ${amountNum},
        ${gift_type === "cash" ? currencyVal : null},
        ${attachment_key || null},
        ${attachment_name || null},
        ${attachment_type || null},
        ${gift_type === "item" ? item_name.trim() : null},
        ${qtyNum},
        ${estimatedNum},
        ${gift_date},
        ${notes || null},
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    const row = result[0] as GiftRecordRow;
    return NextResponse.json(
      {
        message: "礼簿记录创建成功",
        data: {
          ...row,
          amount: toNumberOrNull(row.amount),
          quantity: toNumberOrNull(row.quantity),
          estimated_value: toNumberOrNull(row.estimated_value),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("创建礼簿记录错误:", error);
    return NextResponse.json({ error: "创建礼簿记录失败" }, { status: 500 });
  }
}


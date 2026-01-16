import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";
import { ensureGiftsGivenSchema } from "@/lib/gifts-given-schema";

type GivenGiftListRow = {
  id: string;
  user_id: string;
  recipient_name: string;
  gift_date: string;
  occasion: string | null;
  notes: string | null;
  cash_amount: string | number | null;
  attachment_key: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  created_at: string;
  updated_at: string;
  items_count: string | number;
  items_estimated_total: string | number | null;
};

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * GET /api/gifts-given
 * 获取送礼记录列表（带筛选 + 汇总）
 *
 * 查询参数：
 * - q: 关键字（收礼人/事由/备注）
 * - startDate: YYYY-MM-DD
 * - endDate: YYYY-MM-DD
 * - hasCash: true/false
 * - hasItems: true/false
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    await ensureGiftsGivenSchema();

    const searchParams = request.nextUrl.searchParams;
    const q = searchParams.get("q");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const hasCash = searchParams.get("hasCash");
    const hasItems = searchParams.get("hasItems");

    let query = `
      SELECT
        g.id,
        g.user_id,
        g.recipient_name,
        g.gift_date,
        g.occasion,
        g.notes,
        g.cash_amount,
        g.attachment_key,
        g.attachment_name,
        g.attachment_type,
        g.created_at,
        g.updated_at,
        jsonb_array_length(g.items) as items_count,
        COALESCE(
          (
            SELECT SUM(((x->>'estimated_value')::numeric))
            FROM jsonb_array_elements(g.items) x
          ),
          0
        ) as items_estimated_total
      FROM given_gifts g
      WHERE g.user_id = $1
    `;

    const params: unknown[] = [session.userId];
    let idx = 2;

    if (startDate) {
      query += ` AND g.gift_date >= $${idx}`;
      params.push(startDate);
      idx++;
    }

    if (endDate) {
      query += ` AND g.gift_date <= $${idx}`;
      params.push(`${endDate} 23:59:59`);
      idx++;
    }

    if (q && q.trim().length > 0) {
      query += ` AND (
        g.recipient_name ILIKE $${idx}
        OR COALESCE(g.occasion, '') ILIKE $${idx}
        OR COALESCE(g.notes, '') ILIKE $${idx}
      )`;
      params.push(`%${q.trim()}%`);
      idx++;
    }

    // 过滤 “包含现金/包含物品”（写在 WHERE，避免 HAVING/子查询混乱）
    if (hasCash === "true") {
      query += ` AND g.cash_amount IS NOT NULL`;
    }
    if (hasItems === "true") {
      query += ` AND jsonb_array_length(g.items) > 0`;
    }

    query += ` ORDER BY gift_date DESC, created_at DESC`;

    const rows = (await sql.query(query, params)) as GivenGiftListRow[];

    const data = rows.map((r) => {
      const cash_amount = toNumberOrNull(r.cash_amount);
      const items_estimated_total = toNumberOrNull(r.items_estimated_total) ?? 0;
      const items_count = toNumber(r.items_count, 0);
      return {
        id: r.id,
        user_id: r.user_id,
        recipient_name: r.recipient_name,
        gift_date: r.gift_date,
        occasion: r.occasion,
        notes: r.notes,
        cash_amount,
        attachment_key: r.attachment_key,
        attachment_name: r.attachment_name,
        attachment_type: r.attachment_type,
        created_at: r.created_at,
        updated_at: r.updated_at,
        items_count,
        items_estimated_total,
      };
    });

    const summary = data.reduce(
      (acc, g) => {
        acc.cashTotal += g.cash_amount || 0;
        acc.itemEstimatedTotal += g.items_estimated_total || 0;
        acc.recordCount += 1;
        return acc;
      },
      { cashTotal: 0, itemEstimatedTotal: 0, recordCount: 0 }
    );

    return NextResponse.json({ data, summary });
  } catch (error) {
    console.error("获取送礼记录错误:", error);
    return NextResponse.json({ error: "获取送礼记录失败" }, { status: 500 });
  }
}

type GivenGiftItemInput = {
  item_name: string;
  quantity: number | string;
  unit?: string | null;
  estimated_value: number | string;
};

function parsePositiveNumber(value: unknown, fieldName: string): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${fieldName}必须大于0`);
  return n;
}

function parseNonNegativeNumber(value: unknown, fieldName: string): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${fieldName}必须大于等于0`);
  return n;
}

/**
 * POST /api/gifts-given
 * 创建送礼记录（支持现金+物品组合礼）
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    await ensureGiftsGivenSchema();

    const body = await request.json();
    const {
      recipient_name,
      gift_date,
      occasion,
      notes,
      cash_amount,
      items,
      attachment_key,
      attachment_name,
      attachment_type,
    } = body as {
      recipient_name?: string;
      gift_date?: string;
      occasion?: string;
      notes?: string;
      cash_amount?: number | string | null;
      items?: GivenGiftItemInput[];
      attachment_key?: string | null;
      attachment_name?: string | null;
      attachment_type?: string | null;
    };

    if (!recipient_name || typeof recipient_name !== "string" || recipient_name.trim().length === 0) {
      return NextResponse.json({ error: "收礼人为必填项" }, { status: 400 });
    }
    if (recipient_name.trim().length > 128) {
      return NextResponse.json({ error: "收礼人长度必须在1-128个字符之间" }, { status: 400 });
    }
    if (!gift_date) {
      return NextResponse.json({ error: "送礼日期为必填项" }, { status: 400 });
    }

    const hasCash = cash_amount !== undefined && cash_amount !== null && String(cash_amount) !== "";
    const hasItems = Array.isArray(items) && items.length > 0;

    if (!hasCash && !hasItems) {
      return NextResponse.json({ error: "至少需要填写现金或物品" }, { status: 400 });
    }

    let cashAmountNum: number | null = null;
    if (hasCash) {
      cashAmountNum = parsePositiveNumber(cash_amount, "现金金额");
    }

    const parsedItems: Array<{
      item_name: string;
      quantity: number;
      unit: string;
      estimated_value: number;
    }> = [];

    if (hasItems) {
      for (const it of items!) {
        const name = typeof it.item_name === "string" ? it.item_name.trim() : "";
        if (!name) {
          return NextResponse.json({ error: "物品名称为必填项" }, { status: 400 });
        }
        const qty = parsePositiveNumber(it.quantity, "物品数量");
        const unit = (it.unit || "件").trim() || "件";
        if (unit.length > 32) {
          return NextResponse.json(
            { error: "单位长度必须在1-32个字符之间" },
            { status: 400 }
          );
        }
        const estimated = parseNonNegativeNumber(it.estimated_value, "该行总估值");
        parsedItems.push({
          item_name: name,
          quantity: qty,
          unit,
          estimated_value: estimated,
        });
      }
    }

    const giftId = uuidv4();
    const inserted = await sql`
      INSERT INTO given_gifts (
        id, user_id, recipient_name, gift_date, occasion, notes,
        cash_amount, items,
        attachment_key, attachment_name, attachment_type,
        created_at, updated_at
      )
      VALUES (
        ${giftId},
        ${session.userId},
        ${recipient_name.trim()},
        ${gift_date},
        ${occasion || null},
        ${notes || null},
        ${cashAmountNum},
        ${JSON.stringify(parsedItems)}::jsonb,
        ${attachment_key || null},
        ${attachment_name || null},
        ${attachment_type || null},
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    return NextResponse.json(
      {
        message: "送礼记录创建成功",
        data: {
          ...inserted[0],
          cash_amount: toNumberOrNull(inserted[0].cash_amount),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("创建送礼记录错误:", error);
    const msg = error instanceof Error ? error.message : "创建送礼记录失败";
    const status = msg.includes("必须") || msg.includes("必填") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}


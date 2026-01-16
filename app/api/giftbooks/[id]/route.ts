import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ensureGiftBooksSchema } from "@/lib/giftbooks-schema";

/**
 * GET /api/giftbooks/[id]
 * 获取礼簿详情（含汇总）
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    await ensureGiftBooksSchema();

    const { id } = await context.params;

    const giftbooks = await sql`
      SELECT *
      FROM giftbooks
      WHERE id = ${id} AND user_id = ${session.userId}
      LIMIT 1
    `;

    if (giftbooks.length === 0) {
      return NextResponse.json({ error: "礼簿不存在" }, { status: 404 });
    }

    const summaryRows = await sql`
      SELECT
        COALESCE(SUM(CASE WHEN gift_type = 'cash' AND direction = 'received' THEN amount ELSE 0 END), 0) as "cashTotal",
        COALESCE(SUM(CASE WHEN gift_type = 'item' THEN estimated_value ELSE 0 END), 0) as "itemEstimatedTotal",
        COALESCE(COUNT(id), 0) as "recordCount"
      FROM gift_records
      WHERE giftbook_id = ${id} AND user_id = ${session.userId}
    `;

    const summaryRow = summaryRows[0] || {};
    const cashTotal = parseFloat(summaryRow.cashTotal || "0");
    const itemEstimatedTotal = parseFloat(summaryRow.itemEstimatedTotal || "0");
    const recordCount = parseInt(summaryRow.recordCount || "0", 10);

    return NextResponse.json({
      data: {
        ...giftbooks[0],
        summary: {
          cashTotal,
          itemEstimatedTotal,
          recordCount,
        },
      },
    });
  } catch (error) {
    console.error("获取礼簿详情错误:", error);
    return NextResponse.json({ error: "获取礼簿详情失败" }, { status: 500 });
  }
}

/**
 * PATCH /api/giftbooks/[id]
 * 更新礼簿
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    await ensureGiftBooksSchema();

    const { id } = await context.params;
    const body = await request.json();
    const { name, event_type, event_date, location, description } = body;

    const existing = await sql`
      SELECT * FROM giftbooks
      WHERE id = ${id} AND user_id = ${session.userId}
      LIMIT 1
    `;
    if (existing.length === 0) {
      return NextResponse.json({ error: "礼簿不存在" }, { status: 404 });
    }

    const existingGiftBook = existing[0];
    const newName = name !== undefined ? name : existingGiftBook.name;

    if (!newName || typeof newName !== "string" || newName.trim().length === 0) {
      return NextResponse.json({ error: "礼簿名为必填项" }, { status: 400 });
    }
    if (newName.length > 128) {
      return NextResponse.json({ error: "礼簿名长度必须在1-128个字符之间" }, { status: 400 });
    }

    const result = await sql`
      UPDATE giftbooks
      SET
        name = ${newName.trim()},
        event_type = ${event_type !== undefined ? event_type : existingGiftBook.event_type},
        event_date = ${event_date !== undefined ? event_date : existingGiftBook.event_date},
        location = ${location !== undefined ? location : existingGiftBook.location},
        description = ${description !== undefined ? description : existingGiftBook.description},
        updated_at = NOW()
      WHERE id = ${id} AND user_id = ${session.userId}
      RETURNING *
    `;

    return NextResponse.json({ message: "礼簿更新成功", data: result[0] });
  } catch (error) {
    console.error("更新礼簿错误:", error);
    return NextResponse.json({ error: "更新礼簿失败" }, { status: 500 });
  }
}

/**
 * DELETE /api/giftbooks/[id]
 * 删除礼簿（级联删除记录）
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    await ensureGiftBooksSchema();

    const { id } = await context.params;

    const existing = await sql`
      SELECT id FROM giftbooks
      WHERE id = ${id} AND user_id = ${session.userId}
      LIMIT 1
    `;
    if (existing.length === 0) {
      return NextResponse.json({ error: "礼簿不存在" }, { status: 404 });
    }

    await sql`
      DELETE FROM giftbooks
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    return NextResponse.json({ message: "礼簿删除成功" });
  } catch (error) {
    console.error("删除礼簿错误:", error);
    return NextResponse.json({ error: "删除礼簿失败" }, { status: 500 });
  }
}


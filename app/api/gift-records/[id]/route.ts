import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
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
 * PATCH /api/gift-records/[id]
 * 更新礼簿记录
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

    const existingRows = await sql`
      SELECT * FROM gift_records
      WHERE id = ${id} AND user_id = ${session.userId}
      LIMIT 1
    `;
    if (existingRows.length === 0) {
      return NextResponse.json({ error: "礼簿记录不存在" }, { status: 404 });
    }

    const existing = existingRows[0] as GiftRecordRow;

    const gift_type = body.gift_type !== undefined ? body.gift_type : existing.gift_type;
    const counterparty_name =
      body.counterparty_name !== undefined ? body.counterparty_name : existing.counterparty_name;
    const currency = body.currency !== undefined ? body.currency : existing.currency;
    const attachment_key =
      body.attachment_key !== undefined ? body.attachment_key : undefined;
    const attachment_name =
      body.attachment_name !== undefined ? body.attachment_name : undefined;
    const attachment_type =
      body.attachment_type !== undefined ? body.attachment_type : undefined;
    const item_name = body.item_name !== undefined ? body.item_name : existing.item_name;
    const gift_date = body.gift_date !== undefined ? body.gift_date : existing.gift_date;
    const notes = body.notes !== undefined ? body.notes : existing.notes;

    if (gift_type !== "cash" && gift_type !== "item") {
      return NextResponse.json({ error: "gift_type 必须是 cash 或 item" }, { status: 400 });
    }
    if (!counterparty_name || typeof counterparty_name !== "string" || counterparty_name.trim().length === 0) {
      return NextResponse.json({ error: "对方姓名为必填项" }, { status: 400 });
    }
    if (counterparty_name.length > 128) {
      return NextResponse.json({ error: "对方姓名长度必须在1-128个字符之间" }, { status: 400 });
    }

    let amountNum: number | null = null;
    let qtyNum: number | null = null;
    let estimatedNum: number | null = null;

    if (gift_type === "cash") {
      const amountVal = body.amount !== undefined ? body.amount : existing.amount;
      const parsed = parseFloat(amountVal);
      if (isNaN(parsed) || parsed <= 0) {
        return NextResponse.json({ error: "礼金金额必须大于0" }, { status: 400 });
      }
      amountNum = parsed;
    } else {
      if (!item_name || typeof item_name !== "string" || item_name.trim().length === 0) {
        return NextResponse.json({ error: "礼品名称为必填项" }, { status: 400 });
      }

      const qtyVal = body.quantity !== undefined ? body.quantity : existing.quantity;
      if (qtyVal !== undefined && qtyVal !== null && qtyVal !== "") {
        const parsedQty = parseFloat(qtyVal);
        if (isNaN(parsedQty) || parsedQty <= 0) {
          return NextResponse.json({ error: "数量必须大于0" }, { status: 400 });
        }
        qtyNum = parsedQty;
      }

      const estimatedVal = body.estimated_value !== undefined ? body.estimated_value : existing.estimated_value;
      if (estimatedVal !== undefined && estimatedVal !== null && estimatedVal !== "") {
        const parsedEstimated = parseFloat(estimatedVal);
        if (isNaN(parsedEstimated) || parsedEstimated < 0) {
          return NextResponse.json({ error: "估值必须大于等于0" }, { status: 400 });
        }
        estimatedNum = parsedEstimated;
      }
    }

    const result = await sql`
      UPDATE gift_records
      SET
        direction = 'received',
        gift_type = ${gift_type},
        counterparty_name = ${counterparty_name.trim()},
        amount = ${amountNum},
        currency = ${gift_type === "cash" ? (currency || "CNY") : null},
        attachment_key = ${attachment_key !== undefined ? attachment_key : existing.attachment_key},
        attachment_name = ${attachment_name !== undefined ? attachment_name : existing.attachment_name},
        attachment_type = ${attachment_type !== undefined ? attachment_type : existing.attachment_type},
        item_name = ${gift_type === "item" ? item_name.trim() : null},
        quantity = ${qtyNum},
        estimated_value = ${estimatedNum},
        gift_date = ${gift_date},
        notes = ${notes || null},
        updated_at = NOW()
      WHERE id = ${id} AND user_id = ${session.userId}
      RETURNING *
    `;

    const row = result[0] as GiftRecordRow;
    return NextResponse.json({
      message: "礼簿记录更新成功",
      data: {
        ...row,
        amount: toNumberOrNull(row.amount),
        quantity: toNumberOrNull(row.quantity),
        estimated_value: toNumberOrNull(row.estimated_value),
      },
    });
  } catch (error) {
    console.error("更新礼簿记录错误:", error);
    return NextResponse.json({ error: "更新礼簿记录失败" }, { status: 500 });
  }
}

/**
 * DELETE /api/gift-records/[id]
 * 删除礼簿记录
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

    const existingRows = await sql`
      SELECT id FROM gift_records
      WHERE id = ${id} AND user_id = ${session.userId}
      LIMIT 1
    `;
    if (existingRows.length === 0) {
      return NextResponse.json({ error: "礼簿记录不存在" }, { status: 404 });
    }

    await sql`
      DELETE FROM gift_records
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    return NextResponse.json({ message: "礼簿记录删除成功" });
  } catch (error) {
    console.error("删除礼簿记录错误:", error);
    return NextResponse.json({ error: "删除礼簿记录失败" }, { status: 500 });
  }
}


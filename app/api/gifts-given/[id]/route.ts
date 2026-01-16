import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { del } from "@vercel/blob";
import { ensureGiftsGivenSchema } from "@/lib/gifts-given-schema";

type GivenGiftRow = {
  id: string;
  user_id: string;
  recipient_name: string;
  gift_date: string;
  occasion: string | null;
  notes: string | null;
  cash_amount: string | number | null;
  items: unknown;
  attachment_key: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  created_at: string;
  updated_at: string;
};

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function normalizeItems(items: unknown): Array<{
  item_name: string;
  quantity: number;
  unit: string;
  estimated_value: number;
}> {
  let arr: any[] = [];
  if (Array.isArray(items)) {
    arr = items;
  } else if (typeof items === "string") {
    try {
      const parsed = JSON.parse(items);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      arr = [];
    }
  } else if (items && typeof items === "object") {
    // jsonb might come as object, but we expect array
    arr = [];
  }

  return arr
    .map((it) => ({
      item_name: typeof it?.item_name === "string" ? it.item_name : "",
      quantity: toNumberOrNull(it?.quantity) ?? 0,
      unit: typeof it?.unit === "string" && it.unit.trim() ? it.unit.trim() : "件",
      estimated_value: toNumberOrNull(it?.estimated_value) ?? 0,
    }))
    .filter((it) => it.item_name.length > 0);
}

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

type GivenGiftItemInput = {
  item_name: string;
  quantity: number | string;
  unit?: string | null;
  estimated_value: number | string;
};

/**
 * GET /api/gifts-given/[id]
 * 获取送礼记录详情（含物品明细）
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

    await ensureGiftsGivenSchema();

    const { id } = await context.params;
    const gifts = await sql`
      SELECT * FROM given_gifts
      WHERE id = ${id} AND user_id = ${session.userId}
      LIMIT 1
    `;
    if (gifts.length === 0) {
      return NextResponse.json({ error: "送礼记录不存在" }, { status: 404 });
    }

    const gift = gifts[0] as GivenGiftRow;
    const items = normalizeItems(gift.items);

    return NextResponse.json({
      data: {
        ...gift,
        cash_amount: toNumberOrNull(gift.cash_amount),
        items,
      },
    });
  } catch (error) {
    console.error("获取送礼详情错误:", error);
    return NextResponse.json({ error: "获取送礼详情失败" }, { status: 500 });
  }
}

/**
 * PATCH /api/gifts-given/[id]
 * 更新送礼记录（整包替换 items + 附件三态）
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

    await ensureGiftsGivenSchema();

    const { id } = await context.params;
    const existingRows = await sql`
      SELECT * FROM given_gifts
      WHERE id = ${id} AND user_id = ${session.userId}
      LIMIT 1
    `;
    if (existingRows.length === 0) {
      return NextResponse.json({ error: "送礼记录不存在" }, { status: 404 });
    }

    const existing = existingRows[0] as GivenGiftRow;
    const oldAttachmentKey = existing.attachment_key || null;
    const existingItems = normalizeItems(existing.items);

    const body = (await request.json()) as {
      recipient_name?: string;
      gift_date?: string;
      occasion?: string | null;
      notes?: string | null;
      cash_amount?: number | string | null;
      items?: GivenGiftItemInput[];
      attachment_key?: string | null;
      attachment_name?: string | null;
      attachment_type?: string | null;
    };

    const recipient_name =
      body.recipient_name !== undefined ? body.recipient_name : existing.recipient_name;
    if (!recipient_name || typeof recipient_name !== "string" || recipient_name.trim().length === 0) {
      return NextResponse.json({ error: "收礼人为必填项" }, { status: 400 });
    }
    if (recipient_name.trim().length > 128) {
      return NextResponse.json({ error: "收礼人长度必须在1-128个字符之间" }, { status: 400 });
    }

    const gift_date = body.gift_date !== undefined ? body.gift_date : existing.gift_date;
    if (!gift_date) {
      return NextResponse.json({ error: "送礼日期为必填项" }, { status: 400 });
    }

    const occasion = body.occasion !== undefined ? body.occasion : existing.occasion;
    const notes = body.notes !== undefined ? body.notes : existing.notes;

    // cash
    let cash_amount: number | null;
    if (body.cash_amount === undefined) {
      cash_amount = toNumberOrNull(existing.cash_amount);
    } else if (body.cash_amount === null || String(body.cash_amount) === "") {
      cash_amount = null;
    } else {
      cash_amount = parsePositiveNumber(body.cash_amount, "现金金额");
    }

    // items (整包替换；undefined=不改)
    let parsedItems:
      | Array<{ item_name: string; quantity: number; unit: string; estimated_value: number }>
      | undefined;

    if (body.items !== undefined) {
      parsedItems = [];
      if (Array.isArray(body.items)) {
        for (const it of body.items) {
          const name = typeof it.item_name === "string" ? it.item_name.trim() : "";
          if (!name) {
            return NextResponse.json({ error: "物品名称为必填项" }, { status: 400 });
          }
          const qty = parsePositiveNumber(it.quantity, "物品数量");
          const unit = (it.unit || "件").trim() || "件";
          if (unit.length > 32) {
            return NextResponse.json({ error: "单位长度必须在1-32个字符之间" }, { status: 400 });
          }
          const estimated = parseNonNegativeNumber(it.estimated_value, "该行总估值");
          parsedItems.push({ item_name: name, quantity: qty, unit, estimated_value: estimated });
        }
      }
    }

    const nextItemsCount = parsedItems !== undefined ? parsedItems.length : existingItems.length;

    if (cash_amount === null && nextItemsCount === 0) {
      return NextResponse.json({ error: "至少需要填写现金或物品" }, { status: 400 });
    }

    // attachment (三态：undefined 不改；null 移除；string 替换)
    const attachment_key =
      body.attachment_key !== undefined ? body.attachment_key : undefined;
    const attachment_name =
      body.attachment_key === null
        ? null
        : body.attachment_name !== undefined
          ? body.attachment_name
          : undefined;
    const attachment_type =
      body.attachment_key === null
        ? null
        : body.attachment_type !== undefined
          ? body.attachment_type
          : undefined;

    const itemsJson =
      parsedItems !== undefined ? JSON.stringify(parsedItems) : JSON.stringify(existingItems);

    const updated = await sql`
      UPDATE given_gifts
      SET
        recipient_name = ${recipient_name.trim()},
        gift_date = ${gift_date},
        occasion = ${occasion || null},
        notes = ${notes || null},
        cash_amount = ${cash_amount},
        items = ${itemsJson}::jsonb,
        attachment_key = ${attachment_key !== undefined ? attachment_key : existing.attachment_key},
        attachment_name = ${attachment_name !== undefined ? attachment_name : existing.attachment_name},
        attachment_type = ${attachment_type !== undefined ? attachment_type : existing.attachment_type},
        updated_at = NOW()
      WHERE id = ${id} AND user_id = ${session.userId}
      RETURNING *
    `;

    // 尽力删除旧附件（仅当 attachment_key 显式变化）
    if (attachment_key !== undefined && oldAttachmentKey && attachment_key !== oldAttachmentKey) {
      try {
        await del(oldAttachmentKey);
      } catch (e) {
        console.error("更新送礼时删除旧附件失败:", e);
      }
    }

    const row = updated[0] as GivenGiftRow;
    return NextResponse.json({
      message: "送礼记录更新成功",
      data: {
        ...row,
        cash_amount: toNumberOrNull(row.cash_amount),
      },
    });
  } catch (error) {
    console.error("更新送礼记录错误:", error);
    const msg = error instanceof Error ? error.message : "更新送礼记录失败";
    const status = msg.includes("必须") || msg.includes("必填") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/**
 * DELETE /api/gifts-given/[id]
 * 删除送礼记录（同时删除附件；明细级联删除）
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

    await ensureGiftsGivenSchema();

    const { id } = await context.params;
    const rows = await sql`
      SELECT id, attachment_key FROM given_gifts
      WHERE id = ${id} AND user_id = ${session.userId}
      LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "送礼记录不存在" }, { status: 404 });
    }

    const attachmentKey = (rows[0] as any)?.attachment_key as string | null | undefined;
    if (attachmentKey) {
      try {
        await del(attachmentKey);
      } catch (e) {
        console.error("删除送礼附件失败:", e);
        return NextResponse.json({ error: "删除附件失败，请稍后重试" }, { status: 500 });
      }
    }

    await sql`
      DELETE FROM given_gifts
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    return NextResponse.json({ message: "送礼记录删除成功" });
  } catch (error) {
    console.error("删除送礼记录错误:", error);
    return NextResponse.json({ error: "删除送礼记录失败" }, { status: 500 });
  }
}


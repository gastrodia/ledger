import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ensureGiftBooksSchema } from "@/lib/giftbooks-schema";
import { v4 as uuidv4 } from "uuid";

type GiftRecordRow = {
  id: string;
  user_id: string;
  giftbook_id: string;
  group_id: string | null;
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
  unit: string | null;
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

function normalizeUnit(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  return s || "件";
}

async function loadGroupRows(userId: string, groupIdOrLegacyId: string) {
  await ensureGiftBooksSchema();
  const rows = (await sql`
    SELECT *
    FROM gift_records
    WHERE user_id = ${userId}
      AND direction = 'received'
      AND (group_id = ${groupIdOrLegacyId} OR id = ${groupIdOrLegacyId})
    ORDER BY CASE WHEN gift_type = 'cash' THEN 0 ELSE 1 END, created_at ASC
  `) as GiftRecordRow[];
  return rows;
}

function buildGroup(rows: GiftRecordRow[]) {
  const groupId = rows[0]?.group_id || rows[0]?.id;
  const cash = rows.find((r) => r.gift_type === "cash") || null;
  const items = rows
    .filter((r) => r.gift_type === "item")
    .map((r) => ({
      id: r.id,
      item_name: r.item_name || "",
      quantity: toNumberOrNull(r.quantity) || 0,
      unit: r.unit || "件",
      estimated_value: toNumberOrNull(r.estimated_value) || 0,
    }));

  const attachmentRow = rows.find((r) => !!r.attachment_key) || null;
  const notesVal = rows.find((r) => r.notes && String(r.notes).trim().length > 0)?.notes || null;

  return {
    id: groupId,
    giftbook_id: rows[0]?.giftbook_id || "",
    counterparty_name: rows[0]?.counterparty_name || "",
    gift_date: rows[0]?.gift_date || "",
    notes: notesVal,
    cash_amount: cash ? toNumberOrNull(cash.amount) : null,
    currency: cash?.currency || null,
    items,
    attachment_key: attachmentRow?.attachment_key || null,
    attachment_name: attachmentRow?.attachment_name || null,
    attachment_type: attachmentRow?.attachment_type || null,
  };
}

/**
 * GET /api/gift-record-groups/[id]
 * 获取一组礼簿记录（礼金 + 多行礼品）
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { id } = await context.params;
    const rows = await loadGroupRows(session.userId, id);
    if (rows.length === 0) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

    return NextResponse.json({ data: buildGroup(rows) });
  } catch (e) {
    console.error("获取礼簿记录组错误:", e);
    return NextResponse.json({ error: "获取失败" }, { status: 500 });
  }
}

/**
 * PATCH /api/gift-record-groups/[id]
 * 更新一组礼簿记录（礼金 + 多行礼品）
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { id } = await context.params;
    const existingRows = await loadGroupRows(session.userId, id);
    if (existingRows.length === 0) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

    const groupId = existingRows[0].group_id || existingRows[0].id;
    const giftbookId = existingRows[0].giftbook_id;

    const body = await request.json();

    const counterparty_name =
      typeof body.counterparty_name === "string" ? body.counterparty_name.trim() : "";
    const gift_date = typeof body.gift_date === "string" ? body.gift_date : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";

    const hasCash = !!body.hasCash;
    const hasItems = !!body.hasItems;

    if (!counterparty_name) return NextResponse.json({ error: "对方姓名为必填项" }, { status: 400 });
    if (counterparty_name.length > 128) {
      return NextResponse.json({ error: "对方姓名长度必须在1-128个字符之间" }, { status: 400 });
    }
    if (!gift_date) return NextResponse.json({ error: "日期为必填项" }, { status: 400 });
    if (!hasCash && !hasItems) {
      return NextResponse.json({ error: "至少选择礼金或礼品之一" }, { status: 400 });
    }

    const amountVal = body.amount;
    const currencyVal = "CNY";

    let cashAmountNum: number | null = null;
    if (hasCash) {
      const n = typeof amountVal === "number" ? amountVal : parseFloat(String(amountVal));
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: "礼金金额必须大于0" }, { status: 400 });
      }
      cashAmountNum = n;
    }

    const itemsRaw = Array.isArray(body.items) ? body.items : [];
    const desiredItems: Array<{
      id?: string;
      item_name: string;
      quantity: number;
      unit: string;
      estimated_value: number;
    }> = [];

    if (hasItems) {
      if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
        return NextResponse.json({ error: "请至少添加一行礼品" }, { status: 400 });
      }
      for (const it of itemsRaw) {
        const name = typeof it?.item_name === "string" ? it.item_name.trim() : "";
        if (!name) return NextResponse.json({ error: "礼品名称为必填项" }, { status: 400 });
        const q = typeof it?.quantity === "number" ? it.quantity : parseFloat(String(it?.quantity));
        if (!Number.isFinite(q) || q <= 0) return NextResponse.json({ error: "礼品数量必须大于0" }, { status: 400 });
        const unit = normalizeUnit(it?.unit);
        const ev =
          typeof it?.estimated_value === "number"
            ? it.estimated_value
            : parseFloat(String(it?.estimated_value ?? 0));
        if (!Number.isFinite(ev) || ev < 0) return NextResponse.json({ error: "估值必须大于等于0" }, { status: 400 });

        const rowId = typeof it?.id === "string" && it.id.trim() ? it.id.trim() : undefined;
        desiredItems.push({ id: rowId, item_name: name, quantity: q, unit, estimated_value: ev });
      }
    }

    // 附件三态：undefined=不变；null=移除；string=更新
    const attachmentKey =
      body.attachment_key !== undefined ? (typeof body.attachment_key === "string" ? body.attachment_key : null) : undefined;
    const attachmentName =
      body.attachment_name !== undefined ? (typeof body.attachment_name === "string" ? body.attachment_name : null) : undefined;
    const attachmentType =
      body.attachment_type !== undefined ? (typeof body.attachment_type === "string" ? body.attachment_type : null) : undefined;
    const attachmentsExplicit =
      attachmentKey !== undefined || attachmentName !== undefined || attachmentType !== undefined;

    const existingCash = existingRows.find((r) => r.gift_type === "cash") || null;
    const existingItems = existingRows.filter((r) => r.gift_type === "item");
    const existingItemById = new Map(existingItems.map((r) => [r.id, r] as const));

    // 先处理现金
    let cashRowId: string | null = null;
    if (hasCash) {
      if (existingCash) {
        cashRowId = existingCash.id;
        await sql`
          UPDATE gift_records
          SET
            group_id = ${groupId},
            direction = 'received',
            gift_type = 'cash',
            counterparty_name = ${counterparty_name},
            amount = ${cashAmountNum},
            currency = ${currencyVal},
            item_name = NULL,
            quantity = NULL,
            unit = NULL,
            estimated_value = NULL,
            gift_date = ${gift_date},
            notes = ${notes || null},
            updated_at = NOW()
          WHERE id = ${existingCash.id} AND user_id = ${session.userId}
        `;
      } else {
        cashRowId = uuidv4();
        await sql`
          INSERT INTO gift_records (
            id, user_id, giftbook_id, group_id,
            direction, gift_type, counterparty_name,
            amount, currency,
            attachment_key, attachment_name, attachment_type,
            item_name, quantity, unit, estimated_value,
            gift_date, notes, created_at, updated_at
          )
          VALUES (
            ${cashRowId},
            ${session.userId},
            ${giftbookId},
            ${groupId},
            'received',
            'cash',
            ${counterparty_name},
            ${cashAmountNum},
            ${currencyVal},
            NULL, NULL, NULL,
            NULL, NULL, NULL, NULL,
            ${gift_date},
            ${notes || null},
            NOW(),
            NOW()
          )
        `;
      }
    } else if (existingCash) {
      await sql`DELETE FROM gift_records WHERE id = ${existingCash.id} AND user_id = ${session.userId}`;
    }

    // 处理礼品（多行）
    const keepItemIds = new Set<string>();
    const ensuredItemIds: string[] = [];
    if (hasItems) {
      for (const it of desiredItems) {
        const existing = it.id ? existingItemById.get(it.id) : undefined;
        if (existing) {
          keepItemIds.add(existing.id);
          ensuredItemIds.push(existing.id);
          await sql`
            UPDATE gift_records
            SET
              group_id = ${groupId},
              direction = 'received',
              gift_type = 'item',
              counterparty_name = ${counterparty_name},
              amount = NULL,
              currency = NULL,
              item_name = ${it.item_name},
              quantity = ${it.quantity},
              unit = ${it.unit},
              estimated_value = ${it.estimated_value},
              gift_date = ${gift_date},
              notes = ${notes || null},
              updated_at = NOW()
            WHERE id = ${existing.id} AND user_id = ${session.userId}
          `;
        } else {
          const newId = uuidv4();
          keepItemIds.add(newId);
          ensuredItemIds.push(newId);
          await sql`
            INSERT INTO gift_records (
              id, user_id, giftbook_id, group_id,
              direction, gift_type, counterparty_name,
              amount, currency,
              attachment_key, attachment_name, attachment_type,
              item_name, quantity, unit, estimated_value,
              gift_date, notes, created_at, updated_at
            )
            VALUES (
              ${newId},
              ${session.userId},
              ${giftbookId},
              ${groupId},
              'received',
              'item',
              ${counterparty_name},
              NULL,
              NULL,
              NULL, NULL, NULL,
              ${it.item_name},
              ${it.quantity},
              ${it.unit},
              ${it.estimated_value},
              ${gift_date},
              ${notes || null},
              NOW(),
              NOW()
            )
          `;
        }
      }
    }

    // 删除不再需要的礼品行
    for (const r of existingItems) {
      if (!keepItemIds.has(r.id)) {
        await sql`DELETE FROM gift_records WHERE id = ${r.id} AND user_id = ${session.userId}`;
      }
    }

    // 附件：统一挂在“第一条”记录（优先礼金；否则第一条礼品）
    if (attachmentsExplicit) {
      const targetId = cashRowId || ensuredItemIds[0] || null;
      if (!targetId) {
        return NextResponse.json({ error: "更新失败：缺少可挂附件的记录行" }, { status: 400 });
      }

      await sql`
        UPDATE gift_records
        SET attachment_key = NULL, attachment_name = NULL, attachment_type = NULL
        WHERE user_id = ${session.userId} AND group_id = ${groupId}
      `;

      const k = attachmentKey === undefined ? null : attachmentKey;
      const n = attachmentName === undefined ? null : attachmentName;
      const t = attachmentType === undefined ? null : attachmentType;

      if (k || n || t) {
        await sql`
          UPDATE gift_records
          SET
            attachment_key = ${k},
            attachment_name = ${n},
            attachment_type = ${t}
          WHERE id = ${targetId} AND user_id = ${session.userId}
        `;
      }
    }

    const rows = await loadGroupRows(session.userId, groupId);
    return NextResponse.json({ message: "礼簿记录更新成功", data: buildGroup(rows) });
  } catch (e) {
    console.error("更新礼簿记录组错误:", e);
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}

/**
 * DELETE /api/gift-record-groups/[id]
 * 删除一组礼簿记录
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

    await ensureGiftBooksSchema();
    const { id } = await context.params;

    const existing = (await sql`
      SELECT id FROM gift_records
      WHERE user_id = ${session.userId}
        AND direction = 'received'
        AND (group_id = ${id} OR id = ${id})
      LIMIT 1
    `) as Array<{ id: string }>;

    if (existing.length === 0) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

    await sql`
      DELETE FROM gift_records
      WHERE user_id = ${session.userId}
        AND direction = 'received'
        AND group_id = ${id}
    `;

    return NextResponse.json({ message: "删除成功" });
  } catch (e) {
    console.error("删除礼簿记录组错误:", e);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}


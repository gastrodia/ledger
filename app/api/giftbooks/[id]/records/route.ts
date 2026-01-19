import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";
import { ensureGiftBooksSchema } from "@/lib/giftbooks-schema";

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

type GiftRecordGroupListItem = {
  id: string; // group_id
  counterparty_name: string;
  gift_date: string;
  notes: string | null;
  cash_amount: number | null;
  currency: string | null;
  items_count: number;
  items_estimated_total: number;
  attachment_key: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
};

/**
 * GET /api/giftbooks/[id]/records
 * 获取礼簿下记录列表
 * 查询参数：
 * - q: 按对方姓名/备注模糊搜索（可选）
 * - hasCash: true|false（可选）
 * - hasItems: true|false（可选）
 * - giftType: cash|item（兼容旧版，可选）
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
    const giftType = searchParams.get("giftType"); // legacy
    const hasCash = searchParams.get("hasCash") === "true";
    const hasItems = searchParams.get("hasItems") === "true";

    // 动态查询（对齐 transactions 的写法）
    // 注意：giftType 不能直接用 SQL 过滤 gift_type，否则会丢失同一组里的另一种类型（现金+礼品组合）。
    let query = `
      SELECT *
      FROM gift_records
      WHERE user_id = $1 AND giftbook_id = $2 AND direction = 'received'
    `;
    const params: unknown[] = [session.userId, giftbookId];
    let paramIndex = 3;

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

    const byGroup = new Map<string, GiftRecordRow[]>();
    for (const r of formatted) {
      const gid = r.group_id || r.id;
      const list = byGroup.get(gid);
      if (list) list.push(r);
      else byGroup.set(gid, [r]);
    }

    const groups: Array<{
      sortGiftDate: number;
      sortCreatedAt: number;
      item: GiftRecordGroupListItem;
    }> = [];

    for (const [gid, list] of byGroup.entries()) {
      const cashRows = list.filter((x) => x.gift_type === "cash");
      const itemRows = list.filter((x) => x.gift_type === "item");

      const cash_amount = cashRows.reduce((acc, x) => acc + (toNumberOrNull(x.amount) || 0), 0) || null;
      const currency = cashRows.find((x) => x.currency)?.currency || null;

      const items_count = itemRows.length;
      const items_estimated_total = itemRows.reduce(
        (acc, x) => acc + (toNumberOrNull(x.estimated_value) || 0),
        0
      );

      const attachmentRow = list.find((x) => !!x.attachment_key) || null;
      const notesVal = list.find((x) => x.notes && String(x.notes).trim().length > 0)?.notes || null;

      const giftDate = list
        .map((x) => new Date(x.gift_date).getTime())
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => b - a)[0] ?? 0;
      const createdAt = list
        .map((x) => new Date(x.created_at).getTime())
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => b - a)[0] ?? 0;

      const item: GiftRecordGroupListItem = {
        id: gid,
        counterparty_name: list[0]?.counterparty_name || "",
        gift_date: list[0]?.gift_date || "",
        notes: notesVal,
        cash_amount,
        currency,
        items_count,
        items_estimated_total,
        attachment_key: attachmentRow?.attachment_key || null,
        attachment_name: attachmentRow?.attachment_name || null,
        attachment_type: attachmentRow?.attachment_type || null,
      };

      // 过滤（组级别）
      // 1) 新版：hasCash/hasItems（可同时选中）
      if (hasCash && !cash_amount) continue;
      if (hasItems && items_count === 0) continue;
      // 2) 旧版：giftType（单选语义）
      if (!hasCash && !hasItems) {
        if (giftType === "cash" && !cash_amount) continue;
        if (giftType === "item" && items_count === 0) continue;
      }

      groups.push({ sortGiftDate: giftDate, sortCreatedAt: createdAt, item });
    }

    groups.sort((a, b) => b.sortGiftDate - a.sortGiftDate || b.sortCreatedAt - a.sortCreatedAt);

    return NextResponse.json({
      data: groups.map((g) => g.item),
    });
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
    // 兼容两种创建方式：
    // 1) 旧版：gift_type=cash|item（单条记录）
    // 2) 新版：一次提交可同时包含礼金+多行礼品（生成多条 gift_records）

    const gift_type = body?.gift_type as unknown;
    const counterparty_name = body?.counterparty_name as unknown;
    const gift_date = body?.gift_date as unknown;
    const notes = body?.notes as unknown;
    const attachment_key = body?.attachment_key as unknown;
    const attachment_name = body?.attachment_name as unknown;
    const attachment_type = body?.attachment_type as unknown;

    if (typeof counterparty_name !== "string" || counterparty_name.trim().length === 0) {
      return NextResponse.json({ error: "对方姓名为必填项" }, { status: 400 });
    }
    if (counterparty_name.length > 128) {
      return NextResponse.json({ error: "对方姓名长度必须在1-128个字符之间" }, { status: 400 });
    }
    if (!gift_date) {
      return NextResponse.json({ error: "日期为必填项" }, { status: 400 });
    }

    // =========================
    // 旧版：单条记录
    // =========================
    if (gift_type === "cash" || gift_type === "item") {
      const amount = body?.amount as unknown;
      const currency = body?.currency as unknown;
      const item_name = body?.item_name as unknown;
      const quantity = body?.quantity as unknown;
      const unit = body?.unit as unknown;
      const estimated_value = body?.estimated_value as unknown;

      // 礼金 vs 礼品的字段校验
      let amountNum: number | null = null;
      let qtyNum: number | null = null;
      let estimatedNum: number | null = null;
      const currencyVal = typeof currency === "string" && currency.trim() ? currency.trim() : "CNY";

      if (gift_type === "cash") {
        const parsed = parseFloat(String(amount));
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return NextResponse.json({ error: "礼金金额必须大于0" }, { status: 400 });
        }
        amountNum = parsed;
      } else {
        if (typeof item_name !== "string" || item_name.trim().length === 0) {
          return NextResponse.json({ error: "礼品名称为必填项" }, { status: 400 });
        }
        if (quantity !== undefined && quantity !== null && String(quantity) !== "") {
          const parsedQty = parseFloat(String(quantity));
          if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
            return NextResponse.json({ error: "数量必须大于0" }, { status: 400 });
          }
          qtyNum = parsedQty;
        }
        if (estimated_value !== undefined && estimated_value !== null && String(estimated_value) !== "") {
          const parsedEstimated = parseFloat(String(estimated_value));
          if (!Number.isFinite(parsedEstimated) || parsedEstimated < 0) {
            return NextResponse.json({ error: "估值必须大于等于0" }, { status: 400 });
          }
          estimatedNum = parsedEstimated;
        }
      }

      const id = uuidv4();
      const groupId = id;
      const result = await sql`
        INSERT INTO gift_records (
          id, user_id, giftbook_id,
          group_id,
          direction, gift_type, counterparty_name,
          amount, currency, attachment_key, attachment_name, attachment_type,
          item_name, quantity, unit, estimated_value,
          gift_date, notes, created_at, updated_at
        )
        VALUES (
          ${id},
          ${session.userId},
          ${giftbookId},
          ${groupId},
          'received',
          ${gift_type},
          ${counterparty_name.trim()},
          ${amountNum},
          ${gift_type === "cash" ? currencyVal : null},
          ${typeof attachment_key === "string" && attachment_key ? attachment_key : null},
          ${typeof attachment_name === "string" && attachment_name ? attachment_name : null},
          ${typeof attachment_type === "string" && attachment_type ? attachment_type : null},
          ${gift_type === "item" ? String(item_name).trim() : null},
          ${qtyNum},
          ${gift_type === "item" ? (typeof unit === "string" && unit.trim() ? unit.trim() : "件") : null},
          ${estimatedNum},
          ${String(gift_date)},
          ${typeof notes === "string" && notes ? notes : null},
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
    }

    // =========================
    // 新版：组合创建（礼金 + 多行礼品）
    // =========================
    const hasCash = !!body?.hasCash;
    const hasItems = !!body?.hasItems;
    const amount = body?.amount as unknown;
    const currency = body?.currency as unknown;
    const items = body?.items as unknown;

    const itemsArr = Array.isArray(items) ? items : [];
    const normalizedHasItems = hasItems || itemsArr.length > 0;
    const normalizedHasCash = hasCash || (amount !== undefined && amount !== null && String(amount) !== "");

    if (!normalizedHasCash && !normalizedHasItems) {
      return NextResponse.json({ error: "至少选择礼金或礼品之一" }, { status: 400 });
    }

    let cashAmountNum: number | null = null;
    const currencyVal = typeof currency === "string" && currency.trim() ? currency.trim() : "CNY";
    if (normalizedHasCash) {
      const parsed = parseFloat(String(amount));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return NextResponse.json({ error: "礼金金额必须大于0" }, { status: 400 });
      }
      cashAmountNum = parsed;
    }

    const normalizedItems: Array<{
      item_name: string;
      quantity: number;
      unit: string;
      estimated_value: number;
    }> = [];

    if (normalizedHasItems) {
      if (!Array.isArray(itemsArr) || itemsArr.length === 0) {
        return NextResponse.json({ error: "请至少添加一行礼品" }, { status: 400 });
      }

      for (const raw of itemsArr) {
        const itemName =
          typeof raw?.item_name === "string" ? raw.item_name.trim() : "";
        if (!itemName) {
          return NextResponse.json({ error: "礼品名称为必填项" }, { status: 400 });
        }
        const q = parseFloat(String(raw?.quantity));
        if (!Number.isFinite(q) || q <= 0) {
          return NextResponse.json({ error: "礼品数量必须大于0" }, { status: 400 });
        }
        const unitVal =
          typeof raw?.unit === "string" && raw.unit.trim() ? raw.unit.trim() : "件";
        const ev = parseFloat(String(raw?.estimated_value ?? 0));
        if (!Number.isFinite(ev) || ev < 0) {
          return NextResponse.json({ error: "礼品估值必须大于等于0" }, { status: 400 });
        }
        normalizedItems.push({
          item_name: itemName,
          quantity: q,
          unit: unitVal,
          estimated_value: ev,
        });
      }
    }

    const created: GiftRecordRow[] = [];
    const groupId = uuidv4();
    const attachKey = typeof attachment_key === "string" && attachment_key ? attachment_key : null;
    const attachName = typeof attachment_name === "string" && attachment_name ? attachment_name : null;
    const attachType = typeof attachment_type === "string" && attachment_type ? attachment_type : null;
    const notesVal = typeof notes === "string" && notes ? notes : null;

    // 附件只挂在“第一条”记录上：优先礼金；否则第一行礼品
    let attachmentPlaced = false;
    const placeAttachment = () => {
      if (attachmentPlaced) return { k: null, n: null, t: null };
      attachmentPlaced = true;
      return { k: attachKey, n: attachName, t: attachType };
    };

    if (normalizedHasCash) {
      const id = uuidv4();
      const att = placeAttachment();
      const rows = await sql`
        INSERT INTO gift_records (
          id, user_id, giftbook_id,
          group_id,
          direction, gift_type, counterparty_name,
          amount, currency, attachment_key, attachment_name, attachment_type,
          item_name, quantity, unit, estimated_value,
          gift_date, notes, created_at, updated_at
        )
        VALUES (
          ${id},
          ${session.userId},
          ${giftbookId},
          ${groupId},
          'received',
          'cash',
          ${counterparty_name.trim()},
          ${cashAmountNum},
          ${currencyVal},
          ${att.k},
          ${att.n},
          ${att.t},
          NULL,
          NULL,
          NULL,
          NULL,
          ${String(gift_date)},
          ${notesVal},
          NOW(),
          NOW()
        )
        RETURNING *
      `;
      created.push(rows[0] as GiftRecordRow);
    }

    if (normalizedItems.length > 0) {
      for (let i = 0; i < normalizedItems.length; i++) {
        const it = normalizedItems[i];
        const id = uuidv4();
        const att = placeAttachment();
        const rows = await sql`
          INSERT INTO gift_records (
            id, user_id, giftbook_id,
            group_id,
            direction, gift_type, counterparty_name,
            amount, currency, attachment_key, attachment_name, attachment_type,
            item_name, quantity, unit, estimated_value,
            gift_date, notes, created_at, updated_at
          )
          VALUES (
            ${id},
            ${session.userId},
            ${giftbookId},
            ${groupId},
            'received',
            'item',
            ${counterparty_name.trim()},
            NULL,
            NULL,
            ${att.k},
            ${att.n},
            ${att.t},
            ${it.item_name},
            ${it.quantity},
            ${it.unit},
            ${it.estimated_value},
            ${String(gift_date)},
            ${notesVal},
            NOW(),
            NOW()
          )
          RETURNING *
        `;
        created.push(rows[0] as GiftRecordRow);
      }
    }

    return NextResponse.json(
      {
        message: "礼簿记录创建成功",
        data: created.map((row) => ({
          ...row,
          amount: toNumberOrNull(row.amount),
          quantity: toNumberOrNull(row.quantity),
          estimated_value: toNumberOrNull(row.estimated_value),
        })),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("创建礼簿记录错误:", error);
    return NextResponse.json({ error: "创建礼簿记录失败" }, { status: 500 });
  }
}


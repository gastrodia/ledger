import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";
import { ensureLoansSchema } from "@/lib/loans-schema";

type LoanDirection = "owed" | "lent";
type LoanSubjectType = "money" | "item";
type LoanStatus = "unpaid" | "partial" | "settled";

function computeLoanFields(row: Record<string, unknown>) {
  const subjectType = row.subject_type as LoanSubjectType;
  const dueMoney = row.amount == null ? null : parseFloat(String(row.amount));
  const dueQty = row.item_quantity == null ? null : parseFloat(String(row.item_quantity));

  const repaidMoney = parseFloat(String(row.repaid_amount_total ?? 0));
  const repaidQty = parseFloat(String(row.repaid_quantity_total ?? 0));

  let remainingMoney: number | null = null;
  let remainingQty: number | null = null;
  let status: LoanStatus = "unpaid";

  if (subjectType === "money") {
    const due = dueMoney ?? 0;
    remainingMoney = Math.max(due - repaidMoney, 0);
    status = repaidMoney <= 0 ? "unpaid" : repaidMoney < due ? "partial" : "settled";
  } else {
    const due = dueQty ?? 0;
    remainingQty = Math.max(due - repaidQty, 0);
    status = repaidQty <= 0 ? "unpaid" : repaidQty < due ? "partial" : "settled";
  }

  return {
    repaid_amount_total: repaidMoney,
    repaid_quantity_total: repaidQty,
    remaining_amount: remainingMoney,
    remaining_quantity: remainingQty,
    status,
    repayment_count: Number(row.repayment_count ?? 0),
  };
}

/**
 * GET /api/loans
 * 获取欠款/借款列表（含已还/未还/状态计算）
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

    await ensureLoansSchema();

    const rows = await sql`
      SELECT
        l.id,
        l.user_id,
        l.direction,
        l.subject_type,
        l.counterparty_name,
        l.amount,
        l.item_name,
        l.item_quantity,
        l.item_unit,
        l.occurred_at,
        l.notes,
        l.attachment_key,
        l.attachment_name,
        l.attachment_type,
        l.created_at,
        l.updated_at,
        COALESCE(SUM(r.repaid_amount), 0) AS repaid_amount_total,
        COALESCE(SUM(r.repaid_quantity), 0) AS repaid_quantity_total,
        COUNT(r.id) AS repayment_count
      FROM loans l
      LEFT JOIN loan_repayments r ON r.loan_id = l.id
      WHERE l.user_id = ${session.userId}
      GROUP BY l.id
      ORDER BY l.occurred_at DESC, l.created_at DESC
    `;

    const data = rows.map((r: Record<string, unknown>) => {
      const computed = computeLoanFields(r);
      return {
        id: r.id as string,
        user_id: r.user_id as string,
        direction: r.direction as LoanDirection,
        subject_type: r.subject_type as LoanSubjectType,
        counterparty_name: r.counterparty_name as string,
        amount: r.amount == null ? null : parseFloat(String(r.amount)),
        item_name: (r.item_name as string | null) ?? null,
        item_quantity: r.item_quantity == null ? null : parseFloat(String(r.item_quantity)),
        item_unit: (r.item_unit as string | null) ?? null,
        occurred_at: r.occurred_at as string,
        notes: (r.notes as string | null) ?? null,
        attachment_key: (r.attachment_key as string | null) ?? null,
        attachment_name: (r.attachment_name as string | null) ?? null,
        attachment_type: (r.attachment_type as string | null) ?? null,
        created_at: r.created_at as string,
        updated_at: r.updated_at as string,
        ...computed,
      };
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error("获取欠款/借款错误:", error);
    return NextResponse.json({ error: "获取欠款/借款失败" }, { status: 500 });
  }
}

/**
 * POST /api/loans
 * 创建借还单（欠款/借款）
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

    await ensureLoansSchema();

    const body = await request.json();
    const {
      direction,
      subject_type,
      counterparty_name,
      amount,
      item_name,
      item_quantity,
      item_unit,
      occurred_at,
      notes,
      attachment_key,
      attachment_name,
      attachment_type,
    } = body;

    if (!direction || !subject_type || !counterparty_name || !occurred_at) {
      return NextResponse.json({ error: "请填写必填字段" }, { status: 400 });
    }

    if (direction !== "owed" && direction !== "lent") {
      return NextResponse.json({ error: "direction 必须是 owed 或 lent" }, { status: 400 });
    }
    if (subject_type !== "money" && subject_type !== "item") {
      return NextResponse.json({ error: "subject_type 必须是 money 或 item" }, { status: 400 });
    }

    let amountNum: number | null = null;
    let qtyNum: number | null = null;

    if (subject_type === "money") {
      const n = parseFloat(amount);
      if (isNaN(n) || n <= 0) {
        return NextResponse.json({ error: "金额必须大于0" }, { status: 400 });
      }
      amountNum = n;
    } else {
      if (!item_name || !item_unit || item_quantity === undefined) {
        return NextResponse.json({ error: "请填写物品名称/数量/单位" }, { status: 400 });
      }
      const q = parseFloat(item_quantity);
      if (isNaN(q) || q <= 0) {
        return NextResponse.json({ error: "物品数量必须大于0" }, { status: 400 });
      }
      qtyNum = q;
    }

    const id = uuidv4();

    const result = await sql`
      INSERT INTO loans (
        id, user_id, direction, subject_type, counterparty_name,
        amount, item_name, item_quantity, item_unit,
        occurred_at, notes,
        attachment_key, attachment_name, attachment_type,
        created_at, updated_at
      )
      VALUES (
        ${id},
        ${session.userId},
        ${direction},
        ${subject_type},
        ${counterparty_name},
        ${amountNum},
        ${subject_type === "item" ? item_name : null},
        ${qtyNum},
        ${subject_type === "item" ? item_unit : null},
        ${occurred_at},
        ${notes || null},
        ${attachment_key || null},
        ${attachment_name || null},
        ${attachment_type || null},
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    const row = result[0] as Record<string, unknown>;
    const computed = computeLoanFields({
      ...row,
      repaid_amount_total: 0,
      repaid_quantity_total: 0,
      repayment_count: 0,
    });

    return NextResponse.json(
      {
        message: "创建成功",
        data: {
          id: row.id as string,
          user_id: row.user_id as string,
          direction: row.direction as LoanDirection,
          subject_type: row.subject_type as LoanSubjectType,
          counterparty_name: row.counterparty_name as string,
          amount: row.amount == null ? null : parseFloat(String(row.amount)),
          item_name: (row.item_name as string | null) ?? null,
          item_quantity: row.item_quantity == null ? null : parseFloat(String(row.item_quantity)),
          item_unit: (row.item_unit as string | null) ?? null,
          occurred_at: row.occurred_at as string,
          notes: (row.notes as string | null) ?? null,
          attachment_key: (row.attachment_key as string | null) ?? null,
          attachment_name: (row.attachment_name as string | null) ?? null,
          attachment_type: (row.attachment_type as string | null) ?? null,
          created_at: row.created_at as string,
          updated_at: row.updated_at as string,
          ...computed,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("创建借还单错误:", error);
    return NextResponse.json({ error: "创建失败" }, { status: 500 });
  }
}


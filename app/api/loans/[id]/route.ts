import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { del } from "@vercel/blob";
import { ensureLoansSchema } from "@/lib/loans-schema";

type LoanDirection = "owed" | "lent";
type LoanSubjectType = "money" | "item";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

    await ensureLoansSchema();

    const { id } = await context.params;
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

    const existing = await sql`
      SELECT * FROM loans
      WHERE id = ${id} AND user_id = ${session.userId}
    `;
    if (existing.length === 0) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }

    const loan = existing[0] as Record<string, unknown>;
    const oldAttachmentKey = (loan.attachment_key as string | null | undefined) ?? null;

    // 如果存在归还记录，则不允许修改标的类型（会导致金额/物品归还字段失配）
    const repaymentCountResult = await sql`
      SELECT COUNT(*)::int as cnt
      FROM loan_repayments
      WHERE loan_id = ${id} AND user_id = ${session.userId}
    `;
    const repaymentCount = Number((repaymentCountResult[0] as Record<string, unknown>)?.cnt ?? 0);

    const nextSubjectType = (subject_type ?? loan.subject_type) as LoanSubjectType;
    if (repaymentCount > 0 && subject_type && subject_type !== loan.subject_type) {
      return NextResponse.json(
        { error: "已有归还记录，不能修改标的类型" },
        { status: 400 }
      );
    }

    if (direction && direction !== "owed" && direction !== "lent") {
      return NextResponse.json({ error: "direction 必须是 owed 或 lent" }, { status: 400 });
    }
    if (subject_type && subject_type !== "money" && subject_type !== "item") {
      return NextResponse.json({ error: "subject_type 必须是 money 或 item" }, { status: 400 });
    }

    // 校验更新后的应还值
    let nextAmount: number | null =
      loan.amount == null ? null : parseFloat(String(loan.amount));
    let nextItemName: string | null = (loan.item_name as string | null) ?? null;
    let nextItemQty: number | null =
      loan.item_quantity == null ? null : parseFloat(String(loan.item_quantity));
    let nextItemUnit: string | null = (loan.item_unit as string | null) ?? null;

    if (nextSubjectType === "money") {
      if (amount !== undefined) {
        const n = parseFloat(amount);
        if (isNaN(n) || n <= 0) {
          return NextResponse.json({ error: "金额必须大于0" }, { status: 400 });
        }
        nextAmount = n;
      }
      // money：清空物品字段
      nextItemName = null;
      nextItemQty = null;
      nextItemUnit = null;
    } else {
      // item：要求三要素都完整
      if (item_name !== undefined) nextItemName = item_name || null;
      if (item_unit !== undefined) nextItemUnit = item_unit || null;
      if (item_quantity !== undefined) {
        const q = parseFloat(item_quantity);
        if (isNaN(q) || q <= 0) {
          return NextResponse.json({ error: "物品数量必须大于0" }, { status: 400 });
        }
        nextItemQty = q;
      }

      if (!nextItemName || !nextItemUnit || !nextItemQty) {
        return NextResponse.json({ error: "请填写物品名称/数量/单位" }, { status: 400 });
      }

      // item：清空金额字段
      nextAmount = null;
    }

    const result = await sql`
      UPDATE loans
      SET
        direction = ${direction !== undefined ? (direction as LoanDirection) : (loan.direction as LoanDirection)},
        subject_type = ${subject_type !== undefined ? (subject_type as LoanSubjectType) : (loan.subject_type as LoanSubjectType)},
        counterparty_name = ${counterparty_name !== undefined ? counterparty_name : (loan.counterparty_name as string)},
        amount = ${nextAmount},
        item_name = ${nextItemName},
        item_quantity = ${nextItemQty},
        item_unit = ${nextItemUnit},
        occurred_at = ${occurred_at !== undefined ? occurred_at : (loan.occurred_at as string)},
        notes = ${notes !== undefined ? notes || null : (loan.notes as string | null)},
        attachment_key = ${attachment_key !== undefined ? attachment_key : (loan.attachment_key as string | null)},
        attachment_name = ${attachment_name !== undefined ? attachment_name : (loan.attachment_name as string | null)},
        attachment_type = ${attachment_type !== undefined ? attachment_type : (loan.attachment_type as string | null)},
        updated_at = NOW()
      WHERE id = ${id} AND user_id = ${session.userId}
      RETURNING *
    `;

    if (
      attachment_key !== undefined &&
      oldAttachmentKey &&
      attachment_key !== oldAttachmentKey
    ) {
      try {
        await del(oldAttachmentKey);
      } catch (error) {
        console.error("更新借还单时删除旧附件失败:", error);
      }
    }

    const row = result[0] as Record<string, unknown>;
    return NextResponse.json({
      message: "更新成功",
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
      },
    });
  } catch (error) {
    console.error("更新借还单错误:", error);
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

    await ensureLoansSchema();

    const { id } = await context.params;

    const existing = await sql`
      SELECT id, attachment_key
      FROM loans
      WHERE id = ${id} AND user_id = ${session.userId}
    `;
    if (existing.length === 0) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }

    const loanAttachmentKey =
      (existing[0] as Record<string, unknown>)?.attachment_key as string | null | undefined;
    const repaymentAttachmentRows = await sql`
      SELECT attachment_key
      FROM loan_repayments
      WHERE loan_id = ${id} AND user_id = ${session.userId} AND attachment_key IS NOT NULL
    `;
    const repaymentKeys = repaymentAttachmentRows
      .map((r: Record<string, unknown>) => r.attachment_key as string | null | undefined)
      .filter(Boolean) as string[];

    const keysToDelete = [
      ...(loanAttachmentKey ? [loanAttachmentKey] : []),
      ...repaymentKeys,
    ];

    for (const key of keysToDelete) {
      try {
        await del(key);
      } catch (error) {
        console.error("删除借还单附件失败:", error);
        return NextResponse.json({ error: "删除附件失败，请稍后重试" }, { status: 500 });
      }
    }

    await sql`
      DELETE FROM loans
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    return NextResponse.json({ message: "删除成功" });
  } catch (error) {
    console.error("删除借还单错误:", error);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}


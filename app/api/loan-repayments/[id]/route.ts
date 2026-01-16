import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { del } from "@vercel/blob";
import { ensureLoansSchema } from "@/lib/loans-schema";

type LoanSubjectType = "money" | "item";

/**
 * PATCH /api/loan-repayments/[id]
 * 更新归还记录
 */
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
      repaid_at,
      repaid_amount,
      repaid_quantity,
      notes,
      attachment_key,
      attachment_name,
      attachment_type,
    } = body;

    const existingRows = await sql`
      SELECT
        r.*,
        l.subject_type as loan_subject_type
      FROM loan_repayments r
      JOIN loans l ON l.id = r.loan_id
      WHERE r.id = ${id} AND r.user_id = ${session.userId} AND l.user_id = ${session.userId}
    `;
    if (existingRows.length === 0) {
      return NextResponse.json({ error: "归还记录不存在" }, { status: 404 });
    }

    const existing = existingRows[0] as Record<string, unknown>;
    const subjectType = existing.loan_subject_type as LoanSubjectType;
    const oldAttachmentKey = (existing.attachment_key as string | null | undefined) ?? null;

    let nextRepaidAmount: number | null =
      existing.repaid_amount == null ? null : parseFloat(String(existing.repaid_amount));
    let nextRepaidQty: number | null =
      existing.repaid_quantity == null ? null : parseFloat(String(existing.repaid_quantity));

    if (subjectType === "money") {
      if (repaid_amount !== undefined) {
        const n = parseFloat(repaid_amount);
        if (isNaN(n) || n <= 0) {
          return NextResponse.json({ error: "归还金额必须大于0" }, { status: 400 });
        }
        nextRepaidAmount = n;
      }
      nextRepaidQty = null;
    } else {
      if (repaid_quantity !== undefined) {
        const q = parseFloat(repaid_quantity);
        if (isNaN(q) || q <= 0) {
          return NextResponse.json({ error: "归还数量必须大于0" }, { status: 400 });
        }
        nextRepaidQty = q;
      }
      nextRepaidAmount = null;
    }

    const result = await sql`
      UPDATE loan_repayments
      SET
        repaid_at = ${repaid_at !== undefined ? repaid_at : (existing.repaid_at as string)},
        repaid_amount = ${nextRepaidAmount},
        repaid_quantity = ${nextRepaidQty},
        notes = ${notes !== undefined ? notes || null : (existing.notes as string | null)},
        attachment_key = ${attachment_key !== undefined ? attachment_key : (existing.attachment_key as string | null)},
        attachment_name = ${attachment_name !== undefined ? attachment_name : (existing.attachment_name as string | null)},
        attachment_type = ${attachment_type !== undefined ? attachment_type : (existing.attachment_type as string | null)},
        updated_at = NOW()
      WHERE id = ${id} AND user_id = ${session.userId}
      RETURNING *
    `;

    if (attachment_key !== undefined && oldAttachmentKey && attachment_key !== oldAttachmentKey) {
      try {
        await del(oldAttachmentKey);
      } catch (error) {
        console.error("更新归还记录时删除旧附件失败:", error);
      }
    }

    const row = result[0] as Record<string, unknown>;
    return NextResponse.json({
      message: "更新成功",
      data: {
        id: row.id as string,
        user_id: row.user_id as string,
        loan_id: row.loan_id as string,
        repaid_amount: row.repaid_amount == null ? null : parseFloat(String(row.repaid_amount)),
        repaid_quantity: row.repaid_quantity == null ? null : parseFloat(String(row.repaid_quantity)),
        repaid_at: row.repaid_at as string,
        notes: (row.notes as string | null) ?? null,
        attachment_key: (row.attachment_key as string | null) ?? null,
        attachment_name: (row.attachment_name as string | null) ?? null,
        attachment_type: (row.attachment_type as string | null) ?? null,
        created_at: row.created_at as string,
        updated_at: row.updated_at as string,
      },
    });
  } catch (error) {
    console.error("更新归还记录失败:", error);
    return NextResponse.json({ error: "更新归还记录失败" }, { status: 500 });
  }
}

/**
 * DELETE /api/loan-repayments/[id]
 * 删除归还记录
 */
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
      FROM loan_repayments
      WHERE id = ${id} AND user_id = ${session.userId}
    `;
    if (existing.length === 0) {
      return NextResponse.json({ error: "归还记录不存在" }, { status: 404 });
    }

    const attachmentKey =
      (existing[0] as Record<string, unknown>)?.attachment_key as string | null | undefined;
    if (attachmentKey) {
      try {
        await del(attachmentKey);
      } catch (error) {
        console.error("删除归还附件失败:", error);
        return NextResponse.json({ error: "删除附件失败，请稍后重试" }, { status: 500 });
      }
    }

    await sql`
      DELETE FROM loan_repayments
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    return NextResponse.json({ message: "删除成功" });
  } catch (error) {
    console.error("删除归还记录失败:", error);
    return NextResponse.json({ error: "删除归还记录失败" }, { status: 500 });
  }
}


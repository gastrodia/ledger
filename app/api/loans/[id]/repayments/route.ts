import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";
import { ensureLoansSchema } from "@/lib/loans-schema";

type LoanSubjectType = "money" | "item";

/**
 * GET /api/loans/[id]/repayments
 * 获取某条借还单的归还记录列表
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

    await ensureLoansSchema();

    const { id: loanId } = await context.params;

    const loanRows = await sql`
      SELECT id FROM loans
      WHERE id = ${loanId} AND user_id = ${session.userId}
    `;
    if (loanRows.length === 0) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }

    const rows = await sql`
      SELECT
        id,
        user_id,
        loan_id,
        repaid_amount,
        repaid_quantity,
        repaid_at,
        notes,
        attachment_key,
        attachment_name,
        attachment_type,
        created_at,
        updated_at
      FROM loan_repayments
      WHERE loan_id = ${loanId} AND user_id = ${session.userId}
      ORDER BY repaid_at DESC, created_at DESC
    `;

    const data = rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      user_id: r.user_id as string,
      loan_id: r.loan_id as string,
      repaid_amount: r.repaid_amount == null ? null : parseFloat(String(r.repaid_amount)),
      repaid_quantity: r.repaid_quantity == null ? null : parseFloat(String(r.repaid_quantity)),
      repaid_at: r.repaid_at as string,
      notes: (r.notes as string | null) ?? null,
      attachment_key: (r.attachment_key as string | null) ?? null,
      attachment_name: (r.attachment_name as string | null) ?? null,
      attachment_type: (r.attachment_type as string | null) ?? null,
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
    }));

    return NextResponse.json({ data });
  } catch (error) {
    console.error("获取归还记录失败:", error);
    return NextResponse.json({ error: "获取归还记录失败" }, { status: 500 });
  }
}

/**
 * POST /api/loans/[id]/repayments
 * 新增归还记录（支持部分归还）
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

    await ensureLoansSchema();

    const { id: loanId } = await context.params;

    const loanRows = await sql`
      SELECT id, subject_type
      FROM loans
      WHERE id = ${loanId} AND user_id = ${session.userId}
    `;
    if (loanRows.length === 0) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }
    const subjectType = (loanRows[0] as Record<string, unknown>).subject_type as LoanSubjectType;

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

    if (!repaid_at) {
      return NextResponse.json({ error: "请填写归还日期" }, { status: 400 });
    }

    let amountNum: number | null = null;
    let qtyNum: number | null = null;

    if (subjectType === "money") {
      const n = parseFloat(repaid_amount);
      if (isNaN(n) || n <= 0) {
        return NextResponse.json({ error: "归还金额必须大于0" }, { status: 400 });
      }
      amountNum = n;
    } else {
      const q = parseFloat(repaid_quantity);
      if (isNaN(q) || q <= 0) {
        return NextResponse.json({ error: "归还数量必须大于0" }, { status: 400 });
      }
      qtyNum = q;
    }

    const id = uuidv4();

    const result = await sql`
      INSERT INTO loan_repayments (
        id, user_id, loan_id,
        repaid_amount, repaid_quantity,
        repaid_at, notes,
        attachment_key, attachment_name, attachment_type,
        created_at, updated_at
      )
      VALUES (
        ${id},
        ${session.userId},
        ${loanId},
        ${amountNum},
        ${qtyNum},
        ${repaid_at},
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
    return NextResponse.json(
      {
        message: "归还已记录",
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
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("新增归还记录失败:", error);
    return NextResponse.json({ error: "新增归还记录失败" }, { status: 500 });
  }
}


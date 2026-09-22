import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { ensureCategoriesSchema } from "@/lib/categories-schema";

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const body = await request.json();
    const { type, ids } = body ?? {};
    if (
      (type !== "income" && type !== "expense") ||
      !Array.isArray(ids) || ids.length === 0 ||
      ids.some((id: unknown) => typeof id !== "string" || !id.trim() || id.length > 36) ||
      new Set(ids).size !== ids.length
    ) {
      return NextResponse.json({ error: "分类排序参数无效" }, { status: 400 });
    }

    await ensureCategoriesSchema();
    // Validate the complete, owned group and update it in one statement. A stale
    // list, foreign ID or mixed type must never leave a partially saved order.
    const updated = await sql`
      WITH requested AS (
        SELECT id, (position - 1)::integer AS sort_order
        FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)
          WITH ORDINALITY AS items(id, position)
      ), owned AS MATERIALIZED (
        SELECT id FROM categories
        WHERE user_id = ${session.userId} AND type = ${type}
        ORDER BY id FOR UPDATE
      ), valid AS (
        SELECT 1
        WHERE (SELECT COUNT(*) FROM owned) = ${ids.length}
          AND (SELECT COUNT(*) FROM owned JOIN requested USING (id)) = ${ids.length}
      )
      UPDATE categories AS category
      SET sort_order = requested.sort_order
      FROM requested, valid
      WHERE category.id = requested.id
        AND category.user_id = ${session.userId} AND category.type = ${type}
      RETURNING category.id
    `;
    if (updated.length !== ids.length) {
      return NextResponse.json(
        { error: "分类列表已变化，请刷新后重新排序" }, { status: 409 },
      );
    }
    return NextResponse.json({ message: "分类顺序已保存" });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "分类排序参数无效" }, { status: 400 });
    }
    console.error("保存分类排序失败:", error);
    return NextResponse.json({ error: "保存分类排序失败，请重试" }, { status: 500 });
  }
}

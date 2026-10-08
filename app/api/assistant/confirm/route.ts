import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { confirmationRows, UUID_PATTERN } from "@/lib/assistant";
import { ensureAssistantSchema } from "@/lib/assistant-schema";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const body = await request.json();
    if (!body || typeof body.batch_id !== "string" || !UUID_PATTERN.test(body.batch_id)) return NextResponse.json({ error: "确认批次无效。" }, { status: 400 });
    let rows;
    try { rows = confirmationRows(body.drafts); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "账单格式无效。" }, { status: 400 }); }
    const hash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    const input = JSON.stringify(rows.map(row => ({ ...row, id: randomUUID() })));
    await ensureAssistantSchema();
    // All validation and all inserts share a transaction. Locks prevent concurrent
    // category/member edits from changing ownership between validation and insert.
    const [, , result] = await sql.transaction([
      sql`SELECT id FROM categories WHERE user_id=${session.userId} AND id IN
        (SELECT value->>'category_id' FROM jsonb_array_elements(${input}::jsonb)) FOR SHARE`,
      sql`SELECT id FROM members WHERE user_id=${session.userId} AND id IN
        (SELECT value->>'member_id' FROM jsonb_array_elements(${input}::jsonb)) FOR SHARE`,
      sql`WITH input AS (
        SELECT * FROM jsonb_to_recordset(${input}::jsonb) AS r(id TEXT,type TEXT,amount_cents BIGINT,
          category_id TEXT,member_id TEXT,transaction_date DATE,description TEXT)
      ), valid AS (
        SELECT i.* FROM input i JOIN categories c ON c.id=i.category_id AND c.user_id=${session.userId} AND c.type=i.type
          JOIN members m ON m.id=i.member_id AND m.user_id=${session.userId}
      ), claimed AS (
        INSERT INTO assistant_batches (user_id,id,payload_hash,transaction_ids)
        SELECT ${session.userId},${body.batch_id},${hash},(SELECT jsonb_agg(id) FROM input)
        WHERE (SELECT count(*) FROM valid)=(SELECT count(*) FROM input)
        ON CONFLICT (user_id,id) DO NOTHING RETURNING payload_hash,transaction_ids
      ), inserted AS (
        INSERT INTO transactions (id,user_id,type,amount,category_id,member_id,transaction_date,description,created_at,updated_at)
        SELECT i.id,${session.userId},i.type,i.amount_cents::numeric/100,i.category_id,i.member_id,i.transaction_date,i.description,NOW(),NOW()
        FROM input i CROSS JOIN claimed RETURNING id
      )
      SELECT payload_hash,transaction_ids,true AS created,(SELECT count(*) FROM inserted) AS inserted_count FROM claimed
      UNION ALL
      SELECT payload_hash,transaction_ids,false AS created,0 AS inserted_count FROM assistant_batches
      WHERE user_id=${session.userId} AND id=${body.batch_id}`,
    ], { isolationLevel: "Serializable" });
    const saved = result[0];
    if (!saved) return NextResponse.json({ error: "分类或成员已变更，请刷新后核对；本批次未保存。", notSaved: true }, { status: 409 });
    if (saved.payload_hash !== hash) return NextResponse.json({ error: "该批次已确认过不同内容，请先核对交易记录。", batchConflict: true }, { status: 409 });
    return NextResponse.json({ ids: saved.transaction_ids, count: (saved.transaction_ids as string[]).length, replayed: !saved.created }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
    const code = (error as { code?: string })?.code;
    if (["40001", "23503", "23505"].includes(code || "")) return NextResponse.json({ error: "数据正在变更，请用原批次重试确认。" }, { status: 409 });
    return NextResponse.json({ error: "确认结果暂未获取，请重试原批次以核对是否已保存。" }, { status: 500 });
  }
}

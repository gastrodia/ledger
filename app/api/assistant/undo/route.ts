import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { AssistantDraft, confirmationRows, UUID_PATTERN } from "@/lib/assistant";
import { ensureAssistantSchema } from "@/lib/assistant-schema";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const body = await request.json();
    if (!body || typeof body.batch_id !== "string" || !UUID_PATTERN.test(body.batch_id) || typeof body.undo_id !== "string" || !UUID_PATTERN.test(body.undo_id)) return NextResponse.json({ error: "撤销批次无效。", notUndone: true }, { status: 400 });
    let rows;
    try { rows = confirmationRows(body.drafts); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "账单格式无效。", notUndone: true }, { status: 400 }); }
    const drafts = body.drafts as AssistantDraft[];
    const draftIds = drafts.map(draft => draft.id);
    if (draftIds.some(id => typeof id !== "string" || !UUID_PATTERN.test(id)) || new Set(draftIds).size !== draftIds.length || !Array.isArray(body.draft_ids) || body.draft_ids.length < 1 || body.draft_ids.length > drafts.length || body.draft_ids.some((id: unknown) => typeof id !== "string" || !draftIds.includes(id)) || new Set(body.draft_ids).size !== body.draft_ids.length) return NextResponse.json({ error: "请选择该批次中要撤销的账目。", notUndone: true }, { status: 400 });
    const selectedIds = body.draft_ids as string[];
    const originalHash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    const requestHash = createHash("sha256").update(JSON.stringify({ batch_id: body.batch_id, original_hash: originalHash, draft_ids: [...selectedIds].sort() })).digest("hex");
    const input = JSON.stringify(drafts.map((draft, index) => ({
      draft_id: draft.id, position: index, row: rows[index],
      restored_id: randomUUID(), draft: {
        id: draft.id, type: rows[index].type, amount_cents: rows[index].amount_cents,
        category_id: rows[index].category_id, member_id: rows[index].member_id,
        transaction_date: rows[index].transaction_date, description: draft.description.trim(),
        payment_method: draft.payment_method,
        note: typeof draft.note === "string" ? draft.note.slice(0, 4000) : "",
      },
    })));
    const selected = JSON.stringify(selectedIds);
    const restoredBatchId = randomUUID();
    await ensureAssistantSchema();
    // The locks, exact snapshot checks, deletion, tombstone and undo receipt share
    // one serializable transaction. A failed check never deletes even one row.
    const [result] = await sql.transaction([
      sql`WITH previous AS MATERIALIZED (
        SELECT * FROM assistant_undos WHERE user_id=${session.userId} AND id=${body.undo_id}
      ), batch AS MATERIALIZED (
        SELECT * FROM assistant_batches WHERE user_id=${session.userId} AND id=${body.batch_id} FOR UPDATE
      ), input AS (
        SELECT * FROM jsonb_to_recordset(${input}::jsonb)
          AS r(draft_id TEXT,position INTEGER,row JSONB,restored_id TEXT,draft JSONB)
      ), selected AS (
        SELECT value #>> '{}' AS draft_id FROM jsonb_array_elements(${selected}::jsonb)
      ), targets AS (
        SELECT m.value->>'transaction_id' AS transaction_id,m.value->>'draft_id' AS draft_id,m.value->'row' AS expected_row
        FROM batch b CROSS JOIN LATERAL jsonb_array_elements(b.draft_transactions) m(value)
          JOIN selected s ON s.draft_id=m.value->>'draft_id'
        UNION ALL
        SELECT value #>> '{}' AS transaction_id,NULL AS draft_id,NULL AS expected_row
        FROM batch b CROSS JOIN LATERAL jsonb_array_elements(b.transaction_ids)
        WHERE b.draft_transactions IS NULL
      ), locked AS MATERIALIZED (
        SELECT t.id,t.attachment_key,t.attachment_name,t.attachment_type,
          (t.updated_at IS DISTINCT FROM t.created_at OR t.transaction_date IS DISTINCT FROM t.transaction_date::date::timestamp) AS edited,
          jsonb_build_object('type',t.type,'amount_cents',(t.amount*100)::bigint,
            'category_id',t.category_id,'member_id',t.member_id,
            'transaction_date',to_char(t.transaction_date,'YYYY-MM-DD'),'description',COALESCE(t.description,'')) AS row
        FROM transactions t JOIN targets target ON target.transaction_id=t.id
        WHERE t.user_id=${session.userId} FOR UPDATE OF t
      ), checked AS (
        SELECT b.*,CASE
          WHEN b.payload_hash<>${originalHash} THEN 'snapshot'
          WHEN b.draft_transactions IS NULL AND (SELECT count(*) FROM selected)<>(SELECT count(*) FROM input) THEN 'legacy_partial'
          WHEN b.draft_transactions IS NOT NULL AND (
            (SELECT count(*) FROM targets)<>(SELECT count(*) FROM selected)
            OR EXISTS (SELECT 1 FROM selected s WHERE b.undone_draft_ids ? s.draft_id)
          ) THEN 'target'
          WHEN (SELECT count(*) FROM locked)<>(SELECT count(*) FROM targets)
            OR EXISTS (SELECT 1 FROM locked WHERE edited OR attachment_key IS NOT NULL OR attachment_name IS NOT NULL OR attachment_type IS NOT NULL)
            OR (b.draft_transactions IS NOT NULL AND EXISTS (
              SELECT 1 FROM targets t JOIN locked l ON l.id=t.transaction_id WHERE l.row<>t.expected_row
            ))
            OR (b.draft_transactions IS NULL AND (
              EXISTS (SELECT row,count(*) FROM input GROUP BY row EXCEPT SELECT row,count(*) FROM locked GROUP BY row)
              OR EXISTS (SELECT row,count(*) FROM locked GROUP BY row EXCEPT SELECT row,count(*) FROM input GROUP BY row)
            )) THEN 'changed'
          ELSE NULL END AS reason
        FROM batch b
      ), eligible AS (
        SELECT * FROM checked WHERE reason IS NULL AND NOT EXISTS (SELECT 1 FROM previous)
      ), restored AS (
        SELECT jsonb_agg(COALESCE(snapshot.value,i.draft) || jsonb_build_object('id',i.restored_id) ORDER BY i.position) AS drafts
        FROM input i JOIN selected s USING(draft_id) CROSS JOIN batch b
          LEFT JOIN LATERAL (
            SELECT value FROM jsonb_array_elements(b.draft_snapshot) WHERE value->>'id'=i.draft_id
          ) snapshot ON true
      ), deleted AS (
        DELETE FROM transactions t USING targets target,eligible e
        WHERE t.id=target.transaction_id AND t.user_id=${session.userId} RETURNING t.id
      ), marked AS (
        UPDATE assistant_batches b SET revoked_at=COALESCE(b.revoked_at,NOW()),
          undone_draft_ids=b.undone_draft_ids || ${selected}::jsonb
        FROM eligible e WHERE b.user_id=e.user_id AND b.id=e.id
          AND (SELECT count(*) FROM deleted)=(SELECT count(*) FROM targets) RETURNING b.id
      ), receipt AS (
        INSERT INTO assistant_undos(user_id,id,batch_id,payload_hash,restored_batch_id,drafts,undone_draft_ids)
        SELECT ${session.userId},${body.undo_id},${body.batch_id},${requestHash},${restoredBatchId},restored.drafts,${selected}::jsonb
        FROM marked CROSS JOIN restored
        RETURNING payload_hash,restored_batch_id,drafts,undone_draft_ids
      )
      SELECT payload_hash,restored_batch_id,drafts,undone_draft_ids,false AS replayed,NULL::text AS reason FROM receipt
      UNION ALL
      SELECT payload_hash,restored_batch_id,drafts,undone_draft_ids,true AS replayed,NULL::text AS reason FROM previous
      UNION ALL
      SELECT NULL,NULL,NULL,NULL,false,COALESCE((SELECT reason FROM checked),'missing')
      WHERE NOT EXISTS (SELECT 1 FROM receipt) AND NOT EXISTS (SELECT 1 FROM previous)`,
    ], { isolationLevel: "Serializable" });
    const undone = result[0];
    if (!undone) return NextResponse.json({ error: "撤销结果暂未获取，请重试原请求。" }, { status: 500 });
    if (undone.reason) {
      const reason = undone.reason as string;
      const error = reason === "missing" ? "该确认批次不存在或不属于当前账号。"
        : reason === "legacy_partial" ? "旧版账目只支持撤销整组，请选择本组全部账目。"
        : reason === "changed" ? "账目已在交易记录中修改、删除或添加附件，未执行撤销，请先核对记录。"
        : reason === "target" ? "选中的账目已撤销或不属于该批次，请刷新后核对。"
        : "草稿与原确认内容不一致，未执行撤销，请先核对记录。";
      return NextResponse.json({ error, notUndone: true }, { status: reason === "missing" ? 404 : 409 });
    }
    if (undone.payload_hash !== requestHash) return NextResponse.json({ error: "该撤销请求已用于不同账目，请先核对记录。", notUndone: true, undoConflict: true }, { status: 409 });
    return NextResponse.json({ batch_id: undone.restored_batch_id, drafts: undone.drafts, undone_draft_ids: undone.undone_draft_ids, replayed: undone.replayed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求格式无效。", notUndone: true }, { status: 400 });
    const code = (error as { code?: string })?.code;
    if (["40001", "23503", "23505"].includes(code || "")) return NextResponse.json({ error: "数据正在变更，请重试原撤销请求以核对结果。" }, { status: 409 });
    return NextResponse.json({ error: "撤销结果暂未获取，请重试原请求以核对是否已撤销。" }, { status: 500 });
  }
}

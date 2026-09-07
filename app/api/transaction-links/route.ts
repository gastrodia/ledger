import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { ensureTransactionLinksSchema } from '@/lib/transaction-links-schema';
import { formatLinkedTransaction, isTransactionLinkId, isTransactionLinkSourceType, sourceRelation } from '@/lib/transaction-links';

function failure(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === '23505') {
    return NextResponse.json({ error: '这笔收支已关联其他记录，请先解除原关联', code: 'TRANSACTION_ALREADY_LINKED' }, { status: 409 });
  }
  if (code === '40001' || code === '40P01' || code === '23503') {
    return NextResponse.json({ error: '记录或关联已变更，请刷新后重试', code: 'LINK_CONFLICT' }, { status: 409 });
  }
  if (code === '42501' || code === '42P01') {
    return NextResponse.json({ error: '关联功能尚未完成数据库配置，请联系管理员', code: 'LINK_SCHEMA_UNAVAILABLE' }, { status: 503 });
  }
  console.error('收支关联操作失败:', error);
  return NextResponse.json({ error: '关联操作失败，请重试' }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 });
    const params = request.nextUrl.searchParams;
    const type = params.get('sourceType');
    const id = params.get('sourceId');
    const batch = params.get('sourceIds');
    if (!isTransactionLinkSourceType(type) || (id !== null && batch !== null)) {
      return NextResponse.json({ error: '关联来源参数无效' }, { status: 400 });
    }
    const ids = batch !== null ? [...new Set(batch.split(','))] : [id];
    if (!ids.length || ids.length > 100 || !ids.every(isTransactionLinkId)) {
      return NextResponse.json({ error: '请提供 1 至 100 个有效来源 ID' }, { status: 400 });
    }
    await ensureTransactionLinksSchema();
    const source = sourceRelation(type);
    if (batch === null) {
      const owned = await sql.query(`SELECT s.id FROM ${source.table} s WHERE s.user_id = $1 AND ${source.id} = $2 ${source.extra} LIMIT 1`, [session.userId, id]);
      if (!owned.length) return NextResponse.json({ error: '来源记录不存在' }, { status: 404 });
    }
    const rows = await sql.query(`
      SELECT l.source_id, t.id, t.type, t.amount, t.description, t.transaction_date
      FROM transaction_links l
      JOIN transactions t ON t.id = l.transaction_id AND t.user_id = l.user_id
      WHERE l.user_id = $1 AND l.source_type = $2 AND l.source_id = ANY($3::varchar[])
        AND EXISTS (SELECT 1 FROM ${source.table} s
          WHERE s.user_id = l.user_id AND ${source.id} = l.source_id ${source.extra})
    `, [session.userId, type, ids]);
    return NextResponse.json({ data: batch === null
      ? (rows[0] ? formatLinkedTransaction(rows[0]) : null)
      : rows.map(row => ({ sourceId: row.source_id, transaction: formatLinkedTransaction(row) })) });
  } catch (error) { return failure(error); }
}

async function mutate(request: NextRequest, unlink: boolean) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 });
    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: '请求内容无效' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '请求内容无效' }, { status: 400 });
    }
    const { sourceType: type, sourceId: id, transactionId } = body as Record<string, unknown>;
    if (!isTransactionLinkSourceType(type) || !isTransactionLinkId(id) || (!unlink && !isTransactionLinkId(transactionId))) {
      return NextResponse.json({ error: '关联来源或收支 ID 无效' }, { status: 400 });
    }
    await ensureTransactionLinksSchema();
    const source = sourceRelation(type);
    const sourceExists = `EXISTS (SELECT 1 FROM ${source.table} s WHERE s.user_id = $1 AND ${source.id} = $2 ${source.extra})`;
    const lockSource = sql.query(`SELECT s.id FROM ${source.table} s WHERE s.user_id = $1 AND ${source.id} = $2 ${source.extra} FOR SHARE`, [session.userId, id]);
    if (unlink) {
      const [owned] = await sql.transaction([
        lockSource,
        sql.query(`DELETE FROM transaction_links WHERE user_id = $1 AND source_id = $2 AND source_type = $3 AND ${sourceExists}`, [session.userId, id, type]),
      ], { isolationLevel: 'Serializable' });
      if (!owned.length) return NextResponse.json({ error: '来源记录不存在' }, { status: 404 });
      return NextResponse.json({ message: '已解除关联，原收支记录保留', data: null });
    }
    const [owned, transactions, , linked] = await sql.transaction([
      lockSource,
      sql.query('SELECT id, type, amount, description, transaction_date FROM transactions WHERE user_id = $1 AND id = $2 FOR SHARE', [session.userId, transactionId]),
      // Defensive cleanup for old installations or an interrupted manual schema rollout.
      sql`DELETE FROM transaction_links l WHERE l.user_id = ${session.userId} AND l.source_type = 'gift_group'
        AND NOT EXISTS (SELECT 1 FROM gift_records s WHERE s.user_id = l.user_id
          AND s.direction = 'received' AND COALESCE(s.group_id, s.id) = l.source_id)`,
      sql.query(`
        INSERT INTO transaction_links (user_id, source_id, source_type, transaction_id, given_gift_id, loan_id, repayment_id)
        SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar,
          CASE WHEN $3 = 'given_gift' THEN $2 END,
          CASE WHEN $3 = 'loan' THEN $2 END,
          CASE WHEN $3 = 'repayment' THEN $2 END
        WHERE ${sourceExists}
          AND EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = $1 AND t.id = $4)
        ON CONFLICT (user_id, source_type, source_id) DO UPDATE
          SET transaction_id = EXCLUDED.transaction_id, updated_at = NOW()
        RETURNING transaction_id
      `, [session.userId, id, type, transactionId]),
    ], { isolationLevel: 'Serializable' });
    if (!owned.length) return NextResponse.json({ error: '来源记录不存在' }, { status: 404 });
    if (!transactions.length) return NextResponse.json({ error: '收支记录不存在' }, { status: 404 });
    if (!linked.length) return NextResponse.json({ error: '记录已变更，请刷新后重试' }, { status: 409 });
    return NextResponse.json({ message: '关联已保存，各台账金额保持不变', data: formatLinkedTransaction(transactions[0]) });
  } catch (error) { return failure(error); }
}

export async function PUT(request: NextRequest) { return mutate(request, false); }
export async function DELETE(request: NextRequest) { return mutate(request, true); }

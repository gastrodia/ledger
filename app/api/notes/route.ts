import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const q = (searchParams.get('q') || '').trim();
    const archived = searchParams.get('archived'); // 'true' | 'false' | null

    const params: unknown[] = [session.userId];
    let idx = 2;

    let query = `
      SELECT id, user_id, title, content, pinned_at, archived_at, created_at, updated_at
      FROM notes
      WHERE user_id = $1
    `;

    if (archived === 'true') {
      query += ` AND archived_at IS NOT NULL`;
    } else if (archived === 'false') {
      query += ` AND archived_at IS NULL`;
    }

    if (q) {
      query += ` AND (COALESCE(title, '') ILIKE $${idx} OR content ILIKE $${idx})`;
      params.push(`%${q}%`);
      idx++;
    }

    query += `
      ORDER BY
        CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END,
        pinned_at DESC NULLS LAST,
        updated_at DESC
    `;

    const rows = await sql.query(query, params);

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('获取留言列表错误:', error);
    const message = error instanceof Error ? error.message : '未知错误';
    // 常见问题：数据库未创建 notes 表
    if (message.includes('relation') && message.includes('notes') && message.includes('does not exist')) {
      return NextResponse.json(
        {
          error: '获取留言列表失败',
          details: '数据库缺少 notes 表。请先执行 scripts/init-db.sql（或跑一次迁移）创建表。',
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: '获取留言列表失败', details: message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const title = (body?.title ?? null) as string | null;
    const content = (body?.content ?? '') as string;

    if (!content || !content.trim()) {
      return NextResponse.json({ error: '内容不能为空' }, { status: 400 });
    }

    const id = uuidv4();

    const result = await sql`
      INSERT INTO notes (
        id, user_id, title, content, pinned_at, archived_at, created_at, updated_at
      )
      VALUES (
        ${id},
        ${session.userId},
        ${title && title.trim() ? title.trim() : null},
        ${content},
        NULL,
        NULL,
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    return NextResponse.json(
      { message: '留言创建成功', data: result[0] },
      { status: 201 }
    );
  } catch (error) {
    console.error('创建留言错误:', error);
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: '创建留言失败', details: message }, { status: 500 });
  }
}


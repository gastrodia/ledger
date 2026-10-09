import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import { ensureNotesSchema } from '@/lib/notes-schema';
import { validateNoteInput } from '@/lib/notes';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    await ensureNotesSchema();
    const searchParams = request.nextUrl.searchParams;
    const q = (searchParams.get('q') || '').trim();
    const archived = searchParams.get('archived'); // 'true' | 'false' | null

    const params: unknown[] = [session.userId];
    let idx = 2;

    let query = `
      SELECT id, user_id, title, content, color, pinned_at, archived_at, created_at, updated_at
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
    if (error instanceof SyntaxError) return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
    console.error('获取便利贴列表错误:', error);
    const message = error instanceof Error ? error.message : '未知错误';
    // 常见问题：数据库未创建 notes 表
    if (message.includes('relation') && message.includes('notes') && message.includes('does not exist')) {
      return NextResponse.json(
        {
          error: '获取便利贴列表失败',
          details: '数据库缺少 notes 表。请先执行 scripts/init-db.sql（或跑一次迁移）创建表。',
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: '获取便利贴列表失败', details: message },
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
    const inputError = validateNoteInput(body, true);
    if (inputError) return NextResponse.json({ error: inputError }, { status: 400 });
    await ensureNotesSchema();
    const color = body.color ?? 'yellow';
    const title = (body?.title ?? null) as string | null;
    const content = (body?.content ?? '') as string;

    if (!content || !content.trim()) {
      return NextResponse.json({ error: '内容不能为空' }, { status: 400 });
    }

    const id = uuidv4();

    const result = await sql`
      INSERT INTO notes (
        id, user_id, title, content, color, pinned_at, archived_at, created_at, updated_at
      )
      VALUES (
        ${id},
        ${session.userId},
        ${title && title.trim() ? title.trim() : null},
        ${content},
        ${color},
        ${body.pinned ? new Date().toISOString() : null},
        ${body.archived ? new Date().toISOString() : null},
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    return NextResponse.json(
      { message: '便利贴创建成功', data: result[0] },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
    console.error('创建便利贴错误:', error);
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: '创建便利贴失败', details: message }, { status: 500 });
  }
}


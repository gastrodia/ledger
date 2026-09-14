import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ensureNotesSchema } from '@/lib/notes-schema';
import { validateNoteInput } from '@/lib/notes';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { id } = await context.params;
    await ensureNotesSchema();
    const rows = await sql`
      SELECT id, user_id, title, content, color, pinned_at, archived_at, created_at, updated_at
      FROM notes
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: '便利贴不存在' }, { status: 404 });
    }

    return NextResponse.json({ data: rows[0] });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
    console.error('获取便利贴错误:', error);
    return NextResponse.json({ error: '获取便利贴失败' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { id } = await context.params;
    await ensureNotesSchema();

    const body = await request.json();
    const inputError = validateNoteInput(body);
    if (inputError) return NextResponse.json({ error: inputError }, { status: 400 });
    const { title, content, color, pinned, archived } = body;

    const result = await sql`
      UPDATE notes
      SET
        title = CASE WHEN ${title !== undefined} THEN ${typeof title === 'string' ? title.trim() || null : null} ELSE title END,
        content = CASE WHEN ${content !== undefined} THEN ${content ?? null} ELSE content END,
        color = CASE WHEN ${color !== undefined} THEN ${color ?? null} ELSE color END,
        pinned_at = CASE WHEN ${pinned !== undefined} THEN CASE WHEN ${pinned === true} THEN NOW() ELSE NULL END ELSE pinned_at END,
        archived_at = CASE WHEN ${archived !== undefined} THEN CASE WHEN ${archived === true} THEN NOW() ELSE NULL END ELSE archived_at END,
        updated_at = NOW()
      WHERE id = ${id} AND user_id = ${session.userId}
      RETURNING *
    `;

    if (result.length === 0) return NextResponse.json({ error: '便利贴不存在' }, { status: 404 });
    return NextResponse.json({ message: '便利贴更新成功', data: result[0] });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
    console.error('更新便利贴错误:', error);
    return NextResponse.json({ error: '更新便利贴失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { id } = await context.params;

    const existing = await sql`
      SELECT id FROM notes
      WHERE id = ${id} AND user_id = ${session.userId}
    `;
    if (existing.length === 0) {
      return NextResponse.json({ error: '便利贴不存在' }, { status: 404 });
    }

    await sql`
      DELETE FROM notes
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    return NextResponse.json({ message: '便利贴删除成功' });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
    console.error('删除便利贴错误:', error);
    return NextResponse.json({ error: '删除便利贴失败' }, { status: 500 });
  }
}


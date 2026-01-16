import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';

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
    const rows = await sql`
      SELECT id, user_id, title, content, pinned_at, archived_at, created_at, updated_at
      FROM notes
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: '留言不存在' }, { status: 404 });
    }

    return NextResponse.json({ data: rows[0] });
  } catch (error) {
    console.error('获取留言错误:', error);
    return NextResponse.json({ error: '获取留言失败' }, { status: 500 });
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

    const existing = await sql`
      SELECT * FROM notes
      WHERE id = ${id} AND user_id = ${session.userId}
    `;
    if (existing.length === 0) {
      return NextResponse.json({ error: '留言不存在' }, { status: 404 });
    }

    const body = await request.json();
    const title = body?.title as string | null | undefined;
    const content = body?.content as string | undefined;
    const pinned = body?.pinned as boolean | undefined;
    const archived = body?.archived as boolean | undefined;

    if (content !== undefined && !content.trim()) {
      return NextResponse.json({ error: '内容不能为空' }, { status: 400 });
    }

    const result = await sql`
      UPDATE notes
      SET
        title = ${title !== undefined ? (title && title.trim() ? title.trim() : null) : existing[0].title},
        content = ${content !== undefined ? content : existing[0].content},
        pinned_at = ${
          pinned === undefined
            ? existing[0].pinned_at
            : pinned
              ? sql`NOW()`
              : null
        },
        archived_at = ${
          archived === undefined
            ? existing[0].archived_at
            : archived
              ? sql`NOW()`
              : null
        },
        updated_at = NOW()
      WHERE id = ${id} AND user_id = ${session.userId}
      RETURNING *
    `;

    return NextResponse.json({ message: '留言更新成功', data: result[0] });
  } catch (error) {
    console.error('更新留言错误:', error);
    return NextResponse.json({ error: '更新留言失败' }, { status: 500 });
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
      return NextResponse.json({ error: '留言不存在' }, { status: 404 });
    }

    await sql`
      DELETE FROM notes
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    return NextResponse.json({ message: '留言删除成功' });
  } catch (error) {
    console.error('删除留言错误:', error);
    return NextResponse.json({ error: '删除留言失败' }, { status: 500 });
  }
}


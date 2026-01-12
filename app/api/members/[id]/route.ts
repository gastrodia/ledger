import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';

/**
 * PATCH /api/members/[id]
 * 更新家庭成员
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // 验证用户登录
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    const body = await request.json();
    const { name, avatar } = body;

    // 检查成员是否存在且属于当前用户
    const existingMembers = await sql`
      SELECT * FROM members 
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    if (existingMembers.length === 0) {
      return NextResponse.json(
        { error: '家庭成员不存在' },
        { status: 404 }
      );
    }

    const existingMember = existingMembers[0];

    // 如果更新了名称，验证名称
    const newName = name !== undefined ? name : existingMember.name;
    if (name !== undefined && (name.trim().length === 0 || name.length > 128)) {
      return NextResponse.json(
        { error: '成员姓名长度必须在1-128个字符之间' },
        { status: 400 }
      );
    }

    // 更新成员
    const result = await sql`
      UPDATE members
      SET
        name = ${newName.trim ? newName.trim() : newName},
        avatar = ${avatar !== undefined ? avatar : existingMember.avatar}
      WHERE id = ${id} AND user_id = ${session.userId}
      RETURNING *
    `;

    return NextResponse.json({
      message: '家庭成员更新成功',
      data: result[0],
    });
  } catch (error) {
    console.error('更新家庭成员错误:', error);
    return NextResponse.json(
      { error: '更新家庭成员失败' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/members/[id]
 * 删除家庭成员
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // 验证用户登录
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    // 检查成员是否存在且属于当前用户
    const existingMembers = await sql`
      SELECT id FROM members 
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    if (existingMembers.length === 0) {
      return NextResponse.json(
        { error: '家庭成员不存在' },
        { status: 404 }
      );
    }

    // 检查是否有交易记录使用该成员
    const transactions = await sql`
      SELECT id FROM transactions 
      WHERE member_id = ${id} AND user_id = ${session.userId}
      LIMIT 1
    `;

    if (transactions.length > 0) {
      return NextResponse.json(
        { error: '该成员下还有交易记录，无法删除' },
        { status: 400 }
      );
    }

    // 删除成员
    await sql`
      DELETE FROM members 
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    return NextResponse.json({
      message: '家庭成员删除成功',
    });
  } catch (error) {
    console.error('删除家庭成员错误:', error);
    return NextResponse.json(
      { error: '删除家庭成员失败' },
      { status: 500 }
    );
  }
}

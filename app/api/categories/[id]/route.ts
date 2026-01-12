import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';

/**
 * PATCH /api/categories/[id]
 * 更新分类
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
    const { name, type, icon } = body;

    // 检查分类是否存在且属于当前用户
    const existingCategories = await sql`
      SELECT * FROM categories 
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    if (existingCategories.length === 0) {
      return NextResponse.json(
        { error: '分类不存在' },
        { status: 404 }
      );
    }

    const existingCategory = existingCategories[0];

    // 如果更新了 type，验证其值
    const newType = type !== undefined ? type : existingCategory.type;
    if (type !== undefined && type !== 'income' && type !== 'expense') {
      return NextResponse.json(
        { error: '分类类型必须是 income 或 expense' },
        { status: 400 }
      );
    }

    // 如果更新了名称，验证名称
    const newName = name !== undefined ? name : existingCategory.name;
    if (name !== undefined && (name.trim().length === 0 || name.length > 128)) {
      return NextResponse.json(
        { error: '分类名称长度必须在1-128个字符之间' },
        { status: 400 }
      );
    }

    // 更新分类
    const result = await sql`
      UPDATE categories
      SET
        name = ${newName.trim ? newName.trim() : newName},
        type = ${newType},
        icon = ${icon !== undefined ? icon : existingCategory.icon}
      WHERE id = ${id} AND user_id = ${session.userId}
      RETURNING *
    `;

    return NextResponse.json({
      message: '分类更新成功',
      data: result[0],
    });
  } catch (error) {
    console.error('更新分类错误:', error);
    return NextResponse.json(
      { error: '更新分类失败' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/categories/[id]
 * 删除分类
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

    // 检查分类是否存在且属于当前用户
    const existingCategories = await sql`
      SELECT id FROM categories 
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    if (existingCategories.length === 0) {
      return NextResponse.json(
        { error: '分类不存在' },
        { status: 404 }
      );
    }

    // 检查是否有交易记录使用该分类
    const transactions = await sql`
      SELECT id FROM transactions 
      WHERE category_id = ${id} AND user_id = ${session.userId}
      LIMIT 1
    `;

    if (transactions.length > 0) {
      return NextResponse.json(
        { error: '该分类下还有交易记录，无法删除' },
        { status: 400 }
      );
    }

    // 删除分类
    await sql`
      DELETE FROM categories 
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    return NextResponse.json({
      message: '分类删除成功',
    });
  } catch (error) {
    console.error('删除分类错误:', error);
    return NextResponse.json(
      { error: '删除分类失败' },
      { status: 500 }
    );
  }
}

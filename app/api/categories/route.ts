import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

/**
 * GET /api/categories
 * 获取分类列表
 * 查询参数：
 * - type: 分类类型 'income' 或 'expense'，默认返回全部
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户登录
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      );
    }

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type');

    let categories;
    
    if (type && (type === 'income' || type === 'expense')) {
      categories = await sql`
        SELECT id, user_id, name, type, icon, created_at
        FROM categories
        WHERE user_id = ${session.userId} AND type = ${type}
        ORDER BY created_at DESC
      `;
    } else {
      categories = await sql`
        SELECT id, user_id, name, type, icon, created_at
        FROM categories
        WHERE user_id = ${session.userId}
        ORDER BY created_at DESC
      `;
    }

    return NextResponse.json({
      data: categories,
    });
  } catch (error) {
    console.error('获取分类列表错误:', error);
    return NextResponse.json(
      { error: '获取分类列表失败' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/categories
 * 创建分类
 */
export async function POST(request: NextRequest) {
  try {
    // 验证用户登录
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, type, icon } = body;

    // 验证必填字段
    if (!name || !type) {
      return NextResponse.json(
        { error: '分类名称和类型为必填项' },
        { status: 400 }
      );
    }

    // 验证类型
    if (type !== 'income' && type !== 'expense') {
      return NextResponse.json(
        { error: '分类类型必须是 income 或 expense' },
        { status: 400 }
      );
    }

    // 验证名称长度
    if (name.trim().length === 0 || name.length > 128) {
      return NextResponse.json(
        { error: '分类名称长度必须在1-128个字符之间' },
        { status: 400 }
      );
    }

    // 创建分类
    const id = uuidv4();
    const result = await sql`
      INSERT INTO categories (id, user_id, name, type, icon)
      VALUES (${id}, ${session.userId}, ${name.trim()}, ${type}, ${icon || null})
      RETURNING *
    `;

    return NextResponse.json({
      message: '分类创建成功',
      data: result[0],
    });
  } catch (error) {
    console.error('创建分类错误:', error);
    return NextResponse.json(
      { error: '创建分类失败' },
      { status: 500 }
    );
  }
}

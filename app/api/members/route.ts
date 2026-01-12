import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

/**
 * GET /api/members
 * 获取家庭成员列表
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

    const members = await sql`
      SELECT id, user_id, name, avatar, created_at
      FROM members
      WHERE user_id = ${session.userId}
      ORDER BY created_at ASC
    `;

    return NextResponse.json({
      data: members,
    });
  } catch (error) {
    console.error('获取家庭成员列表错误:', error);
    return NextResponse.json(
      { error: '获取家庭成员列表失败' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/members
 * 创建家庭成员
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
    const { name, avatar } = body;

    // 验证必填字段
    if (!name) {
      return NextResponse.json(
        { error: '成员姓名为必填项' },
        { status: 400 }
      );
    }

    // 验证名称长度
    if (name.trim().length === 0 || name.length > 128) {
      return NextResponse.json(
        { error: '成员姓名长度必须在1-128个字符之间' },
        { status: 400 }
      );
    }

    // 创建成员
    const id = uuidv4();
    const result = await sql`
      INSERT INTO members (id, user_id, name, avatar)
      VALUES (${id}, ${session.userId}, ${name.trim()}, ${avatar || null})
      RETURNING *
    `;

    return NextResponse.json({
      message: '家庭成员创建成功',
      data: result[0],
    });
  } catch (error) {
    console.error('创建家庭成员错误:', error);
    return NextResponse.json(
      { error: '创建家庭成员失败' },
      { status: 500 }
    );
  }
}

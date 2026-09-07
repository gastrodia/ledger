import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { setSessionCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    // 验证必填字段
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return NextResponse.json(
        { error: '请填写用户名和密码' },
        { status: 400 }
      );
    }

    // 查找用户（支持邮箱或用户名登录）
    const users = await sql`
      SELECT id, email, username, password, created_at, updated_at
      FROM users
      WHERE username = ${username} OR email = ${username}
      LIMIT 2
    `;

    if (users.length === 0) {
      return NextResponse.json(
        { error: '用户名或密码错误' },
        { status: 401 }
      );
    }

    // Legacy accounts may have a username equal to another account's email.
    // Check every candidate, but never select an arbitrary account on ambiguity.
    const matches = [];
    for (const candidate of users) {
      if (await verifyPassword(password, candidate.password as string)) matches.push(candidate);
    }
    if (matches.length !== 1) {
      return NextResponse.json(
        { error: matches.length > 1 ? '登录标识有歧义，请使用另一个用户名或邮箱' : '用户名或密码错误' },
        { status: 401 }
      );
    }
    const user = matches[0];

    // 设置会话
    await setSessionCookie({
      userId: user.id as string,
      username: user.username as string,
      email: user.email as string,
    });

    // 返回用户信息（不包含密码）
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (error) {
    console.error('登录错误:', error);
    return NextResponse.json(
      { error: '登录失败，请稍后重试' },
      { status: 500 }
    );
  }
}

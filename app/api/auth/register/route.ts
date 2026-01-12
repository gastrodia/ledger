import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { setSessionCookie } from '@/lib/auth';
import { randomUUID } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, username, password } = body;

    // 验证必填字段
    if (!email || !username || !password) {
      return NextResponse.json(
        { error: '请填写所有必填字段' },
        { status: 400 }
      );
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: '邮箱格式不正确' },
        { status: 400 }
      );
    }

    // 验证用户名长度
    if (username.length < 3 || username.length > 128) {
      return NextResponse.json(
        { error: '用户名长度必须在3-128个字符之间' },
        { status: 400 }
      );
    }

    // 验证密码长度
    if (password.length < 6) {
      return NextResponse.json(
        { error: '密码至少需要6个字符' },
        { status: 400 }
      );
    }

    // 检查邮箱是否已存在
    const existingEmail = await sql`
      SELECT id FROM users WHERE email = ${email}
    `;
    if (existingEmail.length > 0) {
      return NextResponse.json(
        { error: '该邮箱已被注册' },
        { status: 400 }
      );
    }

    // 检查用户名是否已存在
    const existingUsername = await sql`
      SELECT id FROM users WHERE username = ${username}
    `;
    if (existingUsername.length > 0) {
      return NextResponse.json(
        { error: '该用户名已被使用' },
        { status: 400 }
      );
    }

    // 加密密码
    const hashedPassword = await hashPassword(password);

    // 创建用户
    const userId = randomUUID();
    const now = new Date().toISOString();

    await sql`
      INSERT INTO users (id, email, username, password, created_at, updated_at)
      VALUES (${userId}, ${email}, ${username}, ${hashedPassword}, ${now}, ${now})
    `;

    // 设置会话
    await setSessionCookie({
      userId,
      username,
      email,
    });

    // 返回用户信息（不包含密码）
    return NextResponse.json(
      {
        user: {
          id: userId,
          email,
          username,
          created_at: now,
          updated_at: now,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('注册错误:', error);
    return NextResponse.json(
      { error: '注册失败，请稍后重试' },
      { status: 500 }
    );
  }
}

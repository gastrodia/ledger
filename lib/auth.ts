import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-this-in-production'
);

const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000; // 30天

export interface SessionData {
  userId: string;
  username: string;
  email: string;
}

/**
 * 创建会话令牌
 */
export async function createSession(data: SessionData): Promise<string> {
  const token = await new SignJWT(data)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(JWT_SECRET);

  return token;
}

/**
 * 验证会话令牌
 */
export async function verifySession(token: string): Promise<SessionData | null> {
  try {
    const verified = await jwtVerify(token, JWT_SECRET);
    return verified.payload as SessionData;
  } catch (error) {
    return null;
  }
}

/**
 * 设置会话Cookie
 */
export async function setSessionCookie(data: SessionData) {
  const token = await createSession(data);
  const cookieStore = await cookies();
  
  cookieStore.set('session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION / 1000, // 秒
    path: '/',
  });
}

/**
 * 获取当前会话
 */
export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  
  if (!token) {
    return null;
  }
  
  return await verifySession(token);
}

/**
 * 清除会话Cookie
 */
export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete('session');
}

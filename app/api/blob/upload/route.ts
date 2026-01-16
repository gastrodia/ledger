import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { getSession } from '@/lib/auth';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_CONTENT_TYPES = ['image/*', 'application/pdf'];

export async function POST(request: Request) {
  // 本地/非 Vercel 环境通常需要手动配置该 token
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: 'BLOB_READ_WRITE_TOKEN 未配置' },
      { status: 500 }
    );
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: '请求体无效' }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        // 轻度约束：限定模块前缀，避免无序扩散
        const allowedPrefixes = [
          'transactions/',
          'notes/',
          'giftbooks/',
          'loans/',
          'loan-repayments/',
          'gifts-given/',
        ];
        if (!allowedPrefixes.some((p) => pathname.startsWith(p))) {
          throw new Error('不允许的上传路径');
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_ATTACHMENT_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: session.userId }),
        };
      },
      // 这一步可以做落库/审计；本需求先不需要
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error('Blob 上传处理失败:', error);
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json(
      { error: '上传初始化失败', details: message },
      { status: 500 }
    );
  }
}


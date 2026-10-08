import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createSpeechTicket, speechSocketUrl } from "@/lib/assistant-speech-ticket";

export const maxDuration = 10;

export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401, headers });
    // A custom Next server's nextUrl uses its bind hostname. The incoming Host
    // identifies the actual page origin, including a reverse proxy's public host.
    const host = request.headers.get("host");
    const pageUrl = new URL(host ? `${request.nextUrl.protocol}//${host}` : request.nextUrl.origin);
    const origin = request.headers.get("origin");
    if ((origin && origin !== pageUrl.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
      return NextResponse.json({ error: "请求来源无效。" }, { status: 403, headers });
    }
    let url: string;
    try { url = speechSocketUrl(pageUrl.origin); }
    catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "实时语音服务尚未配置。" }, { status: 503, headers });
    }
    return NextResponse.json({ url, ticket: await createSpeechTicket(session.userId) }, { headers });
  } catch {
    return NextResponse.json({ error: "语音授权暂不可用，请稍后重试。" }, { status: 503, headers });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { experimental_upgradeWebSocket } from "@vercel/functions";
import { createSpeechGatewayHandler, speechGatewayConfig } from "@/server/assistant-speech-gateway.mjs";

export const runtime = "nodejs";
export const maxDuration = 120;

// Shared within a warm instance, including its replay and concurrency limits.
// Initialization stays lazy so builds do not require provider credentials.
let gateway: ReturnType<typeof createSpeechGatewayHandler> | undefined;

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (request.nextUrl.search) return NextResponse.json({ error: "语音连接地址无效。" }, { status: 404, headers });
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return NextResponse.json({ error: "此接口需要 WebSocket 连接。" }, { status: 426, headers });
  }
  try {
    const host = request.headers.get("host");
    const pageUrl = new URL(host ? `${request.nextUrl.protocol}//${host}` : request.nextUrl.origin);
    const origin = request.headers.get("origin");
    if (!origin || origin !== pageUrl.origin) {
      return NextResponse.json({ error: "请求来源无效。" }, { status: 403, headers });
    }
    const config = speechGatewayConfig({
      ...process.env,
      SPEECH_ALLOWED_ORIGINS: process.env.SPEECH_ALLOWED_ORIGINS?.trim() || pageUrl.origin,
    });
    if (!config.allowedOrigins.includes(origin)) {
      return NextResponse.json({ error: "请求来源无效。" }, { status: 403, headers });
    }
    const handler = gateway ??= createSpeechGatewayHandler({ config });
    if (!handler.canAccept()) {
      return NextResponse.json({ error: "语音服务繁忙，请稍后重试。" }, { status: 503, headers });
    }
    // The callback must stay pending until the socket closes. The first client
    // message proves its speech ticket before any paid upstream connection.
    return await experimental_upgradeWebSocket(async socket => {
      await handler.accept(socket);
    }, { maxPayload: 16_384 });
  } catch {
    return NextResponse.json({ error: "实时语音服务暂不可用，请稍后重试。" }, { status: 503, headers });
  }
}

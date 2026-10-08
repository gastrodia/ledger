import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { bailianText, bailianFailure, BAILIAN_ASR_MODEL } from "@/lib/bailian";
import { validatePcmWav } from "@/lib/assistant-audio";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    if (!await getSession()) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const declaredSize = Number(request.headers.get("content-length"));
    if (declaredSize > 2_100_000) return NextResponse.json({ error: "录音过大，请控制在60秒以内。" }, { status: 413 });
    const form = await request.formData();
    const audio = form.get("audio");
    if (!audio || typeof audio === "string" || audio.size > 1_920_044) return NextResponse.json({ error: "请上传60秒以内的录音。" }, { status: 400 });
    const buffer = await audio.arrayBuffer();
    if (!validatePcmWav(buffer)) return NextResponse.json({ error: "录音格式无效，请重新录音。" }, { status: 400 });
    const text = await bailianText({ model: process.env.BAILIAN_ASR_MODEL?.trim() || BAILIAN_ASR_MODEL,
      messages: [{ role: "user", content: [{ type: "file", mediaType: "audio/wav", data: new Uint8Array(buffer) }] }],
      asrOptions: { language: "zh", enable_itn: true },
    }, request.signal);
    return NextResponse.json({ text: text.slice(0, 4000) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const failure = bailianFailure(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}

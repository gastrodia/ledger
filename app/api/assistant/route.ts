import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { bailianConfig, bailianFailure } from "@/lib/bailian";
import { UUID_PATTERN, type AssistantPlan } from "@/lib/assistant";
import type { AssistantStreamEvent } from "@/lib/assistant-stream";
import { assistantOptions, prepareAssistantGeneration, AssistantInputError, AssistantPlanError } from "@/lib/assistant-generation";
export { queryLedger } from "@/lib/assistant-generation";

export const maxDuration = 120;

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
    let configured = false;
    try { bailianConfig(); configured = true; } catch { /* credentials stay server-side */ }
    return NextResponse.json({ ...await assistantOptions(session.userId), configured }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "无法加载分类和成员，请重试。" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const body = await request.json();
    // A member button sends an explicit reply without asking the model to
    // recreate an existing draft. This branch never writes transactions.
    if (body?.operation === "select_member") {
      if (typeof body.member_id !== "string" || !UUID_PATTERN.test(body.member_id) || typeof body.draft_id !== "string" || !UUID_PATTERN.test(body.draft_id)) return NextResponse.json({ error: "成员选择无效，请重试。" }, { status: 400 });
      const { members } = await assistantOptions(session.userId);
      const member = members.find(m => m.id === body.member_id);
      if (!member) return NextResponse.json({ error: "成员已变更，请重新加载后选择。" }, { status: 400 });
      return NextResponse.json({ draft_id: body.draft_id, member }, { headers: { "Cache-Control": "no-store" } });
    }
    const { phase, generate } = await prepareAssistantGeneration(session.userId, body);
    if (body.stream === true) return assistantStreamResponse(request.signal, phase, generate);
    return NextResponse.json(await generate(request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (error instanceof AssistantInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof AssistantPlanError) return NextResponse.json({ error: error.message }, { status: 422 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
    const failure = bailianFailure(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}

function assistantStreamResponse(requestSignal: AbortSignal, phase: "thinking" | "images",
  generate: (signal: AbortSignal, emit: (event: AssistantStreamEvent) => void) => Promise<AssistantPlan>) {
  const upstream = new AbortController();
  const signal = AbortSignal.any([requestSignal, upstream.signal]);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AssistantStreamEvent) => {
        if (!closed && !signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      const abort = () => { upstream.abort(); if (!closed) { closed = true; controller.close(); } };
      requestSignal.addEventListener("abort", abort, { once: true });
      try {
        signal.throwIfAborted();
        emit({ type: "status", phase });
        const plan = await generate(signal, emit);
        emit({ type: "result", plan });
      } catch (error) {
        if (!signal.aborted) emit({ type: "error", message: error instanceof AssistantPlanError ? error.message : bailianFailure(error).message });
      } finally {
        requestSignal.removeEventListener("abort", abort);
        upstream.abort();
        if (!closed) { closed = true; controller.close(); }
      }
    },
    cancel() { closed = true; upstream.abort(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform",
    "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no",
  } });
}

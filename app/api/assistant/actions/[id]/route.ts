import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { UUID_PATTERN } from "@/lib/assistant";
import { decideAssistantAction, getAssistantAction } from "@/lib/assistant-command-server";
export const maxDuration = 120;
async function run(request: NextRequest, context: { params: Promise<{ id: string }> }, read: boolean) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "确认编号无效" }, { status: 400 });
  try {
    if (read) return NextResponse.json(await getAssistantAction(session.userId, id), { headers: { "Cache-Control": "no-store" } });
    const body = await request.json();
    if (!["approve", "cancel"].includes(body?.decision)) return NextResponse.json({ error: "请明确确认或取消" }, { status: 400 });
    return NextResponse.json(await decideAssistantAction(session.userId, id, body.decision));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "操作结果暂未获取，请核对原操作。" }, { status: 400 }); }
}
export function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) { return run(request, context, true); }
export function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) { return run(request, context, false); }

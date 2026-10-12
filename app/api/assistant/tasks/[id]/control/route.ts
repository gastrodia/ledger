import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { executeAssistantTaskControl } from "@/lib/assistant-control-server";
export const maxDuration = 120;
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const { id } = await context.params;
    const body = await request.json();
    return NextResponse.json(await executeAssistantTaskControl(session.userId, id, body.attempt, body.output_id));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "原对象未处理，请核对最新状态。" }, { status: 400 }); }
}

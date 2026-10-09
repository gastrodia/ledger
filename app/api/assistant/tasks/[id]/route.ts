import { after, NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runAndContinueAssistantTask } from "@/lib/assistant-task-dispatch";
import { AssistantTaskError, changeAssistantTask, getAssistantTask } from "@/lib/assistant-tasks";

export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };
type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  if (error instanceof AssistantTaskError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "请求格式无效。" }, { status: 400, headers });
  return NextResponse.json({ error: "无法读取或更新 AI 处理任务，请重试。" }, { status: 500, headers });
}
export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401, headers });
    const task = await getAssistantTask(session.userId, (await context.params).id, request.nextUrl.searchParams.get("include_input") === "1");
    if (task.status === "queued") after(() => runAndContinueAssistantTask(session.userId, task.id));
    return NextResponse.json({ task }, { headers });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401, headers });
    const body = await request.json();
    if (!body || !["cancel", "retry"].includes(body.action)) throw new AssistantTaskError(400, "任务操作无效。");
    const task = await changeAssistantTask(session.userId, (await context.params).id, body.action, body.attempt);
    if (task.status === "queued") after(() => runAndContinueAssistantTask(session.userId, task.id));
    return NextResponse.json({ task }, { headers });
  } catch (error) { return failure(error); }
}

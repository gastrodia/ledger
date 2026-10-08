import { after, NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { AssistantTaskError, cancelConversationTasks, createAssistantTask, listAssistantTasks, runAssistantTask } from "@/lib/assistant-tasks";

export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };
function failure(error: unknown) {
  if (error instanceof AssistantTaskError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "请求格式无效。" }, { status: 400, headers });
  return NextResponse.json({ error: "无法保存或读取 AI 处理任务，请重试。" }, { status: 500, headers });
}
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401, headers });
    const task = await createAssistantTask(session.userId, await request.json());
    if (task.status === "queued") after(() => runAssistantTask(session.userId, task.id));
    return NextResponse.json({ task }, { status: 202, headers });
  } catch (error) { return failure(error); }
}
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401, headers });
    const tasks = await listAssistantTasks(session.userId, request.nextUrl.searchParams.get("conversation_id") ?? "");
    for (const task of tasks) if (task.status === "queued") after(() => runAssistantTask(session.userId, task.id));
    return NextResponse.json({ tasks }, { headers });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401, headers });
    await cancelConversationTasks(session.userId, request.nextUrl.searchParams.get("conversation_id") ?? "");
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) { return failure(error); }
}

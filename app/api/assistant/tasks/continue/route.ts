import { after, NextRequest, NextResponse } from "next/server";
import { ASSISTANT_TASK_CONTINUATION_HEADER, verifyAssistantTaskContinuation } from "@/lib/assistant-task-continuation";
import { runAndContinueAssistantTask } from "@/lib/assistant-task-dispatch";

export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const continuation = verifyAssistantTaskContinuation(request.headers.get(ASSISTANT_TASK_CONTINUATION_HEADER));
  if (!continuation) return NextResponse.json({ error: "无效的任务接续凭证。" }, { status: 401, headers });
  const { userId, taskId, attempt, runToken } = continuation;
  after(() => runAndContinueAssistantTask(userId, taskId, { attempt, runToken }));
  return NextResponse.json({ ok: true }, { status: 202, headers });
}

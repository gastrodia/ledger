import { runAssistantTask } from "@/lib/assistant-tasks";
import { ASSISTANT_TASK_CONTINUATION_HEADER, assistantTaskContinuationOrigin,
  signAssistantTaskContinuation } from "@/lib/assistant-task-continuation";

/** Each callback runs one bounded wave, then asks a fresh invocation to continue. */
export async function runAndContinueAssistantTask(userId: string, taskId: string,
  expected?: { attempt: number; runToken: string }): Promise<void> {
  const next = await runAssistantTask(userId, taskId, expected);
  if (!next) return;
  const origin = assistantTaskContinuationOrigin();
  if (!origin) {
    console.warn("AI task continuation deferred", { taskId, attempt: next.attempt, reason: "origin_unavailable" });
    return;
  }
  const headers: Record<string, string> = {
    [ASSISTANT_TASK_CONTINUATION_HEADER]: signAssistantTaskContinuation({ userId, taskId, ...next }),
  };
  // The platform bypass secret is sent only to this deployment's Vercel host.
  if (origin.hostname.endsWith(".vercel.app") && origin.hostname === process.env.VERCEL_URL?.toLowerCase()
    && process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  const url = new URL("/api/assistant/tasks/continue", origin);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { method: "POST", headers, cache: "no-store",
        redirect: "error", signal: AbortSignal.timeout(8000) });
      const accepted = response.status === 202;
      await response.body?.cancel();
      if (accepted) return;
    } catch { /* A lost acknowledgment is safe: the next worker claims with the signed run fence. */ }
  }
  // Checkpoints stay queued. An authenticated GET can recover a lost handoff.
  console.warn("AI task continuation deferred", { taskId, attempt: next.attempt, reason: "dispatch_failed" });
}

import { createHash } from "node:crypto";
import { sql } from "@/lib/db";
import { assistantControlTaskStatus, assistantControlContextSchema, validateAssistantControl, type AssistantControl, type AssistantControlContext } from "@/lib/assistant-control";
import { ensureAssistantActionsSchema, getAssistantAction, decideAssistantAction } from "@/lib/assistant-command-server";
import type { AssistantPlan } from "@/lib/assistant";

function actionContext(row: Record<string, unknown>): AssistantControlContext {
  const payload = row.payload as { command?: { operation: string }; event?: { operation: string } };
  return assistantControlContextSchema.parse({ target_type: "action", target_id: row.id,
    operation: payload.command?.operation || payload.event?.operation,
    revision: createHash("sha256").update(JSON.stringify(row.payload)).digest("hex"),
    summary: String(row.summary).slice(0, 4000), status: row.status });
}
export async function loadAssistantControlContexts(userId: string, conversationId: string, currentTaskId: string): Promise<AssistantControlContext[]> {
  await ensureAssistantActionsSchema();
  const [actions, tasks] = await Promise.all([
    sql.query(`SELECT a.id,a.payload,a.summary,a.status FROM assistant_actions a
      JOIN assistant_task_conversations c ON c.user_id=a.user_id AND c.id=a.conversation_id
      WHERE a.user_id=$1 AND a.conversation_id=$2 AND c.cleared_at IS NULL
      ORDER BY a.updated_at DESC,a.id DESC LIMIT 20`, [userId, conversationId]),
    sql.query(`SELECT t.id,t.attempt,t.agent_checkpoint->>'goal' AS goal,t.status FROM assistant_tasks t
      JOIN assistant_task_conversations c ON c.user_id=t.user_id AND c.id=t.conversation_id
      WHERE t.user_id=$1 AND t.conversation_id=$2 AND t.id<>$3 AND c.cleared_at IS NULL
        AND t.agent_checkpoint->>'status' IN ('needs_input','waiting_approval','stopped','interrupted')
      ORDER BY t.created_at DESC,t.id DESC LIMIT 12`, [userId, conversationId, currentTaskId]),
  ]);
  return [...actions.map(actionContext), ...tasks.map(row => assistantControlContextSchema.parse({
    target_type: "task", target_id: row.id, operation: "task", revision: String(row.attempt),
    summary: String(row.goal).slice(0, 4000), status: row.status,
  }))];
}
/** Resolve fresh account/conversation identity before existing Ledger executors.
 * The model cannot supply a replacement payload or a new execution ID. */
export async function executeAssistantControl(userId: string, conversationId: string, currentTaskId: string, userMessage: string, control: AssistantControl): Promise<AssistantPlan> {
  const contexts = await loadAssistantControlContexts(userId, conversationId, currentTaskId);
  validateAssistantControl(control, contexts, userMessage);
  if (control.target_type === "card") throw new Error("本机卡片控制必须由页面核对原快照后处理。");
  if (control.target_type === "task") {
    const { changeAssistantTask, getAssistantTask } = await import("@/lib/assistant-tasks");
    const task = control.decision === "cancel"
      ? await changeAssistantTask(userId, control.target_id, "cancel", Number(control.revision))
      : await getAssistantTask(userId, control.target_id);
    if (control.decision === "cancel" && task.status !== "cancelled") throw new Error("指定任务已变化，本次取消未被采用，请核对最新状态。");
    const text = task.status === "cancelled" ? "已取消指定任务的未完成事项，已完成账目保留。" : `指定任务状态：${assistantControlTaskStatus(task.agent?.status || task.status, task.agent?.operations)}。`;
    return { action: "control", control, control_result: { id: task.id, status: task.status === "cancelled" ? "cancelled" : "pending", text }, reply: text, drafts: [], query: null };
  }
  const result = control.decision === "status" ? await getAssistantAction(userId, control.target_id)
    : await decideAssistantAction(userId, control.target_id, control.decision);
  return { action: "control", control, control_result: result, reply: result.text, drafts: [], query: null };
}

/** The browser dispatches only a persisted decision from this exact task turn.
 * No execution parameters or purported approval are accepted from its request. */
export async function executeAssistantTaskControl(userId: string, taskId: string, attempt: unknown, outputId: unknown) {
  const { UUID_PATTERN } = await import("@/lib/assistant");
  if (!UUID_PATTERN.test(taskId) || typeof outputId !== "string" || !UUID_PATTERN.test(outputId) || !Number.isSafeInteger(attempt)) throw new Error("控制任务编号或轮次无效。");
  const rows = await sql.query(`SELECT t.conversation_id,t.attempt,t.status,t.payload,t.agent_checkpoint FROM assistant_tasks t
    JOIN assistant_task_conversations c ON c.user_id=t.user_id AND c.id=t.conversation_id
    WHERE t.user_id=$1 AND t.id=$2 AND c.cleared_at IS NULL`, [userId, taskId]);
  const row = rows[0];
  const checkpoint = row?.agent_checkpoint as import("@/lib/assistant-agent-runtime").AssistantAgentCheckpoint | undefined;
  if (!row || row.attempt !== attempt || row.status !== "succeeded" || checkpoint?.output_id !== outputId || !checkpoint.awaiting_delivery
    || checkpoint.pending_plan?.action !== "control" || !checkpoint.pending_plan.control) throw new Error("原控制决定已处理或状态已变化，请核对最新卡片。");
  const result = await executeAssistantControl(userId, String(row.conversation_id), taskId,
    checkpoint.turn_input?.message || (row.payload as { message: string }).message, checkpoint.pending_plan.control);
  return result.control_result!;
}

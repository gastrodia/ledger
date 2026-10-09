import { restoreAssistantAgentCheckpoint, assistantAgentMetadata, assistantAgentApprovalIds, assistantAgentApprovalSettled, assistantAgentApprovalHistory } from "@/lib/assistant-agent-state";
import type { AssistantAgentCheckpoint } from "@/lib/assistant-agent-runtime";
import { createAssistantExecution, restoreAssistantExecution, assistantPlanExecutionDetails } from "@/lib/assistant-execution";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { UUID_PATTERN } from "@/lib/assistant";
import { isAssistantMessageImage, MAX_ASSISTANT_IMAGES, MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH, type AssistantImage } from "@/lib/assistant-images";
import { AssistantInputError, AssistantPlanError, assistantOptions, prepareAssistantGeneration, validateAssistantInput, type AssistantGenerationInput } from "@/lib/assistant-generation";
import { BAILIAN_ASSISTANT_MODEL, bailianConfig, bailianFailure } from "@/lib/bailian";
import { ensureAssistantTaskSchema } from "@/lib/assistant-task-schema";
import type { AssistantImageProgress, AssistantTask, AssistantTaskPhase } from "@/lib/assistant-task-types";

import { ASSISTANT_IMAGE_BATCH_VERSION, AssistantImageBatchError, generateAssistantImageBatch, finalizeAssistantImageBatches, validateAssistantImageBatchResult, type AssistantImageBatchResult } from "@/lib/assistant-image-batches";

export class AssistantTaskError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type ImageCheckpoint = { version: string; key: string; attempt: number; failures: Record<string, string>; contextInputs: Record<string, AssistantImageBatchResult["date_context"]>; results: Array<AssistantImageBatchResult | null> };

type TaskRow = Omit<AssistantTask, "input" | "text"> & {
  user_id: string; request_hash: string; payload: AssistantGenerationInput | null;
  display_input: NonNullable<AssistantTask["input"]>; partial_text: string;
  agent_checkpoint?: AssistantAgentCheckpoint | null; run_token: string | null; image_checkpoint: ImageCheckpoint | null; image_progress: AssistantImageProgress | null;
};
const TASK_TIMEOUT_MS = 240_000;
const TASK_TIMEOUT_MESSAGE = "本次处理已超时，请点击重试。";
const MAX_PARTIAL_LENGTH = 64 * 1024;
const PUBLIC_COLUMNS = "id,conversation_id,user_message_id,status,phase,partial_text,result,error,image_progress,execution_steps,agent_checkpoint,attempt,created_at,updated_at";

export function validateTaskId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new AssistantTaskError(400, "任务编号无效。");
}
function snapshot(row: TaskRow, includeInput = false): AssistantTask {
  const checkpoint = restoreAssistantAgentCheckpoint(row.agent_checkpoint);
  const storedAgent = assistantAgentMetadata(checkpoint) ?? row.result?.agent;
  const agent = storedAgent ? { ...storedAgent,
    status: row.status === "cancelled" ? "stopped" as const : row.status === "failed" ? "needs_input" as const
      : row.status === "queued" || row.status === "running" ? "running" as const
      : !checkpoint && storedAgent.status === "waiting_approval" ? "stopped" as const : storedAgent.status } : undefined;
  const result = row.result && agent ? { ...row.result, agent } : row.result;
  return { id: row.id, conversation_id: row.conversation_id, user_message_id: row.user_message_id,
    status: row.status, phase: row.phase, approval_history: assistantAgentApprovalHistory(checkpoint), agent, image_progress: row.image_progress, execution_steps: restoreAssistantExecution(row.execution_steps), text: row.partial_text, result, error: row.error,
    attempt: row.attempt, created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString(),
    ...(includeInput ? { input: row.display_input } : {}) };
}
async function readRow(userId: string, id: string) {
  const rows = await sql.query("SELECT * FROM assistant_tasks WHERE user_id=$1 AND id=$2", [userId, id]);
  if (!rows[0]) throw new AssistantTaskError(404, "这条处理任务不存在。");
  return rows[0] as TaskRow;
}
async function expireRunning(userId: string, conversationId?: string, id?: string) {
  await sql.query(`UPDATE assistant_tasks SET status='failed',error=$2,lease_until=NULL,run_token=NULL,
    image_progress=CASE WHEN image_progress IS NULL THEN NULL ELSE image_progress || jsonb_build_object('active','[]'::jsonb) END,updated_at=NOW()
    WHERE user_id=$1 AND status='running' AND lease_until <= NOW()
      AND ($3::text IS NULL OR conversation_id=$3) AND ($4::text IS NULL OR id=$4)`,
  [userId, TASK_TIMEOUT_MESSAGE, conversationId ?? null, id ?? null]);
}

export async function createAssistantTask(userId: string, raw: unknown): Promise<AssistantTask> {
  const body = raw as Record<string, unknown> | null;
  validateTaskId(body?.id); validateTaskId(body?.conversation_id); validateTaskId(body?.user_message_id);
  if (typeof body?.display_text !== "string" || body.display_text.length > 4000) throw new AssistantTaskError(400, "消息显示内容无效。");
  const images = body.display_images ?? [];
  if (!Array.isArray(images) || images.length > MAX_ASSISTANT_IMAGES || images.some(image => !isAssistantMessageImage(image))
    || images.reduce((length, image: AssistantImage) => length + image.data.length, 0) > MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH) {
    throw new AssistantTaskError(400, "截图预览格式无效或过大。");
  }
  let input: AssistantGenerationInput;
  try { input = validateAssistantInput(raw); }
  catch (error) { if (error instanceof AssistantInputError) throw new AssistantTaskError(400, error.message); throw error; }
  const displayInput = { message: input.message, display_text: body.display_text,
    display_images: images.map(({ data, name }: AssistantImage) => ({ data, name })) };
  const hash = createHash("sha256").update(JSON.stringify({ conversation_id: body.conversation_id,
    user_message_id: body.user_message_id, input, displayInput })).digest("hex");
  await ensureAssistantTaskSchema();
  // Lock the conversation in a separate statement: the following READ COMMITTED
  // snapshot sees any creation/clear that committed while the lock was awaited.
  const [conversation, rows] = await sql.transaction([
    sql.query(`INSERT INTO assistant_task_conversations (user_id,id) VALUES ($1,$2)
      ON CONFLICT (user_id,id) DO UPDATE SET id=EXCLUDED.id RETURNING cleared_at`, [userId, body.conversation_id]),
    sql.query(`INSERT INTO assistant_tasks
      (user_id,id,conversation_id,user_message_id,request_hash,payload,display_input,status,phase,image_progress)
      SELECT $1::varchar(36),$2::varchar(36),$3::varchar(36),$4::varchar(36),$5,$6::jsonb,$7::jsonb,'queued',$8,$9::jsonb FROM assistant_task_conversations
      WHERE user_id=$1 AND id=$3 AND cleared_at IS NULL
      ON CONFLICT (user_id,id) DO NOTHING RETURNING *`, [userId, body.id, body.conversation_id,
      body.user_message_id, hash, JSON.stringify(input), JSON.stringify(displayInput), input.images.length ? "images" : "thinking", input.images.length
        ? JSON.stringify({ total: input.images.length, completed: 0, failed: [], active: [], stage: "recognizing" }) : null]),
  ], { isolationLevel: "ReadCommitted" });
  if (conversation[0]?.cleared_at) throw new AssistantTaskError(409, "这个对话已清空，请在新对话中重新发送。");
  const row = rows[0] as TaskRow | undefined ?? await readRow(userId, body.id);
  if (row.request_hash !== hash) throw new AssistantTaskError(409, "这条任务已提交过其他内容，请重新发送。");
  return snapshot(row, true);
}

export async function getAssistantTask(userId: string, id: string, includeInput = false): Promise<AssistantTask> {
  validateTaskId(id); await ensureAssistantTaskSchema();
  await expireRunning(userId, undefined, id);
  const rows = await sql.query(`SELECT ${PUBLIC_COLUMNS}${includeInput ? ",display_input" : ""}
    FROM assistant_tasks WHERE user_id=$1 AND id=$2`, [userId, id]);
  if (!rows[0]) throw new AssistantTaskError(404, "这条处理任务不存在。");
  return snapshot(rows[0] as TaskRow, includeInput);
}
export async function listAssistantTasks(userId: string, conversationId: string): Promise<AssistantTask[]> {
  validateTaskId(conversationId); await ensureAssistantTaskSchema();
  await expireRunning(userId, conversationId);
  // Keep the latest bounded window, returned chronologically for reconstruction.
  const rows = await sql.query(`SELECT * FROM (SELECT ${PUBLIC_COLUMNS} FROM assistant_tasks WHERE user_id=$1 AND conversation_id=$2
    ORDER BY created_at DESC,id DESC LIMIT 120) recent ORDER BY created_at ASC,id ASC`, [userId, conversationId]);
  return (rows as TaskRow[]).map(row => snapshot(row));
}
export async function changeAssistantTask(userId: string, id: string, action: "cancel" | "retry" | "resume", attempt?: number): Promise<AssistantTask> {
  validateTaskId(id);
  if (action === "retry" || action === "resume" || (action === "cancel" && attempt !== undefined)) {
    if (!Number.isSafeInteger(attempt) || (attempt as number) < 1 || (attempt as number) > 2_147_483_647) {
      throw new AssistantTaskError(400, "任务版本无效，请刷新后重试。");
    }
  }
  await ensureAssistantTaskSchema();
  if (action === "resume") return resumeAssistantTask(userId, id, attempt!);
  if (action === "cancel") {
    const previous = await readRow(userId, id);
    const checkpoint = restoreAssistantAgentCheckpoint(previous.agent_checkpoint);
    const agentGoal = checkpoint?.goal_id || previous.id;
    if ((attempt === undefined || previous.attempt === attempt) && (checkpoint || previous.status === "running" || previous.status === "queued")) {
      // Stable preview IDs can survive a lost checkpoint acknowledgement. Retire any
      // orphan proposal from this task as well as the currently attached approval.
      let orphanIds: string[] = [];
      try {
        const orphans = await sql.query(`SELECT id FROM assistant_actions WHERE user_id=$1 AND conversation_id=$2
          AND status='pending' AND payload->'_agent_preview'->>'goal_id'=$3`, [userId, previous.conversation_id, agentGoal]);
        orphanIds = orphans.map(action => String(action.id));
      } catch (error) { if ((error as { code?: string }).code !== "42P01") throw error; }
      const ids = [...new Set([...orphanIds, ...(checkpoint ? assistantAgentApprovalIds(checkpoint) : [])])];
      if (ids.length) {
        const { decideAssistantAction } = await import("@/lib/assistant-command-server");
        for (const actionId of ids) {
          const outcome = await decideAssistantAction(userId, actionId, "cancel");
          if (checkpoint && outcome) checkpoint.tool_results.push({ call_id: `cancel-${actionId}`, name: "approval_result", result: outcome });
        }
      }
      if (checkpoint?.status === "waiting_approval") {
        checkpoint.status = "stopped"; checkpoint.pending_approval = null; checkpoint.pending_approvals = []; delete checkpoint.pending_batch;
        await sql.query(`UPDATE assistant_tasks SET status='cancelled',error=NULL,lease_until=NULL,run_token=NULL,agent_checkpoint=$4::jsonb,updated_at=NOW()
          WHERE user_id=$1 AND id=$2 AND attempt=$3 AND status='succeeded' AND agent_checkpoint->>'status'='waiting_approval'`,
        [userId, id, previous.attempt, JSON.stringify(checkpoint)]);
      }
    }
    // An old stop request must not cancel a newer explicit retry. Omitting the
    // attempt preserves compatibility for callers that mean the current task.
    await sql.query(`UPDATE assistant_tasks SET status='cancelled',error=NULL,lease_until=NULL,run_token=NULL,
      image_progress=CASE WHEN image_progress IS NULL THEN NULL ELSE image_progress || jsonb_build_object('active','[]'::jsonb) END,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND status IN ('queued','running') AND ($3::integer IS NULL OR attempt=$3)`, [userId, id, attempt ?? null]);
  } else if (action === "retry") {
    await expireRunning(userId, undefined, id);
    const previous = await readRow(userId, id);
    if (restoreAssistantAgentCheckpoint(previous.agent_checkpoint)?.status === "stopped") return snapshot(previous);
    if (previous.attempt === attempt && ["failed", "cancelled"].includes(previous.status)) {
      if (!previous.payload) throw new AssistantTaskError(409, "这条任务的原始内容已清理，请重新发送。");
      await sql.query(`UPDATE assistant_tasks SET status='queued',phase=CASE WHEN jsonb_array_length(payload->'images')>0 THEN 'images' ELSE 'thinking' END,
        partial_text='',result=NULL,error=NULL,lease_until=NULL,run_token=NULL,attempt=attempt+1,execution_steps='[]'::jsonb,
        image_progress=CASE WHEN image_progress IS NULL THEN NULL ELSE image_progress || jsonb_build_object('failed','[]'::jsonb,'active','[]'::jsonb,'stage','recognizing') END,updated_at=NOW()
        WHERE user_id=$1 AND id=$2 AND attempt=$3 AND status IN ('failed','cancelled') AND payload IS NOT NULL`, [userId, id, attempt]);
    }
  } else throw new AssistantTaskError(400, "任务操作无效。");
  return snapshot(await readRow(userId, id));
}
/** Resume only consumes durable decisions made by the existing approval endpoint. */
export async function resumeAssistantTask(userId: string, id: string, attempt: number): Promise<AssistantTask> {
  const previous = await readRow(userId, id);
  const conversation = await sql.query("SELECT cleared_at FROM assistant_task_conversations WHERE user_id=$1 AND id=$2", [userId, previous.conversation_id]);
  if (conversation[0]?.cleared_at) throw new AssistantTaskError(409, "这个对话已清空，请在新对话中重新发送。");
  // Lost acknowledgements and double clicks return the same current attempt.
  if (previous.attempt !== attempt || previous.status !== "succeeded") return snapshot(previous);
  const checkpoint = restoreAssistantAgentCheckpoint(previous.agent_checkpoint);
  if (!checkpoint || checkpoint.status !== "waiting_approval") return snapshot(previous);
  if (!previous.payload) throw new AssistantTaskError(409, "这条任务的原始内容已清理，请重新发送。");
  if (checkpoint.pending_batch) return resumeAssistantBatch(userId, previous, checkpoint, attempt);
  const ids = assistantAgentApprovalIds(checkpoint);
  if (!ids.length) throw new AssistantTaskError(409, "这条任务没有可接续的确认方案。");
  let actions = await sql.query(`SELECT id,status,result,conversation_id FROM assistant_actions
    WHERE user_id=$1 AND id=ANY($2::varchar[]) AND conversation_id=$3`, [userId, ids, previous.conversation_id]);
  if (actions.length !== ids.length) throw new AssistantTaskError(409, "确认方案与本次任务不匹配，请重新发送。");
  let replacementApproval: import("@/lib/assistant-commands").AssistantApproval | undefined;
  for (let hop = 0; hop < 5; hop++) {
    const original = actions.find(action => (action.result as { replacement_approval?: { id?: string } } | null)?.replacement_approval?.id);
    if (!original) break;
    const replacement = (original.result as { replacement_approval: import("@/lib/assistant-commands").AssistantApproval }).replacement_approval;
    validateTaskId(replacement.id);
    if (ids.includes(replacement.id)) throw new AssistantTaskError(409, "确认方案接续关系无效。");
    const next = await sql.query(`SELECT id,status,result,conversation_id FROM assistant_actions WHERE user_id=$1 AND id=$2 AND conversation_id=$3`,
      [userId, replacement.id, previous.conversation_id]);
    if (!next.length) throw new AssistantTaskError(409, "新的确认方案与本次任务不匹配。");
    const index = ids.indexOf(String(original.id)); ids[index] = replacement.id;
    actions = actions.filter(action => action.id !== original.id).concat(next);
    checkpoint.tool_results.push({ call_id: `receipt-${original.id}`, name: "approval_result", result: original.result });
    const fingerprint = checkpoint.pending_approval?.fingerprint ?? "replacement";
    if (checkpoint.pending_approval?.action_id === original.id) checkpoint.pending_approval = { action_id: replacement.id, fingerprint };
    checkpoint.pending_approvals = (checkpoint.pending_approvals ?? []).map(item => item.action_id === original.id ? { ...item, action_id: replacement.id } : item);
    checkpoint.tool_results.push({ call_id: `replacement-${replacement.id}`, name: "command_preview", result: { approval: replacement } });
    if (checkpoint.pending_plan) checkpoint.pending_plan = { ...checkpoint.pending_plan, approval: replacement,
      reply: replacement.summary, ...(checkpoint.pending_plan.agent ? { agent: assistantAgentMetadata(checkpoint) } : {}) };
    replacementApproval = replacement;
  }
  if (replacementApproval) {
    const rebound = await sql.query(`UPDATE assistant_tasks SET agent_checkpoint=$4::jsonb,result=$5::jsonb,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND attempt=$3 AND status='succeeded' AND payload IS NOT NULL
        AND EXISTS (SELECT 1 FROM assistant_task_conversations c WHERE c.user_id=$1 AND c.id=assistant_tasks.conversation_id AND c.cleared_at IS NULL)
      RETURNING id`, [userId, id, attempt, JSON.stringify(checkpoint), JSON.stringify({ ...previous.result, approval: replacementApproval,
        agent: assistantAgentMetadata(checkpoint) })]);
    if (!rebound.length) return snapshot(await readRow(userId, id));
  }
  if (actions.some(action => !assistantAgentApprovalSettled(action as { status: import("@/lib/assistant-commands").AssistantActionResult["status"] }))) return snapshot(await readRow(userId, id));
  const outcomes = actions.map(action => ({ ...(action.result && typeof action.result === "object" ? action.result as object : {}),
    id: String(action.id), status: action.status as import("@/lib/assistant-commands").AssistantActionResult["status"],
    text: typeof (action.result as { text?: unknown } | null)?.text === "string" ? (action.result as { text: string }).text
      : action.status === "cancelled" ? "用户已取消本次操作，未执行。" : action.status === "expired" ? "确认方案已过期，未执行。" : "操作已结束，请依据服务端状态核对结果。" }));
  const failedOutcome = outcomes.find(outcome => outcome.status !== "succeeded");
  if (failedOutcome && checkpoint.pending_approval?.action_id !== failedOutcome.id) {
    const binding = checkpoint.pending_approvals?.find(item => item.action_id === failedOutcome.id);
    checkpoint.pending_approval = { action_id: failedOutcome.id, fingerprint: binding?.fingerprint ?? checkpoint.pending_approval?.fingerprint ?? "settled" };
  }
  checkpoint.approval_outcome = failedOutcome ?? outcomes.find(outcome => outcome.id === checkpoint.pending_approval?.action_id) ?? outcomes[0];
  // The optional multi-approval list is consumed only after every server action has settled.
  if (outcomes.length > 1) {
    outcomes.filter(outcome => outcome.id !== checkpoint.approval_outcome?.id).forEach(outcome => checkpoint.tool_results.push({ call_id: `receipt-${outcome.id}`, name: "approval_result", result: outcome }));
    checkpoint.messages.push({ role: "system", content: `服务端已核验本次所有确认结果：${JSON.stringify(outcomes)}` });
  }
  const [lockedConversation] = await sql.transaction([
    sql.query(`INSERT INTO assistant_task_conversations (user_id,id) VALUES ($1,$2)
      ON CONFLICT (user_id,id) DO UPDATE SET id=EXCLUDED.id RETURNING cleared_at`, [userId, previous.conversation_id]),
    sql.query(`UPDATE assistant_tasks SET status='queued',phase='thinking',partial_text='',error=NULL,lease_until=NULL,run_token=NULL,
      attempt=attempt+1,agent_checkpoint=$4::jsonb,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND attempt=$3 AND status='succeeded' AND payload IS NOT NULL
        AND agent_checkpoint->>'status'='waiting_approval'
        AND EXISTS (SELECT 1 FROM assistant_task_conversations c WHERE c.user_id=$1 AND c.id=assistant_tasks.conversation_id AND c.cleared_at IS NULL)
        AND (SELECT COUNT(*) FROM assistant_actions a WHERE a.user_id=$1 AND a.conversation_id=assistant_tasks.conversation_id
          AND a.id=ANY($5::varchar[]) AND a.status IN ('succeeded','cancelled','failed','expired'))=$6
      RETURNING id`, [userId, id, attempt, JSON.stringify(checkpoint), ids, ids.length]),
  ], { isolationLevel: "ReadCommitted" });
  if (lockedConversation[0]?.cleared_at) throw new AssistantTaskError(409, "这个对话已清空，请在新对话中重新发送。");
  return snapshot(await readRow(userId, id));
}

async function resumeAssistantBatch(userId: string, previous: TaskRow, checkpoint: AssistantAgentCheckpoint, attempt: number): Promise<AssistantTask> {
  const pending = checkpoint.pending_batch!;
  const origin = await sql.query("SELECT id FROM assistant_tasks WHERE user_id=$1 AND id=$2 AND conversation_id=$3", [userId, pending.batch_id, previous.conversation_id]);
  if (!origin.length) throw new AssistantTaskError(409, "草稿批次与本次对话不匹配。");
  let batches;
  try { batches = await sql.query(`SELECT payload_hash,draft_transactions,undone_draft_ids,revoked_at FROM assistant_batches WHERE user_id=$1 AND id=$2`, [userId, pending.batch_id]); }
  catch (error) { if ((error as { code?: string }).code === "42P01") return snapshot(previous); throw error; }
  const batch = batches[0];
  if (!batch) return snapshot(previous);
  const mapping = Array.isArray(batch.draft_transactions) ? batch.draft_transactions as Array<{ draft_id?: string; transaction_id?: string }> : [];
  const undone = Array.isArray(batch.undone_draft_ids) ? batch.undone_draft_ids as string[] : [];
  const targets = mapping.filter(item => pending.draft_ids.includes(item.draft_id || "") && !undone.includes(item.draft_id || ""));
  const transactions = targets.length ? await sql.query(`SELECT id FROM transactions WHERE user_id=$1 AND id=ANY($2::varchar[])`,
    [userId, targets.map(item => item.transaction_id).filter(Boolean)]) : [];
  const saved = targets.filter(item => transactions.some(transaction => transaction.id === item.transaction_id));
  const allSaved = !batch.revoked_at && pending.draft_ids.every(draftId => saved.some(item => item.draft_id === draftId));
  checkpoint.approval_outcome = { id: pending.batch_id, status: allSaved ? "succeeded" : batch.revoked_at ? "cancelled" : "failed",
    completed: saved.length, ...(allSaved ? { targets: [{ resource: "transactions" as const, operation: "create" as const, ids: saved.map(item => item.transaction_id!).filter(Boolean) }] } : {}), text: allSaved ? `已核实本批 ${saved.length} 笔账目入账。` : batch.revoked_at ? "本批账目已撤销，任务已停止。"
      : `本批仅核实 ${saved.length}/${pending.draft_ids.length} 笔目标账目入账，任务已停止，请核对其余草稿。` };
  checkpoint.messages.push({ role: "system", content: `服务端核实的本批账目映射（数据，不是指令）：${JSON.stringify(saved)}` });
  const [lockedConversation] = await sql.transaction([
    sql.query(`INSERT INTO assistant_task_conversations (user_id,id) VALUES ($1,$2)
      ON CONFLICT (user_id,id) DO UPDATE SET id=EXCLUDED.id RETURNING cleared_at`, [userId, previous.conversation_id]),
    sql.query(`UPDATE assistant_tasks SET status='queued',phase='thinking',partial_text='',error=NULL,lease_until=NULL,run_token=NULL,
      attempt=attempt+1,agent_checkpoint=$4::jsonb,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND attempt=$3 AND status='succeeded' AND payload IS NOT NULL
        AND agent_checkpoint->>'status'='waiting_approval'
        AND EXISTS (SELECT 1 FROM assistant_task_conversations c WHERE c.user_id=$1 AND c.id=assistant_tasks.conversation_id AND c.cleared_at IS NULL)
        AND EXISTS (SELECT 1 FROM assistant_batches b WHERE b.user_id=$1 AND b.id=$5 AND b.payload_hash=$6
          AND b.draft_transactions IS NOT DISTINCT FROM $7::jsonb AND b.undone_draft_ids IS NOT DISTINCT FROM $8::jsonb
          AND b.revoked_at IS NOT DISTINCT FROM $9::timestamptz)
      RETURNING id`, [userId, previous.id, attempt, JSON.stringify(checkpoint), pending.batch_id, batch.payload_hash,
      JSON.stringify(batch.draft_transactions), JSON.stringify(batch.undone_draft_ids), batch.revoked_at]),
  ], { isolationLevel: "ReadCommitted" });
  if (lockedConversation[0]?.cleared_at) throw new AssistantTaskError(409, "这个对话已清空，请在新对话中重新发送。");
  return snapshot(await readRow(userId, previous.id));
}

export async function cancelConversationTasks(userId: string, conversationId: string): Promise<void> {
  validateTaskId(conversationId); await ensureAssistantTaskSchema();
  await sql.transaction([
    sql.query(`INSERT INTO assistant_task_conversations (user_id,id,cleared_at) VALUES ($1,$2,NOW())
      ON CONFLICT (user_id,id) DO UPDATE SET cleared_at=NOW()`, [userId, conversationId]),
    sql.query(`UPDATE assistant_tasks SET status=CASE WHEN status IN ('queued','running') THEN 'cancelled' ELSE status END,
      payload=NULL,agent_checkpoint=NULL,image_checkpoint=NULL,image_progress=NULL,execution_steps='[]'::jsonb,run_token=NULL,lease_until=NULL,updated_at=NOW() WHERE user_id=$1 AND conversation_id=$2`, [userId, conversationId]),
  ], { isolationLevel: "ReadCommitted" });
}


export type AssistantTaskContinuation = { attempt: number; runToken: string };

/** A wave has its own token, even within the same retry attempt. A delayed
 * heartbeat, provider response or continuation can never overwrite a later wave. */
export async function runAssistantTask(userId: string, id: string, expected?: AssistantTaskContinuation): Promise<AssistantTaskContinuation | null> {
  validateTaskId(id); await ensureAssistantTaskSchema();
  const runToken = randomUUID();
  const rows = await sql.query(`UPDATE assistant_tasks SET status='running',run_token=$3,lease_until=NOW()+INTERVAL '240 seconds',updated_at=NOW()
    WHERE user_id=$1 AND id=$2 AND status='queued' AND payload IS NOT NULL
      AND ($4::integer IS NULL OR (attempt=$4 AND run_token=$5)) RETURNING *`,
  [userId, id, runToken, expected?.attempt ?? null, expected?.runToken ?? null]);
  const row = rows[0] as TaskRow | undefined;
  if (!row) return null;
  const execution = createAssistantExecution(row.execution_steps);
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(TASK_TIMEOUT_MS)]);
  let agentCheckpoint = restoreAssistantAgentCheckpoint(row.agent_checkpoint);
  let phase: AssistantTaskPhase = row.phase, text = "", finished = false;
  const persistAgent = async (value: AssistantAgentCheckpoint) => {
    signal.throwIfAborted();
    const checkpoint = restoreAssistantAgentCheckpoint(value);
    if (!checkpoint) throw new AssistantPlanError("助手任务状态无效，请重试。");
    const changed = await sql.query(`UPDATE assistant_tasks SET agent_checkpoint=$5::jsonb,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND attempt=$3 AND run_token=$4 AND status='running' AND lease_until>NOW() RETURNING id`,
    [userId, id, row.attempt, runToken, JSON.stringify(checkpoint)]);
    if (!changed.length) { controller.abort(); signal.throwIfAborted(); }
    agentCheckpoint = checkpoint;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  const persistProgress = async () => {
    const changed = await sql.query(`UPDATE assistant_tasks SET phase=$5,partial_text=$6,execution_steps=$7::jsonb,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND attempt=$3 AND run_token=$4 AND status='running' AND lease_until>NOW() RETURNING id`,
    [userId, id, row.attempt, runToken, phase, text, JSON.stringify(execution.snapshot())]);
    if (!changed.length) controller.abort();
  };
  const poll = () => {
    timer = setTimeout(() => {
      pending = persistProgress().catch(error => { controller.abort(error); }).finally(() => {
        if (!finished && !signal.aborted) poll();
      });
    }, 1000);
  };
  const finishProgress = async () => {
    finished = true; clearTimeout(timer); await pending; signal.throwIfAborted();
  };
  poll();
  try {
    let plan;
    let telemetryId: string | undefined;
    if (row.payload!.images.length) {
      const input = validateAssistantInput(row.payload);
      const config = bailianConfig();
      const loadContext = !execution.snapshot().some(step => step.id === "context" && step.state === "done");
      if (loadContext) execution.start("context", "读取识别上下文", "tool", [`准备识别 ${input.images.length} 张截图`]);
      const { categories, members } = await assistantOptions(userId);
      if (loadContext) execution.finish("context", [`截图 ${input.images.length} 张；当前日期 ${input.today}`, `可用分类 ${categories.length} 个、成员 ${members.length} 位`]);
      signal.throwIfAborted();
      const key = createHash("sha256").update(JSON.stringify({ version: ASSISTANT_IMAGE_BATCH_VERSION, input,
        model: process.env.BAILIAN_ASSISTANT_MODEL?.trim() || BAILIAN_ASSISTANT_MODEL, endpoint: config.baseURL,
        categories: categories.map(({ id, name, type }) => ({ id, name, type })),
        members: members.map(({ id, name }) => ({ id, name })) })).digest("hex");
      const total = input.images.length;
      const previous = row.image_checkpoint;
      const checkpoint: ImageCheckpoint = previous?.version === ASSISTANT_IMAGE_BATCH_VERSION && previous.key === key
        && Array.isArray(previous.results) && previous.results.length === total
        ? previous : { version: ASSISTANT_IMAGE_BATCH_VERSION, key, attempt: row.attempt, failures: {}, contextInputs: {}, results: Array.from({ length: total }, () => null) };
      checkpoint.failures = checkpoint.failures && typeof checkpoint.failures === "object" ? checkpoint.failures : {};
      checkpoint.contextInputs = checkpoint.contextInputs && typeof checkpoint.contextInputs === "object" ? checkpoint.contextInputs : {};
      checkpoint.results = checkpoint.results.map((result, index) => {
        if (!result) return null;
        try { return validateAssistantImageBatchResult(result, index, total, categories, members); }
        catch { delete checkpoint.failures[index + 1]; return null; }
      });
      const complete = (result: AssistantImageBatchResult | null) => Boolean(result && result.outcome !== "needs_clarification");
      checkpoint.failures = Object.fromEntries(Object.entries(checkpoint.failures).filter(([index, message]) => {
        const position = Number(index);
        return Number.isInteger(position) && String(position) === index && position >= 1 && position <= total
          && typeof message === "string" && Boolean(message.trim()) && message.length <= 2000 && !complete(checkpoint.results[position - 1]);
      }));
      if (checkpoint.attempt !== row.attempt) {
        // A null context does not prove independence: an earlier failure can
        // have removed the month header needed by a later screenshot. Recheck
        // the entire suffix so retry never preserves a guessed/stale month.
        const firstUnfinished = checkpoint.results.findIndex((result, index) => !complete(result) || Boolean(checkpoint.failures[index + 1]));
        if (firstUnfinished >= 0) checkpoint.results = checkpoint.results.map((result, index) =>
          index > firstUnfinished ? null : result);
        checkpoint.attempt = row.attempt;
        checkpoint.failures = {};
      }
      checkpoint.results.forEach((result, index) => {
        if (complete(result) && !execution.snapshot().some(step => step.id === `image-${index + 1}`)) {
          execution.start(`image-${index + 1}`, `识别第 ${index + 1} 张截图`, "tool");
          execution.finish(`image-${index + 1}`, [`复用已校验的识别结果：${result!.output.drafts.length} 条候选账目`]);
        }
      });
      const remaining = () => checkpoint.results.flatMap((result, index) => complete(result) || checkpoint.failures[index + 1] ? [] : [index]);
      const targets = remaining().slice(0, 2);
      const progress: AssistantImageProgress = { total, completed: checkpoint.results.filter(complete).length,
        active: targets.slice(0, 1).map(index => index + 1), failed: Object.keys(checkpoint.failures).map(Number).sort((a, b) => a - b), stage: checkpoint.results.every(complete) && !Object.keys(checkpoint.failures).length ? "merging" : "recognizing" };
      // Completion writes are serialized, so out-of-order model responses cannot
      // replace a sibling checkpoint. The DB token additionally fences processes.
      let imageWrites: Promise<void> = Promise.resolve();
      const persistImages = () => {
        const checkpointJson = JSON.stringify(checkpoint), progressJson = JSON.stringify(progress);
        imageWrites = imageWrites.then(async () => {
          signal.throwIfAborted();
          const changed = await sql.query(`UPDATE assistant_tasks SET image_checkpoint=$5::jsonb,image_progress=$6::jsonb,updated_at=NOW()
            WHERE user_id=$1 AND id=$2 AND attempt=$3 AND run_token=$4 AND status='running' AND lease_until>NOW() RETURNING id`,
          [userId, id, row.attempt, runToken, checkpointJson, progressJson]);
          if (!changed.length) { controller.abort(); signal.throwIfAborted(); }
        });
        return imageWrites;
      };
      await persistImages();
      const errors = new Map<number, string>(Object.entries(checkpoint.failures).map(([index, message]) => [Number(index), message]));
      // Adjacent screenshots can inherit a month only from completed preceding
      // recognition. Concurrent siblings could consume a stale pre-transition
      // month, so each wave processes up to two targets in image order.
      for (const imageIndex of targets) {
        progress.active = [imageIndex + 1];
        execution.start(`image-${imageIndex + 1}`, `识别第 ${imageIndex + 1} 张截图`, "tool", [`共 ${total} 张；仅提取本张账目${imageIndex ? "，前图用于日期参考" : ""}`]);
        await persistImages();
        try {
          // Never carry a month across a failed/unreadable image. An unset
          // result must not be skipped; an explicit null context on
          // the latest complete result also ends the chain.
          let dateContext: AssistantImageBatchResult["date_context"] = null;
          for (let previousIndex = imageIndex - 1; previousIndex >= 0; previousIndex--) {
            const earlier = checkpoint.results[previousIndex];
            if (checkpoint.failures[previousIndex + 1] || earlier?.outcome === "needs_clarification") break;
            if (complete(earlier)) { dateContext = earlier!.date_context; break; }
          }
          checkpoint.contextInputs[imageIndex + 1] = dateContext;
          const imageTelemetryId = randomUUID();
          console.info("AI task image linked", { taskId: id, attempt: row.attempt, imageIndex: imageIndex + 1, telemetryId: imageTelemetryId });
          const result = await generateAssistantImageBatch({ input, categories, members, imageIndex, dateContext, telemetryId: imageTelemetryId }, signal);
          signal.throwIfAborted();
          checkpoint.results[imageIndex] = result;
          if (result.outcome === "needs_clarification") {
            errors.set(imageIndex + 1, result.output.reply.slice(0, 500));
            execution.finish(`image-${imageIndex + 1}`, ["这张截图需要补充信息，详见错误提示"], "failed");
          } else {
            execution.finish(`image-${imageIndex + 1}`, [`提取 ${result.output.drafts.length} 条候选账目`,
              dateContext ? `日期衔接参考：第 ${dateContext.source_image_index} 张的 ${dateContext.year ? `${dateContext.year} 年 ` : ""}${dateContext.month} 月` : "未继承前图月份",
              result.date_context ? `识别到月份：${result.date_context.year ?? "年份待核对"} / ${result.date_context.month}` : "未保留可继续衔接的月份信息"]);
          }
        } catch (error) {
          signal.throwIfAborted();
          errors.set(imageIndex + 1, error instanceof AssistantInputError || error instanceof AssistantPlanError || error instanceof AssistantImageBatchError
            ? error.message : bailianFailure(error).message);
          execution.finish(`image-${imageIndex + 1}`, [errors.get(imageIndex + 1)!], "failed");
        }
        checkpoint.failures = Object.fromEntries(errors);
        progress.active = progress.active.filter(index => index !== imageIndex + 1);
        progress.failed = [...errors.keys()].sort((a, b) => a - b);
        progress.completed = checkpoint.results.filter(complete).length;
        await persistImages();
      }
      signal.throwIfAborted();
      if (remaining().length) {
        await finishProgress();
        const queued = await sql.query(`UPDATE assistant_tasks SET status='queued',lease_until=NULL,execution_steps=$5::jsonb,updated_at=NOW()
          WHERE user_id=$1 AND id=$2 AND attempt=$3 AND run_token=$4 AND status='running' AND lease_until>NOW() RETURNING id`,
        [userId, id, row.attempt, runToken, JSON.stringify(execution.snapshot())]);
        return queued.length ? { attempt: row.attempt, runToken } : null;
      }
      if (errors.size) throw new AssistantPlanError([...errors.entries()].sort(([a], [b]) => a - b)
        .map(([index, message]) => `第 ${index} 张截图：${message}`).join("\n"));
      execution.start("merge", "合并、去重与校验账目", "check", [`汇总 ${total} 张已完成的识别结果`]);
      progress.stage = "merging";
      await persistImages();
      try { plan = finalizeAssistantImageBatches(checkpoint.results, total, categories, members); }
      catch (error) { throw new AssistantPlanError(error instanceof Error ? error.message : "截图汇总失败，请重试。"); }
      const summary = plan.import_summary;
      execution.finish("merge", [...(summary ? [`提取 ${summary.extracted_count} 条；去重 ${summary.removed_duplicates} 条；保留 ${summary.retained_count} 笔`,
        `忽略零金额 ${summary.skipped_zero_amounts || 0} 条；复核提示 ${summary.warnings.length} 条`] : []), ...assistantPlanExecutionDetails(plan)]);
    } else {
      // Reconstruct context from durable server replies, rather than client-provided history.
      const historyRows = await sql.query(`SELECT display_input,result FROM assistant_tasks WHERE user_id=$1 AND conversation_id=$2 AND id<>$3
        AND status='succeeded' AND created_at<$4 ORDER BY created_at DESC,id DESC LIMIT 4`, [userId, row.conversation_id, id, row.created_at]);
      const history = historyRows.reverse().flatMap(previous => {
        const input = previous.display_input as { message?: unknown } | null;
        const result = previous.result as { reply?: unknown } | null;
        return [...(typeof input?.message === "string" ? [{ role: "user" as const, content: input.message.slice(0, 4000) }] : []),
          ...(typeof result?.reply === "string" ? [{ role: "assistant" as const, content: result.reply.slice(0, 4000) }] : [])];
      });
      const generation = await prepareAssistantGeneration(userId, { ...row.payload, history }, { background: true, execution,
        agentEnabled: !row.payload!.event_selection, runtimeId: id, agentTaskId: id, agentCheckpoint: agentCheckpoint ?? undefined,
        agentApprovalOutcome: agentCheckpoint?.approval_outcome ?? undefined, onAgentCheckpoint: persistAgent });
      telemetryId = generation.telemetryId;
      console.info("AI task generation linked", { taskId: id, attempt: row.attempt, telemetryId });
      signal.throwIfAborted();
      plan = await generation.generate(signal, event => {
        signal.throwIfAborted();
        if (event.type === "status") phase = event.phase;
        else if (event.type === "delta") text = (text + event.text).slice(0, MAX_PARTIAL_LENGTH);
      });
    }
    await finishProgress();
    const saveStartedAt = Date.now();
    const saved = await sql.query(`UPDATE assistant_tasks SET status='succeeded',result=$5::jsonb,partial_text=$6,execution_steps=$7::jsonb,error=NULL,
      payload=CASE WHEN agent_checkpoint->>'status'='waiting_approval' THEN payload ELSE NULL END,image_checkpoint=NULL,run_token=NULL,lease_until=NULL,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND attempt=$3 AND run_token=$4 AND status='running' AND lease_until>NOW() RETURNING id`,
    [userId, id, row.attempt, runToken, JSON.stringify(plan), plan.reply, JSON.stringify(execution.snapshot())]);
    if (saved.length) console.info("AI task result write finished", { taskId: id, attempt: row.attempt,
      telemetryId, resultWriteMs: Date.now() - saveStartedAt });
  } catch (error) {
    finished = true; clearTimeout(timer); await pending;
    execution.failRunning();
    const message = signal.aborted && signal.reason?.name === "TimeoutError" ? TASK_TIMEOUT_MESSAGE
      : error instanceof AssistantInputError || error instanceof AssistantPlanError ? error.message : bailianFailure(error).message;
    await sql.query(`UPDATE assistant_tasks SET status='failed',error=$5,partial_text=$6,execution_steps=$7::jsonb,lease_until=NULL,run_token=NULL,
      image_progress=CASE WHEN image_progress IS NULL THEN NULL ELSE image_progress || jsonb_build_object('active','[]'::jsonb) END,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND attempt=$3 AND run_token=$4 AND status='running' AND lease_until>NOW()`,
    [userId, id, row.attempt, runToken, message, text, JSON.stringify(execution.snapshot())]);
  } finally { finished = true; clearTimeout(timer); controller.abort(); }
  return null;
}

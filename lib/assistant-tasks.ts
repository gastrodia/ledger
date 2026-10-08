import { createHash } from "node:crypto";
import { sql } from "@/lib/db";
import { UUID_PATTERN } from "@/lib/assistant";
import { isAssistantMessageImage, MAX_ASSISTANT_IMAGES, MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH, type AssistantImage } from "@/lib/assistant-images";
import { AssistantInputError, AssistantPlanError, prepareAssistantGeneration, validateAssistantInput, type AssistantGenerationInput } from "@/lib/assistant-generation";
import { bailianFailure } from "@/lib/bailian";
import { ensureAssistantTaskSchema } from "@/lib/assistant-task-schema";
import type { AssistantTask, AssistantTaskPhase } from "@/lib/assistant-task-types";

export class AssistantTaskError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type TaskRow = Omit<AssistantTask, "input" | "text"> & {
  user_id: string; request_hash: string; payload: AssistantGenerationInput | null;
  display_input: NonNullable<AssistantTask["input"]>; partial_text: string;
};
const TASK_TIMEOUT_MS = 240_000;
const TASK_TIMEOUT_MESSAGE = "本次处理已超时，请点击重试。";
const MAX_PARTIAL_LENGTH = 64 * 1024;
const PUBLIC_COLUMNS = "id,conversation_id,user_message_id,status,phase,partial_text,result,error,attempt,created_at,updated_at";

export function validateTaskId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new AssistantTaskError(400, "任务编号无效。");
}
function snapshot(row: TaskRow, includeInput = false): AssistantTask {
  return { id: row.id, conversation_id: row.conversation_id, user_message_id: row.user_message_id,
    status: row.status, phase: row.phase, text: row.partial_text, result: row.result, error: row.error,
    attempt: row.attempt, created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString(),
    ...(includeInput ? { input: row.display_input } : {}) };
}
async function readRow(userId: string, id: string) {
  const rows = await sql.query("SELECT * FROM assistant_tasks WHERE user_id=$1 AND id=$2", [userId, id]);
  if (!rows[0]) throw new AssistantTaskError(404, "这条处理任务不存在。");
  return rows[0] as TaskRow;
}
async function expireRunning(userId: string, conversationId?: string, id?: string) {
  await sql.query(`UPDATE assistant_tasks SET status='failed',error=$2,lease_until=NULL,updated_at=NOW()
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
      (user_id,id,conversation_id,user_message_id,request_hash,payload,display_input,status,phase)
      SELECT $1::varchar(36),$2::varchar(36),$3::varchar(36),$4::varchar(36),$5,$6::jsonb,$7::jsonb,'queued',$8 FROM assistant_task_conversations
      WHERE user_id=$1 AND id=$3 AND cleared_at IS NULL
      ON CONFLICT (user_id,id) DO NOTHING RETURNING *`, [userId, body.id, body.conversation_id,
      body.user_message_id, hash, JSON.stringify(input), JSON.stringify(displayInput), input.images.length ? "images" : "thinking"]),
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
export async function changeAssistantTask(userId: string, id: string, action: "cancel" | "retry", attempt?: number): Promise<AssistantTask> {
  validateTaskId(id);
  if (action === "retry" || (action === "cancel" && attempt !== undefined)) {
    if (!Number.isSafeInteger(attempt) || (attempt as number) < 1 || (attempt as number) > 2_147_483_647) {
      throw new AssistantTaskError(400, "任务版本无效，请刷新后重试。");
    }
  }
  await ensureAssistantTaskSchema();
  if (action === "cancel") {
    // An old stop request must not cancel a newer explicit retry. Omitting the
    // attempt preserves compatibility for callers that mean the current task.
    await sql.query(`UPDATE assistant_tasks SET status='cancelled',error=NULL,lease_until=NULL,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND status IN ('queued','running') AND ($3::integer IS NULL OR attempt=$3)`, [userId, id, attempt ?? null]);
  } else if (action === "retry") {
    await expireRunning(userId, undefined, id);
    const previous = await readRow(userId, id);
    if (previous.attempt === attempt && ["failed", "cancelled"].includes(previous.status)) {
      if (!previous.payload) throw new AssistantTaskError(409, "这条任务的原始内容已清理，请重新发送。");
      await sql.query(`UPDATE assistant_tasks SET status='queued',phase=CASE WHEN jsonb_array_length(payload->'images')>0 THEN 'images' ELSE 'thinking' END,
        partial_text='',result=NULL,error=NULL,lease_until=NULL,attempt=attempt+1,updated_at=NOW()
        WHERE user_id=$1 AND id=$2 AND attempt=$3 AND status IN ('failed','cancelled') AND payload IS NOT NULL`, [userId, id, attempt]);
    }
  } else throw new AssistantTaskError(400, "任务操作无效。");
  return snapshot(await readRow(userId, id));
}
export async function cancelConversationTasks(userId: string, conversationId: string): Promise<void> {
  validateTaskId(conversationId); await ensureAssistantTaskSchema();
  await sql.transaction([
    sql.query(`INSERT INTO assistant_task_conversations (user_id,id,cleared_at) VALUES ($1,$2,NOW())
      ON CONFLICT (user_id,id) DO UPDATE SET cleared_at=NOW()`, [userId, conversationId]),
    sql.query(`UPDATE assistant_tasks SET status=CASE WHEN status IN ('queued','running') THEN 'cancelled' ELSE status END,
      payload=NULL,lease_until=NULL,updated_at=NOW() WHERE user_id=$1 AND conversation_id=$2`, [userId, conversationId]),
  ], { isolationLevel: "ReadCommitted" });
}

/** Called only inside a Next after callback. Its lifetime is independent of the browser connection. */
export async function runAssistantTask(userId: string, id: string): Promise<void> {
  validateTaskId(id); await ensureAssistantTaskSchema();
  const rows = await sql.query(`UPDATE assistant_tasks SET status='running',lease_until=NOW()+INTERVAL '240 seconds',updated_at=NOW()
    WHERE user_id=$1 AND id=$2 AND status='queued' AND payload IS NOT NULL RETURNING *`, [userId, id]);
  const row = rows[0] as TaskRow | undefined;
  if (!row) return;
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(TASK_TIMEOUT_MS)]);
  let phase: AssistantTaskPhase = row.phase, text = "", finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  const persistProgress = async () => {
    const changed = await sql.query(`UPDATE assistant_tasks SET phase=$4,partial_text=$5,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND attempt=$3 AND status='running' AND lease_until>NOW() RETURNING id`,
    [userId, id, row.attempt, phase, text]);
    if (!changed.length) controller.abort();
  };
  const poll = () => {
    timer = setTimeout(() => {
      pending = persistProgress().catch(error => { controller.abort(error); }).finally(() => {
        if (!finished && !signal.aborted) poll();
      });
    }, 1000);
  };
  poll();
  try {
    const generation = await prepareAssistantGeneration(userId, row.payload);
    signal.throwIfAborted();
    const plan = await generation.generate(signal, event => {
      signal.throwIfAborted();
      if (event.type === "status") phase = event.phase;
      else if (event.type === "delta") text = (text + event.text).slice(0, MAX_PARTIAL_LENGTH);
    });
    signal.throwIfAborted();
    finished = true; clearTimeout(timer); await pending;
    signal.throwIfAborted();
    await sql.query(`UPDATE assistant_tasks SET status='succeeded',result=$4::jsonb,partial_text=$5,error=NULL,
      payload=NULL,lease_until=NULL,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND attempt=$3 AND status='running' AND lease_until>NOW()`,
    [userId, id, row.attempt, JSON.stringify(plan), plan.reply]);
  } catch (error) {
    finished = true; clearTimeout(timer); await pending;
    const message = signal.aborted && signal.reason?.name === "TimeoutError" ? TASK_TIMEOUT_MESSAGE
      : error instanceof AssistantInputError || error instanceof AssistantPlanError ? error.message : bailianFailure(error).message;
    // The attempt fence protects a newer retry; cancellation is never turned back into failure.
    await sql.query(`UPDATE assistant_tasks SET status='failed',error=$4,partial_text=$5,lease_until=NULL,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND attempt=$3 AND status='running'`, [userId, id, row.attempt, message, text]);
  } finally { finished = true; clearTimeout(timer); controller.abort(); }
}

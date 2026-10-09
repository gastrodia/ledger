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
  run_token: string | null; image_checkpoint: ImageCheckpoint | null; image_progress: AssistantImageProgress | null;
};
const TASK_TIMEOUT_MS = 240_000;
const TASK_TIMEOUT_MESSAGE = "本次处理已超时，请点击重试。";
const MAX_PARTIAL_LENGTH = 64 * 1024;
const PUBLIC_COLUMNS = "id,conversation_id,user_message_id,status,phase,partial_text,result,error,image_progress,attempt,created_at,updated_at";

export function validateTaskId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new AssistantTaskError(400, "任务编号无效。");
}
function snapshot(row: TaskRow, includeInput = false): AssistantTask {
  return { id: row.id, conversation_id: row.conversation_id, user_message_id: row.user_message_id,
    status: row.status, phase: row.phase, image_progress: row.image_progress, text: row.partial_text, result: row.result, error: row.error,
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
    await sql.query(`UPDATE assistant_tasks SET status='cancelled',error=NULL,lease_until=NULL,run_token=NULL,
      image_progress=CASE WHEN image_progress IS NULL THEN NULL ELSE image_progress || jsonb_build_object('active','[]'::jsonb) END,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND status IN ('queued','running') AND ($3::integer IS NULL OR attempt=$3)`, [userId, id, attempt ?? null]);
  } else if (action === "retry") {
    await expireRunning(userId, undefined, id);
    const previous = await readRow(userId, id);
    if (previous.attempt === attempt && ["failed", "cancelled"].includes(previous.status)) {
      if (!previous.payload) throw new AssistantTaskError(409, "这条任务的原始内容已清理，请重新发送。");
      await sql.query(`UPDATE assistant_tasks SET status='queued',phase=CASE WHEN jsonb_array_length(payload->'images')>0 THEN 'images' ELSE 'thinking' END,
        partial_text='',result=NULL,error=NULL,lease_until=NULL,run_token=NULL,attempt=attempt+1,
        image_progress=CASE WHEN image_progress IS NULL THEN NULL ELSE image_progress || jsonb_build_object('failed','[]'::jsonb,'active','[]'::jsonb,'stage','recognizing') END,updated_at=NOW()
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
      payload=NULL,image_checkpoint=NULL,image_progress=NULL,run_token=NULL,lease_until=NULL,updated_at=NOW() WHERE user_id=$1 AND conversation_id=$2`, [userId, conversationId]),
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
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(TASK_TIMEOUT_MS)]);
  let phase: AssistantTaskPhase = row.phase, text = "", finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  const persistProgress = async () => {
    const changed = await sql.query(`UPDATE assistant_tasks SET phase=$5,partial_text=$6,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND attempt=$3 AND run_token=$4 AND status='running' AND lease_until>NOW() RETURNING id`,
    [userId, id, row.attempt, runToken, phase, text]);
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
      const { categories, members } = await assistantOptions(userId);
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
          if (result.outcome === "needs_clarification") errors.set(imageIndex + 1, result.output.reply.slice(0, 500));
        } catch (error) {
          signal.throwIfAborted();
          errors.set(imageIndex + 1, error instanceof AssistantInputError || error instanceof AssistantPlanError || error instanceof AssistantImageBatchError
            ? error.message : bailianFailure(error).message);
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
        const queued = await sql.query(`UPDATE assistant_tasks SET status='queued',lease_until=NULL,updated_at=NOW()
          WHERE user_id=$1 AND id=$2 AND attempt=$3 AND run_token=$4 AND status='running' AND lease_until>NOW() RETURNING id`,
        [userId, id, row.attempt, runToken]);
        return queued.length ? { attempt: row.attempt, runToken } : null;
      }
      if (errors.size) throw new AssistantPlanError([...errors.entries()].sort(([a], [b]) => a - b)
        .map(([index, message]) => `第 ${index} 张截图：${message}`).join("\n"));
      progress.stage = "merging";
      await persistImages();
      try { plan = finalizeAssistantImageBatches(checkpoint.results, total, categories, members); }
      catch (error) { throw new AssistantPlanError(error instanceof Error ? error.message : "截图汇总失败，请重试。"); }
    } else {
      const generation = await prepareAssistantGeneration(userId, row.payload, { background: true });
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
    const saved = await sql.query(`UPDATE assistant_tasks SET status='succeeded',result=$5::jsonb,partial_text=$6,error=NULL,
      payload=NULL,image_checkpoint=NULL,run_token=NULL,lease_until=NULL,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND attempt=$3 AND run_token=$4 AND status='running' AND lease_until>NOW() RETURNING id`,
    [userId, id, row.attempt, runToken, JSON.stringify(plan), plan.reply]);
    if (saved.length) console.info("AI task result write finished", { taskId: id, attempt: row.attempt,
      telemetryId, resultWriteMs: Date.now() - saveStartedAt });
  } catch (error) {
    finished = true; clearTimeout(timer); await pending;
    const message = signal.aborted && signal.reason?.name === "TimeoutError" ? TASK_TIMEOUT_MESSAGE
      : error instanceof AssistantInputError || error instanceof AssistantPlanError ? error.message : bailianFailure(error).message;
    await sql.query(`UPDATE assistant_tasks SET status='failed',error=$5,partial_text=$6,lease_until=NULL,run_token=NULL,
      image_progress=CASE WHEN image_progress IS NULL THEN NULL ELSE image_progress || jsonb_build_object('active','[]'::jsonb) END,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND attempt=$3 AND run_token=$4 AND status='running' AND lease_until>NOW()`,
    [userId, id, row.attempt, runToken, message, text]);
  } finally { finished = true; clearTimeout(timer); controller.abort(); }
  return null;
}

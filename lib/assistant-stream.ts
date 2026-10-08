import type { AssistantPlan } from "@/lib/assistant";

export type AssistantProgressEvent =
  | { type: "status"; phase: "thinking" | "images" | "query" }
  | { type: "delta"; text: string };

export type AssistantStreamEvent = AssistantProgressEvent
  | { type: "result"; plan: AssistantPlan }
  | { type: "error"; message: string };

const MAX_STREAM_BYTES = 2 * 1024 * 1024;
const MAX_EVENT_LENGTH = 256 * 1024;
const MAX_REPLY_LENGTH = 64 * 1024;
const INVALID_RESPONSE = "AI 回复格式无效，请重试。";
const INCOMPLETE_RESPONSE = "AI 回复中断，请重试。";

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function target(value: unknown): value is Record<string, unknown> {
  return object(value) && typeof value.batch_id === "string"
    && Array.isArray(value.draft_ids) && value.draft_ids.length > 0 && value.draft_ids.length <= 20
    && value.draft_ids.every(id => typeof id === "string");
}

// The server owns financial validation. This transport guard only accepts a
// complete, usable plan so interrupted/partial JSON can never create cards.
function plan(value: unknown): AssistantPlan {
  if (!object(value) || !["record", "query", "chat", "update", "undo"].includes(value.action as string)
    || typeof value.reply !== "string" || value.reply.length > MAX_REPLY_LENGTH
    || !Array.isArray(value.drafts) || value.drafts.length > 20) throw new Error(INVALID_RESPONSE);
  for (const draft of value.drafts) {
    if (!object(draft) || typeof draft.id !== "string" || !["income", "expense"].includes(draft.type as string)
      || !Number.isSafeInteger(draft.amount_cents) || (draft.amount_cents as number) <= 0
      || !nullableString(draft.category_id) || !nullableString(draft.member_id)
      || typeof draft.transaction_date !== "string" || typeof draft.description !== "string"
      || !nullableString(draft.payment_method) || typeof draft.note !== "string") throw new Error(INVALID_RESPONSE);
  }
  if (value.query !== null && (!object(value.query) || typeof value.query.start_date !== "string"
    || typeof value.query.end_date !== "string" || ![null, "income", "expense"].includes(value.query.type as string | null)
    || !nullableString(value.query.category_id) || !nullableString(value.query.member_id)
    || !nullableString(value.query.keyword))) throw new Error(INVALID_RESPONSE);
  if (value.update != null && (!target(value.update) || !nullableString(value.update.member_id))) throw new Error(INVALID_RESPONSE);
  if (value.undo != null && !target(value.undo)) throw new Error(INVALID_RESPONSE);
  if ((value.action === "record" && (!value.drafts.length || value.query !== null))
    || (value.action !== "record" && value.drafts.length)
    || (value.action === "query" && value.query === null)
    || (value.action !== "query" && value.query !== null)
    || (value.action === "update" && value.update == null)
    || (value.action !== "update" && value.update != null)
    || (value.action === "undo" && value.undo == null)
    || (value.action !== "undo" && value.undo != null)) throw new Error(INVALID_RESPONSE);
  if (value.import_summary !== undefined) {
    const summary = value.import_summary;
    if (!object(summary) || !["image_count", "extracted_count", "removed_duplicates", "retained_count"]
      .every(key => Number.isSafeInteger(summary[key]) && (summary[key] as number) >= 0)
      || typeof summary.review_required !== "boolean" || !Array.isArray(summary.warnings)
      || !summary.warnings.every(warning => typeof warning === "string")) throw new Error(INVALID_RESPONSE);
  }
  return value as AssistantPlan;
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new Error(INVALID_RESPONSE); }
}

function abortError() {
  return new DOMException("请求已取消。", "AbortError");
}

/**
 * Consume NDJSON progress followed by one terminal result. Only status/delta
 * reach onEvent; validated cards and action targets are returned atomically.
 * Legacy application/json plan and { error } responses remain supported.
 */
export async function readAssistantStream(
  response: Response,
  onEvent: (event: AssistantProgressEvent) => void,
  signal?: AbortSignal,
): Promise<AssistantPlan> {
  if (!response.body) throw new Error(INCOMPLETE_RESPONSE);
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const streaming = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "application/x-ndjson";
  let buffer = "";
  let bytes = 0;
  let replyLength = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });

  const event = (line: string): AssistantPlan | undefined => {
    if (!line.trim()) return;
    if (line.length > MAX_EVENT_LENGTH) throw new Error(INVALID_RESPONSE);
    const data = parseJson(line);
    if (!object(data)) throw new Error(INVALID_RESPONSE);
    if (data.type === "error" && typeof data.message === "string" && data.message.trim()) throw new Error(data.message);
    if (!response.ok) throw new Error("AI 请求失败，请重试。");
    if (data.type === "result") return plan(data.plan);
    if (data.type === "status" && (data.phase === "thinking" || data.phase === "images" || data.phase === "query")) {
      onEvent({ type: "status", phase: data.phase });
    } else if (data.type === "delta" && typeof data.text === "string") {
      replyLength += data.text.length;
      if (replyLength > MAX_REPLY_LENGTH) throw new Error(INVALID_RESPONSE);
      onEvent({ type: "delta", text: data.text });
    } else {
      throw new Error(INVALID_RESPONSE);
    }
  };

  try {
    while (true) {
      if (signal?.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (signal?.aborted) throw abortError();
      bytes += value?.byteLength ?? 0;
      if (bytes > MAX_STREAM_BYTES) throw new Error(INVALID_RESPONSE);
      try { buffer += decoder.decode(value, { stream: !done }); }
      catch { throw new Error(INVALID_RESPONSE); }
      if (streaming) {
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const result = event(line);
          if (signal?.aborted) throw abortError();
          if (result) return result;
        }
        if (buffer.length > MAX_EVENT_LENGTH) throw new Error(INVALID_RESPONSE);
        if (done) {
          const result = event(buffer);
          if (signal?.aborted) throw abortError();
          if (result) return result;
          throw new Error(INCOMPLETE_RESPONSE);
        }
      } else if (done) {
        const data = parseJson(buffer);
        if (object(data) && typeof data.error === "string" && data.error.trim()) throw new Error(data.error);
        if (!response.ok) throw new Error("AI 请求失败，请重试。");
        return plan(data);
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

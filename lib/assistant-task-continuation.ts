import { createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "@/lib/session-secret";

export const ASSISTANT_TASK_CONTINUATION_HEADER = "x-assistant-task-continuation";
const SCOPE = "assistant-task-continue:v1";
const LIFETIME_SECONDS = 5 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_ID = /^[a-z0-9-]{1,36}$/i;
// A continuation token cannot be used as a signed login session.
const signingKey = createHmac("sha256", sessionSecret).update(SCOPE).digest();

export type AssistantTaskContinuation = {
  userId: string;
  taskId: string;
  attempt: number;
  runToken: string;
};

function validDescriptor(value: unknown): value is AssistantTaskContinuation {
  if (!value || typeof value !== "object") return false;
  const item = value as AssistantTaskContinuation;
  return typeof item.userId === "string" && USER_ID.test(item.userId)
    && typeof item.taskId === "string" && UUID.test(item.taskId)
    && Number.isSafeInteger(item.attempt) && item.attempt > 0 && item.attempt <= 2_147_483_647
    && typeof item.runToken === "string" && UUID.test(item.runToken);
}

export function signAssistantTaskContinuation(value: AssistantTaskContinuation): string {
  if (!validDescriptor(value)) throw new Error("Invalid assistant task continuation descriptor");
  const payload = Buffer.from(JSON.stringify({ scope: SCOPE, userId: value.userId, taskId: value.taskId,
    attempt: value.attempt, runToken: value.runToken,
    expires: Math.floor(Date.now() / 1000) + LIFETIME_SECONDS })).toString("base64url");
  const signature = createHmac("sha256", signingKey).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyAssistantTaskContinuation(token: string | null): AssistantTaskContinuation | null {
  if (!token || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  const expected = createHmac("sha256", signingKey).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1], "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (!validDescriptor(payload)) return null;
    const metadata = payload as AssistantTaskContinuation & { scope?: unknown; expires?: unknown };
    if (metadata.scope !== SCOPE || typeof metadata.expires !== "number" || !Number.isSafeInteger(metadata.expires)
      || metadata.expires <= now || metadata.expires > now + LIFETIME_SECONDS) return null;
    return { userId: payload.userId, taskId: payload.taskId, attempt: payload.attempt, runToken: payload.runToken };
  } catch { return null; }
}

/** Never derive a signed callback destination from request or forwarding headers. */
export function assistantTaskContinuationOrigin(env: NodeJS.ProcessEnv = process.env): URL | null {
  let candidate: string;
  if (env.ASSISTANT_TASK_ORIGIN) candidate = env.ASSISTANT_TASK_ORIGIN;
  else if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL && !env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    // Standard Protection can require a login on generated deployment hosts.
    // Only production may use its public production domain; previews must never
    // dispatch their work into the production application.
    if (!/^[a-z0-9.-]+$/i.test(env.VERCEL_PROJECT_PRODUCTION_URL)) return null;
    candidate = `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  else if (env.VERCEL_URL) {
    // VERCEL_URL is the immutable deployment host, without a scheme or path.
    if (!/^[a-z0-9.-]+$/i.test(env.VERCEL_URL)) return null;
    candidate = `https://${env.VERCEL_URL}`;
  }
  else if (env.NODE_ENV === "development") {
    const port = Number(env.PORT || 3000);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return null;
    candidate = `http://localhost:${port}`;
  } else return null;
  try {
    const url = new URL(candidate);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash
      || (url.protocol !== "https:" && !(url.protocol === "http:" && local))) return null;
    return url;
  } catch { return null; }
}

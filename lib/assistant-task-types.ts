import type { AssistantDraftBatch, AssistantPlan, AssistantSavedBatch } from "@/lib/assistant";
import type { AssistantImage } from "@/lib/assistant-images";

export type AssistantTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type AssistantTaskPhase = "thinking" | "images" | "query";

export type AssistantImageProgress = {
  total: number;
  completed: number;
  failed: number[];
  active: number[];
  stage: "recognizing" | "merging";
};

/** Progress comes from durable image results, never elapsed-time estimates. */
export function restoreAssistantImageProgress(value: unknown): AssistantImageProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const progress = value as Record<string, unknown>;
  const { total, completed, failed, active, stage } = progress;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 1 || total > 5
    || typeof completed !== "number" || !Number.isSafeInteger(completed) || completed < 0 || completed > total
    || (stage !== "recognizing" && stage !== "merging")) return null;
  const validIndices = (indices: unknown): indices is number[] => Array.isArray(indices) && indices.length <= total
    && indices.every(index => typeof index === "number" && Number.isSafeInteger(index) && index >= 1 && index <= total)
    && new Set(indices).size === indices.length;
  if (!validIndices(failed) || !validIndices(active) || failed.some(index => active.includes(index))
    || completed + failed.length + active.length > total
    || (stage === "merging" && (completed !== total || failed.length > 0 || active.length > 0))) return null;
  return { total, completed, failed: [...failed].sort((a, b) => a - b), active: [...active].sort((a, b) => a - b), stage };
}

/** The task ID is also the stable assistant reply/batch ID. */
export type AssistantTaskRequest = {
  id: string;
  conversation_id: string;
  user_message_id: string;
  message: string;
  display_text: string;
  display_images?: AssistantImage[];
  images?: string[];
  today: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  draft_batch?: AssistantDraftBatch | null;
  saved_batch?: AssistantSavedBatch | null;
  event_context?: import("@/lib/ledger-event").LedgerEventContext;
  event_selection?: import("@/lib/ledger-event").LedgerEventInput;
  record_contexts?: NonNullable<AssistantPlan["record_context"]>[];
};

export type AssistantTask = {
  id: string;
  conversation_id: string;
  user_message_id: string;
  status: AssistantTaskStatus;
  phase: AssistantTaskPhase;
  text: string;
  result: AssistantPlan | null;
  error: string | null;
  attempt: number;
  created_at: string;
  updated_at: string;
  image_progress?: AssistantImageProgress | null;
  approval_history?: import("@/lib/assistant-agent-state").AssistantAgentApprovalHistory;
  agent?: import("@/lib/assistant-agent-runtime").AssistantAgentMetadata;
  execution_steps?: import("@/lib/assistant-execution").AssistantExecutionStep[];
  /** Included on creation or GET by ID with include_input=1; lists stay lightweight. */
  input?: { message: string; display_text: string; display_images: AssistantImage[] };
};

export function assistantTaskActive(task: Pick<AssistantTask, "status">) {
  return task.status === "queued" || task.status === "running";
}

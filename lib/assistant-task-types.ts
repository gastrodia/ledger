import type { AssistantDraftBatch, AssistantPlan, AssistantSavedBatch } from "@/lib/assistant";
import type { AssistantImage } from "@/lib/assistant-images";

export type AssistantTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type AssistantTaskPhase = "thinking" | "images" | "query";

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
  /** Included on creation or GET by ID with include_input=1; lists stay lightweight. */
  input?: { message: string; display_text: string; display_images: AssistantImage[] };
};

export function assistantTaskActive(task: Pick<AssistantTask, "status">) {
  return task.status === "queued" || task.status === "running";
}

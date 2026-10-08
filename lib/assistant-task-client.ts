import { applyDraftMemberUpdate, memberBatchQuestionText, unassignedMemberDrafts, validateAssistantUndo, UUID_PATTERN, type AssistantDraft, type AssistantDraftMemberChoice, type AssistantMember, type AssistantPlan, type AssistantUndo } from "@/lib/assistant";
import { restoreAssistantImages, restoreAssistantImportSummary, type AssistantImage } from "@/lib/assistant-images";
import { sortedAssistantDrafts, type AssistantDraftSort } from "@/lib/assistant-draft-sort";
import { assistantTaskActive, type AssistantTask } from "@/lib/assistant-task-types";

export type EditableAssistantDraft = AssistantDraft & { amount: string; ignored?: boolean };
export type AssistantConversationMessage = {
  id: string; role: "user" | "assistant"; text: string; drafts?: EditableAssistantDraft[];
  status?: "pending" | "saved" | "ignored" | "deleted" | "conflict" | "undone"; commit?: AssistantDraft[]; error?: string;
  savedDrafts?: AssistantDraft[];
  memberFlow?: boolean;
  images?: AssistantImage[];
  image?: AssistantImage;
  importSummary?: AssistantPlan["import_summary"];
  memberChoice?: AssistantDraftMemberChoice;
  undoChoice?: AssistantUndo;
  draftSort?: AssistantDraftSort;
  incomplete?: "stopped" | "interrupted";
  taskId?: string;
  taskStatus?: AssistantTask["status"] | "submitting" | "missing";
  taskAttempt?: number;
  /** Remains set after editing/deleting/moving drafts so recovery cannot replay them. */
  taskApplied?: boolean;
};

export function assistantMemberChoiceTarget(choice: AssistantDraftMemberChoice | undefined, messages: AssistantConversationMessage[]) {
  if (!choice || choice.member_id !== null || !UUID_PATTERN.test(choice.batch_id)
    || !Array.isArray(choice.draft_ids) || !choice.draft_ids.length || choice.draft_ids.length > 20
    || new Set(choice.draft_ids).size !== choice.draft_ids.length || choice.draft_ids.some(id => typeof id !== "string" || !UUID_PATTERN.test(id))) return;
  const message = messages.find(m => m.id === choice.batch_id);
  if (!message || message.role !== "assistant" || message.status !== "pending" || message.commit || !message.drafts?.length) return;
  const drafts = sortedAssistantDrafts(message.drafts, message.draftSort).filter(d => !d.ignored && choice.draft_ids.includes(d.id));
  if (drafts.length !== choice.draft_ids.length || new Set(drafts.map(d => d.id)).size !== drafts.length) return;
  return { message, drafts };
}

const changed = "草稿状态已变化，本次未修改。请核对当前卡片后重试。";

/** Pure, replay-safe recovery. Financial writes always remain explicit UI actions. */
export function mergeAssistantTasks(
  messages: AssistantConversationMessage[], tasks: AssistantTask[], conversationId: string, members: AssistantMember[],
): AssistantConversationMessage[] {
  let next = messages;
  for (const task of tasks) {
    if (task.conversation_id !== conversationId || !UUID_PATTERN.test(task.id) || !UUID_PATTERN.test(task.user_message_id)) continue;
    const user = next.find(message => message.id === task.user_message_id);
    if (!user && !task.input) continue;
    if (!user) next = [...next, { id: task.user_message_id, role: "user", text: task.input!.display_text,
      images: restoreAssistantImages(task.input!.display_images, undefined, true), taskId: task.id, taskStatus: task.status, taskAttempt: task.attempt }];
    const incomplete = task.status === "succeeded" ? undefined : task.status === "cancelled" ? "stopped" : "interrupted";
    const currentUser = user || next[next.length - 1];
    if (currentUser.taskId !== task.id || currentUser.taskStatus !== task.status || currentUser.taskAttempt !== task.attempt
      || currentUser.incomplete !== incomplete || currentUser.error !== undefined) {
      next = next.map(message => message.id === task.user_message_id
        ? { ...message, taskId: task.id, taskStatus: task.status, taskAttempt: task.attempt, incomplete, error: undefined } : message);
    }
    // This flag is persisted on the stable reply, even when its drafts were moved
    // into a later member-selection card or removed by the user.
    const previousReply = next.find(message => message.id === task.id);
    if (previousReply?.taskApplied) continue;
    if (assistantTaskActive(task)) {
      if (previousReply) next = next.filter(message => message.id !== task.id);
      continue;
    }
    let reply: AssistantConversationMessage = { id: task.id, role: "assistant", text: task.text,
      taskId: task.id, taskAttempt: task.attempt, taskStatus: task.status };
    if (task.status !== "succeeded" || !task.result) {
      reply = { ...reply, incomplete: task.status === "cancelled" ? "stopped" : "interrupted",
        error: task.error || (task.status === "cancelled" ? "已停止处理，可以重新识别。" : "处理未完成，请重试原请求。") };
      if (previousReply && previousReply.text === reply.text && previousReply.taskId === reply.taskId
        && previousReply.taskStatus === reply.taskStatus && previousReply.taskAttempt === reply.taskAttempt
        && previousReply.incomplete === reply.incomplete && previousReply.error === reply.error) continue;
    } else {
      const result = task.result;
      reply = { ...reply, text: result.reply, taskApplied: true };
      if (result.action === "undo") {
        const target = next.find(message => message.id === result.undo?.batch_id);
        try {
          const undo = validateAssistantUndo(result.undo, target?.status === "saved" && target.drafts?.length
            ? { batch_id: target.id, status: "saved", drafts: target.drafts } : null);
          reply = { ...reply, text: `已找到要撤销的 ${undo.draft_ids.length} 笔入账，请核对后确认撤销。`, undoChoice: undo };
        } catch { reply.text = "原账单状态已变化，请在交易记录中核对撤销结果。"; }
      } else if (result.action === "update") {
        const update = result.update;
        const target = next.find(message => message.id === update?.batch_id);
        if (!update || !target || target.status !== "pending" || target.commit || !target.drafts?.length) reply.text = changed;
        else if (update.member_id === null) {
          if (assistantMemberChoiceTarget(update, next)) reply.memberChoice = update;
          else reply.text = changed;
        } else {
          try {
            const drafts = applyDraftMemberUpdate(target.drafts, update, members);
            next = next.map(message => message.id === target.id ? { ...message, drafts, error: undefined } : message);
          } catch { reply.text = changed; }
        }
      } else if (result.drafts.length) {
        const unassigned = unassignedMemberDrafts(result.drafts, members);
        reply = { ...reply, text: unassigned.length ? memberBatchQuestionText(unassigned) : result.reply,
          drafts: result.drafts.map(draft => ({ ...draft, amount: (draft.amount_cents / 100).toFixed(2) })), status: "pending", memberFlow: true,
          importSummary: restoreAssistantImportSummary(result.import_summary) };
      }
    }
    const previousIndex = next.findIndex(message => message.id === task.id);
    if (previousIndex !== -1) next = next.map(message => message.id === task.id ? reply : message);
    else {
      const userIndex = next.findIndex(message => message.id === task.user_message_id);
      next = [...next.slice(0, userIndex + 1), reply, ...next.slice(userIndex + 1)];
    }
  }
  return next;
}

export class AssistantTaskRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function assistantTaskJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AssistantTaskRequestError(typeof data.error === "string" ? data.error : "任务状态暂未获取，请重试。", response.status);
  return data as T;
}

// Polls decode fresh JSON objects even when the plan and uploaded input have not
// changed. Compare their values without serializing image data on every poll.
function sameTaskValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameTaskValue(value, right[index]));
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameTaskValue(a[key], b[key]));
}

/** Ignore stale polls and preserve references when the snapshot has not changed. */
export function reconcileAssistantTaskSnapshots(current: AssistantTask[], received: AssistantTask[]) {
  const byId = new Map(current.map(task => [task.id, task]));
  let changed = false;
  for (const task of received) {
    const previous = byId.get(task.id);
    if (previous) {
      if (task.attempt < previous.attempt || (previous.status === "succeeded" && task.status !== "succeeded")) continue;
      if (task.attempt === previous.attempt) {
        if (Date.parse(task.updated_at) < Date.parse(previous.updated_at)) continue;
        if (!assistantTaskActive(previous) && assistantTaskActive(task)) continue;
      }
    }
    const input = task.input || previous?.input;
    const stableInput = previous && sameTaskValue(previous.input, input) ? previous.input : input;
    const result = previous && sameTaskValue(previous.result, task.result) ? previous.result : task.result;
    if (previous && previous.conversation_id === task.conversation_id && previous.user_message_id === task.user_message_id
      && previous.status === task.status && previous.phase === task.phase && previous.text === task.text
      && previous.error === task.error && previous.attempt === task.attempt && previous.created_at === task.created_at
      && previous.updated_at === task.updated_at && previous.result === result && previous.input === stableInput) continue;
    // Heartbeats still advance updated_at so an older response cannot overwrite
    // newer progress, while the unchanged result/input retain their references.
    byId.set(task.id, { ...task, result, ...(stableInput ? { input: stableInput } : {}) });
    changed = true;
  }
  return changed ? [...byId.values()].sort((left, right) => left.created_at.localeCompare(right.created_at)) : current;
}

/** A polling subscription owns only reads; stopping it can never cancel a task. */
export function subscribeAssistantTasks(options: {
  conversationId: string;
  needsInput: (task: AssistantTask) => boolean;
  onTasks: (tasks: AssistantTask[]) => void;
  onError: (error: Error) => void;
  fetch?: typeof fetch;
  activeInterval?: number;
  idleInterval?: number;
}) {
  const request = options.fetch || fetch;
  let stopped = false;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued = false;
  const refresh = async () => {
    if (stopped) return;
    if (controller) { queued = true; return; }
    clearTimeout(timer);
    const activeController = new AbortController();
    controller = activeController;
    let delay = options.activeInterval ?? 1500;
    try {
      const { tasks } = await assistantTaskJson<{ tasks: AssistantTask[] }>(await request(`/api/assistant/tasks?conversation_id=${encodeURIComponent(options.conversationId)}`, {
        cache: "no-store", signal: activeController.signal,
      }));
      if (stopped || activeController.signal.aborted) return;
      if (!Array.isArray(tasks)) throw new Error("任务状态格式无效，请重试。");
      // Lists never carry historical screenshots. Recover an unknown message
      // from its own bounded response; existing local messages need no download.
      const pending = tasks.filter(task => task.conversation_id === options.conversationId && !task.input && options.needsInput(task));
      const withInput = new Map<string, AssistantTask>();
      let index = 0;
      const recover = async () => {
        while (index < pending.length && !activeController.signal.aborted) {
          const missing = pending[index++];
          const { task } = await assistantTaskJson<{ task: AssistantTask }>(await request(`/api/assistant/tasks/${missing.id}?include_input=1`, { cache: "no-store", signal: activeController.signal }));
          withInput.set(task.id, task);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, pending.length) }, recover));
      if (stopped || activeController.signal.aborted) return;
      const recovered = tasks.map(task => withInput.get(task.id) || task);
      options.onTasks(recovered);
      if (!recovered.some(assistantTaskActive)) delay = options.idleInterval ?? 15000;
    } catch (error) {
      if (!stopped && !activeController.signal.aborted) options.onError(error instanceof Error ? error : new Error("连接中断，正在重新获取处理结果。"));
      delay = 5000;
    } finally {
      if (controller === activeController) controller = undefined;
      if (!stopped) {
        const retryImmediately = queued;
        queued = false;
        timer = setTimeout(() => { void refresh(); }, retryImmediately ? 0 : delay);
      }
    }
  };
  void refresh();
  return { refresh: () => { void refresh(); }, stop: () => { stopped = true; clearTimeout(timer); controller?.abort(); } };
}

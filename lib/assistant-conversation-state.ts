import { confirmationRows, UUID_PATTERN, type AssistantDraft } from "@/lib/assistant";
import { assistantCardTarget, reconcileAssistantCardHistory } from "@/lib/assistant-card-updates";
import { assistantDraftSort } from "@/lib/assistant-draft-sort";
import { MAX_ASSISTANT_IMAGE_LENGTH, MAX_ASSISTANT_IMAGES, restoreAssistantImages, restoreAssistantImportSummary, type AssistantImage } from "@/lib/assistant-images";
import { restoreAssistantProcess } from "@/lib/assistant-process";
import { assistantMemberChoiceTarget as memberChoiceTarget, migrateAssistantDraftRemovalPreviews, restoreAssistantAgent, restoreAssistantApprovalHistory, restoreAssistantTaskHistory, type AssistantConversationMessage as Message } from "@/lib/assistant-task-client";
import { restoreAssistantImageProgress, type AssistantTaskRequest } from "@/lib/assistant-task-types";
import { undoRecoverySnapshots, type AssistantUndoRecovery } from "@/lib/assistant-undo";
export type Confirmation = { id: string; drafts: AssistantDraft[]; error?: string };
export type Conversation = { conversationId?: string; messages: Message[]; input: string; images?: AssistantImage[]; image?: AssistantImage | null; confirmations?: Confirmation[]; undos?: AssistantUndoRecovery[]; outbox?: AssistantTaskRequest | null };

export function confirmationSnapshots(value?: Conversation): Confirmation[] {
  const byId = new Map<string, Confirmation>();
  const candidates = [...(Array.isArray(value?.confirmations) ? value.confirmations : []),
  ...(Array.isArray(value?.messages) ? value.messages.filter(m => m?.status === "pending" && m.commit?.length).map(m => ({ id: m.id, drafts: m.commit!, error: m.error })) : [])];
  for (const candidate of candidates) {
    if (!candidate || !UUID_PATTERN.test(candidate.id)) continue;
    try { confirmationRows(candidate.drafts); }
    catch { continue; }
    byId.set(candidate.id, { id: candidate.id, drafts: candidate.drafts, ...(typeof candidate.error === "string" ? { error: candidate.error } : {}) });
  }
  return [...byId.values()];
}

export function restoreAssistantConversation(value: Conversation) {
  const restoredConversationId = typeof value?.conversationId === "string" && UUID_PATTERN.test(value.conversationId) ? value.conversationId : crypto.randomUUID();
  const pendingRequest = value?.outbox;
  const restoredOutbox = pendingRequest && pendingRequest.conversation_id === restoredConversationId && UUID_PATTERN.test(pendingRequest.id)
    && UUID_PATTERN.test(pendingRequest.user_message_id) && typeof pendingRequest.message === "string" && typeof pendingRequest.display_text === "string"
    && typeof pendingRequest.today === "string" && (!pendingRequest.images || (Array.isArray(pendingRequest.images) && pendingRequest.images.length <= MAX_ASSISTANT_IMAGES
      && pendingRequest.images.every(image => typeof image === "string" && image.length <= MAX_ASSISTANT_IMAGE_LENGTH))) ? pendingRequest : null;
  if (!value || !Array.isArray(value.messages) || value.messages.length > 120 || typeof value.input !== "string"
    || value.messages.some(m => {
      if (!m || !UUID_PATTERN.test(m.id) || !["user", "assistant"].includes(m.role) || typeof m.text !== "string" || (m.drafts && !Array.isArray(m.drafts))) return true;
      return m.drafts?.some(d => !d || typeof d.amount !== "string" || typeof d.description !== "string" || typeof d.transaction_date !== "string" || !["income", "expense"].includes(d.type)) || false;
    })) {
    const recovered = confirmationSnapshots(value);
    const recoveredUndos = undoRecoverySnapshots(value?.undos);
    return { invalid: true, conversation: { conversationId: restoredConversationId, messages: [], input: "", images: [], confirmations: recovered, undos: recoveredUndos, outbox: null } };
  }
  const restored: Conversation = {
    conversationId: restoredConversationId, outbox: restoredOutbox, messages: value.messages.map(m => {
      const remaining = m.drafts?.filter(d => !d.ignored);
      if (m.status === "ignored" || (m.status === "pending" && !m.commit && remaining?.length === 0)) {
        return { ...m, status: "deleted" as const, drafts: [], text: "这组草稿已删除，未入账。", error: undefined, image: undefined, images: restoreAssistantImages(m.images, m.image, true), importSummary: restoreAssistantImportSummary(m.importSummary) };
      }
      return { ...m, drafts: remaining, image: undefined, images: restoreAssistantImages(m.images, m.image, true), importSummary: restoreAssistantImportSummary(m.importSummary) };
    }), input: value.input.slice(0, 4000), images: restoreAssistantImages(value.images, value.image), confirmations: confirmationSnapshots(value), undos: undoRecoverySnapshots(value.undos)
  };
  if (restored.messages.at(-1)?.role === "user" && !restored.messages.at(-1)?.taskId && !restored.messages.at(-1)?.localHandled) restored.messages[restored.messages.length - 1].incomplete = "interrupted";
  restored.messages = restored.messages.map(m => ({
    ...m, agent: restoreAssistantAgent(m.agent), ...(m.approvalHistory ? { approvalHistory: restoreAssistantApprovalHistory(m.approvalHistory) } : {}), ...(m.taskHistory ? { taskHistory: restoreAssistantTaskHistory(m.taskHistory) } : {}), process: restoreAssistantProcess(m.process), ...(Object.hasOwn(m, "image_progress") ? { image_progress: restoreAssistantImageProgress(m.image_progress) } : {}), draftSort: assistantDraftSort(m.draftSort), memberChoice: m.role === "assistant" && memberChoiceTarget(m.memberChoice, restored.messages) ? m.memberChoice : undefined,
    cardUpdatedLink: m.role === "assistant" && typeof m.cardUpdatedLink === "string" && UUID_PATTERN.test(m.cardUpdatedLink) && restored.messages.some(target => target.id === m.cardUpdatedLink && target.role === "assistant" && !assistantCardTarget(target)) ? m.cardUpdatedLink : undefined,
    supersededApproval: m.role === "assistant" && m.cardUpdatedLink && m.supersededApproval && UUID_PATTERN.test(m.supersededApproval.id) ? m.supersededApproval : undefined,
    draftCardLink: m.role === "assistant" && typeof m.draftCardLink === "string" && UUID_PATTERN.test(m.draftCardLink) && restored.messages.some(target => target.id === m.draftCardLink && target.role === "assistant" && !assistantCardTarget(target)) ? m.draftCardLink : undefined
  }));
  restored.messages = reconcileAssistantCardHistory(migrateAssistantDraftRemovalPreviews(restored.messages));
  return { invalid: false, conversation: restored };
}

// Session state changes atomically at restore/reset boundaries. The storage shape stays unchanged.
export type AssistantConversationState = {
  conversationId: string | null;
  messages: Message[];
  input: string;
  images: AssistantImage[];
  confirmations: Confirmation[];
  undos: AssistantUndoRecovery[];
  outbox: AssistantTaskRequest | null;
  outboxPersistable: boolean;
};
export const emptyAssistantConversation: AssistantConversationState = {
  conversationId: null, messages: [], input: "", images: [], confirmations: [], undos: [], outbox: null, outboxPersistable: true,
};
type ConversationAction =
  | { type: "restore"; value: Conversation }
  | { type: "clear"; conversationId: string }
  | { type: "logout" }
  | { type: "patch"; value: Partial<AssistantConversationState> }
  | { type: "messages"; value: import("react").SetStateAction<Message[]> }
  | { type: "input"; value: import("react").SetStateAction<string> }
  | { type: "images"; value: import("react").SetStateAction<AssistantImage[]> };

export function assistantConversationReducer(state: AssistantConversationState, action: ConversationAction): AssistantConversationState {
  switch (action.type) {
    case "restore": return {
      conversationId: action.value.conversationId!, messages: action.value.messages, input: action.value.input,
      images: action.value.images || [], confirmations: action.value.confirmations || [], undos: action.value.undos || [], outbox: action.value.outbox || null, outboxPersistable: true
    };
    case "clear": return { ...state, conversationId: action.conversationId, messages: [], input: "", images: [], outbox: null };
    case "logout": return { ...emptyAssistantConversation, outboxPersistable: state.outboxPersistable };
    case "patch": return Object.entries(action.value).every(([key, value]) => Object.is(state[key as keyof AssistantConversationState], value)) ? state : { ...state, ...action.value };
    case "messages": {
      const messages = typeof action.value === "function" ? action.value(state.messages) : action.value;
      return messages === state.messages ? state : { ...state, messages };
    }
    case "input": {
      const input = typeof action.value === "function" ? action.value(state.input) : action.value;
      return input === state.input ? state : { ...state, input };
    }
    case "images": {
      const images = typeof action.value === "function" ? action.value(state.images) : action.value;
      return images === state.images ? state : { ...state, images };
    }
  }
}

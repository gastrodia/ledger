"use client";

import { type AssistantActionPhase } from "@/components/assistant/action-card";
import { useFormDraft } from "@/hooks/use-form-draft";
import { toast } from "@/hooks/use-toast";
import { UUID_PATTERN } from "@/lib/assistant";
import { assistantCardTarget, relocateAssistantCard } from "@/lib/assistant-card-updates";
import { assistantConversationReducer, confirmationSnapshots, emptyAssistantConversation, restoreAssistantConversation, type Confirmation, type Conversation } from "@/lib/assistant-conversation-state";
import { type AssistantImage } from "@/lib/assistant-images";
import { type AssistantConversationMessage as Message } from "@/lib/assistant-task-client";
import { type AssistantTaskRequest } from "@/lib/assistant-task-types";
import { undoRecoverySnapshots, type AssistantUndoRecovery } from "@/lib/assistant-undo";
import { subscribeDraftLogout } from "@/lib/form-drafts";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useReducer, useRef, useState, type SetStateAction } from "react";

import { useAssistantSetup } from "./use-assistant-setup";

export function useAssistantSession(onReset: (kind: "clear" | "logout") => void) {
  const [conversation, dispatchConversation] = useReducer(assistantConversationReducer, emptyAssistantConversation);
  const { messages, conversationId, outbox, outboxPersistable, input, images, confirmations, undos } = conversation;
  const setMessages = (value: SetStateAction<Message[]>) => dispatchConversation({ type: "messages", value });
  const setInput = (value: SetStateAction<string>) => dispatchConversation({ type: "input", value });
  const setImages = (value: SetStateAction<AssistantImage[]>) => dispatchConversation({ type: "images", value });
  const setConversationId = (conversationId: string | null) => dispatchConversation({ type: "patch", value: { conversationId } });
  const setOutbox = (outbox: AssistantTaskRequest | null) => dispatchConversation({ type: "patch", value: { outbox } });
  const setOutboxPersistable = (outboxPersistable: boolean) => dispatchConversation({ type: "patch", value: { outboxPersistable } });
  const setConfirmations = (confirmations: Confirmation[]) => dispatchConversation({ type: "patch", value: { confirmations } });
  const setUndos = (undos: AssistantUndoRecovery[]) => dispatchConversation({ type: "patch", value: { undos } });
  const outboxRef = useRef<AssistantTaskRequest | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const [sending, setSending] = useState(false);
  const [actionPending, setActionPending] = useState<{ id: string; phase: AssistantActionPhase } | null>(null);
  const actionPendingRef = useRef(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const followReplyRef = useRef(true);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const controllersRef = useRef(new Set<AbortController>());
  const conversationControllersRef = useRef(new Set<AbortController>());
  const confirmationsRef = useRef<Confirmation[]>([]);
  const undosRef = useRef<AssistantUndoRecovery[]>([]);
  const conversationEpochRef = useRef(0);
  const liveRef = useRef(true);
  const saveLockRef = useRef(false);
  const sendLockRef = useRef(false);
  const resetModules = useEffectEvent(onReset);
  const persistedConversation = useMemo(() => ({ conversationId: conversationId || undefined, messages, input, images, confirmations, undos, outbox: outboxPersistable ? outbox : null }), [conversationId, messages, input, images, confirmations, undos, outbox, outboxPersistable]);
  const draft = useFormDraft<Conversation>({
    scope: "assistant", autoRestore: true, value: persistedConversation, dirty: !!conversationId || messages.length > 0 || !!input || !!images.length || !!confirmations.length || !!undos.length,
    onRestore: value => {
      const { conversation: restored, invalid } = restoreAssistantConversation(value);
      outboxRef.current = restored.outbox || null;
      confirmationsRef.current = restored.confirmations || [];
      undosRef.current = restored.undos || [];
      dispatchConversation({ type: "restore", value: restored });
      if (invalid) toast.error("本机对话草稿格式无效，请重新输入。");
      return restored;
    },
  });
  const setup = useAssistantSetup(controllersRef);
  const { configured, loadError, resetSetup } = setup;
  useEffect(() => {
    liveRef.current = true;
    const pending = controllersRef.current;
    const revoke = subscribeDraftLogout(() => {
      conversationEpochRef.current++;
      pending.forEach(c => c.abort());
      resetModules("logout");
      outboxRef.current = null; confirmationsRef.current = []; undosRef.current = [];
      dispatchConversation({ type: "logout" });
      resetSetup();
      setSending(false); setSavingId(null);
    });
    return () => {
      liveRef.current = false; revoke(); pending.forEach(c => c.abort());
    };
  }, [resetSetup]);
  const newController = (conversationRequest = true) => {
    const c = new AbortController(); controllersRef.current.add(c);
    if (conversationRequest) conversationControllersRef.current.add(c);
    return c;
  };
  const finishController = (controller: AbortController) => { controllersRef.current.delete(controller); conversationControllersRef.current.delete(controller); };
  const currentConversation = useCallback((epoch: number) => liveRef.current && epoch === conversationEpochRef.current, []);
  const changeConfirmation = (id: string, next?: Confirmation) => {
    confirmationsRef.current = [...confirmationsRef.current.filter(c => c.id !== id), ...(next ? [next] : [])];
    setConfirmations(confirmationsRef.current);
  };
  const changeUndo = (id: string, next?: AssistantUndoRecovery) => {
    undosRef.current = [...undosRef.current.filter(item => item.id !== id), ...(next ? [next] : [])];
    setUndos(undosRef.current);
  };
  const patchMessage = (id: string, update: Partial<Message>) => setMessages(current => {
    const old = current.find(m => m.id === id);
    if (old && assistantCardTarget(old)) return current;
    const next = current.map(m => m.id === id ? { ...m, ...update } : m);
    const changed = ["status", "approval", "eventContext", "actionPreview", "replyView", "actionResult"].some(key => key in update && JSON.stringify(old?.[key as keyof Message]) !== JSON.stringify(update[key as keyof Message]));
    return changed && old ? relocateAssistantCard(next, id, next.at(-1)!.id) : next;
  });
  function clearConversation() {
    const previousId = conversationId;
    const nextId = crypto.randomUUID();
    conversationEpochRef.current++;
    onReset("clear");
    dispatchConversation({ type: "clear", conversationId: nextId });
    outboxRef.current = null;
    if (previousId) void fetch(`/api/assistant/tasks?conversation_id=${encodeURIComponent(previousId)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
    conversationControllersRef.current.forEach(c => c.abort());
    conversationControllersRef.current.clear();
    sendLockRef.current = false; saveLockRef.current = false;
    followReplyRef.current = true;
    setSending(false); setSavingId(null);
    const retained = confirmationsRef.current;
    const retainedUndos = undosRef.current;
    draft.clear(stored => {
      if (stored?.conversationId && stored.conversationId !== previousId && UUID_PATTERN.test(stored.conversationId)) {
        void fetch(`/api/assistant/tasks?conversation_id=${encodeURIComponent(stored.conversationId)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
      }
      return {
        conversationId: nextId, outbox: null, messages: [], input: "", images: [], confirmations: confirmationSnapshots({
          messages: stored?.messages || [], confirmations: [...(stored?.confirmations || []), ...retained], input: "",
        }), undos: undoRecoverySnapshots([...(stored?.undos || []), ...retainedUndos])
      };
    }, true);
  }
  useLayoutEffect(() => { messagesRef.current = messages; }, [messages]);
  const draftChecking = draft.status === "checking";
  useEffect(() => {
    if (conversationId || draftChecking || configured === false && loadError) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled && liveRef.current) setConversationId(crypto.randomUUID()); });
    return () => { cancelled = true; };
  }, [conversationId, draftChecking, configured, loadError]);

  return { ...setup, messages, setMessages, conversationId, setConversationId, outbox, setOutbox, outboxPersistable, setOutboxPersistable, outboxRef, messagesRef, input, setInput, sending, setSending, actionPending, setActionPending, actionPendingRef, savingId, setSavingId, images, setImages, confirmations, setConfirmations, undos, setUndos, feedRef, followReplyRef, composerRef, controllersRef, conversationControllersRef, confirmationsRef, undosRef, conversationEpochRef, liveRef, saveLockRef, sendLockRef, draft, newController, finishController, currentConversation, changeConfirmation, changeUndo, patchMessage, clearConversation };
}
export type AssistantSession = ReturnType<typeof useAssistantSession>;

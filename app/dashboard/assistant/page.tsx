"use client";

import Link from "next/link";
import { AssistantDraftCard, AssistantDraftRow } from "@/components/assistant/draft-card";
import { AssistantReplyShell, AssistantReplyCard, AssistantReplyNotice, assistantChoiceClass } from "@/components/assistant/reply-primitives";
import { draftReplyView, recordReplyView, resultReplyView } from "@/lib/assistant-reply-view";
import { approvalDecision, isActionStatusRequest, type AssistantActionResult } from "@/lib/assistant-commands";
import NextImage from "next/image";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ClipboardEvent } from "react";
import { ArrowLeftRight, ArrowUp, BarChart3, Check, Copy, Gift, ImagePlus, LayoutGrid, Loader2, MessageCircle, Mic, Plus, Search, Square, StickyNote, Trash2, Undo2, Users } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { SortableAssistantImages } from "@/components/assistant/sortable-images";
import { AssistantActionCard, AssistantActionControls, type AssistantActionPhase } from "@/components/assistant/action-card";
import { eventActionPreview, summaryActionPreview, withoutApprovalExpiry } from "@/lib/assistant-action-preview";
import { AssistantMemberLabel, AssistantMemberPicker } from "@/components/assistant/member-picker";
import { eventCashflowCents, eventKinds, eventType, ledgerEventMemberChoices } from "@/lib/ledger-event";
import { AssistantAgentTaskStatus } from "@/components/assistant/agent-task-status";
import { AssistantProcessingDetails } from "@/components/assistant/processing-details";
import { assistantProcessFromTask, restoreAssistantProcess } from "@/lib/assistant-process";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { CategoryIcon } from "@/components/icons/entity-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { markdownTableComponents } from "@/components/ui/markdown-table";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DraftNotice } from "@/components/ui/draft-notice";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useFormDraft } from "@/hooks/use-form-draft";
import { applyDraftMemberUpdate, assignMissingDraftMembers, confirmationRows, memberBatchQuestionText, unassignedMemberDrafts, isCalendarDate, MAX_AMOUNT_CENTS, UUID_PATTERN, type AssistantCategory, type AssistantDraft, type AssistantDraftBatch, type AssistantSavedBatch, type AssistantMember, type AssistantMemberSelection } from "@/lib/assistant";
import { savedDraftSnapshot, undoRecoverySnapshots, validateUndoResult, type AssistantUndoRecovery } from "@/lib/assistant-undo";
import { MAX_AUDIO_SECONDS, recordingToWav } from "@/lib/assistant-audio";
import { startSpeechRecording, type SpeechPhase, type SpeechRecording } from "@/lib/assistant-speech";
import { appendSpeechTranscript } from "@/lib/assistant-speech-transcript";
import { assistantAgentWaiting, assistantAgentActionSettled, resumeAssistantAgentTask, cancelAssistantTaskCheckpoint, restoreAssistantAgent, restoreAssistantApprovalHistory, restoreAssistantTaskHistory, syncSavedTransactionCards, completeAssistantMemberSelection, approveAssistantDraftRemoval, assistantMemberChoiceTarget as memberChoiceTarget, assistantImageProgressText, assistantTaskRetryLabel, assistantTaskJson, AssistantTaskRequestError, mergeAssistantTasks, reconcileAssistantTaskSnapshots, subscribeAssistantTasks, type EditableAssistantDraft as EditableDraft, type AssistantConversationMessage as Message } from "@/lib/assistant-task-client";
import { assistantTaskActive, restoreAssistantImageProgress, type AssistantImageProgress, type AssistantTask, type AssistantTaskRequest } from "@/lib/assistant-task-types";
import { assistantDraftSort, nextAssistantDraftSort, sortedAssistantDrafts } from "@/lib/assistant-draft-sort";
import { appendAssistantImages, clipboardImages, restoreAssistantImages, restoreAssistantImportSummary, prepareAssistantMessageImage, MAX_ASSISTANT_IMAGES, MAX_ASSISTANT_IMAGE_LENGTH, MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH, type AssistantImage } from "@/lib/assistant-images";
import { localCalendarDate } from "@/lib/stats-period";
import { getDraftEpoch, subscribeDraftLogout } from "@/lib/form-drafts";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type StreamingReply = { text: string; phase: AssistantTask["phase"]; image_progress?: AssistantImageProgress | null };
type Confirmation = { id: string; drafts: AssistantDraft[]; error?: string };
type Conversation = { conversationId?: string; messages: Message[]; input: string; images?: AssistantImage[]; image?: AssistantImage | null; confirmations?: Confirmation[]; undos?: AssistantUndoRecovery[]; outbox?: AssistantTaskRequest | null };

function confirmationSnapshots(value?: Conversation): Confirmation[] {
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
const money = (cents: number) => (cents / 100).toFixed(2);
const editDraft = (d: AssistantDraft): EditableDraft => ({ ...d, amount: money(d.amount_cents) });
const buttonClass = "h-auto p-0 whitespace-normal motion-reduce:transition-none";
const iconButtonClass = "[&_svg]:size-5 flex size-10 shrink-0 items-center justify-center rounded-[12px] text-muted-foreground hover:bg-muted";
const fieldLabelClass = "min-w-0 space-y-2 [&_label]:text-xs [&_label]:font-medium [&_label]:text-muted-foreground";
const fieldClass = "min-w-0";
const incompleteFieldClass = "border-destructive bg-destructive/5 hover:border-destructive focus-visible:ring-destructive focus:ring-destructive";
const shortcutButtonClass = "flex min-h-9 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[12px] border border-border bg-card p-2 text-[12px] hover:bg-muted lg:px-3.5 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";
const composerHintClass = "mt-[3px] text-center text-[10px] leading-[14px] text-muted-foreground [&_a]:underline";
const contentWidthClass = "mx-auto w-full max-w-[1064px] px-4 md:px-6 lg:px-8";
const capabilitiesPrompt = "你可以做什么？请介绍你能帮我处理的账本事项，并举几个使用例子。";
const quickTools = [
  { label: "查账单", description: "按时间、成员或分类查收支", icon: Search, prompt: "查询这个月的收支明细，按日期从近到远列出。" },
  { label: "借还查询", description: "看看我欠谁、谁还欠我", icon: ArrowLeftRight, prompt: "帮我查一下还没结清的借还，区分我欠别人的和别人欠我的。" },
  { label: "人情往来", description: "查询送礼、收礼和礼簿", icon: Gift, prompt: "帮我看看这个月的送礼和收礼记录。" },
  { label: "便利贴", description: "查看保存的备忘事项", icon: StickyNote, prompt: "查看我当前未归档的便利贴。" },
  { label: "查重复", description: "找出疑似重复的账目供核对", icon: Copy, prompt: "检查这个月有没有疑似重复的收支记录，列出让我核对，先不要删除。" },
  { label: "成员与分类", description: "查看家庭成员和收支分类", icon: Users, prompt: "查看目前的家庭成员和收支分类。" },
  { label: "你可以做什么", description: "了解能力和提问方式", icon: MessageCircle, prompt: capabilitiesPrompt },
];
const bubbleClass = "text-[14px] leading-[1.75] wrap-anywhere [&_p+p]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li+li]:mt-1 [&_strong]:font-semibold [&_strong]:text-foreground [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-muted [&_pre]:p-3 [&_h2]:mt-2.5 [&_h2]:mb-[5px] [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-2.5 [&_h3]:mb-[5px] [&_h3]:font-semibold [&_h3]:text-foreground [&_a]:text-primary [&_a]:underline [&_table]:border-collapse [&_table]:text-[12px] [&_th]:border-b [&_th]:border-border [&_th]:px-[9px] [&_th]:py-1.5 [&_td]:border-b [&_td]:border-border [&_td]:px-[9px] [&_td]:py-1.5";

type DraftValidationField = "amount" | "category" | "member" | "date";
function invalidDraftFields(draft: EditableDraft, categories: AssistantCategory[], members: AssistantMember[]) {
  return {
    amount: !/^\d{1,10}(\.\d{1,2})?$/.test(draft.amount) || Number(draft.amount) <= 0 || Math.round(Number(draft.amount) * 100) > MAX_AMOUNT_CENTS,
    category: !categories.some(category => category.id === draft.category_id && category.type === draft.type),
    member: !members.some(member => member.id === draft.member_id),
    date: !isCalendarDate(draft.transaction_date),
  };
}

function submittedDrafts(drafts: EditableDraft[]): AssistantDraft[] {
  return drafts.filter(d => !d.ignored).map(d => {
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(d.amount)) throw new Error("请填写大于0、最多两位小数的金额。");
    return { id: d.id, type: d.type, amount_cents: Math.round(Number(d.amount) * 100), category_id: d.category_id, member_id: d.member_id,
      transaction_date: d.transaction_date, description: d.description, payment_method: d.payment_method, note: d.note };
  });
}

async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "服务暂时不可用，请重试。");
  return data;
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<AssistantTaskRequest | null>(null);
  const [outboxPersistable, setOutboxPersistable] = useState(true);
  const [tasks, setTasks] = useState<AssistantTask[]>([]);
  const [tasksReady, setTasksReady] = useState(false);
  const [taskConnectionError, setTaskConnectionError] = useState("");
  const taskSubscription = useRef<ReturnType<typeof subscribeAssistantTasks> | null>(null);
  const submittingTasks = useRef(new Set<string>());
  const resumingAgents = useRef(new Set<string>());
  const outboxRef = useRef<AssistantTaskRequest | null>(null);
  const knownTasks = useRef<AssistantTask[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const [input, setInput] = useState("");
  const [categories, setCategories] = useState<AssistantCategory[]>([]);
  const [members, setMembers] = useState<AssistantMember[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);
  const [reload, setReload] = useState(0);
  const [sending, setSending] = useState(false);
  const [streamingReply, setStreamingReply] = useState<StreamingReply | null>(null);
  const [actionPending, setActionPending] = useState<{ id: string; phase: AssistantActionPhase } | null>(null);
  const actionPendingRef = useRef(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [speechPhase, setSpeechPhase] = useState<SpeechPhase | null>(null);
  const recording = speechPhase === "recording";
  const voiceBusy = speechPhase !== null;
  const [seconds, setSeconds] = useState(0);
  const [images, setImages] = useState<AssistantImage[]>([]);
  const [preparingImage, setPreparingImage] = useState(false);
  const [previewImage, setPreviewImage] = useState<AssistantImage | null>(null);
  const [quickToolsOpen, setQuickToolsOpen] = useState(false);
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [confirmingIds, setConfirmingIds] = useState<string[]>([]);
  const [undos, setUndos] = useState<AssistantUndoRecovery[]>([]);
  const [undoingIds, setUndoingIds] = useState<string[]>([]);
  const [expandedDrafts, setExpandedDrafts] = useState<Record<string, boolean>>({});
  const [validationTarget, setValidationTarget] = useState<{ draftId: string; field: DraftValidationField } | null>(null);
  const feed = useRef<HTMLDivElement>(null);
  const followReply = useRef(true);
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const speech = useRef<SpeechRecording | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const controllers = useRef(new Set<AbortController>());
  const conversationControllers = useRef(new Set<AbortController>());
  const confirmationControllers = useRef(new Map<string, AbortController>());
  const confirmationsRef = useRef<Confirmation[]>([]);
  const undoControllers = useRef(new Map<string, AbortController>());
  const undosRef = useRef<AssistantUndoRecovery[]>([]);
  const conversationEpoch = useRef(0);
  const live = useRef(true);
  const saveLock = useRef(false);
  const sendLock = useRef(false);
  const recordLock = useRef(false);
  const imageSelection = useRef(0);
  const imagePrepareLock = useRef(false);
  const draft = useFormDraft<Conversation>({ scope: "assistant", autoRestore: true, value: { conversationId: conversationId || undefined, messages, input, images, confirmations, undos, outbox: outboxPersistable ? outbox : null }, dirty: !!conversationId || messages.length > 0 || !!input || !!images.length || !!confirmations.length || !!undos.length,
    onRestore: value => {
      const restoredConversationId = typeof value?.conversationId === "string" && UUID_PATTERN.test(value.conversationId) ? value.conversationId : crypto.randomUUID();
      setConversationId(restoredConversationId);
      const pendingRequest = value?.outbox;
      const restoredOutbox = pendingRequest && pendingRequest.conversation_id === restoredConversationId && UUID_PATTERN.test(pendingRequest.id)
        && UUID_PATTERN.test(pendingRequest.user_message_id) && typeof pendingRequest.message === "string" && typeof pendingRequest.display_text === "string"
        && typeof pendingRequest.today === "string" && (!pendingRequest.images || (Array.isArray(pendingRequest.images) && pendingRequest.images.length <= MAX_ASSISTANT_IMAGES
          && pendingRequest.images.every(image => typeof image === "string" && image.length <= MAX_ASSISTANT_IMAGE_LENGTH))) ? pendingRequest : null;
      outboxRef.current = restoredOutbox; setOutbox(restoredOutbox); setOutboxPersistable(true);
      if (!value || !Array.isArray(value.messages) || value.messages.length > 120 || typeof value.input !== "string"
        || value.messages.some(m => {
          if (!m || !UUID_PATTERN.test(m.id) || !["user", "assistant"].includes(m.role) || typeof m.text !== "string" || (m.drafts && !Array.isArray(m.drafts))) return true;
          return m.drafts?.some(d => !d || typeof d.amount !== "string" || typeof d.description !== "string" || typeof d.transaction_date !== "string" || !["income", "expense"].includes(d.type)) || false;
        })) {
        setMessages([]); setInput(""); setImages([]); outboxRef.current = null; setOutbox(null);
        const recovered = confirmationSnapshots(value);
        confirmationsRef.current = recovered; setConfirmations(recovered);
        const recoveredUndos = undoRecoverySnapshots(value?.undos);
        undosRef.current = recoveredUndos; setUndos(recoveredUndos);
        toast.error("本机对话草稿格式无效，请重新输入。"); return { conversationId: restoredConversationId, messages: [], input: "", images: [], confirmations: recovered, undos: recoveredUndos, outbox: null };
      }
      const restored: Conversation = { conversationId: restoredConversationId, outbox: restoredOutbox, messages: value.messages.map(m => {
        const remaining = m.drafts?.filter(d => !d.ignored);
        if (m.status === "ignored" || (m.status === "pending" && !m.commit && remaining?.length === 0)) {
          return { ...m, status: "deleted" as const, drafts: [], text: "这组草稿已删除，未入账。", error: undefined, image: undefined, images: restoreAssistantImages(m.images, m.image, true), importSummary: restoreAssistantImportSummary(m.importSummary) };
        }
        return { ...m, drafts: remaining, image: undefined, images: restoreAssistantImages(m.images, m.image, true), importSummary: restoreAssistantImportSummary(m.importSummary) };
      }), input: value.input.slice(0, 4000), images: restoreAssistantImages(value.images, value.image), confirmations: confirmationSnapshots(value), undos: undoRecoverySnapshots(value.undos) };
      if (restored.messages.at(-1)?.role === "user" && !restored.messages.at(-1)?.taskId && !restored.messages.at(-1)?.localHandled) restored.messages[restored.messages.length - 1].incomplete = "interrupted";
      restored.messages = restored.messages.map(m => ({ ...m, agent: restoreAssistantAgent(m.agent), ...(m.approvalHistory ? { approvalHistory: restoreAssistantApprovalHistory(m.approvalHistory) } : {}), ...(m.taskHistory ? { taskHistory: restoreAssistantTaskHistory(m.taskHistory) } : {}), process: restoreAssistantProcess(m.process), ...(Object.hasOwn(m, "image_progress") ? { image_progress: restoreAssistantImageProgress(m.image_progress) } : {}), draftSort: assistantDraftSort(m.draftSort), memberChoice: m.role === "assistant" && memberChoiceTarget(m.memberChoice, restored.messages) ? m.memberChoice : undefined }));
      setMessages(restored.messages); setInput(restored.input); setImages(restored.images || []);
      confirmationsRef.current = restored.confirmations || []; setConfirmations(confirmationsRef.current);
      undosRef.current = restored.undos || []; setUndos(undosRef.current);
      return restored;
    },
  });

  useEffect(() => {
    const controller = new AbortController();
    const pending = controllers.current;
    pending.add(controller);
    fetch("/api/assistant", { cache: "no-store", signal: controller.signal }).then(responseJson).then(data => {
      if (controller.signal.aborted) return;
      setLoadError(""); setCategories(data.categories); setMembers(data.members); setConfigured(data.configured);
    }).catch(error => { if (!controller.signal.aborted) setLoadError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setIsInitializing(false); });
    return () => { controller.abort(); pending.delete(controller); };
  }, [reload]);

  const reloadSetup = () => {
    setLoadError("");
    setIsInitializing(true);
    setReload(value => value + 1);
  };

  useEffect(() => {
    live.current = true;
    const pending = controllers.current;
    const revoke = subscribeDraftLogout(() => {
      conversationEpoch.current++;
      pending.forEach(c => c.abort());
      speech.current?.cancel(); speech.current = null; recordLock.current = false;
      imageSelection.current++; imagePrepareLock.current = false;
      setMessages([]); setInput(""); setImages([]); setStreamingReply(null);
      taskSubscription.current?.stop(); submittingTasks.current.clear();
      knownTasks.current = []; setTasks([]); setTasksReady(false); setConversationId(null); outboxRef.current = null; setOutbox(null); setTaskConnectionError("");
      setPreviewImage(null); confirmationsRef.current = []; setConfirmations([]); setConfirmingIds([]);
      undosRef.current = []; setUndos([]); setUndoingIds([]);
      setCategories([]); setMembers([]); setConfigured(false); setIsInitializing(false);
      setSpeechPhase(null); setTranscribing(false); setSending(false); setSavingId(null); setPreparingImage(false);
      setLoadError("登录状态已变更，请重新登录后使用助手。");
    });
    return () => {
      live.current = false; revoke(); pending.forEach(c => c.abort());
      speech.current?.cancel(); speech.current = null;
    };
  }, []);
  useEffect(() => { if (voiceBusy && composer.current) composer.current.scrollTop = composer.current.scrollHeight; }, [input, voiceBusy]);

  useEffect(() => {
    if (!validationTarget) return;
    let animation: Animation | undefined;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(`${validationTarget.draftId}-${validationTarget.field}`);
      if (!element || !feed.current?.contains(element)) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: reducedMotion ? "instant" : "smooth" });
      if (!reducedMotion) {
        const color = getComputedStyle(element).getPropertyValue("--color-destructive").trim();
        animation = element.animate([
          { borderColor: color, boxShadow: `0 0 0 2px ${color}` },
          { borderColor: "transparent", boxShadow: "0 0 0 0 transparent" },
          { borderColor: color, boxShadow: `0 0 0 2px ${color}` },
        ], { duration: 700, iterations: 3, easing: "ease-in-out" });
      }
    });
    return () => { cancelAnimationFrame(frame); animation?.cancel(); };
  }, [validationTarget]);

  const activeTask = tasks.find(assistantTaskActive);
  const storedActiveMessage = messages.find(message => message.role === "user" && (message.taskStatus === "queued" || message.taskStatus === "running"));
  const activeTaskId = activeTask?.id || storedActiveMessage?.taskId;
  const taskBusy = !!activeTaskId;
  const recoveringTasks = !!conversationId && !tasksReady;
  const activeImageProgress = streamingReply?.image_progress || (recoveringTasks ? storedActiveMessage?.image_progress : null);
  const imageProgressText = activeImageProgress ? assistantImageProgressText(activeImageProgress,
    recoveringTasks ? "recovering" : activeTask?.status || "running") : null;
  // Keep the new text and its scroll position in the same paint. A passive
  // effect briefly shows the old position on every streamed update.
  useLayoutEffect(() => {
    if (followReply.current) feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "instant" });
  }, [messages.length, sending, taskBusy, recoveringTasks, streamingReply?.text, imageProgressText]);
  const requestBusy = sending || taskBusy || recoveringTasks || transcribing || voiceBusy || preparingImage;
  const busy = requestBusy || !!outbox;
  const unresolved = messages.filter(m => m.status === "pending").reduce((n, m) => n + (m.drafts?.filter(d => !d.ignored).length || 0), 0);
  const newController = (conversationRequest = true) => {
    const c = new AbortController(); controllers.current.add(c);
    if (conversationRequest) conversationControllers.current.add(c);
    return c;
  };
  const finishController = (controller: AbortController) => { controllers.current.delete(controller); conversationControllers.current.delete(controller); };
  const currentConversation = (epoch: number) => live.current && epoch === conversationEpoch.current;
  const changeConfirmation = (id: string, next?: Confirmation) => {
    confirmationsRef.current = [...confirmationsRef.current.filter(c => c.id !== id), ...(next ? [next] : [])];
    setConfirmations(confirmationsRef.current);
  };
  const changeUndo = (id: string, next?: AssistantUndoRecovery) => {
    undosRef.current = [...undosRef.current.filter(item => item.id !== id), ...(next ? [next] : [])];
    setUndos(undosRef.current);
  };
  const patchMessage = (id: string, update: Partial<Message>) => setMessages(current => current.map(m => m.id === id ? { ...m, ...update } : m));

  function clearConversation() {
    const previousId = conversationId;
    const nextId = crypto.randomUUID();
    conversationEpoch.current++;
    taskSubscription.current?.stop(); submittingTasks.current.clear();
    setConversationId(nextId); knownTasks.current = []; setTasks([]); setTasksReady(false); setTaskConnectionError("");
    outboxRef.current = null; setOutbox(null);
    if (previousId) void fetch(`/api/assistant/tasks?conversation_id=${encodeURIComponent(previousId)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
    conversationControllers.current.forEach(c => c.abort());
    conversationControllers.current.clear();
    sendLock.current = false; saveLock.current = false; recordLock.current = false;
    speech.current?.cancel(); speech.current = null;
    imageSelection.current++; imagePrepareLock.current = false;
    setMessages([]); setInput(""); setImages([]); setPreviewImage(null); setExpandedDrafts({});
    setStreamingReply(null); followReply.current = true;
    setSending(false); setSavingId(null); setTranscribing(false); setSpeechPhase(null); setPreparingImage(false); setSeconds(0);
    const retained = confirmationsRef.current;
    const retainedUndos = undosRef.current;
    draft.clear(stored => {
      if (stored?.conversationId && stored.conversationId !== previousId && UUID_PATTERN.test(stored.conversationId)) {
        void fetch(`/api/assistant/tasks?conversation_id=${encodeURIComponent(stored.conversationId)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
      }
      return { conversationId: nextId, outbox: null, messages: [], input: "", images: [], confirmations: confirmationSnapshots({
        messages: stored?.messages || [], confirmations: [...(stored?.confirmations || []), ...retained], input: "",
      }), undos: undoRecoverySnapshots([...(stored?.undos || []), ...retainedUndos]) };
    }, true);
  }

  function acceptTasks(received: AssistantTask[], completeSnapshot = false) {
    if (!conversationId) return;
    const valid = reconcileAssistantTaskSnapshots(knownTasks.current, received.filter(task => task.conversation_id === conversationId));
    knownTasks.current = valid;
    setTasks(valid);
    setMessages(current => {
      const merged = mergeAssistantTasks(current, valid, conversationId, members, categories);
      if (!completeSnapshot) return merged;
      const recovered = merged.map(message => message.role === "user" && message.taskId && !valid.some(task => task.id === message.taskId)
        && !submittingTasks.current.has(message.taskId) && !merged.some(reply => reply.id === message.taskId && reply.taskApplied)
        && message.taskStatus !== "missing"
        ? { ...message, taskStatus: "missing" as const, incomplete: "interrupted" as const, error: "消息未发送完成，请重试发送。" } : message);
      return recovered.some((message, index) => message !== merged[index]) ? recovered : merged;
    });
    const pending = valid.find(assistantTaskActive);
    setStreamingReply(current => pending
      ? current?.text === pending.text && current.phase === pending.phase && current.image_progress === pending.image_progress
        ? current : { text: pending.text, phase: pending.phase, image_progress: pending.image_progress }
      : null);
    if (outboxRef.current && valid.some(task => task.id === outboxRef.current!.id)) { outboxRef.current = null; setOutbox(null); }
    setTaskConnectionError(""); setTasksReady(true);
  }

  const handleTaskSnapshot = useEffectEvent((snapshot: AssistantTask[]) => acceptTasks(snapshot, true));
  const handleTaskError = useEffectEvent((error: Error) => {
    setTasksReady(true);
    setTaskConnectionError(error instanceof AssistantTaskRequestError && error.status === 401
      ? "登录状态已失效，请重新登录后恢复结果。" : "暂时无法获取处理进度，正在重新连接。已提交的任务会继续处理。");
    setMessages(current => current.map(message => message.taskStatus === "submitting" && !submittingTasks.current.has(message.taskId || "")
      ? { ...message, taskStatus: "missing", error: "发送结果暂未确认，重试会先核对原任务。" } : message));
  });
  const draftChecking = draft.status === "checking";
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => {
    if (conversationId || draftChecking || configured === false && loadError) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled && live.current) setConversationId(crypto.randomUUID()); });
    return () => { cancelled = true; };
  }, [conversationId, draftChecking, configured, loadError]);
  useEffect(() => {
    if (!conversationId || draftChecking || isInitializing || loadError) return;
    const epoch = conversationEpoch.current;
    const subscription = subscribeAssistantTasks({ conversationId,
      needsInput: task => !messagesRef.current.some(message => message.id === task.user_message_id),
      onTasks: snapshot => { if (currentConversation(epoch)) handleTaskSnapshot(snapshot); },
      onError: error => { if (currentConversation(epoch)) handleTaskError(error); },
    });
    taskSubscription.current = subscription;
    const refresh = () => { if (document.visibilityState !== "hidden") subscription.refresh(); };
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh); document.addEventListener("visibilitychange", refresh);
    return () => {
      subscription.stop();
      if (taskSubscription.current === subscription) taskSubscription.current = null;
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh);
    };
  }, [conversationId, draftChecking, isInitializing, loadError]);

  async function submitTask(request: AssistantTaskRequest) {
    if (!conversationId || request.conversation_id !== conversationId) return;
    const epoch = conversationEpoch.current;
    const controller = newController();
    submittingTasks.current.add(request.id);
    sendLock.current = true; followReply.current = true; setSending(true);
    try {
      const { task } = await assistantTaskJson<{ task: AssistantTask }>(await fetch("/api/assistant/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify(request),
      }));
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      acceptTasks([task]);
    } catch (error) {
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      // A lost acknowledgement must be reconciled before another submission.
      try {
        const { task } = await assistantTaskJson<{ task: AssistantTask }>(await fetch(`/api/assistant/tasks/${request.id}`, { cache: "no-store", signal: controller.signal }));
        if (!currentConversation(epoch) || controller.signal.aborted) return;
        acceptTasks([task]);
      } catch (lookupError) {
        if (!currentConversation(epoch) || controller.signal.aborted) return;
        const missing = lookupError instanceof AssistantTaskRequestError && lookupError.status === 404;
        patchMessage(request.user_message_id, { taskStatus: "missing", incomplete: "interrupted", error: missing
          ? error instanceof Error ? error.message : "消息未发送完成，请重试发送。"
          : "发送结果暂未确认，重试会先核对原任务。" });
      }
    } finally {
      submittingTasks.current.delete(request.id); finishController(controller);
      if (currentConversation(epoch)) { sendLock.current = false; setSending(false); taskSubscription.current?.refresh(); }
    }
  }

  async function continueAgentCheckpoint(task: AssistantTask, settled?: AssistantActionResult) {
    const agent = restoreAssistantAgent(task.agent || task.result?.agent);
    if (!assistantAgentWaiting(task) || !agent) return;
    const key = `${task.id}:${task.attempt}:${agent.pending_action_id || agent.pending_batch_id}`;
    if (resumingAgents.current.has(key)) return;
    resumingAgents.current.add(key);
    const epoch = conversationEpoch.current;
    const controller = newController();
    let dispatched = false;
    try {
      if (agent.pending_batch_id) {
        const { task: resumed } = await resumeAssistantAgentTask(task, fetch, controller.signal);
        if (!currentConversation(epoch) || controller.signal.aborted) return;
        dispatched = resumed.attempt > task.attempt || !assistantAgentWaiting(resumed);
        acceptTasks([resumed]);
        return;
      }
      const result = settled || await responseJson(await fetch(`/api/assistant/actions/${agent.pending_action_id}`, { cache: "no-store", signal: controller.signal })) as AssistantActionResult;
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      if (result.id !== agent.pending_action_id || (!assistantAgentActionSettled(result) && !result.replacement_approval)) return;
      patchMessage(task.id, result.replacement_approval
        ? { approval: result.replacement_approval, actionResult: { ...result, status: "pending" }, actionPreview: result.replacement_approval.preview, text: result.replacement_approval.summary, error: undefined }
        : { actionResult: result, actionPreview: result.preview || task.result?.approval?.preview, approval: undefined, error: undefined });
      // The server verifies the stored action outcome before continuing this ID.
      const { task: resumed } = await resumeAssistantAgentTask(task, fetch, controller.signal);
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      dispatched = resumed.attempt > task.attempt || !assistantAgentWaiting(resumed)
        || restoreAssistantAgent(resumed.agent || resumed.result?.agent)?.pending_action_id !== agent.pending_action_id;
      acceptTasks([resumed]);
    } catch (error) {
      if (currentConversation(epoch) && !controller.signal.aborted) patchMessage(task.id, { error: error instanceof Error ? error.message : "任务暂未继续，正在核对原操作结果。" });
    } finally {
      resumingAgents.current.delete(key); finishController(controller);
      if (dispatched && currentConversation(epoch)) taskSubscription.current?.refresh();
    }
  }

  const recoverAgentCheckpoints = useEffectEvent(() => {
    if (saveLock.current || sendLock.current || actionPendingRef.current) return;
    for (const task of knownTasks.current.filter(assistantAgentWaiting)) void continueAgentCheckpoint(task);
  });
  useEffect(() => { recoverAgentCheckpoints(); }, [tasks]);

  async function decideConversationAction(message: Message, decision: "approve" | "cancel", read = false, userReply?: Message) {
    if (actionPendingRef.current || saveLock.current || sendLock.current || busy) return;
    actionPendingRef.current = true;
    setActionPending({ id: message.id, phase: read ? "read" : decision });
    patchMessage(message.id, { error: undefined });
    try { await performConversationAction(message, decision, read, userReply); }
    finally { actionPendingRef.current = false; if (live.current) setActionPending(null); }
  }

  async function performConversationAction(message: Message, decision: "approve" | "cancel", read = false, userReply?: Message) {
    if (saveLock.current || sendLock.current || busy) return;
    if (message.approval || (read && message.actionResult)) {
      const epoch = conversationEpoch.current;
      saveLock.current = true; setSavingId(message.id);
      try {
        const response = await fetch(`/api/assistant/actions/${message.approval?.id || message.actionResult!.id}`, read ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
        const result: AssistantActionResult = await responseJson(response);
        if (!currentConversation(epoch)) return;
        const summary = message.approval?.summary.replace(/\n尚未执行。[\s\S]*$/, "");
        patchMessage(message.id, { error: undefined, actionPreview: result.preview || message.actionPreview || message.approval?.preview || (message.eventContext ? eventActionPreview(message.eventContext.input, message.approval?.summary || message.text) : summaryActionPreview(message.approval?.summary || message.text)), text: result.status === "pending" && message.approval ? message.approval.summary : summary ? `${summary}\n\n${result.text}` : result.text, actionResult: result, ...(result.event_context ? { eventContext: result.event_context, eventChoices: undefined } : {}),
          ...(["succeeded", "failed", "cancelled", "expired"].includes(result.status) ? { approval: undefined } : {}) });
        if (result.transaction_updates?.length) setMessages(current => syncSavedTransactionCards(current, result.transaction_updates!));
        if (result.replacement_approval) patchMessage(message.id, { approval: result.replacement_approval, actionPreview: result.replacement_approval.preview,
          actionResult: { ...result, status: "pending" }, text: result.replacement_approval.summary, error: undefined });
        if (result.status === "succeeded") reloadSetup();
        const agentTask = knownTasks.current.find(task => task.id === message.taskId && assistantAgentWaiting(task));
        if (agentTask && (assistantAgentActionSettled(result) || result.replacement_approval)) await continueAgentCheckpoint(agentTask, result);
      } catch (error) { if (currentConversation(epoch)) patchMessage(message.id, { error: error instanceof Error ? error.message : "结果待核对，请查询操作状态。" }); }
      finally { saveLock.current = false; if (currentConversation(epoch)) setSavingId(null); }
      return;
    }
    if (decision === "cancel") {
      patchMessage(message.id, { confirmChoice: undefined, removeChoice: undefined, clearChoice: undefined, undoChoice: undefined, replyKind: "result", text: "已取消本次操作，未执行。" }); return;
    }
    if (message.removeChoice) {
      setMessages(current => approveAssistantDraftRemoval(current, message.id, members)); return;
    }
    if (message.clearChoice) { clearConversation(); return; }
    if (message.undoChoice) {
      const target = messages.find(m => m.id === message.undoChoice!.batch_id);
      const saved = await undoSaved(target, message.undoChoice.draft_ids);
      patchMessage(message.id, { undoChoice: undefined, replyKind: "result", text: saved ? "已撤销入账，并恢复为待确认草稿。" : "请查看原账单卡片核对撤销结果。" }); return;
    }
    if (message.confirmChoice) {
      const choice = message.confirmChoice;
      const target = messages.find(m => m.id === choice.batch_id);
      const selected = target?.drafts?.filter(d => choice.draft_ids.includes(d.id)) || [];
      if (!target || target.status !== "pending" || target.commit || JSON.stringify(selected) !== choice.snapshot) {
        patchMessage(message.id, { confirmChoice: undefined, text: "草稿在确认期间已变化，未入账。请重新核对并发起确认。" }); return;
      }
      try { confirmationRows(submittedDrafts(selected)); } catch (error) {
        patchMessage(message.id, { confirmChoice: undefined, text: error instanceof Error ? error.message : "请先补全草稿。" }); return;
      }
      const remaining = target.drafts!.filter(d => !choice.draft_ids.includes(d.id));
      const agentBatch = knownTasks.current.some(task => assistantAgentWaiting(task) && restoreAssistantAgent(task.agent || task.result?.agent)?.pending_batch_id === target.id);
      const batch: Message = remaining.length ? { ...target, id: agentBatch ? target.id : crypto.randomUUID(), drafts: selected,
        ...(agentBatch ? {} : { taskId: undefined }), taskApplied: true } : target;
      const remainder: Message | undefined = remaining.length && agentBatch ? { ...target, id: crypto.randomUUID(), drafts: remaining,
        agent: undefined, taskId: undefined, taskHistory: undefined, approvalHistory: undefined, text: "其余草稿仍待核对，尚未入账。" } : undefined;
      // Persist the exact subset before posting, preserving all unselected rows.
      const changed = messages.map(m => m.id === message.id ? { ...m, confirmChoice: undefined, text: "正在核对入账结果。" }
        : remaining.length && m.id === target.id ? agentBatch ? batch : { ...m, drafts: remaining } : m);
      const updated = [...(remainder ? [...changed, remainder] : remaining.length ? [...changed, batch] : changed), ...(userReply ? [userReply] : [])];
      if (!draft.persist({ conversationId: conversationId || undefined, messages: updated, input: "", images, confirmations, undos, outbox })) {
        patchMessage(message.id, { text: "无法保存本机操作记录，本次尚未入账，请稍后重试。" }); return;
      }
      setMessages(updated);
      const saved = await confirm(batch);
      patchMessage(message.id, { confirmChoice: undefined, replyKind: "result", text: saved ? `已将 ${selected.length} 笔草稿记入账本。` : "入账未确认，请查看原卡片的提示并核对结果。" });
    }
  }

  function downloadExport(message: Message) {
    if (!message.exportFile) return;
    const url = URL.createObjectURL(new Blob([message.exportFile.csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = message.exportFile.name; link.click(); URL.revokeObjectURL(url);
  }

  async function send(override?: string, eventSelection?: import("@/lib/ledger-event").LedgerEventInput) {
    const originalInput = override ?? input;
    const sentImages = override ? [] : images;
    const text = originalInput.trim() || (sentImages.length ? "请按图片顺序识别截图里的收支，衔接重叠账目，生成待确认账单。" : "");
    if (!text || actionPendingRef.current || busy || outboxRef.current || sendLock.current || saveLock.current || draft.hasDraft || draft.status === "checking" || configured === null || !conversationId) return;
    const pendingApprovals = messages.filter(m => m.approval || m.confirmChoice || m.removeChoice || m.clearChoice || m.undoChoice);
    const pendingApproval = pendingApprovals.at(-1);
    // A reviewed draft operation and its source card represent one choice.
    const reviewedBatches = new Set(pendingApprovals.flatMap(m => m.confirmChoice ? [m.confirmChoice.batch_id] : m.removeChoice ? [m.removeChoice.batch_id] : []));
    const pendingDrafts = messages.filter(m => m.status === "pending" && !m.commit && m.drafts?.some(d => !d.ignored) && !reviewedBatches.has(m.id));
    const pendingCount = pendingApprovals.length + pendingDrafts.length;
    if (!sentImages.length && isActionStatusRequest(text)) {
      if (pendingApprovals.filter(m => m.approval).length > 1) {
        setInput("");
        setMessages(current => [...current, { id: crypto.randomUUID(), role: "user", text, localHandled: true }, { id: crypto.randomUUID(), role: "assistant", text: "当前有多个待确认方案，请在对应卡片上核对执行状态。" }]);
        return;
      }
      const action = [...messages].reverse().find(m => m.approval || m.actionResult);
      setInput("");
      if (action) await decideConversationAction(action, "approve", true);
      else setMessages(current => [...current, { id: crypto.randomUUID(), role: "assistant", text: "当前没有已提交的管理操作。入账或撤销结果请查看对应账单卡片。" }]);
      return;
    }
    const decision = !sentImages.length ? approvalDecision(text, !!pendingApproval || pendingCount > 1) : null;
    if (decision && pendingCount > 1) {
      setInput("");
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "user", text, localHandled: true }, { id: crypto.randomUUID(), role: "assistant", text: "当前有多个待处理方案或账单，请在要操作的卡片上点击确认或取消；本次未执行任何操作。" }]);
      return;
    }
    if (pendingApproval && decision) {
      setInput("");
      const userReply: Message = { id: crypto.randomUUID(), role: "user", text, localHandled: true };
      setMessages(current => [...current, userReply]);
      await decideConversationAction(pendingApproval, decision, false, userReply);
      return;
    }
    if (decision === "approve" && !pendingApproval && text !== "确认入账") {
      setInput("");
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "user", text }, { id: crypto.randomUUID(), role: "assistant", text: "当前没有待批准的操作。请先说明要确认入账、修改或删除哪些记录。" }]);
      return;
    }
    if (configured === false) { toast.error("请先在服务端配置百炼 API Key。"); return; }
    if (messages.length >= 78) { toast.info("当前对话已较长，请先确认待处理账单，再清空对话。"); return; }
    const latestBatch = [...messages].reverse().find(m => m.drafts?.length);
    const draftBatch: AssistantDraftBatch | null = latestBatch?.status === "pending" && !latestBatch.commit
      ? { batch_id: latestBatch.id, status: "pending", drafts: sortedAssistantDrafts(latestBatch.drafts!, latestBatch.draftSort).filter(d => !d.ignored).map(d => ({ id: d.id, type: d.type, description: d.description, member_id: d.member_id, category_id: d.category_id, amount_cents: Math.round(Number(d.amount) * 100), transaction_date: d.transaction_date, payment_method: d.payment_method, note: d.note })) } : null;
    const savedBatch: AssistantSavedBatch | null = latestBatch?.status === "saved"
      ? { batch_id: latestBatch.id, status: "saved", drafts: sortedAssistantDrafts(latestBatch.drafts!, latestBatch.draftSort).filter(d => !d.ignored).map(d => ({ id: d.id, type: d.type, description: d.description, member_id: d.member_id, category_id: d.category_id, amount_cents: Math.round(Number(d.amount) * 100), transaction_date: d.transaction_date, payment_method: d.payment_method, note: d.note })) } : null;
    const epoch = conversationEpoch.current;
    sendLock.current = true; setSending(true);
    try {
      // Waiting proposals require an explicit decision on their own cards.
      // Sending another request must not cancel those unrelated operations.
      const previews = sentImages.length ? await Promise.all(sentImages.map(image => prepareAssistantMessageImage(image, Math.floor(MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH / sentImages.length)))) : [];
      if (!currentConversation(epoch)) return;
      const id = crypto.randomUUID();
      const userMessage: Message = { id: crypto.randomUUID(), role: "user", incomplete: "interrupted", taskId: id, taskStatus: "submitting",
        text: originalInput.trim() ? text : sentImages.length ? `识别这 ${sentImages.length} 张截图` : text, images: previews };
      const request: AssistantTaskRequest = { id, conversation_id: conversationId, user_message_id: userMessage.id, message: text,
        display_text: userMessage.text, display_images: previews, ...(sentImages.length ? { images: sentImages.map(image => image.data) } : {}), today: localCalendarDate(), draft_batch: draftBatch, saved_batch: savedBatch,
        ...(eventSelection ? { event_selection: eventSelection } : {}),
        ...([...messages].reverse().find(m => m.eventContext)?.eventContext ? { event_context: [...messages].reverse().find(m => m.eventContext)!.eventContext } : {}),
        record_contexts: messages.flatMap(m => [...(m.taskHistory || []).flatMap(output => output.ledgerContext ? [output.ledgerContext] : []), ...(m.ledgerContext ? [m.ledgerContext] : [])]).slice(-3),
        history: messages.filter(m => !m.incomplete).slice(-8).map(m => ({ role: m.role, content: m.drafts
          ? `${m.text.slice(0, 500)}\n卡片当前状态：${m.status === "saved" ? "已保存" : m.status === "deleted" ? "已删除，未入账" : m.status === "conflict" ? "保存冲突待核对" : "待确认"}。以下是用户核对编辑后的账单，以此为准，不要重复生成：\n${JSON.stringify(sortedAssistantDrafts(m.drafts, m.draftSort).map(d => ({ type: d.type, amount_cents: Math.round(Number(d.amount) * 100), date: d.transaction_date, description: d.description.slice(0, 40) })))}`.slice(0, 4000)
          : m.text.slice(0, 4000) })) };
      const nextMessages = [...messages.map(message => ({ ...message, memberChoice: undefined, eventChoices: undefined })), userMessage];
      // Persist stable identifiers and the original upload before dispatch. The
      // outbox is dropped only after the server has acknowledged this exact ID.
      const snapshot: Conversation = { conversationId, messages: nextMessages, input: "", images: [], confirmations: confirmationsRef.current, undos: undosRef.current, outbox: request };
      const persisted = draft.persist(snapshot);
      if (!persisted && !draft.persist({ ...snapshot, outbox: null })) {
        toast.error("本机对话暂时无法保存；本次尚未发送，输入和截图仍保留在当前页面，请稍后重试。");
        return;
      }
      outboxRef.current = request; setOutbox(request); setOutboxPersistable(persisted); setMessages(nextMessages); setInput(""); setImages([]);
      if (!persisted) toast.info("原截图暂未保存在本机，请等待发送完成后再离开；服务器接收后可用原图重试。");
      await submitTask(request);
    } catch (error) {
      if (currentConversation(epoch)) { toast.error(error instanceof Error ? error.message : "截图准备失败，请重试。"); setInput(originalInput); setImages(sentImages); }
    } finally { if (currentConversation(epoch)) { sendLock.current = false; setSending(false); } }
  }

  async function retryTask(message: Message) {
    if (requestBusy || sendLock.current || saveLock.current || !conversationId) return;
    const taskId = message.taskId;
    if (!taskId) {
      const source = message.role === "user" ? message : [...messages.slice(0, messages.findIndex(item => item.id === message.id))].reverse().find(item => item.role === "user");
      if (!source) return;
      setInput(source.text); setImages(source.images || []); composer.current?.focus();
      if (source.images?.length) toast.info("已恢复截图预览，请核对清晰度后重新发送；可重新选择原图。");
      return;
    }
    const epoch = conversationEpoch.current;
    const controller = newController();
    sendLock.current = true; setSending(true);
    try {
      let task: AssistantTask;
      try {
        ({ task } = await assistantTaskJson<{ task: AssistantTask }>(await fetch(`/api/assistant/tasks/${taskId}`, { cache: "no-store", signal: controller.signal })));
      } catch (error) {
        if (!(error instanceof AssistantTaskRequestError) || error.status !== 404) throw error;
        const request = outboxRef.current;
        if (request?.id !== taskId) throw new Error("原请求已不可恢复，请重新选择原截图或重新输入后发送。");
        if (!currentConversation(epoch) || controller.signal.aborted) return;
        await submitTask(request);
        return;
      }
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      if (task.status === "failed" || task.status === "cancelled") {
        ({ task } = await assistantTaskJson<{ task: AssistantTask }>(await fetch(`/api/assistant/tasks/${taskId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "retry", attempt: task.attempt }),
        })));
      }
      if (currentConversation(epoch) && !controller.signal.aborted) acceptTasks([task]);
    } catch (error) { if (currentConversation(epoch) && !controller.signal.aborted) toast.error(error instanceof Error ? error.message : "重试失败，请稍后再试。"); }
    finally { finishController(controller); if (currentConversation(epoch)) { sendLock.current = false; setSending(false); taskSubscription.current?.refresh(); } }
  }

  async function stopTask(taskId = activeTaskId) {
    if (!taskId || !conversationId || sendLock.current || saveLock.current) return;
    const epoch = conversationEpoch.current;
    const controller = newController();
    try {
      const current = knownTasks.current.find(task => task.id === taskId) || (await assistantTaskJson<{ task: AssistantTask }>(await fetch(`/api/assistant/tasks/${taskId}`, { cache: "no-store", signal: controller.signal }))).task;
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      const { task } = await cancelAssistantTaskCheckpoint(current, fetch, controller.signal);
      if (currentConversation(epoch) && !controller.signal.aborted) acceptTasks([task]);
    } catch (error) { if (currentConversation(epoch) && !controller.signal.aborted) toast.error(error instanceof Error ? error.message : "停止失败，请重试。"); }
    finally { finishController(controller); }
  }

  async function chooseMember(message: Message, member: AssistantMember) {
    if (busy || sendLock.current || saveLock.current || draft.hasDraft || draft.status === "checking" || message.status !== "pending" || message.commit) return;
    const unassigned = unassignedMemberDrafts(message.drafts || [], members);
    const memberDraft = unassigned[0];
    if (!memberDraft) return;
    try { assignMissingDraftMembers(message.drafts || [], member.id, members); }
    catch (error) { toast.error(error instanceof Error ? error.message : "成员选择无效。"); return; }
    sendLock.current = true; followReply.current = true; setSending(true);
    const epoch = conversationEpoch.current;
    const controller = newController();
    const memberLabel = unassigned.every(d => d.type === "expense") ? "支出人" : unassigned.every(d => d.type === "income") ? "收入所属人" : "所属成员";
    const answer: Message = { id: crypto.randomUUID(), role: "user", text: `${unassigned.length > 1 ? `这 ${unassigned.length} 笔账目` : memberDraft.description.slice(0, 80) || "这笔账"}：${memberLabel}是「${member.name}」` };
    setMessages(current => [...current, answer]);
    try {
      const result: AssistantMemberSelection = await responseJson(await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ operation: "select_member", draft_id: memberDraft.id, member_id: member.id }) }));
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      if (result.draft_id !== memberDraft.id || result.member?.id !== member.id) throw new Error("成员选择结果无效，请重试。");
      const questionId = crypto.randomUUID();
      setMessages(current => completeAssistantMemberSelection(current, message.id, member, members, answer.id, questionId));
    } catch (error) {
      if (!controller.signal.aborted && currentConversation(epoch)) {
        toast.error(error instanceof Error ? error.message : "发送选择失败，请重试。");
        setMessages(current => current.filter(m => m.id !== answer.id));
      }
    } finally { finishController(controller); if (currentConversation(epoch)) { sendLock.current = false; setSending(false); } }
  }

  async function selectReplacementMember(question: Message, member: AssistantMember) {
    if (busy || sendLock.current || saveLock.current || draft.hasDraft || draft.status === "checking") return;
    const choice = question.memberChoice;
    const target = memberChoiceTarget(choice, messages);
    if (!choice || !target) { toast.error("待修改的账目已变化，请重新选择。"); return; }
    const update = { ...choice, member_id: member.id };
    try { applyDraftMemberUpdate(target.message.drafts!, update, members); }
    catch (error) { toast.error(error instanceof Error ? error.message : "成员选择无效。"); return; }
    sendLock.current = true; followReply.current = true; setSending(true);
    const epoch = conversationEpoch.current;
    const controller = newController();
    const label = target.drafts.every(d => d.type === "expense") ? "支出人" : "所属成员";
    const answer: Message = { id: crypto.randomUUID(), role: "user", text: `将这 ${target.drafts.length} 笔账目的${label}改为「${member.name}」` };
    setMessages(current => [...current, answer]);
    try {
      const result: AssistantMemberSelection = await responseJson(await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ operation: "select_member", draft_id: target.drafts[0].id, member_id: member.id }) }));
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      if (result.draft_id !== target.drafts[0].id || result.member?.id !== member.id) throw new Error("成员选择结果无效，请重试。");
      const reply: Message = { id: crypto.randomUUID(), role: "assistant", text: `已将这 ${target.drafts.length} 笔账目的${label}改为「${result.member.name}」，请核对后确认入账。` };
      setMessages(current => {
        const active = current.find(m => m.id === question.id);
        const latest = active?.memberChoice && memberChoiceTarget(active.memberChoice, current);
        if (!latest || active.memberChoice!.batch_id !== choice.batch_id || active.memberChoice!.draft_ids.length !== choice.draft_ids.length
          || choice.draft_ids.some(id => !active.memberChoice!.draft_ids.includes(id))) {
          return [...current, { ...reply, text: "草稿状态已变化，本次未修改。请核对当前卡片后重试。" }];
        }
        let updated: EditableDraft[];
        try { updated = applyDraftMemberUpdate(latest.message.drafts!, update, members); }
        catch { return [...current, { ...reply, text: "待修改的账目已变化，本次未修改。请核对当前卡片后重试。" }]; }
        return [...current.map(m => m.id === latest.message.id ? { ...m, drafts: updated, error: undefined } : m.id === question.id ? { ...m, memberChoice: undefined } : m), reply];
      });
    } catch (error) {
      if (!controller.signal.aborted && currentConversation(epoch)) {
        toast.error(error instanceof Error ? error.message : "成员修改失败，请重试。");
        setMessages(current => current.filter(m => m.id !== answer.id));
      }
    } finally { finishController(controller); if (currentConversation(epoch)) { sendLock.current = false; setSending(false); } }
  }

  function revealInvalidDraft(message: Message, error: string) {
    if (message.commit) return;
    const preferred: DraftValidationField | undefined = error.includes("金额") ? "amount" : error.includes("分类") ? "category" : error.includes("成员") ? "member" : error.includes("日期") ? "date" : undefined;
    const drafts = sortedAssistantDrafts(message.drafts || [], message.draftSort).filter(d => !d.ignored);
    for (const d of drafts) {
      const invalid = invalidDraftFields(d, categories, members);
      const field = preferred ? (invalid[preferred] ? preferred : undefined) : (Object.keys(invalid) as DraftValidationField[]).find(key => invalid[key]);
      if (!field) continue;
      setExpandedDrafts(current => ({ ...current, [d.id]: true }));
      setValidationTarget({ draftId: d.id, field });
      return;
    }
  }

  async function confirm(message: Message) {
    if (saveLock.current || busy || confirmationControllers.current.has(message.id)) return;
    let submitted: AssistantDraft[];
    try { submitted = message.commit || submittedDrafts(message.drafts || []); confirmationRows(submitted); }
    catch (error) { const text = error instanceof Error ? error.message : "请核对账单。"; patchMessage(message.id, { error: text }); toast.error(text); revealInvalidDraft(message, text); return; }
    // Persist the exact payload before the request. A lost response/reload retries
    // the same batch; edits remain locked until its outcome has been established.
    saveLock.current = true; setSavingId(message.id); patchMessage(message.id, { commit: submitted, error: undefined });
    changeConfirmation(message.id, { id: message.id, drafts: submitted });
    const epoch = conversationEpoch.current;
    const controller = newController(false);
    confirmationControllers.current.set(message.id, controller);
    setConfirmingIds(current => [...current, message.id]);
    try {
      const response = await fetch("/api/assistant/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ batch_id: message.id, drafts: submitted }) });
      const result = await response.json().catch(() => ({}));
      if (!live.current || controller.signal.aborted) return;
      if (!response.ok) {
        // A validation rejection is known to have performed no write. Other
        // failures preserve the submitted payload for idempotent reconciliation.
        const error = result.error || "确认结果暂未获取，请重试确认。";
        if (response.status === 400 || result.notSaved || result.batchRevoked) changeConfirmation(message.id);
        else changeConfirmation(message.id, { id: message.id, drafts: submitted, error });
        patchMessage(message.id, { ...(result.batchConflict || result.batchRevoked ? { status: "conflict", commit: undefined } : response.status === 400 || result.notSaved ? { commit: undefined } : {}), error });
        if (!currentConversation(epoch)) toast.error(error);
        return;
      }
      changeConfirmation(message.id);
      patchMessage(message.id, { status: "saved", error: undefined, commit: undefined, savedDrafts: submitted.map(d => ({ ...d })) });
      toast.success(`${result.count} 笔已记入账本${result.replayed ? "（已核对，无重复记账）" : ""}`);
      if (currentConversation(epoch)) {
        const waiting = knownTasks.current.find(task => assistantAgentWaiting(task) && restoreAssistantAgent(task.agent || task.result?.agent)?.pending_batch_id === message.id);
        if (waiting) await continueAgentCheckpoint(waiting);
      }
      return true;
    } catch {
      if (!controller.signal.aborted && live.current) {
        const error = "网络中断，保存结果待核对。请重试确认，不会重复记账。";
        changeConfirmation(message.id, { id: message.id, drafts: submitted, error }); patchMessage(message.id, { error });
      }
    } finally {
      finishController(controller); confirmationControllers.current.delete(message.id);
      if (live.current) {
        setConfirmations([...confirmationsRef.current]);
        setConfirmingIds(current => current.filter(id => id !== message.id));
        if (currentConversation(epoch)) { saveLock.current = false; setSavingId(null); }
      }
    }
  }

  async function undoSaved(message?: Message, draftIds?: string[], retry?: AssistantUndoRecovery) {
    if (saveLock.current || (retry && undoControllers.current.has(retry.id))) return;
    let operation: AssistantUndoRecovery;
    try {
      if (retry) operation = undoRecoverySnapshots([retry])[0];
      else {
        if (!message || message.status !== "saved" || !message.drafts?.length) throw new Error("这组账目已变化，请核对当前卡片。");
        if (undosRef.current.some(item => item.batch_id === message.id)) throw new Error("撤销结果尚待核对，请先核对原操作。");
        const drafts = savedDraftSnapshot(message.savedDrafts || submittedDrafts(message.drafts));
        const ids = draftIds || message.drafts.map(d => d.id);
        if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !message.drafts!.some(d => d.id === id))) throw new Error("撤销目标已变化，请核对当前卡片。");
        operation = { id: crypto.randomUUID(), batch_id: message.id, drafts, draft_ids: [...ids], draftSort: message.draftSort };
      }
      if (!operation) throw new Error("原始撤销操作无效，请核对交易记录。");
    } catch (error) { toast.error(error instanceof Error ? error.message : "撤销目标无效。"); return; }
    const request = { ...operation, error: undefined };
    saveLock.current = true; setSavingId(request.batch_id);
    changeUndo(request.id, request); patchMessage(request.batch_id, { error: undefined });
    const epoch = conversationEpoch.current;
    const controller = newController(false);
    undoControllers.current.set(request.id, controller);
    setUndoingIds(current => [...current, request.id]);
    try {
      const response = await fetch("/api/assistant/undo", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ batch_id: request.batch_id, drafts: request.drafts, draft_ids: request.draft_ids, undo_id: request.id }) });
      const data = await response.json().catch(() => ({}));
      if (!live.current || controller.signal.aborted) return;
      if (!response.ok) {
        const error = typeof data.error === "string" ? data.error : "撤销结果暂未获取，请核对原操作。";
        if (response.status === 400 || data.notUndone) changeUndo(request.id);
        else changeUndo(request.id, { ...request, error });
        patchMessage(request.batch_id, { error }); toast.error(error);
        return;
      }
      const result = validateUndoResult(data, request);
      const restored: Message = { id: result.batch_id, role: "assistant", text: `已撤销 ${result.drafts.length} 笔入账，草稿已恢复。核对后可重新确认。`,
        status: "pending", drafts: result.drafts.map(editDraft), draftSort: request.draftSort, memberFlow: true };
      // Only the recovered draft survives a cleared chat; never bring its old
      // messages, screenshots or composer back into the new conversation.
      setMessages(current => {
        const next = current.map(m => {
          if (m.id !== request.batch_id) return m;
          const remaining = m.drafts?.filter(d => !result.undone_draft_ids.includes(d.id)) || [];
          return { ...m, drafts: remaining, savedDrafts: request.drafts, status: remaining.length ? "saved" as const : "undone" as const,
            ...(remaining.length ? {} : { text: "本组入账已撤销，草稿已恢复。" }), error: undefined, commit: undefined };
        });
        return next.some(m => m.id === restored.id) ? next : [...next, restored];
      });
      changeUndo(request.id);
      toast.success(`已撤销 ${result.drafts.length} 笔入账，草稿已恢复`);
      return true;
    } catch {
      if (live.current && !controller.signal.aborted) {
        const error = "撤销结果待核对，请重试原操作；核对成功后会自动恢复草稿。";
        changeUndo(request.id, { ...request, error }); patchMessage(request.batch_id, { error }); toast.error(error);
      }
    } finally {
      finishController(controller); undoControllers.current.delete(request.id);
      if (live.current) {
        setUndoingIds(current => current.filter(id => id !== request.id));
        if (currentConversation(epoch)) { saveLock.current = false; setSavingId(null); }
      }
    }
  }

  function updateDraft(messageId: string, draftId: string, update: Partial<EditableDraft>) {
    if (busy || sendLock.current || saveLock.current) return;
    setValidationTarget(current => current?.draftId === draftId ? null : current);
    setMessages(current => current.map(m => {
      if ("member_id" in update && m.memberChoice?.batch_id === messageId && m.memberChoice.draft_ids.includes(draftId)) return { ...m, memberChoice: undefined };
      return m.id === messageId && m.status === "pending" && !m.commit ? { ...m, error: undefined, drafts: m.drafts?.map(d => d.id === draftId ? { ...d, ...update } : d) } : m;
    }));
  }

  function cycleDraftSort(messageId: string) {
    if (busy || sendLock.current) return;
    setMessages(current => current.map(message => message.id === messageId && message.drafts?.length
      ? { ...message, draftSort: nextAssistantDraftSort(message.draftSort) } : message));
  }

  function deleteDrafts(messageId: string, draftId?: string) {
    if (busy || saveLock.current || sendLock.current) return;
    const deletedBatch = messages.find(message => message.id === messageId);
    if (deletedBatch && (!draftId || deletedBatch.drafts?.length === 1)) {
      const waiting = knownTasks.current.find(task => assistantAgentWaiting(task) && restoreAssistantAgent(task.agent || task.result?.agent)?.pending_batch_id === messageId);
      if (waiting) void stopTask(waiting.id);
    }
    setMessages(current => current.map(m => {
      if (m.memberChoice?.batch_id === messageId && (!draftId || m.memberChoice.draft_ids.includes(draftId))) return { ...m, memberChoice: undefined };
      // An unresolved save must keep the exact original batch available for retry.
      if (m.id !== messageId || m.status !== "pending" || m.commit) return m;
      const remaining = draftId ? m.drafts?.filter(d => d.id !== draftId) || [] : [];
      const unassigned = m.memberFlow ? unassignedMemberDrafts(remaining, members) : [];
      const imageReply = current.some(input => input.role === "user" && input.taskId === m.id && input.images?.length);
      return remaining.length ? { ...m, drafts: remaining, ...(m.memberFlow && !imageReply ? { text: unassigned.length ? memberBatchQuestionText(unassigned) : "请核对账目后确认入账。" } : {}), error: undefined }
        : { ...m, drafts: [], status: "deleted" as const, text: "这组草稿已删除，未入账。", error: undefined };
    }));
  }

  async function transcribe(blob: Blob, clipToLimit = false) {
    if (!live.current) return;
    const epoch = conversationEpoch.current;
    setTranscribing(true);
    const controller = newController();
    try {
      const audio = await recordingToWav(blob, clipToLimit);
      if (controller.signal.aborted || !currentConversation(epoch)) return;
      const form = new FormData(); form.append("audio", audio, "recording.wav");
      const result = await responseJson(await fetch("/api/assistant/transcribe", { method: "POST", body: form, signal: controller.signal }));
      if (currentConversation(epoch) && !controller.signal.aborted) { setInput(current => [current, result.text].filter(Boolean).join("，").slice(0, 4000)); toast.success("语音已转成文字，核对后点击发送。"); }
    } catch (error) { if (!controller.signal.aborted && currentConversation(epoch)) toast.error(error instanceof Error ? error.message : "语音识别失败，请重试。"); }
    finally { finishController(controller); if (currentConversation(epoch)) setTranscribing(false); }
  }

  async function toggleRecording() {
    if (speech.current) { speech.current.stop(); return; }
    if (busy || recordLock.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") { toast.info("当前浏览器不支持实时录音，可选择一段60秒以内的音频。"); audioInput.current?.click(); return; }
    if (input.length >= 4000) { toast.info("输入框已满，请先发送或删减文字。"); return; }
    recordLock.current = true;
    const epoch = conversationEpoch.current;
    const startedEpoch = getDraftEpoch();
    const controller = newController();
    const originalInput = input;
    const active = () => currentConversation(epoch) && startedEpoch === getDraftEpoch() && !controller.signal.aborted;
    let session: SpeechRecording | undefined;
    try {
      session = startSpeechRecording({ signal: controller.signal,
        onText: text => {
          if (!active()) return;
          const combined = appendSpeechTranscript(originalInput, text);
          setInput(combined);
          if (combined.length >= 4000) speech.current?.stop();
        },
        onPhase: phase => { if (active()) setSpeechPhase(phase); },
        onSeconds: elapsed => { if (active()) setSeconds(elapsed); },
      });
      speech.current = session;
      const text = await session.done;
      if (active()) {
        if (text.trim()) toast.success("语音已转成文字，核对后点击发送。");
        else toast.info("没有识别到语音，请靠近麦克风重试。");
      }
    } catch (error) {
      if (active() && !(error instanceof DOMException && error.name === "AbortError")) toast.error(error instanceof Error ? error.message : "语音识别失败，请重试。");
    } finally {
      finishController(controller);
      if (speech.current === session) speech.current = null;
      if (active()) { recordLock.current = false; setSpeechPhase(null); }
    }
  }

  async function selectImages(files: File[], pasted = false) {
    if (busy || voiceBusy || transcribing || sendLock.current || saveLock.current || draft.hasDraft || draft.status === "checking") return;
    if (imagePrepareLock.current) { toast.info("截图正在准备，请稍后再添加。"); return; }
    if (!files.length) return;
    if (files.length + images.length > MAX_ASSISTANT_IMAGES) { toast.error(`一次最多选择 ${MAX_ASSISTANT_IMAGES} 张截图，请分批识别。`); return; }
    if (files.some(file => !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10_000_000)) { toast.error("请选择10MB以内的 JPG、PNG 或 WebP 图片。"); return; }
    const selection = ++imageSelection.current;
    imagePrepareLock.current = true; setPreparingImage(true);
    const startedEpoch = getDraftEpoch();
    const epoch = conversationEpoch.current;
    const current = () => currentConversation(epoch) && startedEpoch === getDraftEpoch() && selection === imageSelection.current;
    try {
      const prepared: AssistantImage[] = [];
      for (const file of files) {
        if (!current()) return;
        const url = URL.createObjectURL(file);
        try {
          const img = new Image(); img.src = url; await img.decode();
          if (!current()) return;
          const scale = Math.min(1, 1920 / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
          const context = canvas.getContext("2d"); if (!context) throw new Error("无法读取图片。");
          context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(img, 0, 0, canvas.width, canvas.height);
          const data = canvas.toDataURL("image/jpeg", 0.8);
          if (data.length > MAX_ASSISTANT_IMAGE_LENGTH) throw new Error("图片过大，请裁剪到账单区域后重试。");
          prepared.push({ data, name: (file.name || (pasted ? "粘贴的图片" : "账单截图")).slice(0, 255) });
        } finally { URL.revokeObjectURL(url); }
      }
      if (!current()) return;
      const next = appendAssistantImages(images, prepared);
      if (next.length < images.length + prepared.length) toast.info("相同截图已保留一份。");
      setImages(next);
    } catch (error) { if (current()) toast.error(error instanceof Error ? error.message : "图片读取失败。"); }
    finally { if (selection === imageSelection.current) { imagePrepareLock.current = false; if (live.current) setPreparingImage(false); } }
  }

  function pasteImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = clipboardImages(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    void selectImages(files, true);
  }

  function manualEntry() {
    if (busy || draft.hasDraft || saveLock.current || messages.length >= 120) return;
    followReply.current = true;
    const d: EditableDraft = { id: crypto.randomUUID(), type: "expense", amount_cents: 0, amount: "", category_id: null,
      member_id: null, transaction_date: localCalendarDate(), description: "", payment_method: null, note: "" };
    setMessages(current => [...current.map(m => m.memberChoice ? { ...m, memberChoice: undefined } : m), { id: crypto.randomUUID(), role: "assistant", text: "填好下面这笔账，再确认入账。", drafts: [d], status: "pending" }]);
  }

  const composerDisabled = !!actionPending || busy || draft.hasDraft || draft.status === "checking" || savingId !== null;
  function fillQuickPrompt(prompt: string) {
    if (composerDisabled) return;
    const next = input.trim() ? `${input}\n${prompt}` : prompt;
    if (next.length > 4000) { toast.info("输入内容过长，请先整理后再添加快捷提问。"); return; }
    setInput(next);
    setQuickToolsOpen(false);
    composer.current?.focus();
  }
  const activeMemberChoice = [...messages].reverse().find(m => m.memberChoice && memberChoiceTarget(m.memberChoice, messages));
  const detachedConfirmations = confirmations.filter(c => !messages.some(m => m.id === c.id && m.status === "pending" && m.commit));
  // The provisional reply uses the final task ID and the same message subtree,
  // so finishing a reply updates it in place instead of removing/recreating it.
  const streamingMessage: Message | null = activeTask && !messages.some(message => message.id === activeTask.id)
    ? { id: activeTask.id, role: "assistant", text: streamingReply?.text || "", agent: restoreAssistantAgent(activeTask.agent || activeTask.result?.agent), approvalHistory: restoreAssistantApprovalHistory(activeTask.approval_history), process: assistantProcessFromTask(activeTask) } : null;
  const displayMessages = streamingMessage ? messages.flatMap(message => message.id === activeTask!.user_message_id ? [message, streamingMessage] : [message]) : messages;
  return <DashboardLayout viewport contentClassName="px-0 pb-1.5 md:px-0 md:pb-1.5 lg:px-0 lg:pb-7"><section className="flex h-full min-h-0 w-full flex-col text-foreground [&_*]:motion-reduce:scroll-auto [&_*]:motion-reduce:transition-none" aria-label="AI 记账">
    <div className={cn(contentWidthClass, "shrink-0")}>
    <header className="mb-3.5 flex shrink-0 items-center gap-3">
      <div className="flex size-[42px] shrink-0 items-center justify-center rounded-[14px] bg-[color-mix(in_srgb,var(--color-primary)_9%,var(--color-background))] text-primary"><MessageCircle size={22} /></div>
      <div className="min-w-0 flex-1"><h1 className="text-[20px] leading-[26px] font-semibold tracking-[-0.5px]">AI 记账</h1><p className="mt-[3px] text-[12px] leading-[18px] text-muted-foreground">{unresolved ? `${unresolved} 笔待确认` : "随手记录，清楚每一笔"}</p></div>
      <Button type="button" variant="ghost" className={cn(buttonClass, iconButtonClass)} aria-label="清空对话" onClick={clearConversation} title="清空对话"><Trash2 size={19} /></Button>
    </header>
    <DraftNotice draft={draft} hideSaved hidePending />
    {!!detachedConfirmations.length && <div className="mb-3 max-h-32 shrink-0 overflow-y-auto rounded-[10px] bg-muted px-3 py-2.5 text-[12px]" aria-label="入账结果核对">
      {detachedConfirmations.map(c => <div key={c.id} className="flex items-center justify-between gap-3 py-1">
        <span>{c.drafts.length} 笔入账结果待核对{c.error ? <span className="mt-1 block text-[11px] text-muted-foreground">{c.error}</span> : null}</span>
        <Button type="button" variant="ghost" className={cn(buttonClass, "shrink-0 text-primary underline")} disabled={busy || savingId !== null || confirmingIds.includes(c.id)} onClick={() => void confirm({ id: c.id, role: "assistant", text: "", status: "pending", commit: c.drafts })}>{confirmingIds.includes(c.id) ? "正在核对…" : "核对原批次"}</Button>
      </div>)}
    </div>}
    {!!undos.length && <div className="mb-3 max-h-32 shrink-0 overflow-y-auto rounded-[10px] bg-muted px-3 py-2.5 text-[12px]" aria-label="撤销结果核对">
      {undos.map(operation => <div key={operation.id} className="flex items-center justify-between gap-3 py-1">
        <span>{operation.draft_ids.length} 笔撤销结果{undoingIds.includes(operation.id) ? "正在核对" : "待核对"}{operation.error && <span className="mt-1 block text-[11px] text-muted-foreground">{operation.error}</span>}</span>
        <Button type="button" variant="ghost" className={cn(buttonClass, "shrink-0 text-primary underline")} aria-label="核对撤销结果" disabled={busy || savingId !== null || undoingIds.includes(operation.id)} onClick={() => void undoSaved(undefined, undefined, operation)}>{undoingIds.includes(operation.id) ? "正在核对…" : "核对原操作"}</Button>
      </div>)}
    </div>}
    {taskConnectionError && <div className="mb-3 flex items-center gap-3 rounded-[10px] bg-muted px-3 py-2.5 text-[13px]" role="status"><span>{taskConnectionError}</span><Button type="button" variant="ghost" className={cn(buttonClass, "ml-auto whitespace-nowrap underline")} onClick={() => taskSubscription.current?.refresh()}>重新连接</Button></div>}
    {loadError && <div className="mb-3 flex items-center gap-3 rounded-[10px] bg-muted px-3 py-2.5 text-[13px]" role="alert">{loadError}<Button type="button" variant="ghost" className={cn(buttonClass, "ml-auto whitespace-nowrap underline")} onClick={reloadSetup}>重新加载</Button></div>}
    {configured === false && <div className="mb-3 flex items-center gap-3 rounded-[10px] bg-muted px-3 py-2.5 text-[13px]" role="status">AI 尚未配置，请完成百炼服务端配置。仍可手动填写确认卡片。</div>}
    </div>
    <div ref={feed} onScroll={event => { const element = event.currentTarget; followReply.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable_both-edges] [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]" aria-live="polite" aria-relevant="additions text">
      <div className={contentWidthClass}>
      {!messages.length && <div className="mx-auto mt-[clamp(16px,6dvh,60px)] mb-7 w-full max-w-[380px]">
        <span className="text-[12px] font-medium text-primary">你的日常账本</span>
        <h2 className="mt-2.5 text-[25px] leading-[1.4] font-[650] tracking-[-0.8px] [@media(max-width:360px)]:text-[23px]">今天的钱，花到哪了？</h2>
        <p className="mt-3 mb-[26px] text-[13px] leading-[1.8] text-muted-foreground">用文字、语音或截图记录收支，<br />我来整理，你来确认。</p>
        <Button type="button" variant="ghost" className={cn(buttonClass, "mt-2.5 flex w-full items-center justify-between gap-3 rounded-[14px] border border-border bg-card px-4 py-3.5 text-left text-[13px] hover:border-primary")} disabled={composerDisabled} onClick={() => fillQuickPrompt("这个月主要花在哪些分类？")}><span className="min-w-0"><span className="mb-[5px] block text-[11px] text-muted-foreground">看看消费情况</span><span>这个月主要花在哪些分类？</span></span><ArrowUp size={16} className="shrink-0 text-muted-foreground" /></Button>
        <Button type="button" variant="ghost" className={cn(buttonClass, "mt-2.5 flex w-full items-center justify-between gap-3 rounded-[14px] border border-border bg-card px-4 py-3.5 text-left text-[13px] hover:border-primary")} disabled={composerDisabled} onClick={() => fillQuickPrompt(capabilitiesPrompt)}><span className="min-w-0"><span className="mb-[5px] block text-[11px] text-muted-foreground">了解账本助手</span><span>你可以做什么？</span></span><ArrowUp size={16} className="shrink-0 text-muted-foreground" /></Button>
      </div>}
      {displayMessages.map(message => {
        const visibleDrafts = sortedAssistantDrafts(message.drafts || [], message.draftSort);
        const sortMode = assistantDraftSort(message.draftSort);
        const replacement = message.id === activeMemberChoice?.id ? memberChoiceTarget(message.memberChoice, messages) : undefined;
        const unassigned = message.memberFlow && message.status === "pending" && !message.commit && activeMemberChoice?.memberChoice?.batch_id !== message.id ? unassignedMemberDrafts(visibleDrafts, members) : [];
        const question = unassigned[0];
        const pendingPhase = actionPending?.id === message.id ? actionPending.phase : undefined;
        const hasAction = !!(message.approval || message.confirmChoice || message.removeChoice || message.clearChoice || message.undoChoice);
        const actionPreview = draftReplyView(message, messages, members, categories) || (message.clearChoice ? { title: "清空当前对话", metrics: [], sections: [], notices: [{ text: message.text, tone: "attention" as const }] } : undefined) || message.actionPreview || message.approval?.preview || (hasAction
          ? message.approval && message.eventContext ? eventActionPreview(message.eventContext.input, message.approval.summary) : summaryActionPreview(message.approval?.summary || message.text)
          : undefined);
        const actionControls = (hasAction || pendingPhase) ? <AssistantActionControls pending={pendingPhase} executing={message.actionResult?.status === "executing"} disabled={composerDisabled}
          approveLabel={message.undoChoice ? `确认撤销 ${message.undoChoice.draft_ids.length} 笔` : message.approval?.preview?.approveLabel} canRead={!!message.approval} onDecide={phase => void decideConversationAction(message, phase === "cancel" ? "cancel" : "approve", phase === "read")}
          error={message.error} resultText={message.actionResult?.status === "pending" ? "尚未执行，等待你的确认。" : message.actionResult?.status === "executing" ? message.actionResult.text : undefined} /> : null;
        const replyView = !actionPreview ? message.replyView || (message.ledgerContext ? recordReplyView(message.ledgerContext.resource, message.ledgerContext.rows, undefined, members, categories)
          : message.replyKind ? resultReplyView(message.text)
          : message.navigateTo ? resultReplyView(message.text, "页面入口")
          : message.exportFile ? resultReplyView(message.text, "导出已准备好") : undefined) : undefined;
        const eventMembers = ledgerEventMemberChoices(message.eventContext, message.eventChoices);
        const memberEvent = eventMembers ? message.eventContext!.input : undefined;
        const imageReply = question && message.text !== memberBatchQuestionText(unassigned) && messages.some(input => input.role === "user" && input.taskId === message.id && input.images?.length);
        const questionTotal = unassigned.every(d => /^\d{1,10}(\.\d{1,2})?$/.test(d.amount))
          ? money(unassigned.reduce((sum, d) => sum + Math.round(Number(d.amount) * 100), 0)) : "—";
        const agentSettled = !!message.actionResult && assistantAgentActionSettled(message.actionResult) || message.status === "saved";
        const agentRunning = message.agent?.status === "running" || message.agent?.status === "waiting_approval" && agentSettled;
        const agentStatus = message.agent && <AssistantAgentTaskStatus agent={message.agent} process={agentRunning ? message.process : undefined}
          disconnected={!!taskConnectionError && (message === streamingMessage || message.taskId === activeTaskId)}
          error={!hasAction && !message.drafts?.length && !message.incomplete ? message.error : undefined} settled={agentSettled}
          hasPreview={!!actionPreview || !!message.drafts?.length || !!message.eventChoices?.length}
          disabled={!!actionPending || sending || savingId !== null} onStop={() => void stopTask(message.taskId || message.id)}
          onEdit={() => { setInput(message.agent!.goal); composer.current?.focus(); }} />;
        return <div key={message.id} className={cn("mb-5 flex", message.role === "user" && "justify-end")} data-message-role={message.role} data-message-id={message.id} data-streaming-reply={message === streamingMessage || undefined} aria-busy={message === streamingMessage || undefined}>
        <div className={cn("min-w-0 max-w-full", message.role === "user" && "max-w-[88%]", (question || replacement) && "w-[400px]", (actionPreview || replyView || !!message.eventChoices?.length || (!!message.drafts?.length && !question)) && "w-[520px]")}>
          {message.role === "assistant" && agentRunning && agentStatus}
          {message.role === "assistant" && message.process && !message.agent && <AssistantProcessingDetails process={message.process}
            disconnected={!!taskConnectionError && (message === streamingMessage || message.taskId === activeTaskId)} />}
          {message.role === "assistant" && message.agent && !agentRunning && message.process && <AssistantProcessingDetails process={message.process} quiet />}
          {message.role === "assistant" && !!message.approvalHistory?.length && <div className="mb-3 space-y-3" aria-label="任务操作记录">{message.approvalHistory.filter(entry => entry.approval.id !== (message.approval?.id || message.actionResult?.id)
            && !message.taskHistory?.some(output => (output.actionResult?.id || output.approval?.id) === entry.approval.id)).map(entry => <AssistantActionCard key={entry.approval.id}
              preview={entry.approval.preview || summaryActionPreview(entry.approval.summary)} status={entry.result?.status || "executing"} resultText={entry.result?.text.split("\n")[0] || "原操作结果待核对。"} />)}</div>}
          {message.role === "assistant" && !!message.taskHistory?.length && <div className="mb-3 space-y-3" aria-label="任务先前结果">{message.taskHistory.map(output => {
            const preview = output.actionPreview || output.approval?.preview;
            const view = output.replyView || (output.drafts?.length ? { title: output.status === "saved" ? "已入账账目" : "先前账目", metrics: [], sections: [], notices: [],
              records: (output.savedDrafts || output.drafts).map(draft => ({ title: draft.description || "未填写用途", amount: `¥${(draft.amount_cents / 100).toFixed(2)}`, subtitle: `${draft.transaction_date} · ${draft.type === "income" ? "收入" : "支出"}` })) }
              : output.ledgerContext ? recordReplyView(output.ledgerContext.resource, output.ledgerContext.rows, undefined, members, categories) : undefined);
            return <div key={`${output.attempt}:${output.actionResult?.id || output.approval?.id || "reply"}`}>{preview ? <AssistantActionCard preview={preview} status={output.actionResult?.status || "executing"} resultText={output.actionResult?.text.split("\n")[0]} />
              : view ? <AssistantReplyCard preview={view} /> : <p className="text-[13px] leading-6 text-muted-foreground whitespace-pre-wrap wrap-anywhere">{withoutApprovalExpiry(output.text)}</p>}
              {output.exportFile && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => downloadExport({ ...message, exportFile: output.exportFile })}>下载 {output.exportFile.name}</Button>}
            </div>;
          })}</div>}

          <div className={cn(bubbleClass, message.role === "user" ? "rounded-[17px_17px_5px_17px] bg-[color-mix(in_srgb,var(--color-primary)_9%,var(--color-background))] px-[15px] py-[11px] text-foreground" : "text-foreground")}>
            {!!message.images?.length && <div className={cn("mb-2 grid gap-2", message.images.length > 1 && "grid-cols-2")} aria-label="已发送的截图">{message.images.map((image, index) => <Button key={index} type="button" variant="ghost" className={cn(buttonClass, "relative block max-w-full overflow-hidden rounded-[10px] hover:bg-transparent")} aria-label={`查看第 ${index + 1} 张图片：${image.name}`} onClick={() => setPreviewImage(image)}><NextImage src={image.data} alt={image.name} width={240} height={240} unoptimized className="h-auto max-h-[260px] w-auto max-w-full object-contain" /></Button>)}</div>}
            {!actionPreview && !replyView && (!message.eventChoices?.length || eventMembers) && <ReactMarkdown components={markdownTableComponents} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} disallowedElements={["img"]}>{question ? `${imageReply ? `${message.text}\n\n` : ""}${memberBatchQuestionText(unassigned)}` : withoutApprovalExpiry(message.text)}</ReactMarkdown>}
          </div>
          {message.incomplete && ((message.role === "assistant") || (!message.taskId && message.role === "user") || message.taskStatus === "missing") && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status">
            <AssistantReplyNotice tone={message.incomplete === "stopped" ? "info" : "error"}>{message.error || (message.incomplete === "stopped" ? "已停止生成" : "上次处理未完成")}</AssistantReplyNotice>
            {message.image_progress && (message.taskStatus === "failed" || message.taskStatus === "cancelled") && <span>{assistantImageProgressText(message.image_progress, message.taskStatus)}</span>}
            <Button type="button" variant="ghost" className={cn(buttonClass, "text-xs text-primary underline")} disabled={requestBusy || savingId !== null || draft.hasDraft || draftChecking} onClick={() => void retryTask(message)}>{assistantTaskRetryLabel(message)}</Button>
          </div>}
          {eventMembers && memberEvent && <AssistantMemberPicker heading={<p className="mb-3 flex items-baseline gap-2 text-[13px]"><span className="min-w-0 wrap-anywhere">{memberEvent.kind ? eventKinds[memberEvent.kind] : "这笔账"}{memberEvent.counterparty ? ` · ${memberEvent.counterparty}` : ""}</span><strong className="ml-auto whitespace-nowrap text-[16px]">¥{eventCashflowCents(memberEvent) === null ? "—" : money(eventCashflowCents(memberEvent)!)}</strong><span className="shrink-0 text-[11px] text-muted-foreground">{memberEvent.kind && eventType(memberEvent.kind) === "income" ? "收入" : "支出"}</span></p>}
            members={members} disabled={composerDisabled} loading={isInitializing} loadError={!!loadError} onReload={reloadSetup}
            onSelect={member => void send(`${memberEvent.kind && eventType(memberEvent.kind) === "income" ? "收入所属人" : "支出人"}是「${member.name}」`, { ...memberEvent, member_id: member.id })}
            footer={<p className="mt-3 text-[11px] text-muted-foreground">点击名字，自动回复；核对后再确认入账</p>} />}
          {!eventMembers && !!message.eventChoices?.length && <AssistantReplyShell label="补充事项信息" title="请选择下一步">
            <div className="space-y-3 p-4"><div className={bubbleClass}><ReactMarkdown components={markdownTableComponents} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} disallowedElements={["img"]}>{message.text}</ReactMarkdown></div>
            <div className="flex flex-col gap-2">{message.eventChoices.map((choice, index) => <Button key={index} type="button" variant="ghost" className={assistantChoiceClass} disabled={composerDisabled} onClick={() => void send(choice.label, choice.input)}>{choice.label}</Button>)}</div></div>
          </AssistantReplyShell>}
          {actionPreview ? <AssistantActionCard preview={actionPreview} status={message.actionResult?.status || (message.agent?.status === "stopped" ? "executing" : "pending")} pending={pendingPhase}
            resultText={message.actionResult?.text.split("\n")[0]}>{actionControls}</AssistantActionCard> : actionControls}
          {replyView && <AssistantReplyCard preview={replyView} footer={(message.navigateTo || message.exportFile) ? <>
            {message.navigateTo && <Link href={message.navigateTo} className="inline-flex min-h-9 items-center rounded-xl border border-border px-3 text-sm text-primary hover:bg-muted">打开对应页面</Link>}
            {message.exportFile && <Button type="button" variant="outline" size="sm" className="max-w-full whitespace-normal wrap-anywhere" onClick={() => downloadExport(message)}>下载 {message.exportFile.name}</Button>}
          </> : undefined}>
            {replyView.analysis && <details className="border-t border-border pt-3"><summary className="cursor-pointer text-xs text-primary">查看分析说明</summary><div className={`${bubbleClass} mt-3 text-foreground`}><ReactMarkdown components={markdownTableComponents} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} disallowedElements={["img"]}>{message.text}</ReactMarkdown></div></details>}
          </AssistantReplyCard>}
          {message.importSummary && <div className="w-[520px] max-w-full" aria-label="截图合并结果"><AssistantReplyCard preview={{ title: "截图识别结果", metrics: [
            { label: "已识别截图", value: `${message.importSummary.image_count} 张` }, { label: "待核对账目", value: `${message.importSummary.retained_count} 笔`, primary: true },
          ], sections: [{ title: "整理结果", rows: [{ label: "衔接去重", value: `${message.importSummary.removed_duplicates} 笔` }, { label: "跳过零金额", value: `${message.importSummary.skipped_zero_amounts || 0} 行` }] }],
          notices: [{ text: "以上为原始识别汇总，当前入账状态以下方账目卡片为准。", tone: "info" }, ...message.importSummary.warnings.map(text => ({ text, tone: "attention" as const }))] }} /></div>}
          {replacement && <AssistantMemberPicker label="修改记账成员" heading={<p className="mb-3 flex items-baseline justify-between gap-3 text-[13px]"><span className="min-w-0 wrap-anywhere">{replacement.drafts.length === 1 ? replacement.drafts[0].description || "这笔账" : `修改这 ${replacement.drafts.length} 笔账目的人员`}</span>{replacement.drafts.length === 1 && <strong className="shrink-0 text-[16px]">¥{replacement.drafts[0].amount}</strong>}</p>} members={members} disabled={composerDisabled} loading={isInitializing} loadError={!!loadError}
            onReload={reloadSetup} onSelect={member => void selectReplacementMember(message, member)} footer={<div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground"><span>点击人员，自动回复并更新</span><Button type="button" variant="ghost" className={cn(buttonClass, "shrink-0 py-1 underline")} disabled={composerDisabled} onClick={() => patchMessage(message.id, { memberChoice: undefined })}>取消修改</Button></div>} />}
          {question && <AssistantMemberPicker heading={<p className="mb-3 flex items-baseline gap-2 text-[13px]"><span className="min-w-0 wrap-anywhere">{unassigned.length > 1 ? `${unassigned.length} 笔待选成员` : question.description || "这笔账"}</span><strong className="ml-auto whitespace-nowrap text-[16px]">¥{questionTotal}</strong>{unassigned.length === 1 && <span className="shrink-0 text-[11px] text-muted-foreground">{question.type === "expense" ? "支出" : "收入"}</span>}</p>} members={members} disabled={composerDisabled} loading={isInitializing} loadError={!!loadError}
            onReload={reloadSetup} onSelect={member => void chooseMember(message, member)} footer={<div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[11px] text-muted-foreground"><span>点击名字，自动回复</span><div className="flex flex-wrap gap-3">{unassigned.length === 1 && <Button type="button" variant="ghost" className={cn(buttonClass, "py-[3px] text-xs font-normal text-muted-foreground hover:text-destructive")} disabled={composerDisabled} onClick={() => deleteDrafts(message.id, question.id)}>删除这笔草稿</Button>}{message.drafts!.length > 1 && <Button type="button" variant="ghost" className={cn(buttonClass, "py-[3px] text-xs font-normal text-muted-foreground hover:text-destructive")} disabled={composerDisabled} onClick={() => deleteDrafts(message.id)}>删除本组</Button>}</div></div>}>
            {unassigned.length > 1 && <p className="mt-2.5 text-[11px] leading-[1.6] text-muted-foreground">选一次应用到这 {unassigned.length} 笔，确认前可逐笔修改。</p>}
            {unassigned.length > 1 && <ul className="mt-3.5 grid list-none gap-[9px] p-0" aria-label="待选成员的账目">{unassigned.map(d => <li key={d.id} className="flex items-center gap-2 text-[12px]">
              <span className="min-w-0 flex-1 wrap-anywhere">{d.description.trim() ? d.description : d.type === "expense" ? "支出" : "收入"}<small className="mt-px block text-[10px] text-muted-foreground">{d.transaction_date}</small></span>
              <span className="shrink-0 tabular-nums">¥{d.amount}</span>
              <Button type="button" variant="ghost" className={cn(buttonClass, "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-muted hover:text-destructive")} aria-label="删除这笔草稿" title="删除这笔草稿" disabled={composerDisabled} onClick={() => deleteDrafts(message.id, d.id)}><Trash2 size={16} /></Button>
            </li>)}</ul>}
          </AssistantMemberPicker>}
          {!!message.drafts?.length && !question && <AssistantDraftCard drafts={visibleDrafts} status={message.status}
            pending={savingId === message.id} checking={!!message.commit} error={message.error} sortMode={sortMode}
            sortDisabled={busy || !!savingId || !!actionPending} onSort={() => cycleDraftSort(message.id)} footer={<>
            {message.status === "pending" && <div className="space-y-3"><p className="text-xs leading-5 text-muted-foreground">{message.commit ? "本组结果待核对，请重试原操作。" : "尚未入账，核对后确认。"}</p><div className="flex items-center gap-2 flex-wrap">
              {!message.commit && <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs font-normal text-muted-foreground hover:text-destructive" disabled={!!actionPending || !!savingId || busy} onClick={() => deleteDrafts(message.id)}>删除本组</Button>}
              {message.commit && <span className="text-xs text-muted-foreground">重试将核对原批次</span>}
              <Button type="button" className="ml-auto min-w-[120px]" disabled={!!actionPending || !!savingId || busy || activeMemberChoice?.memberChoice?.batch_id === message.id} onClick={() => void confirm(message)}>
                {savingId === message.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{savingId === message.id ? "正在确认" : message.commit ? "重试确认" : `确认 ${message.drafts.length} 笔`}
              </Button>
            </div></div>}
            {message.status === "saved" && <div className="flex items-center flex-wrap gap-2 text-[12px] text-primary"><Check size={16} className="shrink-0" /><span>已记入账本</span><Button type="button" variant="ghost" className="ml-auto h-8 gap-1 px-2 text-[12px] font-normal text-muted-foreground" aria-label="撤销入账" title="撤销本组入账并恢复草稿" disabled={!!actionPending || !!savingId || busy || undos.some(operation => operation.batch_id === message.id)} onClick={() => void undoSaved(message)}>{savingId === message.id ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}{savingId === message.id ? "正在撤销…" : "撤销入账"}</Button><Link className="shrink-0 underline" href="/dashboard">查看记录</Link></div>}
            {message.status === "conflict" && <p className="py-1 text-[12px] text-muted-foreground"><Link href="/dashboard">核对原批次的交易记录</Link></p>}
          </>}>
            {visibleDrafts.map(d => {
              const category = categories.find(c => c.id === d.category_id);
              const member = members.find(m => m.id === d.member_id);
              const locked = message.status !== "pending" || !!message.commit || !!savingId || busy || !!actionPending;
              const canDelete = message.status === "pending" && !message.commit;
              const needsReview = message.status === "pending" && !message.commit;
              const fields = invalidDraftFields(d, categories, members);
              const invalid = { amount: needsReview && fields.amount, category: needsReview && fields.category,
                member: needsReview && fields.member, date: needsReview && fields.date };
              const needsCompletion = Object.values(invalid).some(Boolean);
              return <AssistantDraftRow key={d.id} draft={d} category={category} member={member} canDelete={canDelete} locked={locked}
                open={expandedDrafts[d.id] ?? needsCompletion} onToggle={open => setExpandedDrafts(current => current[d.id] === open ? current : { ...current, [d.id]: open })}
                onDelete={() => deleteDrafts(message.id, d.id)}>
                <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                  <div className={fieldLabelClass}>
                    <Label id={`${d.id}-type-label`}>收支类型</Label>
                    <div className="flex h-11 items-center gap-1 rounded-md border bg-muted/50 p-1" role="group" aria-labelledby={`${d.id}-type-label`}>
                      {(["expense", "income"] as const).map(type => (
                        <Button key={type} type="button" className="h-full min-w-0 flex-1 px-2 sm:px-3" variant={d.type === type ? "default" : "ghost"}
                          aria-pressed={d.type === type} disabled={locked}
                          onClick={() => updateDraft(message.id, d.id, { type, category_id: d.type === type ? d.category_id : null })}>
                          {type === "expense" ? "支出" : "收入"}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className={fieldLabelClass}>
                    <Label htmlFor={`${d.id}-amount`}>金额（元） *</Label>
                    <Input id={`${d.id}-amount`} className={cn("h-11 min-w-0 text-2xl font-semibold md:text-2xl", invalid.amount && incompleteFieldClass)} aria-invalid={invalid.amount || undefined} autoComplete="off" aria-label="金额" inputMode="decimal" value={d.amount} disabled={locked} onChange={e => updateDraft(message.id, d.id, { amount: e.target.value })} placeholder="0.00" />
                  </div>
                  <div className={fieldLabelClass}>
                    <Label htmlFor={`${d.id}-category`}>分类 *</Label>
                    <Select value={d.category_id || ""} disabled={locked} onValueChange={value => updateDraft(message.id, d.id, { category_id: value === "unselected" ? null : value })}>
                      <SelectTrigger id={`${d.id}-category`} className={cn(fieldClass, invalid.category && incompleteFieldClass)} aria-invalid={invalid.category || undefined} aria-label="分类"><SelectValue placeholder="请选择分类" /></SelectTrigger>
                      <SelectContent><SelectItem value="unselected">请选择分类</SelectItem>{categories.filter(c => c.type === d.type).map(c => <SelectItem key={c.id} value={c.id}><span className="inline-flex items-center gap-2"><CategoryIcon icon={c.icon} className="size-4" />{c.name}</span></SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className={fieldLabelClass}>
                    <Label htmlFor={`${d.id}-member`}>家庭成员 *</Label>
                    <Select value={d.member_id || ""} disabled={locked} onValueChange={value => updateDraft(message.id, d.id, { member_id: value === "unselected" ? null : value })}>
                      <SelectTrigger id={`${d.id}-member`} className={cn(fieldClass, invalid.member && incompleteFieldClass)} aria-invalid={invalid.member || undefined} aria-label="家庭成员"><SelectValue placeholder="请选择成员" /></SelectTrigger>
                      <SelectContent><SelectItem value="unselected">请选择成员</SelectItem>{members.map(m => <SelectItem key={m.id} value={m.id} textValue={m.name}><AssistantMemberLabel member={m} /></SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className={cn(fieldLabelClass, "col-span-2 sm:col-span-1")}>
                    <Label htmlFor={`${d.id}-date`}>交易日期 *</Label>
                    <Input id={`${d.id}-date`} className={cn(fieldClass, invalid.date && incompleteFieldClass)} aria-invalid={invalid.date || undefined} aria-label="日期" type="date" value={d.transaction_date} disabled={locked} onChange={e => updateDraft(message.id, d.id, { transaction_date: e.target.value })} />
                  </div>
                  <div className={cn(fieldLabelClass, "col-span-2 sm:col-span-1")}>
                    <Label htmlFor={`${d.id}-payment`}>支付方式</Label>
                    <Input id={`${d.id}-payment`} className={fieldClass} aria-label="支付方式" value={d.payment_method || ""} maxLength={40} disabled={locked} onChange={e => updateDraft(message.id, d.id, { payment_method: e.target.value || null })} placeholder="可选" />
                  </div>
                  <div className={cn(fieldLabelClass, "col-span-2")}>
                    <Label htmlFor={`${d.id}-description`}>备注</Label>
                    <Input id={`${d.id}-description`} className={fieldClass} aria-label="备注" value={d.description} maxLength={500} disabled={locked} onChange={e => updateDraft(message.id, d.id, { description: e.target.value })} placeholder="如午餐、超市采购（可选）" />
                  </div>
                </div>
              </AssistantDraftRow>;
            })}
          </AssistantDraftCard>}
          {message.role === "assistant" && !agentRunning && !message.incomplete && agentStatus}
        </div>
      </div>; })}
      {/* Contain the rotating SVG so its transformed bounds cannot change the feed's scrollHeight. */}
      <div className="min-h-5" data-reply-status>{!streamingMessage && (sending || taskBusy || recoveringTasks) && <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground" role="status"><span className="grid size-5 shrink-0 place-items-center overflow-hidden" aria-hidden="true"><Loader2 size={17} className="animate-spin" /></span>{imageProgressText || (recoveringTasks ? "正在恢复处理进度…" : sending && !taskBusy ? "正在发送…" : "正在整理…")}</div>}</div>
      </div>
    </div>
    <footer className={cn(contentWidthClass, "shrink-0 pt-3")}>
      <div className="mb-2.5 grid grid-cols-2 gap-2 min-[400px]:grid-cols-4 lg:flex [@media(max-width:360px)]:gap-1.5">
        <Button type="button" variant="ghost" className={cn(buttonClass, shortcutButtonClass)} disabled={composerDisabled} onClick={() => imageInput.current?.click()}><ImagePlus size={16} />识别截图</Button>
        <Button type="button" variant="ghost" className={cn(buttonClass, shortcutButtonClass)} disabled={composerDisabled} onClick={manualEntry}><Plus size={16} />手动记账</Button>
        <Button type="button" variant="ghost" className={cn(buttonClass, shortcutButtonClass)} disabled={composerDisabled} onClick={() => fillQuickPrompt("这个月收入、支出和结余各是多少？主要花在哪些分类？")}><BarChart3 size={16} />本月统计</Button>
        <Button type="button" variant="ghost" className={cn(buttonClass, shortcutButtonClass)} disabled={composerDisabled} aria-haspopup="dialog" onClick={() => setQuickToolsOpen(true)}><LayoutGrid size={16} />更多工具</Button>
      </div>
      {!!images.length && <div className="mb-2.5 min-w-0" aria-label="待识别截图">
        <p className="mb-1.5 text-[11px] text-muted-foreground">{images.length} / {MAX_ASSISTANT_IMAGES} 张 · 按顺序合并识别，自动衔接去重</p>
        {images.length > 1 && <p className="mb-1 text-[10px] text-muted-foreground">长按或拖动截图调整顺序</p>}
        <SortableAssistantImages images={images} disabled={busy || savingId !== null || draft.hasDraft || draft.status === "checking"}
          onReorder={setImages} onPreview={setPreviewImage} onRemove={image => setImages(current => current.filter(item => item !== image))} />
      </div>}
      <div className="flex items-end gap-1 rounded-[18px] border border-input bg-card p-1.5 shadow-[0_2px_8px_rgb(15_23_42_/_0.035)] focus-within:border-primary focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary)_9%,transparent)]">
        <Button type="button" variant="ghost" className={cn(buttonClass, iconButtonClass, recording && "bg-muted text-destructive")} aria-label={speechPhase === "starting" ? "取消语音连接" : recording ? "结束录音" : "语音输入"} disabled={!!actionPending || !!savingId || sending || taskBusy || recoveringTasks || !!outbox || transcribing || speechPhase === "finishing" || preparingImage || draft.hasDraft || draft.status === "checking" || configured === false} onClick={() => void toggleRecording()}>{transcribing || speechPhase === "starting" || speechPhase === "finishing" ? <Loader2 size={22} className="animate-spin" /> : recording ? <Square size={20} /> : <Mic size={24} />}</Button>
        <Textarea ref={composer} readOnly={voiceBusy} aria-busy={voiceBusy} className="min-h-10 max-h-[120px] min-w-0 flex-1 resize-none border-0 bg-transparent px-1.5 py-[9px] text-base md:text-[15px] leading-[22px] rounded-none shadow-none focus-visible:ring-0 [field-sizing:content] placeholder:text-muted-foreground focus-visible:outline-none" aria-label="记一笔，或问问账本" title="支持文字和粘贴多张图片" value={input} disabled={!!actionPending || sending || taskBusy || recoveringTasks || !!outbox || transcribing || draft.hasDraft || draft.status === "checking"} maxLength={4000} rows={1} placeholder={speechPhase === "starting" ? "正在连接语音…" : recording ? "请说话，文字会实时显示…" : "记一笔，或问问账本"} onChange={e => setInput(e.target.value)} onPaste={pasteImage} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        {taskBusy ? <Button type="button" size="icon" className={cn(buttonClass, "flex size-10 shrink-0 items-center justify-center rounded-[12px]")} aria-label="停止生成" title="停止生成" onClick={() => void stopTask()}><Square size={18} className="fill-current" /></Button>
          : <Button type="button" size="icon" className={cn(buttonClass, "[&_svg]:size-6 flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100")} aria-label="发送" disabled={composerDisabled || !!outbox || (!input.trim() && !images.length) || configured === false || configured === null} onClick={() => void send()}>{sending ? <Loader2 size={22} className="animate-spin" /> : <ArrowUp size={25} />}</Button>}
      </div>
      <p className={composerHintClass} role="status">{speechPhase === "starting" ? "正在连接语音，点击可取消…" : recording ? `正在听写 ${seconds} / ${MAX_AUDIO_SECONDS} 秒 · 点击停止` : speechPhase === "finishing" ? "正在确认末尾文字…" : transcribing ? "正在识别语音…" : preparingImage ? "正在准备截图…" : isInitializing ? "正在加载成员和分类…" : "AI 识别仅供参考，确认后才入账"}</p>
      {!isInitializing && !loadError && !categories.length && configured !== null && <p className={composerHintClass}><Link href="/dashboard/categories">先添加收支分类</Link></p>}
      {!isInitializing && !loadError && !members.length && configured !== null && <p className={composerHintClass}><Link href="/dashboard/members">先添加家庭成员</Link></p>}
      <input ref={imageInput} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="选择账单截图" onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ""; void selectImages(files); }} />
      <input ref={audioInput} type="file" accept="audio/*" className="sr-only" aria-label="选择录音" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file && file.size <= 10_000_000) void transcribe(file); else if (file) toast.error("音频文件过大。"); }} />
    </footer>
  </section>
    <Dialog open={!!previewImage} onOpenChange={open => { if (!open) setPreviewImage(null); }}>
      <DialogContent className="max-w-3xl" aria-describedby={undefined}>
        <DialogTitle className="pr-8 text-[14px]">{previewImage?.name || "账单截图"}</DialogTitle>
        {previewImage && <div className="min-h-0 overflow-auto"><NextImage src={previewImage.data} alt={previewImage.name} width={1600} height={1600} unoptimized className="mx-auto h-auto max-h-[70dvh] w-auto max-w-full object-contain" /></div>}
      </DialogContent>
    </Dialog>
    <Dialog open={quickToolsOpen} onOpenChange={setQuickToolsOpen}>
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); composer.current?.focus(); }}>
        <div className="shrink-0 pr-8 space-y-2"><DialogTitle className="text-base">更多工具</DialogTitle><DialogDescription className="text-xs leading-5">选择一个提问示例，补充细节后发送。保存、修改或删除都会先让你确认。</DialogDescription></div>
        <DialogBody className="space-y-2">
          {quickTools.map(({ label, description, icon: Icon, prompt }) => <Button key={label} type="button" variant="ghost" disabled={composerDisabled} className="h-auto min-h-14 w-full justify-start gap-3 whitespace-normal rounded-xl border border-border px-3 py-3 text-left hover:border-primary" onClick={() => fillQuickPrompt(prompt)}>
            <Icon size={18} className="shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{label}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{description}</span></span><ArrowUp size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          </Button>)}
        </DialogBody>
      </DialogContent>
    </Dialog>
  </DashboardLayout>;
}

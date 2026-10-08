"use client";

import Link from "next/link";
import NextImage from "next/image";
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { ArrowUp, BarChart3, Check, ChevronRight, ImagePlus, Loader2, MessageCircle, Mic, Plus, Square, Trash2, UserRound, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DraftNotice } from "@/components/ui/draft-notice";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useFormDraft } from "@/hooks/use-form-draft";
import { applyDraftMemberUpdate, assignMissingDraftMembers, confirmationRows, memberBatchQuestionText, unassignedMemberDrafts, MAX_ASSISTANT_DRAFTS, UUID_PATTERN, type AssistantCategory, type AssistantDraft, type AssistantDraftBatch, type AssistantDraftMemberChoice, type AssistantMember, type AssistantMemberSelection, type AssistantPlan } from "@/lib/assistant";
import { MAX_AUDIO_SECONDS, recordingToWav } from "@/lib/assistant-audio";
import { clipboardImage, isAssistantImage, isAssistantMessageImage, prepareAssistantMessageImage, type AssistantImage } from "@/lib/assistant-images";
import { localCalendarDate } from "@/lib/stats-period";
import { getDraftEpoch, subscribeDraftLogout } from "@/lib/form-drafts";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// `ignored` is read only to migrate conversations saved by the earlier UI.
type EditableDraft = AssistantDraft & { amount: string; ignored?: boolean };
type Message = {
  id: string; role: "user" | "assistant"; text: string; drafts?: EditableDraft[];
  status?: "pending" | "saved" | "ignored" | "deleted" | "conflict"; commit?: AssistantDraft[]; error?: string;
  memberFlow?: boolean;
  image?: AssistantImage;
  memberChoice?: AssistantDraftMemberChoice;
};
type Confirmation = { id: string; drafts: AssistantDraft[]; error?: string };
type Conversation = { messages: Message[]; input: string; image?: AssistantImage | null; confirmations?: Confirmation[] };

function memberChoiceTarget(choice: AssistantDraftMemberChoice | undefined, messages: Message[]) {
  if (!choice || choice.member_id !== null || !UUID_PATTERN.test(choice.batch_id)
    || !Array.isArray(choice.draft_ids) || !choice.draft_ids.length || choice.draft_ids.length > MAX_ASSISTANT_DRAFTS
    || new Set(choice.draft_ids).size !== choice.draft_ids.length || choice.draft_ids.some(id => typeof id !== "string" || !UUID_PATTERN.test(id))) return;
  const message = messages.find(m => m.id === choice.batch_id);
  if (!message || message.role !== "assistant" || message.status !== "pending" || message.commit || !message.drafts?.length) return;
  const drafts = message.drafts.filter(d => !d.ignored && choice.draft_ids.includes(d.id));
  if (drafts.length !== choice.draft_ids.length || new Set(drafts.map(d => d.id)).size !== drafts.length) return;
  return { message, drafts };
}

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
const fieldLabelClass = "flex min-w-0 flex-col gap-1.5 text-[12px] text-muted-foreground";
const fieldClass = "h-[42px] w-full min-w-0 rounded-[9px] border border-input bg-background px-2.5 py-2 text-base md:text-sm text-foreground";
const textButtonClass = "min-h-10 px-2.5 py-2 text-[13px] text-muted-foreground";
const shortcutButtonClass = "flex min-h-9 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[12px] border border-border bg-card p-2 text-[12px] hover:bg-muted lg:px-3.5 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";
const composerHintClass = "mt-[3px] text-center text-[10px] leading-[14px] text-muted-foreground [&_a]:underline";
const bubbleClass = "text-[14px] leading-[1.75] wrap-anywhere [&_p+p]:mt-2 [&_ul]:pl-5 [&_ol]:pl-5 [&_h2]:mt-2.5 [&_h2]:mb-[5px] [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-2.5 [&_h3]:mb-[5px] [&_h3]:font-semibold [&_h3]:text-foreground [&_a]:text-primary [&_a]:underline [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-[12px] [&_th]:border-b [&_th]:border-border [&_th]:px-[9px] [&_th]:py-1.5 [&_th]:whitespace-nowrap [&_td]:border-b [&_td]:border-border [&_td]:px-[9px] [&_td]:py-1.5 [&_td]:whitespace-nowrap";

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
  const [input, setInput] = useState("");
  const [categories, setCategories] = useState<AssistantCategory[]>([]);
  const [members, setMembers] = useState<AssistantMember[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [sending, setSending] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [image, setImage] = useState<AssistantImage | null>(null);
  const [preparingImage, setPreparingImage] = useState(false);
  const [previewImage, setPreviewImage] = useState<AssistantImage | null>(null);
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [confirmingIds, setConfirmingIds] = useState<string[]>([]);
  const [expandedDrafts, setExpandedDrafts] = useState<Record<string, boolean>>({});
  const feed = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recordingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const conversationControllers = useRef(new Set<AbortController>());
  const confirmationControllers = useRef(new Map<string, AbortController>());
  const confirmationsRef = useRef<Confirmation[]>([]);
  const conversationEpoch = useRef(0);
  const live = useRef(true);
  const saveLock = useRef(false);
  const sendLock = useRef(false);
  const recordLock = useRef(false);
  const imageSelection = useRef(0);
  const draft = useFormDraft<Conversation>({ scope: "assistant", autoRestore: true, value: { messages, input, image, confirmations }, dirty: messages.length > 0 || !!input || !!image || !!confirmations.length,
    onRestore: value => {
      if (!value || !Array.isArray(value.messages) || value.messages.length > 120 || typeof value.input !== "string"
        || value.messages.some(m => {
          if (!m || !UUID_PATTERN.test(m.id) || !["user", "assistant"].includes(m.role) || typeof m.text !== "string" || (m.drafts && !Array.isArray(m.drafts))) return true;
          return m.drafts?.some(d => !d || typeof d.amount !== "string" || typeof d.description !== "string" || typeof d.transaction_date !== "string" || !["income", "expense"].includes(d.type)) || false;
        })) {
        const recovered = confirmationSnapshots(value);
        confirmationsRef.current = recovered; setConfirmations(recovered);
        toast.error("本机对话草稿格式无效，请重新输入。"); return { messages: [], input: "", image: null, confirmations: recovered };
      }
      const restored: Conversation = { messages: value.messages.map(m => {
        const remaining = m.drafts?.filter(d => !d.ignored);
        if (m.status === "ignored" || (m.status === "pending" && !m.commit && remaining?.length === 0)) {
          return { ...m, status: "deleted" as const, drafts: [], text: "这组草稿已删除，未入账。", error: undefined, image: isAssistantMessageImage(m.image) ? m.image : undefined };
        }
        return { ...m, drafts: remaining, image: isAssistantMessageImage(m.image) ? m.image : undefined };
      }), input: value.input.slice(0, 4000), image: isAssistantImage(value.image) ? value.image : null, confirmations: confirmationSnapshots(value) };
      restored.messages = restored.messages.map(m => ({ ...m, memberChoice: m.role === "assistant" && memberChoiceTarget(m.memberChoice, restored.messages) ? m.memberChoice : undefined }));
      setMessages(restored.messages); setInput(restored.input); setImage(restored.image || null);
      confirmationsRef.current = restored.confirmations || []; setConfirmations(confirmationsRef.current);
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
    }).catch(error => { if (!controller.signal.aborted) setLoadError(error.message); });
    return () => { controller.abort(); pending.delete(controller); };
  }, [reload]);

  useEffect(() => {
    live.current = true;
    const pending = controllers.current;
    const revoke = subscribeDraftLogout(() => {
      conversationEpoch.current++;
      pending.forEach(c => c.abort());
      if (recordingTimer.current) clearInterval(recordingTimer.current);
      if (recorder.current?.state === "recording") { recorder.current.onstop = null; recorder.current.stop(); }
      stream.current?.getTracks().forEach(track => track.stop());
      imageSelection.current++;
      setMessages([]); setInput(""); setImage(null);
      setPreviewImage(null); confirmationsRef.current = []; setConfirmations([]); setConfirmingIds([]);
      setCategories([]); setMembers([]); setConfigured(false);
      setRecording(false); setTranscribing(false); setSending(false); setSavingId(null); setPreparingImage(false);
      setLoadError("登录状态已变更，请重新登录后使用助手。");
    });
    return () => {
      live.current = false; revoke(); pending.forEach(c => c.abort());
      if (recordingTimer.current) clearInterval(recordingTimer.current);
      if (recorder.current?.state === "recording") { recorder.current.onstop = null; recorder.current.stop(); }
      stream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);
  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" }); }, [messages.length, sending]);

  const busy = sending || transcribing || recording || preparingImage;
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
  const patchMessage = (id: string, update: Partial<Message>) => setMessages(current => current.map(m => m.id === id ? { ...m, ...update } : m));

  function clearConversation() {
    conversationEpoch.current++;
    conversationControllers.current.forEach(c => c.abort());
    conversationControllers.current.clear();
    sendLock.current = false; saveLock.current = false; recordLock.current = false;
    if (recordingTimer.current) clearInterval(recordingTimer.current);
    recordingTimer.current = null;
    if (recorder.current) {
      recorder.current.onstop = null; recorder.current.ondataavailable = null; recorder.current.onerror = null;
      if (recorder.current.state === "recording") recorder.current.stop();
      recorder.current = null;
    }
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    imageSelection.current++;
    setMessages([]); setInput(""); setImage(null); setPreviewImage(null); setExpandedDrafts({});
    setSending(false); setSavingId(null); setTranscribing(false); setRecording(false); setPreparingImage(false); setSeconds(0);
    const retained = confirmationsRef.current;
    draft.clear(stored => ({ messages: [], input: "", image: null, confirmations: confirmationSnapshots({
      messages: stored?.messages || [], confirmations: [...(stored?.confirmations || []), ...retained],
      input: "",
    }) }), next => !!next.confirmations?.length);
  }

  async function send() {
    const originalInput = input;
    const sentImage = image;
    const text = input.trim() || (image ? "请识别截图里的收支，生成待确认账单。" : "");
    if (!text || busy || sendLock.current || saveLock.current || draft.hasDraft || draft.status === "checking") return;
    if (configured === false) { toast.error("请先在服务端配置百炼 API Key。"); return; }
    // Keep restored conversations within the 120-message limit, including replies.
    if (messages.length >= 78) { toast.info("当前对话已较长，请先确认待处理账单，再清空对话。"); return; }
    const latestBatch = [...messages].reverse().find(m => m.drafts?.length);
    const draftBatch: AssistantDraftBatch | null = latestBatch?.status === "pending" && !latestBatch.commit
      ? { batch_id: latestBatch.id, status: "pending", drafts: latestBatch.drafts!.map(d => ({ id: d.id, type: d.type, description: d.description, member_id: d.member_id })) } : null;
    sendLock.current = true; setSending(true);
    const epoch = conversationEpoch.current;
    const controller = newController();
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", text: originalInput.trim() ? text : sentImage ? "识别这张截图" : text };
    try {
      if (sentImage) userMessage.image = await prepareAssistantMessageImage(sentImage);
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      setMessages(current => [...current.map(m => m.memberChoice ? { ...m, memberChoice: undefined } : m), userMessage]); setInput(""); setImage(null);
      const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ message: text, image: sentImage?.data, today: localCalendarDate(), draft_batch: draftBatch,
          history: messages.slice(-8).map(m => ({ role: m.role, content: m.drafts
            ? `${m.text.slice(0, 500)}\n卡片当前状态：${m.status === "saved" ? "已保存" : m.status === "deleted" ? "已删除，未入账" : m.status === "conflict" ? "保存冲突待核对" : "待确认"}。以下是用户核对编辑后的账单，以此为准，不要重复生成：\n${JSON.stringify(m.drafts.map(d => ({ type: d.type, amount_cents: Math.round(Number(d.amount) * 100), date: d.transaction_date, description: d.description.slice(0, 40) })))}`.slice(0, 4000)
            : m.text.slice(0, 4000) })) }),
      });
      const result: AssistantPlan = await responseJson(response);
      if (!currentConversation(epoch) || controller.signal.aborted) return;
      if (result.action === "update") {
        const update = result.update;
        if (!draftBatch || !update || update.batch_id !== draftBatch.batch_id) throw new Error("更新结果与当前草稿不匹配，请重试。");
        if (update.member_id === null) {
          if (!memberChoiceTarget(update, messages)) throw new Error("待修改的账目已变化，请重试。");
          const reply: Message = { id: crypto.randomUUID(), role: "assistant", text: result.reply, memberChoice: update };
          setMessages(current => [...current, memberChoiceTarget(update, current) ? reply : { ...reply, memberChoice: undefined, text: "草稿状态已变化，本次未修改。请核对当前卡片后重试。" }]);
          return;
        }
        applyDraftMemberUpdate(latestBatch!.drafts!, update, members);
        const reply: Message = { id: crypto.randomUUID(), role: "assistant", text: result.reply };
        setMessages(current => {
          const target = current.find(m => m.id === update.batch_id);
          if (!target || target.status !== "pending" || target.commit || !target.drafts?.length) {
            return [...current, { ...reply, text: "草稿状态已变化，本次未修改。请核对当前卡片后重试。" }];
          }
          let updated: EditableDraft[];
          try { updated = applyDraftMemberUpdate(target.drafts, update, members); }
          catch { return [...current, { ...reply, text: "待修改的账目已变化，本次未修改。请核对当前卡片后重试。" }]; }
          return [...current.map(m => m.id === target.id ? { ...m, drafts: updated, error: undefined } : m), reply];
        });
        setImage(null);
        return;
      }
      setImage(null);
      const unassigned = unassignedMemberDrafts(result.drafts, members);
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "assistant", text: unassigned.length ? memberBatchQuestionText(unassigned) : result.reply,
        ...(result.drafts.length ? { drafts: result.drafts.map(editDraft), status: "pending" as const, memberFlow: true } : {}) }]);
    } catch (error) {
      if (!controller.signal.aborted && currentConversation(epoch)) {
        toast.error(error instanceof Error ? error.message : "识别失败，请重试。");
        setInput(originalInput); setImage(sentImage); setMessages(current => current.filter(m => m.id !== userMessage.id));
      }
    } finally { finishController(controller); if (currentConversation(epoch)) { sendLock.current = false; setSending(false); } }
  }

  async function chooseMember(message: Message, member: AssistantMember) {
    if (busy || sendLock.current || saveLock.current || draft.hasDraft || draft.status === "checking" || message.status !== "pending" || message.commit) return;
    const unassigned = unassignedMemberDrafts(message.drafts || [], members);
    const memberDraft = unassigned[0];
    if (!memberDraft) return;
    let selected: EditableDraft[];
    try { selected = assignMissingDraftMembers(message.drafts || [], member.id, members); }
    catch (error) { toast.error(error instanceof Error ? error.message : "成员选择无效。"); return; }
    sendLock.current = true; setSending(true);
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
      setMessages(current => [...current.map(m => m.id === message.id ? { ...m, text: memberBatchQuestionText(unassigned), drafts: undefined, status: undefined, error: undefined, memberFlow: undefined, memberChoice: undefined } : m.memberChoice ? { ...m, memberChoice: undefined } : m),
        { id: crypto.randomUUID(), role: "assistant", text: "成员已补充，请核对账目后确认入账。", drafts: selected, status: "pending" as const, memberFlow: true }]);
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
    sendLock.current = true; setSending(true);
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

  async function confirm(message: Message) {
    if (saveLock.current || busy || confirmationControllers.current.has(message.id)) return;
    let submitted: AssistantDraft[];
    try { submitted = message.commit || submittedDrafts(message.drafts || []); confirmationRows(submitted); }
    catch (error) { const text = error instanceof Error ? error.message : "请核对账单。"; patchMessage(message.id, { error: text }); toast.error(text); return; }
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
        if (response.status === 400 || result.notSaved) changeConfirmation(message.id);
        else changeConfirmation(message.id, { id: message.id, drafts: submitted, error });
        patchMessage(message.id, { ...(result.batchConflict ? { status: "conflict", commit: undefined } : response.status === 400 || result.notSaved ? { commit: undefined } : {}), error });
        if (!currentConversation(epoch)) toast.error(error);
        return;
      }
      changeConfirmation(message.id);
      patchMessage(message.id, { status: "saved", error: undefined, commit: undefined });
      toast.success(`${result.count} 笔已记入账本${result.replayed ? "（已核对，无重复记账）" : ""}`);
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

  function updateDraft(messageId: string, draftId: string, update: Partial<EditableDraft>) {
    if (busy || sendLock.current || saveLock.current) return;
    setMessages(current => current.map(m => {
      if ("member_id" in update && m.memberChoice?.batch_id === messageId && m.memberChoice.draft_ids.includes(draftId)) return { ...m, memberChoice: undefined };
      return m.id === messageId && m.status === "pending" && !m.commit ? { ...m, error: undefined, drafts: m.drafts?.map(d => d.id === draftId ? { ...d, ...update } : d) } : m;
    }));
  }

  function deleteDrafts(messageId: string, draftId?: string) {
    if (busy || saveLock.current || sendLock.current) return;
    setMessages(current => current.map(m => {
      if (m.memberChoice?.batch_id === messageId && (!draftId || m.memberChoice.draft_ids.includes(draftId))) return { ...m, memberChoice: undefined };
      // An unresolved save must keep the exact original batch available for retry.
      if (m.id !== messageId || m.status !== "pending" || m.commit) return m;
      const remaining = draftId ? m.drafts?.filter(d => d.id !== draftId) || [] : [];
      const unassigned = m.memberFlow ? unassignedMemberDrafts(remaining, members) : [];
      return remaining.length ? { ...m, drafts: remaining, ...(m.memberFlow ? { text: unassigned.length ? memberBatchQuestionText(unassigned) : "请核对账目后确认入账。" } : {}), error: undefined }
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
    if (recording) { recorder.current?.stop(); return; }
    if (busy || recordLock.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { toast.info("当前浏览器无法录音，可选择一段60秒以内的音频。"); audioInput.current?.click(); return; }
    recordLock.current = true;
    const epoch = conversationEpoch.current;
    const startedEpoch = getDraftEpoch();
    let media: MediaStream | undefined;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!currentConversation(epoch) || startedEpoch !== getDraftEpoch()) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(type => MediaRecorder.isTypeSupported(type));
      const next = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = []; recorder.current = next;
      next.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      next.onstop = () => {
        if (!currentConversation(epoch)) { media?.getTracks().forEach(track => track.stop()); return; }
        if (recordingTimer.current) clearInterval(recordingTimer.current);
        media?.getTracks().forEach(track => track.stop()); recorder.current = null;
        setRecording(false); void transcribe(new Blob(chunks, { type: next.mimeType }), true);
      };
      next.onerror = () => { media?.getTracks().forEach(track => track.stop()); if (currentConversation(epoch)) toast.error("录音失败，请重新录音。"); };
      setSeconds(0); setRecording(true); next.start();
      // This clock read runs in the recording click handler, after getUserMedia.
      // eslint-disable-next-line react-hooks/purity
      const started = Date.now();
      recordingTimer.current = setInterval(() => {
        if (!currentConversation(epoch)) return;
        const elapsed = Math.floor((Date.now() - started) / 1000); setSeconds(elapsed);
        if (elapsed >= MAX_AUDIO_SECONDS && next.state === "recording") next.stop();
      }, 250);
    } catch (error) {
      media?.getTracks().forEach(track => track.stop());
      if (currentConversation(epoch)) toast.error(error instanceof DOMException && error.name === "NotAllowedError" ? "麦克风权限未开启，请在浏览器设置中允许录音。" : "无法启动麦克风，请使用 HTTPS 或本机浏览器重试。");
    } finally { if (currentConversation(epoch)) recordLock.current = false; }
  }

  async function selectImage(file: File, name = file.name) {
    if (sending || recording || transcribing || sendLock.current || saveLock.current || draft.hasDraft || draft.status === "checking") return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10_000_000) { toast.error("请选择10MB以内的 JPG、PNG 或 WebP 图片。"); return; }
    const selection = ++imageSelection.current;
    setPreparingImage(true);
    const startedEpoch = getDraftEpoch();
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      const scale = Math.min(1, 1920 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas"); canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      const context = canvas.getContext("2d"); if (!context) throw new Error("无法读取图片。");
      context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.8);
      if (data.length > 2_000_000) throw new Error("图片过大，请裁剪到账单区域后重试。");
      if (live.current && startedEpoch === getDraftEpoch() && selection === imageSelection.current) setImage({ data, name: name.slice(0, 255) || "粘贴的图片" });
    } catch (error) { if (live.current && startedEpoch === getDraftEpoch() && selection === imageSelection.current) toast.error(error instanceof Error ? error.message : "图片读取失败。"); }
    finally { URL.revokeObjectURL(url); if (live.current && selection === imageSelection.current) setPreparingImage(false); }
  }

  function pasteImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = clipboardImage(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    void selectImage(file, "粘贴的图片");
  }

  function manualEntry() {
    if (busy || draft.hasDraft || saveLock.current || messages.length >= 120) return;
    const d: EditableDraft = { id: crypto.randomUUID(), type: "expense", amount_cents: 0, amount: "", category_id: null,
      member_id: null, transaction_date: localCalendarDate(), description: "", payment_method: null, note: "" };
    setMessages(current => [...current.map(m => m.memberChoice ? { ...m, memberChoice: undefined } : m), { id: crypto.randomUUID(), role: "assistant", text: "填好下面这笔账，再确认入账。", drafts: [d], status: "pending" }]);
  }

  const composerDisabled = busy || draft.hasDraft || draft.status === "checking" || savingId !== null;
  const activeMemberChoice = [...messages].reverse().find(m => m.memberChoice && memberChoiceTarget(m.memberChoice, messages));
  const detachedConfirmations = confirmations.filter(c => !messages.some(m => m.id === c.id && m.status === "pending" && m.commit));
  return <DashboardLayout viewport contentClassName="pb-1.5 md:pb-1.5 lg:pb-7"><section className="flex h-full min-h-0 w-full flex-col text-foreground lg:mx-auto lg:max-w-[1000px] [&_*]:motion-reduce:scroll-auto [&_*]:motion-reduce:transition-none" aria-label="AI 记账">
    <header className="mb-3.5 flex shrink-0 items-center gap-3">
      <div className="flex size-[42px] shrink-0 items-center justify-center rounded-[14px] bg-[color-mix(in_srgb,var(--color-primary)_9%,var(--color-background))] text-primary"><MessageCircle size={22} /></div>
      <div className="min-w-0 flex-1"><h1 className="text-[20px] leading-[26px] font-semibold tracking-[-0.5px]">AI 记账</h1><p className="mt-[3px] text-[12px] leading-[18px] text-muted-foreground">{unresolved ? `${unresolved} 笔待确认` : "随手记录，清楚每一笔"}</p></div>
      <Button type="button" variant="ghost" className={cn(buttonClass, iconButtonClass)} aria-label="清空对话" onClick={clearConversation} title="清空对话"><Trash2 size={19} /></Button>
    </header>
    <DraftNotice draft={draft} hideSaved />
    {!!detachedConfirmations.length && <div className="mb-3 max-h-32 shrink-0 overflow-y-auto rounded-[10px] bg-muted px-3 py-2.5 text-[12px]" aria-label="入账结果核对">
      {detachedConfirmations.map(c => <div key={c.id} className="flex items-center justify-between gap-3 py-1">
        <span>{c.drafts.length} 笔入账结果待核对{c.error ? <span className="mt-1 block text-[11px] text-muted-foreground">{c.error}</span> : null}</span>
        <Button type="button" variant="ghost" className={cn(buttonClass, "shrink-0 text-primary underline")} disabled={busy || savingId !== null || confirmingIds.includes(c.id)} onClick={() => void confirm({ id: c.id, role: "assistant", text: "", status: "pending", commit: c.drafts })}>{confirmingIds.includes(c.id) ? "正在核对…" : "核对原批次"}</Button>
      </div>)}
    </div>}
    {loadError && <div className="mb-3 flex items-center gap-3 rounded-[10px] bg-muted px-3 py-2.5 text-[13px]" role="alert">{loadError}<Button type="button" variant="ghost" className={cn(buttonClass, "ml-auto whitespace-nowrap underline")} onClick={() => setReload(v => v + 1)}>重新加载</Button></div>}
    {configured === false && <div className="mb-3 flex items-center gap-3 rounded-[10px] bg-muted px-3 py-2.5 text-[13px]" role="status">AI 尚未配置，请完成百炼服务端配置。仍可手动填写确认卡片。</div>}
    <div ref={feed} className="min-h-0 flex-1 overflow-auto overscroll-contain scroll-smooth [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent] motion-reduce:scroll-auto" aria-live="polite" aria-relevant="additions text">
      {!messages.length && <div className="mx-auto mt-[clamp(16px,6dvh,60px)] mb-7 w-full max-w-[380px]">
        <span className="text-[12px] font-medium text-primary">你的日常账本</span>
        <h2 className="mt-2.5 text-[25px] leading-[1.4] font-[650] tracking-[-0.8px] [@media(max-width:360px)]:text-[23px]">今天的钱，花到哪了？</h2>
        <p className="mt-3 mb-[26px] text-[13px] leading-[1.8] text-muted-foreground">用文字、语音或截图记录收支，<br />我来整理，你来确认。</p>
        <Button type="button" variant="ghost" className={cn(buttonClass, "mt-2.5 flex w-full items-center justify-between gap-3 rounded-[14px] border border-border bg-card px-4 py-3.5 text-left text-[13px] hover:border-primary")} disabled={composerDisabled} onClick={() => setInput("这个月主要花在哪些分类？")}><span className="min-w-0"><span className="mb-[5px] block text-[11px] text-muted-foreground">看看消费情况</span><span>这个月主要花在哪些分类？</span></span><ArrowUp size={16} className="shrink-0 text-muted-foreground" /></Button>
      </div>}
      {messages.map(message => {
        const replacement = message.id === activeMemberChoice?.id ? memberChoiceTarget(message.memberChoice, messages) : undefined;
        const unassigned = message.memberFlow && message.status === "pending" && !message.commit && activeMemberChoice?.memberChoice?.batch_id !== message.id ? unassignedMemberDrafts(message.drafts || [], members) : [];
        const question = unassigned[0];
        const questionTotal = unassigned.every(d => /^\d{1,10}(\.\d{1,2})?$/.test(d.amount))
          ? money(unassigned.reduce((sum, d) => sum + Math.round(Number(d.amount) * 100), 0)) : "—";
        return <div key={message.id} className={cn("mb-5 flex", message.role === "user" && "justify-end")} data-message-role={message.role}>
        <div className={cn("min-w-0 max-w-full", message.role === "user" && "max-w-[88%]", (question || replacement) && "w-[400px]")}>
          <div className={cn(bubbleClass, message.role === "user" ? "rounded-[17px_17px_5px_17px] bg-[color-mix(in_srgb,var(--color-primary)_9%,var(--color-background))] px-[15px] py-[11px] text-foreground" : "text-muted-foreground")}>
            {message.image && <Button type="button" variant="ghost" className={cn(buttonClass, "mb-2 block max-w-full hover:bg-transparent overflow-hidden rounded-[10px]")} aria-label={`查看图片：${message.image.name}`} onClick={() => setPreviewImage(message.image!)}><NextImage src={message.image.data} alt={message.image.name} width={240} height={240} unoptimized className="h-auto max-h-[260px] w-auto max-w-full object-contain" /></Button>}
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} disallowedElements={["img"]}>{question ? memberBatchQuestionText(unassigned) : message.text}</ReactMarkdown>
          </div>
          {replacement && <div className="mt-2.5 w-[min(400px,100%)] rounded-[16px] border border-border bg-card p-3.5" aria-label="修改记账成员">
            <p className="mb-3 flex items-baseline justify-between gap-3 text-[13px]"><span className="min-w-0 wrap-anywhere">{replacement.drafts.length === 1 ? replacement.drafts[0].description || "这笔账" : `修改这 ${replacement.drafts.length} 笔账目的人员`}</span>{replacement.drafts.length === 1 && <strong className="shrink-0 text-[16px]">¥{replacement.drafts[0].amount}</strong>}</p>
            {members.length ? <div className="flex flex-wrap gap-2">{members.map(member => <Button type="button" variant="ghost" key={member.id} className={cn(buttonClass, "flex min-h-11 max-w-full items-center gap-[7px] rounded-[12px] border border-primary/25 bg-primary/5 px-3.5 py-2.5 text-[14px] hover:border-primary hover:bg-primary/10")} disabled={composerDisabled} onClick={() => void selectReplacementMember(message, member)}><UserRound size={16} aria-hidden="true" className="shrink-0 text-primary" /><span className="wrap-anywhere">{member.name}</span></Button>)}</div>
              : <p className="text-[13px] text-muted-foreground">还没有可选成员，<Link className="ml-1.5 underline" href="/dashboard/members">先添加成员</Link><Button type="button" variant="ghost" className={cn(buttonClass, "ml-1.5 underline")} disabled={busy} onClick={() => setReload(v => v + 1)}>刷新成员</Button></p>}
            <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground"><span>点击人员，自动回复并更新</span><Button type="button" variant="ghost" className={cn(buttonClass, "shrink-0 py-1 underline")} disabled={composerDisabled} onClick={() => patchMessage(message.id, { memberChoice: undefined })}>取消修改</Button></div>
          </div>}
          {question && <div className="mt-2.5 w-[min(400px,100%)] rounded-[16px] border border-border bg-card p-3.5" aria-label="选择记账成员">
            <p className="mb-3 flex items-baseline gap-2 text-[13px]"><span className="min-w-0 wrap-anywhere">{unassigned.length > 1 ? `${unassigned.length} 笔待选成员` : question.description || "这笔账"}</span><strong className="ml-auto whitespace-nowrap text-[16px]">¥{questionTotal}</strong>{unassigned.length === 1 && <span className="shrink-0 text-[11px] text-muted-foreground">{question.type === "expense" ? "支出" : "收入"}</span>}</p>
            {members.length ? <div className="flex flex-wrap gap-2">{members.map(member => <Button type="button" variant="ghost" key={member.id} className={cn(buttonClass, "flex min-h-11 max-w-full items-center gap-[7px] rounded-[12px] border border-[color-mix(in_srgb,var(--color-primary)_24%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-primary)_4%,var(--color-card))] px-3.5 py-2.5 text-[14px] hover:border-primary hover:bg-[color-mix(in_srgb,var(--color-primary)_9%,var(--color-card))]")} disabled={composerDisabled} onClick={() => void chooseMember(message, member)}><UserRound size={16} aria-hidden="true" className="shrink-0 text-primary" /><span className="wrap-anywhere">{member.name}</span></Button>)}</div>
              : <p className="text-[13px] text-muted-foreground">还没有可选成员，<Link className="ml-1.5 underline" href="/dashboard/members">先添加成员</Link><Button type="button" variant="ghost" className={cn(buttonClass, "ml-1.5 underline")} disabled={busy} onClick={() => setReload(v => v + 1)}>刷新成员</Button></p>}
            {unassigned.length > 1 && <p className="mt-2.5 text-[11px] leading-[1.6] text-muted-foreground">选一次应用到这 {unassigned.length} 笔，确认前可逐笔修改。</p>}
            {unassigned.length > 1 && <ul className="mt-3.5 grid list-none gap-[9px] p-0" aria-label="待选成员的账目">{unassigned.map(d => <li key={d.id} className="flex items-center justify-between gap-3 text-[12px]"><span className="min-w-0 wrap-anywhere">{d.description || "待填用途"}<small className="mt-px block text-[10px] text-muted-foreground">{d.transaction_date}</small></span><span className="shrink-0 tabular-nums">¥{d.amount}</span></li>)}</ul>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[11px] text-muted-foreground"><span>点击名字，自动回复</span><div className="flex flex-wrap gap-3">{unassigned.length === 1 && <Button type="button" variant="ghost" className={cn(buttonClass, "py-[3px] text-destructive")} disabled={composerDisabled} onClick={() => deleteDrafts(message.id, question.id)}>删除这笔草稿</Button>}{message.drafts!.length > 1 && <Button type="button" variant="ghost" className={cn(buttonClass, "py-[3px] text-destructive")} disabled={composerDisabled} onClick={() => deleteDrafts(message.id)}>删除本组</Button>}</div></div>
          </div>}
          {!!message.drafts?.length && !question && <div className="mt-3 w-[470px] max-w-full overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_2px_6px_rgb(15_23_42_/_0.025)]">
            <div className="flex items-center justify-between gap-3 border-b border-border px-[15px] py-[13px] text-[12px] text-muted-foreground"><span className="flex items-center gap-[7px] font-medium text-foreground"><span className={cn("size-1.5 rounded-full", message.status === "pending" ? "bg-primary" : "bg-muted-foreground")} />{message.status === "saved" ? "已确认账目" : "核对账目"}</span><span>{message.drafts.length} 笔</span></div>
            {message.drafts.map(d => {
              const category = categories.find(c => c.id === d.category_id);
              const member = members.find(m => m.id === d.member_id);
              const locked = message.status !== "pending" || !!message.commit || !!savingId || busy;
              const canDelete = message.status === "pending" && !message.commit;
              return <div key={d.id} className="relative border-b border-border">
              <details className="peer group/draft" open={expandedDrafts[d.id] ?? (message.status === "pending" && (!d.category_id || !d.member_id || !d.amount))} onToggle={event => {
                const open = event.currentTarget.open;
                setExpandedDrafts(current => current[d.id] === open ? current : { ...current, [d.id]: open });
              }}>
                <summary className={cn("flex min-h-[78px] cursor-pointer list-none items-center gap-2.5 px-3.5 py-[13px] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-[3px] [&::-webkit-details-marker]:hidden [@media(max-width:360px)]:gap-2 [@media(max-width:360px)]:p-3", canDelete && "pr-14 group-open/draft:pr-3.5 [@media(max-width:360px)]:pr-12 [@media(max-width:360px)]:group-open/draft:pr-3")}><span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-muted text-[20px] text-primary">{category?.icon || (d.type === "expense" ? "↗" : "↙")}</span><span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] leading-[21px] font-semibold" title={d.description}>{d.description || "待填用途"}</span>
                  <span className="mt-1 block truncate text-[11px] leading-4 text-muted-foreground" title={`${category?.name || "待选分类"} · ${d.transaction_date}${d.payment_method ? ` · ${d.payment_method}` : ""}`}>{category?.name || "待选分类"} · {d.transaction_date === localCalendarDate() ? "今天" : d.transaction_date}{d.payment_method ? ` · ${d.payment_method}` : ""}</span>
                </span><span className="max-w-[125px] shrink-0 text-right" data-type={d.type}><strong className={cn("block text-[17px] leading-[23px] font-[650] tracking-[-0.4px] wrap-anywhere [@media(max-width:360px)]:text-[16px]", d.type === "income" && "text-primary")}>¥{d.amount || "—"}</strong><span className="mt-[3px] block max-w-[100px] truncate text-[10px] leading-4 text-muted-foreground">{d.type === "expense" ? "支出" : "收入"} · {member?.name || "待选成员"}</span></span><ChevronRight size={15} className="shrink-0 text-muted-foreground transition-transform duration-150 ease-[ease] group-open/draft:rotate-90 motion-reduce:transition-none" /></summary>
                <div className="grid grid-cols-2 gap-3 px-3.5 pt-0.5 pb-4 [@media(max-width:360px)]:grid-cols-1">
                  <div className={fieldLabelClass}>
                    <Label htmlFor={`${d.id}-type`}>收支类型</Label>
                    <Select value={d.type} disabled={locked} onValueChange={value => updateDraft(message.id, d.id, { type: value as "income" | "expense", category_id: null })}>
                      <SelectTrigger id={`${d.id}-type`} className={fieldClass} aria-label="收支类型"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="expense">支出</SelectItem><SelectItem value="income">收入</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className={fieldLabelClass}>
                    <Label htmlFor={`${d.id}-amount`}>金额</Label>
                    <Input id={`${d.id}-amount`} className={fieldClass} aria-label="金额" inputMode="decimal" value={d.amount} disabled={locked} onChange={e => updateDraft(message.id, d.id, { amount: e.target.value })} placeholder="0.00" />
                  </div>
                  <div className={fieldLabelClass}>
                    <Label htmlFor={`${d.id}-category`}>分类</Label>
                    <Select value={d.category_id || ""} disabled={locked} onValueChange={value => updateDraft(message.id, d.id, { category_id: value === "unselected" ? null : value })}>
                      <SelectTrigger id={`${d.id}-category`} className={fieldClass} aria-label="分类"><SelectValue placeholder="请选择分类" /></SelectTrigger>
                      <SelectContent><SelectItem value="unselected">请选择分类</SelectItem>{categories.filter(c => c.type === d.type).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className={fieldLabelClass}>
                    <Label htmlFor={`${d.id}-member`}>家庭成员</Label>
                    <Select value={d.member_id || ""} disabled={locked} onValueChange={value => updateDraft(message.id, d.id, { member_id: value === "unselected" ? null : value })}>
                      <SelectTrigger id={`${d.id}-member`} className={fieldClass} aria-label="家庭成员"><SelectValue placeholder="请选择成员" /></SelectTrigger>
                      <SelectContent><SelectItem value="unselected">请选择成员</SelectItem>{members.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className={fieldLabelClass}>
                    <Label htmlFor={`${d.id}-date`}>日期</Label>
                    <Input id={`${d.id}-date`} className={fieldClass} aria-label="日期" type="date" value={d.transaction_date} disabled={locked} onChange={e => updateDraft(message.id, d.id, { transaction_date: e.target.value })} />
                  </div>
                  <div className={fieldLabelClass}>
                    <Label htmlFor={`${d.id}-payment`}>支付方式</Label>
                    <Input id={`${d.id}-payment`} className={fieldClass} aria-label="支付方式" value={d.payment_method || ""} maxLength={40} disabled={locked} onChange={e => updateDraft(message.id, d.id, { payment_method: e.target.value || null })} placeholder="可选" />
                  </div>
                  <div className={cn(fieldLabelClass, "col-span-2 [@media(max-width:360px)]:col-auto")}>
                    <Label htmlFor={`${d.id}-description`}>备注</Label>
                    <Input id={`${d.id}-description`} className={fieldClass} aria-label="备注" value={d.description} maxLength={500} disabled={locked} onChange={e => updateDraft(message.id, d.id, { description: e.target.value })} placeholder="这笔钱的用途" />
                  </div>
                  {canDelete && <Button type="button" variant="ghost" className={cn(buttonClass, textButtonClass, "col-span-2 flex items-center justify-center gap-1.5 text-destructive [@media(max-width:360px)]:col-auto")} disabled={locked} onClick={() => deleteDrafts(message.id, d.id)}><Trash2 size={14} />删除这笔草稿</Button>}
                </div>
              </details>
              {canDelete && <Button type="button" variant="ghost" className={cn(buttonClass, "absolute right-2 top-[23px] flex size-8 items-center justify-center rounded-md text-destructive/80 hover:bg-destructive/10 hover:text-destructive peer-open:hidden")} aria-label="删除这笔草稿" title="删除这笔草稿" disabled={locked} onClick={() => deleteDrafts(message.id, d.id)}><Trash2 size={16} /></Button>}
              </div>;
            })}
            {message.error && <p className="px-3.5 pt-2.5 text-[12px] text-destructive" role="alert">{message.error}</p>}
            {message.status === "pending" && <div className="flex items-center gap-2.5 px-3.5 py-[13px]">
              {!message.commit && <Button type="button" variant="ghost" className={cn(buttonClass, textButtonClass, "flex-1 rounded-[10px] border border-border")} disabled={!!savingId || busy} onClick={() => deleteDrafts(message.id)}>删除本组</Button>}
              {message.commit && <span className="text-xs text-muted-foreground">重试将核对原批次</span>}
              <Button type="button" className={cn(buttonClass, "flex min-h-[42px] flex-[1.4] items-center justify-center gap-1.5 rounded-[10px] bg-primary px-3.5 py-2.5 text-[13px] font-semibold text-primary-foreground")} disabled={!!savingId || busy || activeMemberChoice?.memberChoice?.batch_id === message.id} onClick={() => void confirm(message)}>
                {savingId === message.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{savingId === message.id ? "正在确认" : message.commit ? "重试确认" : `确认 ${message.drafts.length} 笔`}
              </Button>
            </div>}
            {message.status === "saved" && <div className="flex items-center gap-1.5 p-3.5 text-[13px] text-primary"><Check size={16} />已记入账本<Link className="ml-auto underline" href="/dashboard">查看记录</Link></div>}
            {message.status === "conflict" && <p className="px-3.5 py-3 text-[12px] text-muted-foreground"><Link href="/dashboard">核对原批次的交易记录</Link></p>}
          </div>}
        </div>
      </div>; })}
      {sending && <div className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status"><Loader2 size={17} className="animate-spin" />正在整理…</div>}
    </div>
    <footer className="shrink-0 pt-3">
      <div className="mb-2.5 grid grid-cols-3 gap-2 lg:flex [@media(max-width:360px)]:gap-1.5">
        <Button type="button" variant="ghost" className={cn(buttonClass, shortcutButtonClass)} disabled={composerDisabled} onClick={() => imageInput.current?.click()}><ImagePlus size={16} />识别截图</Button>
        <Button type="button" variant="ghost" className={cn(buttonClass, shortcutButtonClass)} disabled={composerDisabled} onClick={manualEntry}><Plus size={16} />手动记账</Button>
        <Button type="button" variant="ghost" className={cn(buttonClass, shortcutButtonClass)} disabled={composerDisabled} onClick={() => setInput("这个月收入、支出和结余各是多少？主要花在哪些分类？")}><BarChart3 size={16} />本月统计</Button>
      </div>
      {image && <div className="mb-2.5 flex items-center gap-2 rounded-[12px] border border-border bg-card px-3 py-2 text-[12px]"><NextImage src={image.data} alt="待识别截图" width={48} height={48} unoptimized className="size-12 shrink-0 rounded-[7px] border border-border object-cover" /><div className="min-w-0 flex-1"><span className="block truncate">{image.name}</span><span className="mt-1 block truncate text-[11px] text-muted-foreground">点击发送后识别</span></div><Button type="button" variant="ghost" className={buttonClass} aria-label="移除截图" disabled={busy} onClick={() => setImage(null)}><X size={16} /></Button></div>}
      <div className="flex items-end gap-1 rounded-[18px] border border-input bg-card p-1.5 shadow-[0_2px_8px_rgb(15_23_42_/_0.035)] focus-within:border-primary focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary)_9%,transparent)]">
        <Button type="button" variant="ghost" className={cn(buttonClass, iconButtonClass, recording && "bg-muted text-destructive")} aria-label={recording ? "结束录音" : "语音输入"} disabled={!!savingId || sending || transcribing || preparingImage || draft.hasDraft || draft.status === "checking" || configured === false} onClick={() => void toggleRecording()}>{transcribing ? <Loader2 size={22} className="animate-spin" /> : recording ? <Square size={20} /> : <Mic size={24} />}</Button>
        <Textarea className="min-h-10 max-h-[120px] min-w-0 flex-1 resize-none border-0 bg-transparent px-1.5 py-[9px] text-base md:text-[15px] leading-[22px] rounded-none shadow-none focus-visible:ring-0 [field-sizing:content] placeholder:text-muted-foreground focus-visible:outline-none" aria-label="记一笔，或问问账本" title="支持文字和直接粘贴图片" value={input} disabled={sending || recording || transcribing || draft.hasDraft || draft.status === "checking"} maxLength={4000} rows={1} placeholder={recording ? `正在录音 ${seconds}s，点击停止` : "记一笔，或问问账本"} onChange={e => setInput(e.target.value)} onPaste={pasteImage} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <Button type="button" size="icon" className={cn(buttonClass, "[&_svg]:size-6 flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100")} aria-label="发送" disabled={composerDisabled || (!input.trim() && !image) || configured === false || configured === null} onClick={() => void send()}>{sending ? <Loader2 size={22} className="animate-spin" /> : <ArrowUp size={25} />}</Button>
      </div>
      <p className={composerHintClass} role="status">{recording ? `正在录音 ${seconds} / ${MAX_AUDIO_SECONDS} 秒` : transcribing ? "正在识别语音…" : preparingImage ? "正在准备截图…" : "AI 识别仅供参考，确认后才入账"}</p>
      {!categories.length && configured !== null && <p className={composerHintClass}><Link href="/dashboard/categories">先添加收支分类</Link></p>}
      {!members.length && configured !== null && <p className={composerHintClass}><Link href="/dashboard/members">先添加家庭成员</Link></p>}
      <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="选择账单截图" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void selectImage(file); }} />
      <input ref={audioInput} type="file" accept="audio/*" className="sr-only" aria-label="选择录音" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file && file.size <= 10_000_000) void transcribe(file); else if (file) toast.error("音频文件过大。"); }} />
    </footer>
  </section>
    <Dialog open={!!previewImage} onOpenChange={open => { if (!open) setPreviewImage(null); }}>
      <DialogContent className="max-w-3xl" aria-describedby={undefined}>
        <DialogTitle className="pr-8 text-[14px]">{previewImage?.name || "账单截图"}</DialogTitle>
        {previewImage && <div className="min-h-0 overflow-auto"><NextImage src={previewImage.data} alt={previewImage.name} width={1600} height={1600} unoptimized className="mx-auto h-auto max-h-[70dvh] w-auto max-w-full object-contain" /></div>}
      </DialogContent>
    </Dialog>
  </DashboardLayout>;
}

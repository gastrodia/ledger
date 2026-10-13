"use client";

import { toast } from "@/hooks/use-toast";
import { recordingToWav } from "@/lib/assistant-audio";
import { appendAssistantImages, clipboardImages, MAX_ASSISTANT_IMAGE_LENGTH, MAX_ASSISTANT_IMAGES, type AssistantImage } from "@/lib/assistant-images";
import { startSpeechRecording, type SpeechPhase, type SpeechRecording } from "@/lib/assistant-speech";
import { appendSpeechTranscript } from "@/lib/assistant-speech-transcript";
import { assistantResponseJson as responseJson } from "@/lib/assistant-task-client";
import { getDraftEpoch } from "@/lib/form-drafts";
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import type { AssistantActivity } from "./use-assistant-controller";
import type { AssistantSession } from "./use-assistant-session";

export function useAssistantInput(session: Pick<AssistantSession, "input" | "setInput" | "images" | "setImages" | "composerRef" | "conversationEpochRef" | "liveRef" | "saveLockRef" | "sendLockRef" | "draft" | "newController" | "finishController" | "currentConversation">, activity: () => AssistantActivity) {
  const { input, setInput, images, setImages, composerRef, conversationEpochRef, liveRef, saveLockRef, sendLockRef, draft, newController, finishController, currentConversation } = session;
  const [transcribing, setTranscribing] = useState(false);
  const [speechPhase, setSpeechPhase] = useState<SpeechPhase | null>(null);
  const recording = speechPhase === "recording";
  const voiceBusy = speechPhase !== null;
  const [seconds, setSeconds] = useState(0);
  const [preparingImage, setPreparingImage] = useState(false);
  const [previewImage, setPreviewImage] = useState<AssistantImage | null>(null);
  const [quickToolsOpen, setQuickToolsOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const speechRef = useRef<SpeechRecording | null>(null);
  const recordLockRef = useRef(false);
  const imageSelectionRef = useRef(0);
  const imagePrepareLockRef = useRef(false);
  useEffect(() => { if (voiceBusy && composerRef.current) composerRef.current.scrollTop = composerRef.current.scrollHeight; }, [input, voiceBusy, composerRef]);
  async function transcribe(blob: Blob, clipToLimit = false) {
    if (!liveRef.current) return;
    const epoch = conversationEpochRef.current;
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
    if (speechRef.current) { speechRef.current.stop(); return; }
    if (activity().busy || recordLockRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") { toast.info("当前浏览器不支持实时录音，可选择一段60秒以内的音频。"); audioInputRef.current?.click(); return; }
    if (input.length >= 4000) { toast.info("输入框已满，请先发送或删减文字。"); return; }
    recordLockRef.current = true;
    const epoch = conversationEpochRef.current;
    const startedEpoch = getDraftEpoch();
    const controller = newController();
    const originalInput = input;
    const active = () => currentConversation(epoch) && startedEpoch === getDraftEpoch() && !controller.signal.aborted;
    let session: SpeechRecording | undefined;
    try {
      session = startSpeechRecording({
        signal: controller.signal,
        onText: text => {
          if (!active()) return;
          const combined = appendSpeechTranscript(originalInput, text);
          setInput(combined);
          if (combined.length >= 4000) speechRef.current?.stop();
        },
        onPhase: phase => { if (active()) setSpeechPhase(phase); },
        onSeconds: elapsed => { if (active()) setSeconds(elapsed); },
      });
      speechRef.current = session;
      const text = await session.done;
      if (active()) {
        if (text.trim()) toast.success("语音已转成文字，核对后点击发送。");
        else toast.info("没有识别到语音，请靠近麦克风重试。");
      }
    } catch (error) {
      if (active() && !(error instanceof DOMException && error.name === "AbortError")) toast.error(error instanceof Error ? error.message : "语音识别失败，请重试。");
    } finally {
      finishController(controller);
      if (speechRef.current === session) speechRef.current = null;
      if (active()) { recordLockRef.current = false; setSpeechPhase(null); }
    }
  }

  async function selectImages(files: File[], pasted = false) {
    if (activity().busy || voiceBusy || transcribing || sendLockRef.current || saveLockRef.current || draft.hasDraft || draft.status === "checking") return;
    if (imagePrepareLockRef.current) { toast.info("截图正在准备，请稍后再添加。"); return; }
    if (!files.length) return;
    if (files.length + images.length > MAX_ASSISTANT_IMAGES) { toast.error(`一次最多选择 ${MAX_ASSISTANT_IMAGES} 张截图，请分批识别。`); return; }
    if (files.some(file => !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10_000_000)) { toast.error("请选择10MB以内的 JPG、PNG 或 WebP 图片。"); return; }
    const selection = ++imageSelectionRef.current;
    imagePrepareLockRef.current = true; setPreparingImage(true);
    const startedEpoch = getDraftEpoch();
    const epoch = conversationEpochRef.current;
    const current = () => currentConversation(epoch) && startedEpoch === getDraftEpoch() && selection === imageSelectionRef.current;
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
    finally { if (selection === imageSelectionRef.current) { imagePrepareLockRef.current = false; if (liveRef.current) setPreparingImage(false); } }
  }

  function pasteImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = clipboardImages(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    void selectImages(files, true);
  }

  function resetInput(kind: "clear" | "logout") {
    speechRef.current?.cancel(); speechRef.current = null; recordLockRef.current = false;
    imageSelectionRef.current++; imagePrepareLockRef.current = false;
    setPreviewImage(null); setTranscribing(false); setSpeechPhase(null); setPreparingImage(false);
    if (kind === "clear") setSeconds(0);
  }
  useEffect(() => () => { speechRef.current?.cancel(); speechRef.current = null; }, []);

  return { transcribing, speechPhase, recording, voiceBusy, seconds, preparingImage, previewImage, setPreviewImage, quickToolsOpen, setQuickToolsOpen, imageInputRef, audioInputRef, toggleRecording, selectImages, pasteImage, transcribe, resetInput };
}

import { MAX_AUDIO_SECONDS } from "@/lib/assistant-audio";
import { SpeechTranscript } from "@/lib/assistant-speech-transcript";

export type SpeechPhase = "starting" | "recording" | "finishing";
export type SpeechRecording = { stop(): void; cancel(): void; done: Promise<string> };
type Options = {
  signal: AbortSignal;
  onText(text: string): void;
  onPhase(phase: SpeechPhase): void;
  onSeconds(seconds: number): void;
};

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) { promise.catch(() => {}); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

// Capture and transport have one lifetime, so cancellation during permissions,
// setup, recording or finalization always closes every resource.
export function startSpeechRecording(options: Options): SpeechRecording {
  const lifetime = new AbortController();
  const signal = AbortSignal.any([options.signal, lifetime.signal]);
  const transcript = new SpeechTranscript();
  let phase: SpeechPhase = "starting", closed = false, finished = false;
  let media: MediaStream | undefined, context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined, capture: AudioWorkletNode | undefined;
  let socket: WebSocket | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let flushDeadline: ReturnType<typeof setTimeout> | undefined;
  let resolveReady: () => void = () => {}, resolveFinished: () => void = () => {};
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  const completed = new Promise<void>(resolve => { resolveFinished = resolve; });
  const fail = (message: string) => lifetime.abort(new Error(message));
  const setPhase = (next: SpeechPhase) => { phase = next; options.onPhase(next); };
  const setDeadline = (ms: number, action: () => void) => { clearTimeout(deadline); deadline = setTimeout(action, ms); };

  function releaseCapture() {
    if (capture) { capture.port.onmessage = null; capture.onprocessorerror = null; capture.disconnect(); capture.port.close(); capture = undefined; }
    source?.disconnect(); source = undefined;
    media?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    media = undefined;
    if (context) { context.onstatechange = null; void context.close().catch(() => {}); context = undefined; }
  }

  function send(data: string | ArrayBuffer) {
    if (closed || signal.aborted) return;
    if (socket?.readyState !== WebSocket.OPEN) { fail("语音连接已断开，已识别文字已保留，请重试。"); return; }
    if (socket.bufferedAmount > 256_000) { fail("网络过慢，语音输入已停止，已识别文字已保留。"); return; }
    try { socket.send(data); } catch { fail("语音发送失败，已识别文字已保留，请重试。"); }
  }

  function finishCapture() {
    if (closed || signal.aborted || finished) return;
    clearTimeout(flushDeadline);
    releaseCapture();
    setPhase("finishing");
    setDeadline(15_000, () => fail("末尾语音识别超时，已显示的文字已保留，请核对后发送。"));
    send(JSON.stringify({ type: "finish" }));
  }

  function stop() {
    if (closed || signal.aborted || phase === "finishing") return;
    if (phase === "starting") { lifetime.abort(new DOMException("录音已取消", "AbortError")); return; }
    setPhase("finishing");
    clearTimeout(deadline);
    // The worklet acknowledges only after sending its final partial packet.
    capture?.port.postMessage({ type: "stop" });
    media?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    flushDeadline = setTimeout(() => fail("录音已中断，已识别文字已保留，请核对后重试。"), 2_000);
  }

  const hide = () => { if (document.hidden) stop(); };
  async function run(): Promise<string> {
    options.onPhase("starting");
    options.onSeconds(0);
    setDeadline(30_000, () => fail("语音连接超时，请检查麦克风权限和网络后重试。"));
    try {
      signal.throwIfAborted();
      // Resume in the click gesture, before permissions/network awaits (Safari).
      context = new AudioContext({ latencyHint: "interactive" });
      const resumed = context.resume();
      const permission = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(value => {
        if (signal.aborted || closed) value.getTracks().forEach(track => track.stop());
        else media = value;
        return value;
      });
      [media] = await abortable(Promise.all([permission, resumed]), signal);
      await abortable(context.audioWorklet.addModule("/audio/pcm-capture.worklet.js"), signal);
      const response = await fetch("/api/assistant/transcribe/session", { method: "POST", signal, cache: "no-store" });
      const session = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof session.error === "string" ? session.error : "无法连接实时语音服务，请重试。");
      if (typeof session.url !== "string" || typeof session.ticket !== "string") throw new Error("实时语音服务返回异常，请重试。");
      signal.throwIfAborted();
      socket = new WebSocket(session.url);
      socket.onopen = () => send(JSON.stringify({ type: "authenticate", ticket: session.ticket }));
      socket.onerror = () => fail("实时语音服务连接失败，请检查网络或语音服务配置。");
      socket.onclose = () => { if (!finished && !closed) fail("语音连接中断，已识别文字已保留，请核对后重试。"); };
      socket.onmessage = event => {
        if (closed || signal.aborted) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "ready") { resolveReady(); return; }
          if (data.type === "finishing") { stop(); return; }
          if (data.type === "error" || data.type === "conversation.item.input_audio_transcription.failed") {
            fail(typeof data.message === "string" ? data.message : "语音识别失败，已识别文字已保留，请重试。"); return;
          }
          if (data.type === "session.finished") {
            if (phase !== "finishing" || !transcript.complete) { fail("语音识别未完整结束，已显示的文字已保留，请核对。"); return; }
            finished = true; resolveFinished(); return;
          }
          const before = transcript.text;
          const text = transcript.update(data);
          if (text !== before) options.onText(text);
        } catch { fail("语音识别返回异常，已识别文字已保留，请重试。"); }
      };
      await abortable(ready, signal);
      signal.throwIfAborted();
      source = context.createMediaStreamSource(media);
      capture = new AudioWorkletNode(context, "ledger-pcm-capture");
      capture.onprocessorerror = () => fail("录音处理中断，已识别文字已保留，请重试。");
      capture.port.onmessage = event => {
        if (closed || signal.aborted) return;
        if (event.data.type === "audio") {
          send(event.data.buffer);
          options.onSeconds(Math.min(MAX_AUDIO_SECONDS, Math.floor(event.data.samples / 16000)));
        } else if (event.data.type === "stopped") finishCapture();
      };
      source.connect(capture); capture.connect(context.destination);
      media.getTracks().forEach(track => { track.onended = stop; });
      context.onstatechange = () => { if (context?.state === "suspended" && phase === "recording") stop(); };
      document.addEventListener("visibilitychange", hide);
      setPhase("recording");
      setDeadline(MAX_AUDIO_SECONDS * 1000, stop);
      await abortable(completed, signal);
      return transcript.text;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") throw new Error("麦克风权限未开启，请在浏览器设置中允许录音。");
      if (error instanceof DOMException && error.name === "NotFoundError") throw new Error("未找到麦克风，请连接麦克风后重试。");
      throw error;
    } finally {
      closed = true;
      clearTimeout(deadline); clearTimeout(flushDeadline);
      document.removeEventListener("visibilitychange", hide);
      releaseCapture();
      if (socket) {
        socket.onopen = null; socket.onmessage = null; socket.onclose = null; socket.onerror = null;
        socket.close(); socket = undefined;
      }
    }
  }
  return { stop, cancel: () => lifetime.abort(new DOMException("录音已取消", "AbortError")), done: run() };
}

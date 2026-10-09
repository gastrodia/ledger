import { generateText, Output, streamText, wrapLanguageModel, type FlexibleSchema, type LanguageModelUsage, type ModelMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { structuredOutputMiddleware } from "@/lib/structured-output";

// Server-side only. Never return this configuration or provider payloads to the client.
export const BAILIAN_SUMMARY_MODEL = "qwen3.8-max";
export const BAILIAN_ASSISTANT_MODEL = "qwen3.8-max";
export const BAILIAN_ASR_MODEL = "qwen3-asr-flash";

export class BailianError extends Error {
  constructor(public status: number, public code = "") {
    super("百炼请求失败");
    this.name = "BailianError";
  }
}

export function bailianConfig() {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) throw new BailianError(503, "missing_key");
  const workspace = process.env.DASHSCOPE_WORKSPACE_ID?.trim();
  const baseURL = (process.env.DASHSCOPE_BASE_URL?.trim() || (workspace
    ? `https://${workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
    : "https://dashscope.aliyuncs.com/compatible-mode/v1")).replace(/\/+$/, "");
  let url: URL;
  try { url = new URL(baseURL); } catch { throw new BailianError(503, "invalid_endpoint"); }
  if (url.protocol !== "https:" || !/\.(aliyuncs\.com)$/.test(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new BailianError(503, "invalid_endpoint");
  }
  return { apiKey, baseURL };
}

function providerError(error: unknown): BailianError {
  if (error instanceof BailianError) return error;
  if (!error || typeof error !== "object") return new BailianError(502);
  const e = error as {
    status?: number; statusCode?: number; code?: unknown; name?: string;
    finishReason?: string; text?: unknown; responseBody?: string; data?: { error?: { code?: unknown } };
    cause?: unknown; lastError?: unknown;
  };
  if (e.finishReason === "length") return new BailianError(502, "truncated");
  if (e.name === "TimeoutError") return new BailianError(504, "timeout");
  if (e.name === "AbortError") return new BailianError(502, "cancelled");
  if (e.name === "AI_NoOutputGeneratedError") return new BailianError(502, "empty");
  // Output.object wraps parsing and schema errors in its own error. Preserve
  // that classification instead of treating its parser cause as a network error.
  if (e.name === "AI_NoObjectGeneratedError") {
    return typeof e.text === "string" && !e.text.trim()
      ? new BailianError(502, "empty")
      : new BailianError(422, "invalid_output");
  }
  // The SDK can wrap a transport validation failure in an APICallError with
  // HTTP status 200. Keep our actual terminal-stream error classification.
  if (e.cause instanceof BailianError) return e.cause;
  const status = e.status ?? e.statusCode;
  let code = typeof e.code === "string" ? e.code : "";
  if (e.responseBody) {
    try {
      const body = JSON.parse(e.responseBody);
      code = String(body.error?.code || body.code || code);
    } catch { /* A gateway may return HTML instead of JSON. */ }
  }
  if (!code && e.data?.error?.code) code = String(e.data.error.code);
  if (status || code) return new BailianError(status || 502, code);
  if (e.cause) return providerError(e.cause);
  if (e.lastError) return providerError(e.lastError);
  return new BailianError(502);
}

export function bailianFailure(error: unknown): { status: number; message: string } {
  const e = providerError(error);
  if (e.code === "missing_key") return { status: 503, message: "百炼尚未配置，请设置服务端 DASHSCOPE_API_KEY。" };
  if (e.code === "invalid_endpoint") return { status: 503, message: "百炼地址配置无效，请检查服务端配置。" };
  if (e.code === "invalid_timeout") return { status: 503, message: "AI 请求时限配置无效，请检查服务端配置。" };
  if (e.code === "invalid_output") return { status: 422, message: "AI 返回格式异常，请重试。" };
  if (e.code === "Model.Unsupported") return { status: 503, message: "当前百炼工作空间的部署范围不支持所选模型，请检查模型配置。" };
  if (e.status === 402 || /Arrearage|InsufficientBalance/i.test(e.code)) return { status: 503, message: "百炼余额或额度不足，请检查账户。" };
  if (e.status === 401 || e.status === 403) return { status: 503, message: "百炼暂不可用，请检查 API Key 的地域和模型权限。" };
  if (e.status === 429) return { status: 429, message: "百炼请求过于频繁或额度受限，请稍后重试。" };
  if (e.status === 400 || e.status === 404) return { status: 503, message: "百炼模型暂不可用，请检查模型、地域和接口配置。" };
  if (e.status === 504) return { status: 504, message: "AI 响应超时，请稍后重试。" };
  return { status: 502, message: "AI 服务暂时无法连接，请稍后重试。" };
}

export type BailianRequest = {
  model: string;
  messages: ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  // Interactive routes keep the 90-second default. Longer background image
  // work may opt into a bounded budget within the surrounding task deadline.
  timeoutMs?: number;
  // Optional server-generated correlation ID; never forwarded to the provider.
  telemetryId?: string;
  thinking?: boolean;
  reasoningEffort?: string;
  asrOptions?: { language?: string; enable_itn?: boolean };
};

export type BailianStreamPart =
  | { type: "text-delta"; text: string }
  | { type: "finish"; finishReason: string };

// The SDK handles messages and response parsing. This hook supplies only the
// small wire differences required by DashScope's compatible endpoint.
function transformBailianBody(body: Record<string, unknown>): Record<string, unknown> {
  const { max_tokens: maxTokens, ...result } = body;
  result.stream ??= false;
  if (maxTokens !== undefined) result.max_completion_tokens = maxTokens;
  if (!Array.isArray(body.messages)) return result;
  result.messages = body.messages.map(message => {
    if (!message || typeof message !== "object" || !Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map((part: Record<string, unknown>) => {
        if (part.type !== "input_audio" || !part.input_audio || typeof part.input_audio !== "object") return part;
        const { format, ...audio } = part.input_audio as Record<string, unknown>;
        if (typeof audio.data !== "string" || (format !== "wav" && format !== "mp3")) return part;
        return {
          ...part,
          input_audio: { ...audio, data: audio.data.startsWith("data:") ? audio.data : `data:audio/${format === "mp3" ? "mpeg" : "wav"};base64,${audio.data}` },
        };
      }),
    };
  });
  return result;
}

// The provider SDK owns SSE and JSON parsing. Check the transport's terminal
// marker separately so a disconnected HTTP body cannot look like success.
function requireCompletedTransport(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let tail = "", completed = false;
  const inspect = (text: string) => {
    const next = tail + text;
    completed ||= /(?:^|\n)data:[ \t]*\[DONE\][ \t]*(?:\r?\n|$)/.test(next);
    tail = next.slice(-256);
  };
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) { inspect(decoder.decode(chunk, { stream: true })); controller.enqueue(chunk); },
    flush() {
      inspect(decoder.decode());
      if (!completed) throw new BailianError(502, "incomplete_stream");
    },
  }));
}

type BailianOperation = "text" | "object" | "stream" | "object-stream";

function failureClassification(error: BailianError) {
  if (["timeout", "cancelled", "invalid_output", "truncated", "empty", "incomplete", "incomplete_stream"].includes(error.code)) return error.code;
  if (error.status === 402 || /Arrearage|InsufficientBalance/i.test(error.code)) return "billing";
  if (error.status === 401 || error.status === 403) return "credentials";
  if (error.status === 429) return "rate_limited";
  if (error.status === 400 || error.status === 404 || ["missing_key", "invalid_endpoint", "invalid_timeout"].includes(error.code)) return "configuration";
  if (error.status === 504) return "timeout";
  return "unavailable";
}

function requestSettings(request: BailianRequest, operation: BailianOperation, externalSignal?: AbortSignal) {
  const timeoutMs = request.timeoutMs ?? 90_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 180_000) throw new BailianError(503, "invalid_timeout");
  const config = bailianConfig();
  const controller = new AbortController();
  const signal = AbortSignal.any([...(externalSignal ? [externalSignal] : []), AbortSignal.timeout(timeoutMs), controller.signal]);
  const provider = createOpenAICompatible({
    name: "bailian", ...config, supportsStructuredOutputs: false, includeUsage: true,
    transformRequestBody: transformBailianBody,
    fetch: async (input, init) => {
      const response = await fetch(input, { ...init, cache: "no-store" });
      if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return response;
      return new Response(requireCompletedTransport(response.body), { status: response.status, statusText: response.statusText, headers: response.headers });
    },
  });
  const startedAt = Date.now();
  const telemetryId = typeof request.telemetryId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.telemetryId)
    ? request.telemetryId : undefined;
  let firstOutputMs: number | undefined;
  let terminalRecorded = false;
  const metadata = () => ({ model: request.model, operation, timeoutMs, durationMs: Date.now() - startedAt, firstOutputMs,
    ...(telemetryId ? { telemetryId } : {}),
  });
  const recordFirstOutput = (kind: "text" | "partial") => {
    if (firstOutputMs !== undefined || terminalRecorded) return;
    firstOutputMs = Date.now() - startedAt;
    console.info("AI request first output", { ...metadata(), outputKind: kind });
  };
  const recordUsage = (usage: LanguageModelUsage) => {
    if (terminalRecorded) return;
    terminalRecorded = true;
    console.info("AI request completed", {
      ...metadata(),
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
    });
  };
  const recordFailure = (error: unknown) => {
    const failure = requestFailure(error, signal);
    if (!terminalRecorded) {
      terminalRecorded = true;
      // Provider codes, payloads and error messages can contain sensitive data.
      // Record only our allowlisted classification and public HTTP status.
      console.info("AI request failed", { ...metadata(), failure: failureClassification(failure), status: bailianFailure(failure).status });
    }
    return failure;
  };
  return {
    controller, signal, recordUsage, recordFirstOutput, recordFailure,
    settings: {
      model: wrapLanguageModel({ model: provider(request.model), middleware: structuredOutputMiddleware }),
      instructions: request.messages.filter(message => message.role === "system"),
      messages: request.messages.filter(message => message.role !== "system"), temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens, maxRetries: 0, abortSignal: signal,
      providerOptions: { bailian: {
        ...(request.thinking !== undefined ? { enable_thinking: request.thinking } : {}),
        ...(request.reasoningEffort !== undefined ? { reasoningEffort: request.reasoningEffort } : {}),
        ...(request.asrOptions !== undefined ? { asr_options: request.asrOptions } : {}),
      } },
      experimental_include: { requestBody: false },
    },
  };
}

function requestFailure(error: unknown, signal: AbortSignal) {
  return providerError(signal.aborted ? signal.reason : error);
}

function checkFinish(finishReason: string, text: string) {
  if (finishReason === "length") throw new BailianError(502, "truncated");
  if (!text.trim()) throw new BailianError(502, "empty");
  if (finishReason !== "stop") throw new BailianError(502, "incomplete");
}

export async function bailianText(request: BailianRequest, signal?: AbortSignal): Promise<string> {
  const runtime = requestSettings(request, "text", signal);
  try {
    const result = await generateText(runtime.settings);
    checkFinish(result.finishReason, result.text);
    runtime.signal.throwIfAborted();
    runtime.recordUsage(result.totalUsage);
    return result.text.trim();
  } catch (error) { throw runtime.recordFailure(error); }
  finally { runtime.controller.abort(); }
}

export async function bailianObject<T>(request: BailianRequest & { schema: FlexibleSchema<T>; schemaName?: string }, signal?: AbortSignal): Promise<T> {
  const runtime = requestSettings(request, "object", signal);
  try {
    const result = await generateText({
      ...runtime.settings, output: Output.object({ schema: request.schema, name: request.schemaName }),
    });
    checkFinish(result.finishReason, result.text);
    const output = result.output;
    runtime.signal.throwIfAborted();
    runtime.recordUsage(result.totalUsage);
    return output;
  } catch (error) { throw runtime.recordFailure(error); }
  finally { runtime.controller.abort(); }
}

// Partial objects are unvalidated snapshots, suitable only for provisional UI.
// Callers must use the returned, validated object for all actions and writes.
export async function bailianObjectStream<T>(
  request: BailianRequest & { schema: FlexibleSchema<T>; schemaName?: string },
  onPartial: (partial: unknown) => void,
  signal?: AbortSignal,
): Promise<T> {
  const runtime = requestSettings(request, "object-stream", signal);
  const result = streamText({
    ...runtime.settings, output: Output.object({ schema: request.schema, name: request.schemaName }),
    // Partial-output streams omit SDK error events. Abort with the original
    // error so failures cannot be mistaken for a successfully validated object.
    onError: ({ error }) => { runtime.controller.abort(error); },
  });
  const iterator = result.partialOutputStream[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await iterator.next();
      runtime.signal.throwIfAborted();
      if (next.done) break;
      if (next.value && typeof next.value === "object" && Object.keys(next.value).length > 0) runtime.recordFirstOutput("partial");
      onPartial(next.value);
    }
    checkFinish(await result.finishReason, await result.text);
    const output = await result.output;
    runtime.signal.throwIfAborted();
    runtime.recordUsage(await result.totalUsage);
    return output;
  } catch (error) { throw runtime.recordFailure(error); }
  finally {
    // Abort before returning the iterator: cancelling only one SDK tee branch
    // may otherwise wait forever for the still-open provider response.
    runtime.controller.abort();
    await iterator.return?.();
  }
}

export async function bailianStream(request: BailianRequest, signal?: AbortSignal): Promise<AsyncGenerator<BailianStreamPart>> {
  const runtime = requestSettings(request, "stream", signal);
  const result = streamText({
    ...runtime.settings,
    // The SDK default callback logs raw provider errors. Public errors are
    // normalized below, without recording prompts, responses or credentials.
    onError: () => {},
  });
  const iterator = result.fullStream[Symbol.asyncIterator]();
  let first: Awaited<ReturnType<typeof iterator.next>>;
  try {
    // SDK lifecycle events can precede a provider's first error or empty result.
    // Start the public stream only after actual answer content has arrived.
    let prefix = "";
    while (true) {
      first = await iterator.next();
      runtime.signal.throwIfAborted();
      if (first.done) throw new BailianError(502, "empty");
      if (first.value.type === "error") throw first.value.error;
      if (first.value.type === "abort") throw runtime.signal.reason;
      if (first.value.type === "finish") throw new BailianError(502, "empty");
      if (first.value.type === "text-delta") {
        if (first.value.text.trim()) {
          runtime.recordFirstOutput("text");
          first = { done: false, value: { ...first.value, text: prefix + first.value.text } };
          break;
        }
        prefix += first.value.text;
      }
    }
  } catch (error) {
    const failure = runtime.recordFailure(error);
    runtime.controller.abort();
    await iterator.return?.();
    throw failure;
  }

  return (async function* (): AsyncGenerator<BailianStreamPart> {
    let next: Awaited<ReturnType<typeof iterator.next>> = first;
    let hasText = false, finishReason: string | undefined;
    try {
      while (!next.done) {
        runtime.signal.throwIfAborted();
        const chunk = next.value;
        if (chunk.type === "error") throw chunk.error;
        if (chunk.type === "abort") throw runtime.signal.reason;
        if (chunk.type === "text-delta" && chunk.text) {
          hasText ||= !!chunk.text.trim();
          yield { type: "text-delta", text: chunk.text };
        }
        if (chunk.type === "finish") finishReason = chunk.finishReason;
        next = await iterator.next();
      }
      if (!finishReason || !["stop", "length"].includes(finishReason)) throw new BailianError(502, "incomplete_stream");
      if (!hasText) throw new BailianError(502, "empty");
      runtime.signal.throwIfAborted();
      if (finishReason === "length") runtime.recordFailure(new BailianError(502, "truncated"));
      else runtime.recordUsage(await result.totalUsage);
      yield { type: "finish", finishReason };
    } catch (error) { throw runtime.recordFailure(error); }
    finally {
      runtime.recordFailure(new BailianError(502, "cancelled"));
      runtime.controller.abort();
      await iterator.return?.();
    }
  })();
}

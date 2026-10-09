import { restoreAssistantExecution, type AssistantExecutionStep } from "@/lib/assistant-execution";
import { restoreAssistantImageProgress, type AssistantImageProgress, type AssistantTask } from "@/lib/assistant-task-types";
import type { AssistantPlan } from "@/lib/assistant";

/** A compact record of observed work, never model reasoning or raw tool payloads. */
export type AssistantProcess = {
  status: AssistantTask["status"];
  phase: AssistantTask["phase"];
  attempt: number;
  hasReply: boolean;
  images: AssistantImageProgress | null;
  action: AssistantPlan["action"] | null;
  draftCount: number;
  execution?: AssistantExecutionStep[];
  /** Total wall time from task submission, including waiting and retry gaps. */
  startedAt?: number;
  finishedAt?: number;
};

export function assistantProcessFromTask(task: AssistantTask): AssistantProcess {
  const startedAt = Date.parse(task.created_at);
  const finishedAt = Date.parse(task.updated_at);
  const execution = restoreAssistantExecution(task.execution_steps);
  const timed = Number.isFinite(startedAt) && startedAt >= 0;
  return {
    status: task.status, phase: task.phase, attempt: task.attempt, hasReply: !!task.text,
    images: restoreAssistantImageProgress(task.image_progress),
    action: task.status === "succeeded" ? task.result?.action ?? null : null,
    draftCount: task.status === "succeeded" ? task.result?.drafts.length ?? 0 : 0,
    ...(execution.length ? { execution } : {}),
    ...(timed ? { startedAt } : {}),
    ...(timed && !["queued", "running"].includes(task.status) && Number.isFinite(finishedAt) && finishedAt >= startedAt ? { finishedAt } : {}),
  };
}

export function restoreAssistantProcess(value: unknown): AssistantProcess | undefined {
  if (!value || typeof value !== "object") return;
  const p = value as AssistantProcess;
  if (!["queued", "running", "succeeded", "failed", "cancelled"].includes(p.status)
    || !["thinking", "images", "query"].includes(p.phase)
    || !Number.isSafeInteger(p.attempt) || p.attempt < 1
    || typeof p.hasReply !== "boolean"
    || ![null, "chat", "record", "query", "update", "undo", "remove", "manage", "edit", "confirm", "navigate", "event"].includes(p.action)
    || !Number.isSafeInteger(p.draftCount) || p.draftCount < 0 || p.draftCount > 20) return;
  return { status: p.status, phase: p.phase, attempt: p.attempt, hasReply: p.hasReply,
    images: restoreAssistantImageProgress(p.images), action: p.action, draftCount: p.draftCount,
    ...(restoreAssistantExecution(p.execution).length ? { execution: restoreAssistantExecution(p.execution) } : {}),
    ...restoreProcessTiming(p) };
}

function restoreProcessTiming(p: AssistantProcess) {
  if (typeof p.startedAt !== "number" || !Number.isSafeInteger(p.startedAt) || p.startedAt < 0) return {};
  const active = p.status === "queued" || p.status === "running";
  return { startedAt: p.startedAt,
    ...(!active && typeof p.finishedAt === "number" && Number.isSafeInteger(p.finishedAt) && p.finishedAt >= p.startedAt
      ? { finishedAt: p.finishedAt } : {}) };
}

export function assistantProcessElapsed(p: AssistantProcess, now: number): string | null {
  if (p.startedAt === undefined) return null;
  const active = p.status === "queued" || p.status === "running";
  const end = active ? now : p.finishedAt;
  if (end === undefined || !Number.isFinite(end)) return null;
  const seconds = Math.max(0, Math.floor((end - p.startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const duration = hours ? `${hours} 小时 ${minutes} 分 ${seconds % 60} 秒`
    : minutes ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
  return `${active ? "已用时" : "耗时"} ${duration}`;
}

export type AssistantProcessStep = {
  label: string;
  detail?: string;
  details?: string[];
  kind?: AssistantExecutionStep["kind"];
  duration?: string;
  tool?: boolean;
  state: "done" | "running" | "waiting" | "failed" | "stopped";
};

export function assistantProcessView(p: AssistantProcess) {
  const done = p.status === "succeeded";
  const active = p.status === "running" || p.status === "queued";
  const state: AssistantProcessStep["state"] = done ? "done" : p.status === "failed" ? "failed"
    : p.status === "cancelled" ? "stopped" : p.status === "queued" ? "waiting" : "running";
  const steps: AssistantProcessStep[] = [];
  const query = p.phase === "query" || p.action === "query";
  if (p.phase === "images" || p.images) {
    const images = p.images;
    const recognized = images?.completed === images?.total && !!images;
    steps.push({ label: "截图识别", tool: true, state: recognized ? "done" : state,
      detail: images ? `已完成 ${images.completed}/${images.total} 张${images.active.length && active ? ` · 正在识别第 ${images.active.join("、")} 张` : ""}${images.failed.length ? ` · 第 ${images.failed.join("、")} 张失败` : ""}` : undefined });
    if (images?.stage === "merging" || done) steps.push({ label: "整理识别结果", detail: "合并截图、检查重复账目与字段", state });
  } else {
    steps.push({ label: "理解请求", detail: "结合对话识别记账、查询或修改意图", state: query || done ? "done" : state });
  }
  if (query) {
    steps.push({ label: "查询账本", tool: true, detail: "按请求筛选记录并汇总收支", state: done || p.hasReply ? "done" : state });
    if (p.hasReply || done) steps.push({ label: "整理回答", detail: "根据账本查询结果生成说明", state });
  }
  if (done && !query) {
    const result = p.action === "record" ? { label: `生成 ${p.draftCount} 笔草稿`, detail: "生成时未入账，需核对并确认" }
      : p.action === "update" ? { label: "生成草稿修改方案", detail: "具体处理结果见下方回复" }
      : p.action === "remove" ? { label: "生成草稿删除预览", detail: "核对删除范围，明确确认后才执行" }
      : ["manage", "confirm", "event"].includes(p.action || "") ? { label: "整理操作方案", detail: "涉及保存数据时需明确批准，实际结果见回复" }
      : p.action === "edit" ? { label: "整理草稿修改", detail: "实际结果见回复" }
      : p.action === "undo" ? { label: "生成撤销方案", detail: "需核对并确认撤销" }
      : { label: "生成回复" };
    steps.push({ ...result, state: "done" });
  }
  if (p.execution?.length) {
    steps.splice(0, steps.length, ...p.execution.map(step => {
      const interrupted = step.state === "running" && !active;
      const end = step.finishedAt ?? (interrupted ? p.finishedAt : undefined);
      const seconds = end === undefined ? undefined : Math.max(0, Math.floor((end - step.startedAt) / 1000));
      const duration = seconds === undefined ? undefined : seconds === 0 ? "<1 秒"
        : seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
      return { label: step.label, details: step.details, kind: step.kind, duration,
        state: interrupted ? p.status === "cancelled" ? "stopped" as const : "failed" as const : step.state };
    }));
  }
  const current = [...steps].reverse().find(step => step.state === "running" || step.state === "waiting");
  const summary = done ? "处理完成" : p.status === "failed" ? "处理未完成" : p.status === "cancelled" ? "已停止处理"
    : p.status === "queued" ? "等待处理…" : `${current?.label || "正在处理"}…`;
  return { steps, summary: active && p.images ? `${summary} · ${p.images.completed}/${p.images.total} 张` : summary, active };
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, ChevronDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Button } from "@/components/ui/button";
import { markdownTableComponents } from "@/components/ui/markdown-table";
import { readSummaryError } from "@/lib/stats-ai-summary";

export function AiAnalysis({ query, label, showIncome, onReveal, onUnauthorized, empty }: {
  query: string;
  label: string;
  showIncome: boolean;
  onReveal: () => void;
  onUnauthorized: () => void;
  empty: boolean;
}) {
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const stop = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setLoading(false);
  };
  const generate = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const current = () => controllerRef.current === controller && !controller.signal.aborted;
    onReveal();
    setLoading(true);
    setSummary("");
    setError(null);
    try {
      const response = await fetch(`/api/stats/ai-summary?${query}`, { signal: controller.signal });
      if (!current()) return;
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) throw new Error(await readSummaryError(response));
      if (!response.body) throw new Error("浏览器不支持流式响应");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { value, done } = await reader.read();
        if (!current()) return;
        text += done ? decoder.decode() : decoder.decode(value, { stream: true });
        setSummary(text);
        if (done) break;
      }
      if (!text.trim()) throw new Error("暂未生成解读，请重试");
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : "AI 解读失败，请重试");
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; setLoading(false); }
    }
  };

  return <details className="group rounded-lg border bg-card">
    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium sm:px-5 [&::-webkit-details-marker]:hidden">
      <Sparkles className="size-4 text-primary" aria-hidden="true" />AI 解读
      <span className="ml-auto text-xs font-normal text-muted-foreground">按需生成</span>
      <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    <div className="space-y-4 border-t p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}的收支发现与建议</p>
        {loading ? <Button variant="outline" size="sm" onClick={stop}>停止生成</Button> :
          <Button size="sm" disabled={empty} onClick={() => void generate()}>{!showIncome ? "显示金额并生成解读" : summary ? "重新生成" : "生成解读"}</Button>}
      </div>
      {empty ? <p className="text-sm text-muted-foreground">本期暂无收支记录，记账后可生成解读。</p> : error ?
        <p role="alert" className="text-sm text-destructive">{error}</p> : !showIncome && summary ?
          <Button variant="outline" size="sm" onClick={onReveal}>显示金额并查看解读</Button> : showIncome && summary ?
            <div className="min-w-0 break-words text-sm leading-7 [&_h1]:my-3 [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:font-semibold [&_h3]:my-3 [&_h3]:font-medium [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={markdownTableComponents}>{summary}</ReactMarkdown>
            </div> : <p className="text-sm text-muted-foreground" role={loading ? "status" : undefined}>{loading ? "正在分析本期收支…" : "结合当前期间的实际记录，查看值得关注的变化。"}</p>}
    </div>
  </details>;
}

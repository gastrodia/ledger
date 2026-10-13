import { AssistantReplyCard } from "@/components/assistant/reply-primitives";
import { markdownTableComponents } from "@/components/ui/markdown-table";
import type { AssistantCategory, AssistantMember, AssistantReadResult } from "@/lib/assistant";
import { recordReplyView } from "@/lib/assistant-reply-view";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

export function AssistantReadResultCards({ results, members, categories }: {
  results: AssistantReadResult[]; members: AssistantMember[]; categories: AssistantCategory[];
}) {
  return <div className="space-y-3" aria-label="查询结果">{results.map(result => {
    const view = result.reply_view || (result.record_context
      ? recordReplyView(result.record_context.resource, result.record_context.rows, result.command, members, categories) : undefined);
    return <div key={result.id} data-read-result-id={result.id} data-operation-id={result.operation_id}>
      {view ? <AssistantReplyCard preview={view} />
        : <ReactMarkdown components={markdownTableComponents} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} disallowedElements={["img"]}>{result.reply}</ReactMarkdown>}
    </div>;
  })}</div>;
}

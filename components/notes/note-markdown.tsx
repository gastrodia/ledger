import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { markdownTableComponents } from "@/components/ui/markdown-table";

export function NoteMarkdown({ content }: { content: string }) {
  return <div className="note-markdown"><ReactMarkdown components={markdownTableComponents} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown></div>;
}

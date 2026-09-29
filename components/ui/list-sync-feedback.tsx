import { Button } from "@/components/ui/button";

export function ListSyncFeedback({ error, refreshing, onRetry }: {
  error: string | null;
  refreshing: boolean;
  onRetry: () => void;
}) {
  if (error) return <div role="alert" className="flex items-center gap-3 px-4 py-2 text-sm text-destructive">
    <span>同步失败，已保留当前内容。{error}</span>
    <Button type="button" size="sm" variant="outline" onClick={onRetry}>重试</Button>
  </div>;
  return refreshing ? <span role="status" className="sr-only">正在同步列表</span> : null;
}

"use client";

import { Button } from "@/components/ui/button";
import type { DraftStatus } from "@/lib/form-drafts";

export function DraftNotice({ draft }: { draft: {
  hasDraft: boolean;
  status: DraftStatus;
  error: string | null;
  isPersisted?: boolean;
  needsProtection?: boolean;
  restore: () => void;
  discard: () => void;
} }) {
  if (draft.hasDraft) return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm" role="status">
      <p>发现此账户在本机保存的未完成草稿。请先恢复或放弃旧草稿；当前新输入尚未保存为草稿。恢复会替换当前输入。</p>
      <p className="mt-1 text-xs text-muted-foreground">草稿只在当前浏览器保留，未上传的附件需重新选择。</p>
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" onClick={draft.restore}>恢复草稿</Button>
        <Button type="button" size="sm" variant="outline" onClick={draft.discard}>放弃旧草稿</Button>
      </div>
      {draft.error ? <p className="mt-2 text-destructive">{draft.error}</p> : null}
    </div>
  );
  if (draft.error) return <p role="status" className="text-sm text-amber-700">{draft.error}</p>;
  if (draft.needsProtection) return <p role="status" className="text-xs text-muted-foreground">当前输入尚未保存为本机草稿，离开前会提醒你确认。</p>;
  if (draft.status === "saved" && draft.isPersisted !== false) return <p role="status" className="text-xs text-muted-foreground">草稿已保存在本机，尚未提交。退出登录会清除草稿。</p>;
  return null;
}

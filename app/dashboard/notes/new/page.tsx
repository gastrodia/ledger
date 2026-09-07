"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NoteEditor } from "@/components/notes/note-editor";
import { toast } from "@/hooks/use-toast";
import { useFormDraft } from "@/hooks/use-form-draft";
import { useFormLeaveGuard } from "@/hooks/use-form-leave-guard";
import { DraftNotice } from "@/components/ui/draft-notice";

export default function NewNotePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = !!title || !!content;
  const draft = useFormDraft({
    scope: "note:new",
    value: { title, content },
    dirty,
    onRestore: (saved) => {
      if (typeof saved?.title === "string" && typeof saved?.content === "string") {
        setTitle(saved.title);
        setContent(saved.content);
      } else toast.error("草稿格式无法识别，请放弃此草稿后继续编辑。");
    },
  });
  const { requestClose } = useFormLeaveGuard({ draft, isBusy: isSubmitting || isUploading });
  const backToList = () => requestClose(() => router.push("/dashboard/notes"));


  const handleSave = async () => {
    if (isUploading || !content.trim()) return;
    setSaveError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title || null, content }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "保存失败");
      draft.clear();
      toast.success("笔记已保存");
      router.push(`/dashboard/notes/${json.data.id}`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-bold tracking-tight">新建笔记</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={backToList}>
              返回列表
            </Button>
            <Button onClick={handleSave} disabled={isSubmitting || isUploading || !content.trim()}>
              {isSubmitting ? "保存中..." : "保存"}
            </Button>
          </div>
        </div>

        <DraftNotice draft={draft} />
        {saveError ? <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{saveError}。内容仍在编辑器中，请重试保存。</p> : null}
        <Card>
          <CardHeader>
            <CardTitle>内容</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">标题（可选）</Label>
              <Input
                id="title"
                disabled={isSubmitting}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：本周计划"
              />
            </div>

            <div className="space-y-2">
              <Label>Markdown</Label>
              <NoteEditor value={content} onChange={setContent} onUploadingChange={setIsUploading} disabled={isSubmitting} />
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}


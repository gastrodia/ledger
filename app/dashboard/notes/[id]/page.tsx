"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { useFormDraft } from "@/hooks/use-form-draft";
import { useFormLeaveGuard } from "@/hooks/use-form-leave-guard";
import { DraftNotice } from "@/components/ui/draft-notice";
import type { Note } from "@/types";
import { NoteEditor } from "@/components/notes/note-editor";
import { Archive, Pin, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function NoteDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const isLoading = loadedId !== id;
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = !!note && (title !== (note.title || "") || content !== note.content);
  const draft = useFormDraft({
    scope: `note:${id}`,
    value: { title, content },
    dirty,
    enabled: !isLoading && !loadError && note?.id === id,
    onRestore: (saved) => {
      if (typeof saved?.title === "string" && typeof saved?.content === "string") {
        setTitle(saved.title);
        setContent(saved.content);
      } else toast.error("草稿格式无法识别，请放弃此草稿后继续编辑。");
    },
  });
  const { requestClose } = useFormLeaveGuard({ draft, isBusy: isSaving || isUploading });
  const backToList = () => requestClose(() => router.push("/dashboard/notes"));


  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(`/api/notes/${id}`, { signal: controller.signal });
        const json = await res.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error(json.error || "加载失败");
        setLoadError(null);
        setNote(json.data);
        setTitle(json.data.title || "");
        setContent(json.data.content || "");
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "加载失败");
      } finally {
        if (!controller.signal.aborted) setLoadedId(id);
      }
    };
    if (id) void load();
    return () => controller.abort();
  }, [id, reload]);

  const save = async () => {
    if (isUploading || !content.trim()) return;
    setSaveError(null);
    setIsSaving(true);
    try {
      const res = await fetch(`/api/notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title || null, content }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "保存失败");
      setNote(json.data);
      draft.clear();
      toast.success("笔记已保存");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  const togglePinned = async () => {
    if (!note) return;
    const res = await fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !note.pinned_at }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error || "操作失败");
      return;
    }
    setNote(json.data);
  };

  const toggleArchived = async () => {
    if (!note) return;
    const res = await fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !note.archived_at }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error || "操作失败");
      return;
    }
    setNote(json.data);
  };

  const del = async () => {
    try {
      const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "删除失败");
      draft.clear();
      toast.success("笔记已删除");
      router.push("/dashboard/notes");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="text-center py-12 text-muted-foreground">加载中...</div>
      </DashboardLayout>
    );
  }

  if (loadError || !note) {
    return (
      <DashboardLayout>
        <div className="space-y-4 rounded-lg border p-8 text-center" role="alert">
          <p>{loadError || "笔记不存在或无权限"}</p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => { setLoadedId(null); setReload((current) => current + 1); }}>重新加载</Button>
            <Button variant="outline" onClick={() => router.push("/dashboard/notes")}>返回笔记列表</Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight">编辑笔记</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={backToList}>
              返回列表
            </Button>
            <Button variant="outline" onClick={togglePinned}>
              <Pin className="h-4 w-4" />
              {note.pinned_at ? "取消置顶" : "置顶"}
            </Button>
            <Button variant="outline" onClick={toggleArchived}>
              <Archive className="h-4 w-4" />
              {note.archived_at ? "取消归档" : "归档"}
            </Button>
            <Button variant="destructive" onClick={() => setIsDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" />
              删除
            </Button>
            <Button onClick={save} disabled={isSaving || isUploading || !content.trim()}>
              {isSaving ? "保存中..." : "保存"}
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
                disabled={isSaving}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Markdown</Label>
              <NoteEditor value={content} onChange={setContent} onUploadingChange={setIsUploading} disabled={isSaving} />
            </div>
          </CardContent>
        </Card>

        <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除</AlertDialogTitle>
              <AlertDialogDescription>确定要删除这条笔记吗？此操作无法撤销。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={del} className="bg-destructive hover:bg-destructive/90">
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}


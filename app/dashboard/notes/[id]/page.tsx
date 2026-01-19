"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
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
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const load = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`/api/notes/${id}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "加载失败");
      setNote(json.data);
      setTitle(json.data.title || "");
      setContent(json.data.content || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = async () => {
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
      toast.success("已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
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
      toast.success("已删除");
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

  if (!note) {
    return (
      <DashboardLayout>
        <div className="text-center py-12 text-muted-foreground">留言不存在或无权限</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight">编辑留言</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => router.push("/dashboard/notes")}>
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
            <Button onClick={save} disabled={isSaving}>
              {isSaving ? "保存中..." : "保存"}
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>内容</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">标题（可选）</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Markdown</Label>
              <NoteEditor value={content} onChange={setContent} />
            </div>
          </CardContent>
        </Card>

        <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除</AlertDialogTitle>
              <AlertDialogDescription>确定要删除这条留言吗？此操作无法撤销。</AlertDialogDescription>
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


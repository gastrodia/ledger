"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { Note } from "@/types";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { MessageSquare, Plus, Pin, Archive, Trash2, Edit, Eye } from "lucide-react";

export default function NotesPage() {
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState<"false" | "true">("false");

  const [selected, setSelected] = useState<Note | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [previewNote, setPreviewNote] = useState<Note | null>(null);

  const loadNotes = async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      params.set("archived", archived);
      const res = await fetch(`/api/notes?${params.toString()}`);
      if (!res.ok) throw new Error("加载失败");
      const json = await res.json();
      setNotes(json.data || []);
    } catch (error) {
      console.error("加载留言失败:", error);
      toast.error("加载失败，请重试");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archived]);

  const visibleNotes = useMemo(() => {
    // 服务器已排序；这里只做本地过滤的兜底（输入框还没触发查询时）
    if (!q.trim()) return notes;
    const s = q.trim().toLowerCase();
    return notes.filter((n) => `${n.title || ""}\n${n.content}`.toLowerCase().includes(s));
  }, [notes, q]);

  const togglePinned = async (note: Note) => {
    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !note.pinned_at }),
      });
      if (!res.ok) throw new Error("操作失败");
      await loadNotes();
    } catch {
      toast.error("操作失败，请重试");
    }
  };

  const toggleArchived = async (note: Note) => {
    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !note.archived_at }),
      });
      if (!res.ok) throw new Error("操作失败");
      await loadNotes();
    } catch {
      toast.error("操作失败，请重试");
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    try {
      const res = await fetch(`/api/notes/${selected.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      setIsDeleteOpen(false);
      setSelected(null);
      await loadNotes();
    } catch {
      toast.error("删除失败，请重试");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <MessageSquare className="h-6 w-6" />
              留言
            </h1>
            <p className="text-muted-foreground mt-1">记录你的 Markdown 笔记</p>
          </div>

          <Button asChild>
            <Link href="/dashboard/notes/new">
              <Plus className="h-4 w-4" />
              新增留言
            </Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span>列表</span>
              <div className="flex items-center gap-2">
                <Button
                  variant={archived === "false" ? "default" : "outline"}
                  onClick={() => setArchived("false")}
                >
                  未归档
                </Button>
                <Button
                  variant={archived === "true" ? "default" : "outline"}
                  onClick={() => setArchived("true")}
                >
                  已归档
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索标题/内容"
              />
              <Button variant="outline" onClick={loadNotes} disabled={isLoading}>
                搜索
              </Button>
            </div>

            {isLoading ? (
              <div className="text-center py-10 text-muted-foreground">加载中...</div>
            ) : visibleNotes.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                暂无留言
              </div>
            ) : (
              <div className="divide-y rounded-md border">
                {visibleNotes.map((n) => (
                  <div key={n.id} className="p-4 hover:bg-accent/30 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold truncate">
                            {n.title || "（无标题）"}
                          </h3>
                          {n.pinned_at ? (
                            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                              <Pin className="h-3.5 w-3.5" />
                              置顶
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          更新于 {formatDate(n.updated_at)}
                        </p>
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2 whitespace-pre-wrap">
                          {n.content}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => togglePinned(n)}
                          aria-label="置顶"
                        >
                          <Pin className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setPreviewNote(n)}
                          aria-label="预览"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => toggleArchived(n)}
                          aria-label="归档"
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => router.push(`/dashboard/notes/${n.id}`)}
                          aria-label="编辑"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => {
                            setSelected(n);
                            setIsDeleteOpen(true);
                          }}
                          aria-label="删除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
              <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 列表页快速预览 */}
        <Dialog
          open={!!previewNote}
          onOpenChange={(open) => {
            if (!open) setPreviewNote(null);
          }}
        >
          <DialogContent className="sm:max-w-[900px]">
            <DialogHeader>
              <DialogTitle>{previewNote?.title || "（无标题）"}</DialogTitle>
              <DialogDescription>
                更新于 {previewNote ? formatDate(previewNote.updated_at) : "-"}
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[70vh] overflow-auto rounded-md border bg-card px-4 py-3 prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {previewNote?.content || "（暂无内容）"}
              </ReactMarkdown>
            </div>

            <DialogFooter>
              {previewNote ? (
                <Button
                  variant="outline"
                  onClick={() => router.push(`/dashboard/notes/${previewNote.id}`)}
                >
                  打开编辑页
                </Button>
              ) : null}
              <Button onClick={() => setPreviewNote(null)}>关闭</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}


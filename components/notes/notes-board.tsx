"use client";

import { ListSyncFeedback } from "@/components/ui/list-sync-feedback";
import { Skeleton, SkeletonRegion } from "@/components/ui/loading-skeleton";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Plus, Search, StickyNote, Pin, X, RotateCw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/hooks/use-confirm";
import { toast } from "@/hooks/use-toast";
import { selectNotes } from "@/lib/notes";
import type { Note } from "@/types";
import { NoteCard } from "./note-card";
import { NoteComposer } from "./note-composer";
import { ColorPicker } from "./color-picker";
import "./notes.css";

export function NotesBoard({ initialEditor }: { initialEditor?: string }) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const loaded = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [color, setColor] = useState("all");
  const [editor, setEditor] = useState<Note | "new" | null>(initialEditor === "new" ? "new" : null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const pending = useRef(new Set<string>());
  const openedInitial = useRef(false);
  // Invalidate reads when a write completes, so a stale refresh cannot undo it.
  const revision = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const startedRevision = revision.current;
    const load = async () => {
      try {
        const res = await fetch("/api/notes", { signal: controller.signal, cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "便利贴加载失败，请重试");
        if (controller.signal.aborted || startedRevision !== revision.current) return;
        const loadedNotes: Note[] = json.data || [];
        loaded.current = true;
        setNotes(loadedNotes); setLoadError(null); setRefreshError(null);
        if (initialEditor && initialEditor !== "new" && !openedInitial.current) {
          const note = loadedNotes.find((item) => item.id === initialEditor);
          if (note) { setEditor(note); setArchived(!!note.archived_at); openedInitial.current = true; }
          else setLoadError("这张便利贴不存在或无权限查看，可以返回贴墙查看其他便利贴。");
        }
      } catch (error) {
        if (!controller.signal.aborted && startedRevision === revision.current) {
          const message = error instanceof Error ? error.message : "便利贴加载失败，请重试";
          if (loaded.current) setRefreshError(message);
          else setLoadError(message);
        }
      } finally { if (!controller.signal.aborted) { setIsLoading(false); setIsRefreshing(false); } }
    };
    void load();
    return () => controller.abort();
  }, [initialEditor, reload]);

  const visible = useMemo(() => selectNotes(notes, query, archived, color), [notes, query, archived, color]);
  const pinned = visible.filter((note) => note.pinned_at);
  const others = visible.filter((note) => !note.pinned_at);
  const wallCount = notes.filter((note) => !note.archived_at).length;
  const refresh = () => { if (!loaded.current) setIsLoading(true); else setIsRefreshing(true); setRefreshError(null); setReload((value) => value + 1); };
  const closeEditor = () => { setEditor(null); if (initialEditor) router.replace("/dashboard/notes"); };
  const saved = (note: Note) => {
    revision.current++;
    setNotes((current) => [note, ...current.filter((item) => item.id !== note.id)]);
    closeEditor();
    // Reconcile without replacing the wall or changing the current filters.
    refresh();
  };

  const mutate = async (note: Note, patch?: { pinned?: boolean; archived?: boolean }) => {
    if (pending.current.has(note.id)) return;
    pending.current.add(note.id); setBusyIds(new Set(pending.current));
    try {
      if (!patch && !await confirm({ title: "删除这张便利贴？", description: "删除后无法恢复。如果只是暂时不用，可以先归档。", confirmText: "删除", cancelText: "保留" })) return;
      const res = await fetch(`/api/notes/${note.id}`, {
        method: patch ? "PATCH" : "DELETE",
        ...(patch ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) } : {}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "操作失败，请重试");
      revision.current++;
      setNotes((current) => patch ? current.map((item) => item.id === note.id ? json.data : item) : current.filter((item) => item.id !== note.id));
      if (!patch) toast.success("便利贴已删除");
      else if (patch.archived !== undefined) toast.success(patch.archived ? "已收进归档" : "已移回贴墙");
    } catch (error) { toast.error(error instanceof Error ? error.message : "操作失败，请重试"); }
    finally { pending.current.delete(note.id); setBusyIds(new Set(pending.current)); }
  };
  const cards = (items: Note[]) => <div className="notes-grid">{items.map((note) => <NoteCard key={note.id} note={note} busy={busyIds.has(note.id)} onEdit={() => setEditor(note)} onPin={() => void mutate(note, { pinned: !note.pinned_at })} onArchive={() => void mutate(note, { archived: !note.archived_at })} onDelete={() => void mutate(note)} />)}</div>;

  return <DashboardLayout>
    <div className="notes-workspace">
      <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><StickyNote className="size-6" />便利贴</h1><p className="mt-2 text-sm text-muted-foreground">把脑海里的小事，贴在这里。</p></div>
        <Button className="bg-slate-800 text-white hover:bg-slate-700" onClick={() => setEditor("new")}><Plus />写一张</Button>
      </header>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1" role="group" aria-label="便利贴位置">
          <Button variant={archived ? "ghost" : "secondary"} aria-pressed={!archived} onClick={() => setArchived(false)}><StickyNote />贴墙<span className="text-xs opacity-60">{isLoading ? "…" : loadError ? "—" : wallCount}</span></Button>
          <Button variant={archived ? "secondary" : "ghost"} aria-pressed={archived} onClick={() => setArchived(true)}><Archive />归档<span className="text-xs opacity-60">{isLoading ? "…" : loadError ? "—" : notes.length - wallCount}</span></Button>
        </div>
        <div className="relative w-full sm:w-64"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><input aria-label="搜索便利贴" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="找一张便利贴…" className="h-10 w-full rounded-md border bg-white pl-9 pr-9 text-sm" />{query ? <button type="button" aria-label="清除搜索" className="absolute right-0 top-0 flex size-10 items-center justify-center" onClick={() => setQuery("")}><X className="size-4" /></button> : null}</div>
      </div>
      <div className="notes-wall">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-3"><ColorPicker value={color} onChange={setColor} filter /><div className="flex items-center gap-1 text-xs text-muted-foreground"><span aria-live="polite">{isLoading ? "正在加载…" : loadError ? "加载失败" : `${visible.length} 张${archived ? "已归档" : "便利贴"}`}</span><Button variant="ghost" size="icon" aria-label="刷新便利贴" disabled={isLoading || isRefreshing || busyIds.size > 0} onClick={refresh}><RotateCw className={isLoading || isRefreshing ? "animate-spin" : ""} /></Button></div></div>
        <ListSyncFeedback error={refreshError} refreshing={isRefreshing} onRetry={refresh} />
        {isLoading ? <NotesWallSkeleton showQuickAdd={!archived && !query && color === "all"} /> : loadError ? <div role="alert" className="space-y-4 py-16 text-center"><p>{loadError}</p><Button variant="outline" onClick={refresh}>重新加载</Button>{initialEditor ? <Button variant="ghost" onClick={() => router.replace("/dashboard/notes")}>返回贴墙</Button> : null}</div> : <>
          {!archived && !query && color === "all" ? <button type="button" className="note-quick-add mb-7" onClick={() => setEditor("new")}><span className="flex size-9 items-center justify-center rounded-full bg-white/70"><Plus className="size-4" /></span><span>有什么想记下来的？</span><span className="ml-auto hidden text-xs text-stone-500 sm:inline">点一下，写张便利贴</span></button> : null}
          {visible.length === 0 ? <div className="flex flex-col items-center gap-3 py-12 text-center"><StickyNote className="mb-2 size-10 text-stone-400" /><h2 className="text-base font-medium">{query || color !== "all" ? "没有找到这张便利贴" : archived ? "归档里还没有便利贴" : "给想法找个落脚处"}</h2><p className="max-w-sm text-sm leading-6 text-muted-foreground">{query || color !== "all" ? "换个关键词或颜色，再找找看。" : archived ? "暂时不用的便利贴可以收进这里，随时移回贴墙。" : "一份清单、一个灵感、一句提醒。从第一张开始。"}</p>{query || color !== "all" ? <Button variant="outline" onClick={() => { setQuery(""); setColor("all"); }}>清除筛选</Button> : !archived ? <Button variant="outline" onClick={() => setEditor("new")}>写第一张</Button> : null}</div> : <>
            {pinned.length > 0 ? <section aria-label="置顶便利贴" className="mb-8"><h2 className="mb-4 flex items-center gap-2 text-xs font-medium text-stone-600"><Pin className="size-3.5" />置顶 · {pinned.length}</h2>{cards(pinned)}</section> : null}
            {others.length > 0 ? <section aria-label="其他便利贴"><h2 className="mb-4 text-xs font-medium text-stone-600">{archived ? "收纳的便利贴" : pinned.length ? "其他便利贴" : "我的便利贴"} · {others.length}</h2>{cards(others)}</section> : null}
          </>}
        </>}
      </div>
      {editor ? <NoteComposer key={editor === "new" ? "new" : editor.id} note={editor === "new" ? null : editor} initialColor={color === "all" ? "yellow" : color} onClose={closeEditor} onSaved={saved} /> : initialEditor && initialEditor !== "new" && isLoading ? <NoteComposerSkeleton onClose={closeEditor} /> : null}
    </div>
  </DashboardLayout>;
}

function NotesWallSkeleton({ showQuickAdd }: { showQuickAdd: boolean }) {
  return (
    <SkeletonRegion label="正在加载便利贴">
      {showQuickAdd ? <Skeleton className="mb-7 h-[62px] w-full rounded-sm" /> : null}
      <Skeleton className="mb-4 h-4 w-24" />
      <div className="notes-grid">
        {[3, 5, 4, 4, 3, 5].map((lines, index) => (
          <div key={index} className="flex min-w-0 flex-col rounded-[2px_2px_18px_2px] border border-stone-200 bg-white/60 px-5 pb-3 pt-4 max-sm:px-[18px]">
            <div className="mb-3.5 flex h-5 items-center justify-between">
              <Skeleton className="h-2 w-2 rounded-full" />
              <Skeleton className="h-2.5 w-8" />
            </div>
            <div className="flex-1 space-y-3" style={{ minHeight: 144 + (lines - 3) * 16 }}>
              <Skeleton className="mb-4 h-5 w-2/3" />
              {Array.from({ length: lines }, (_, line) => (
                <Skeleton key={line} className={`h-3 ${line === lines - 1 ? "w-3/5" : "w-full"}`} />
              ))}
            </div>
            <div className="mt-4 flex h-4 items-center justify-between">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-3 w-3" />
            </div>
            <div className="mt-2 flex h-[49px] items-center gap-5 border-t border-stone-200 pt-2">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-4" />
              <Skeleton className="ml-auto h-4 w-4" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

function NoteComposerSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="note-composer sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>编辑便利贴</DialogTitle>
          <DialogDescription>正在加载这张便利贴…</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <SkeletonRegion label="正在加载便利贴内容">
            <div className="space-y-3">
              <div className="flex h-11 items-center px-1"><Skeleton className="h-6 w-2/3" /></div>
              <div className="space-y-2">
                <div className="flex h-10 items-center gap-2">
                  <Skeleton className="h-9 w-14" />
                  <Skeleton className="h-9 w-14" />
                  <Skeleton className="ml-auto h-9 w-24" />
                </div>
                <div className="h-[300px] space-y-4 rounded-md border p-3">
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
            </div>
          </SkeletonRegion>
        </DialogBody>
        <DialogFooter className="items-center justify-between border-t border-black/10 pt-3">
          <div aria-hidden="true" className="flex items-center gap-2">
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="size-6 rounded-full" />)}
          </div>
          <Button variant="ghost" onClick={onClose}>返回贴墙</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

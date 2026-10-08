"use client";

import { useRef, useState } from "react";
import type { Note } from "@/types";
import { getNoteColor, isNoteColor } from "@/lib/notes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { useFormLeaveGuard } from "@/hooks/use-form-leave-guard";
import { toast } from "@/hooks/use-toast";
import { NoteEditor } from "./note-editor";
import { ColorPicker } from "./color-picker";

export function NoteComposer({ note, initialColor = "yellow", onClose, onSaved }: {
  note: Note | null; initialColor?: string; onClose: () => void; onSaved: (note: Note) => void;
}) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [content, setContent] = useState(note?.content ?? "");
  const [color, setColor] = useState(getNoteColor(note?.color ?? initialColor).value);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saving = useRef(false);
  const dirty = title !== (note?.title ?? "") || content !== (note?.content ?? "") || color !== getNoteColor(note?.color ?? initialColor).value;
  const { requestClose } = useFormLeaveGuard({ isDirty: dirty, isBusy: isSaving || isUploading });
  const paper = getNoteColor(color);

  const save = async () => {
    if (saving.current || isUploading || !content.trim()) return;
    saving.current = true; setIsSaving(true); setSaveError(null);
    try {
      const res = await fetch(note ? `/api/notes/${note.id}` : "/api/notes", {
        method: note ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || null, content, color }),
      });
      const json = await res.json();
      if (!res.ok || !json.data?.id) throw new Error(json.error || "保存失败，请重试");
      onSaved(json.data);
      toast.success(note ? "便利贴已保存" : "已贴到墙上");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败，请重试");
    } finally { saving.current = false; setIsSaving(false); }
  };

  return <Dialog open onOpenChange={(open) => { if (!open) void requestClose(onClose); }}>
    <DialogContent className="note-composer sm:max-w-[640px]" style={{ backgroundColor: paper.background, borderColor: paper.edge }}>
      <DialogHeader>
        <DialogTitle>{note ? "编辑便利贴" : "一张新的便利贴"}</DialogTitle>
        <DialogDescription className="text-slate-600">{note?.archived_at ? "这张便利贴已收进归档，保存后仍会留在归档中。" : "记下想法、待办，或一件值得记住的小事。"}</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        {saveError ? <p role="alert" className="rounded-md border border-red-800/20 bg-white/50 p-3 text-sm text-red-800">{saveError}。内容仍在这里，可以重试保存。</p> : null}
        <label className="sr-only" htmlFor="sticky-title">标题（可选）</label>
        <input id="sticky-title" maxLength={255} value={title} disabled={isSaving} onChange={(e) => setTitle(e.target.value)} placeholder="标题（可选）" className="w-full bg-transparent px-1 py-2 text-xl font-semibold outline-none placeholder:text-slate-500" />
        <NoteEditor value={content} onChange={setContent} onUploadingChange={setIsUploading} disabled={isSaving} compact />
      </DialogBody>
      <DialogFooter className="items-center justify-between border-t border-black/10 pt-3">
        <ColorPicker value={color} onChange={(value) => { if (isNoteColor(value)) setColor(value); }} disabled={isSaving} />
        <div className="flex items-center gap-2">
          <Button variant="ghost" disabled={isSaving || isUploading} onClick={() => void requestClose(onClose)}>收起</Button>
          <Button className="bg-slate-800 text-white hover:bg-slate-700" disabled={isSaving || isUploading || !content.trim()} onClick={() => void save()}>{isSaving ? "保存中…" : note ? "保存" : "贴上去"}</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

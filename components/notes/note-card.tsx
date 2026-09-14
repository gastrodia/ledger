import type { CSSProperties } from "react";
import { Archive, ArchiveRestore, Pin, PinOff, Trash2, ArrowUpRight } from "lucide-react";
import type { Note } from "@/types";
import { getNoteColor } from "@/lib/notes";
import { formatDate } from "@/lib/utils";
import { NoteMarkdown } from "./note-markdown";

export function NoteCard({ note, busy, onEdit, onPin, onArchive, onDelete }: {
  note: Note; busy: boolean; onEdit: () => void; onPin: () => void; onArchive: () => void; onDelete: () => void;
}) {
  const color = getNoteColor(note.color);
  return <article className="sticky-note" style={{ "--paper": color.background, "--paper-edge": color.edge } as CSSProperties} aria-label={note.title || "无标题便利贴"}>
    <div className="sticky-note-top" aria-hidden="true">{note.pinned_at ? <Pin className="size-3.5" /> : <span className="size-1 rounded-full bg-black/20" />}<span>{color.label}</span></div>
    <div className="relative min-h-36 flex-1">
      <button type="button" className="absolute inset-0 z-10 rounded-sm" aria-label={`编辑便利贴：${note.title || "无标题"}`} disabled={busy} onClick={onEdit} />
      <div className="pointer-events-none max-h-64 overflow-hidden" inert>
        {note.title ? <h3 className="mb-3 break-words text-lg font-semibold leading-relaxed">{note.title}</h3> : null}
        <NoteMarkdown content={note.content} />
      </div>
    </div>
    <div className="mt-4 flex items-center justify-between gap-2 text-[11px] text-slate-600"><time dateTime={note.updated_at}>{formatDate(note.updated_at)}</time><ArrowUpRight className="size-3.5" aria-hidden="true" /></div>
    <div className="mt-2 flex items-center gap-1 border-t border-black/10 pt-2">
      <button type="button" className="note-action" disabled={busy} onClick={onPin} title={note.pinned_at ? "取消置顶" : "置顶"} aria-label={note.pinned_at ? "取消置顶" : "置顶"} aria-pressed={!!note.pinned_at}>{note.pinned_at ? <PinOff /> : <Pin />}</button>
      <button type="button" className="note-action" disabled={busy} onClick={onArchive} title={note.archived_at ? "移回贴墙" : "归档"} aria-label={note.archived_at ? "移回贴墙" : "归档"}>{note.archived_at ? <ArchiveRestore /> : <Archive />}</button>
      <button type="button" className="note-action ml-auto hover:text-red-800" disabled={busy} onClick={onDelete} title="删除" aria-label="删除"><Trash2 /></button>
    </div>
  </article>;
}

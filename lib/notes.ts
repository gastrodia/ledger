import type { Note } from "@/types";

export const noteColors = [
  { value: "yellow", label: "奶油黄", background: "#fff3bc", edge: "#eadb97" },
  { value: "pink", label: "樱花粉", background: "#fce1e5", edge: "#efc7cf" },
  { value: "green", label: "鼠尾草绿", background: "#e4edcf", edge: "#ccdbb0" },
  { value: "blue", label: "雾霾蓝", background: "#deecf5", edge: "#c2dae9" },
  { value: "purple", label: "丁香紫", background: "#ece3f7", edge: "#d9c9ea" },
] as const;

export type NoteColor = (typeof noteColors)[number]["value"];
export function isNoteColor(value: unknown): value is NoteColor {
  return noteColors.some((color) => color.value === value);
}
export function getNoteColor(value?: string | null) {
  return noteColors.find((color) => color.value === value) ?? noteColors[0];
}

export function selectNotes(notes: Note[], query: string, archived: boolean, color: string) {
  const search = query.trim().toLocaleLowerCase();
  return notes.filter((note) =>
    Boolean(note.archived_at) === archived &&
    (color === "all" || getNoteColor(note.color).value === color) &&
    (!search || `${note.title ?? ""}\n${note.content}`.toLocaleLowerCase().includes(search))
  ).sort((a, b) => {
    if (Boolean(a.pinned_at) !== Boolean(b.pinned_at)) return a.pinned_at ? -1 : 1;
    return (b.pinned_at ?? "").localeCompare(a.pinned_at ?? "") || b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id);
  });
}

export function validateNoteInput(body: unknown, creating = false): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "便利贴格式不正确";
  const input = body as Record<string, unknown>;
  if (input.title !== undefined && input.title !== null && (typeof input.title !== "string" || input.title.length > 255)) return "标题不能超过 255 个字";
  if ((creating || input.content !== undefined) && (typeof input.content !== "string" || !input.content.trim())) return "内容不能为空";
  if (input.color !== undefined && !isNoteColor(input.color)) return "请选择有效的便利贴颜色";
  for (const key of ["pinned", "archived"]) {
    if (input[key] !== undefined && typeof input[key] !== "boolean") return "便利贴状态格式不正确";
  }
  return null;
}

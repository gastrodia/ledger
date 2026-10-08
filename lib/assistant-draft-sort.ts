import { isCalendarDate } from "@/lib/assistant";

export type AssistantDraftSort = "original" | "date-asc" | "date-desc";

export function assistantDraftSort(value: unknown): AssistantDraftSort {
  return value === "date-asc" || value === "date-desc" ? value : "original";
}

export function nextAssistantDraftSort(value: unknown): AssistantDraftSort {
  const mode = assistantDraftSort(value);
  return mode === "original" ? "date-asc" : mode === "date-asc" ? "date-desc" : "original";
}

export function sortedAssistantDrafts<T extends { transaction_date: string }>(drafts: readonly T[], value?: unknown): T[] {
  const mode = assistantDraftSort(value);
  if (mode === "original") return [...drafts];
  const direction = mode === "date-asc" ? 1 : -1;
  return drafts.map((draft, index) => ({ draft, index, valid: isCalendarDate(draft.transaction_date) })).sort((a, b) => {
    // Unfilled dates stay at the end in both directions. Equal dates retain the
    // recognition order, which remains available when returning to original.
    if (a.valid !== b.valid) return a.valid ? -1 : 1;
    if (!a.valid || a.draft.transaction_date === b.draft.transaction_date) return a.index - b.index;
    return (a.draft.transaction_date < b.draft.transaction_date ? -1 : 1) * direction;
  }).map(({ draft }) => draft);
}

export const ASSISTANT_DRAFT_SORT_LABELS: Record<AssistantDraftSort, string> = {
  original: "原顺序", "date-asc": "日期正序", "date-desc": "日期倒序",
};

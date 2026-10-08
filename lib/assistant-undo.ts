import { confirmationRows, UUID_PATTERN, type AssistantDraft } from "@/lib/assistant";
import { assistantDraftSort, type AssistantDraftSort } from "@/lib/assistant-draft-sort";

// Financial requests outlive clearing chat. Preserve their exact payload until
// the server has established an outcome, including after a lost response.
export type AssistantUndoRecovery = {
  id: string;
  batch_id: string;
  drafts: AssistantDraft[];
  draft_ids: string[];
  draftSort?: AssistantDraftSort;
  error?: string;
};
export type AssistantUndoResult = {
  batch_id: string;
  drafts: AssistantDraft[];
  undone_draft_ids: string[];
  replayed: boolean;
};

export function savedDraftSnapshot(raw: unknown): AssistantDraft[] {
  confirmationRows(raw);
  const drafts = raw as AssistantDraft[];
  if (drafts.some(d => typeof d.id !== "string" || !UUID_PATTERN.test(d.id)
    || typeof d.note !== "string" || d.note.length > 1000)
    || new Set(drafts.map(d => d.id)).size !== drafts.length) throw new Error("原始入账草稿无效，请核对交易记录。");
  return drafts.map(d => ({ id: d.id, type: d.type, amount_cents: d.amount_cents, category_id: d.category_id,
    member_id: d.member_id, transaction_date: d.transaction_date, description: d.description,
    payment_method: d.payment_method, note: d.note }));
}

export function undoRecoverySnapshots(raw: unknown): AssistantUndoRecovery[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, AssistantUndoRecovery>();
  for (const value of raw.slice(0, 120)) {
    if (!value || typeof value !== "object" || !UUID_PATTERN.test(value.id)
      || !UUID_PATTERN.test(value.batch_id) || !Array.isArray(value.draft_ids)) continue;
    try {
      const drafts = savedDraftSnapshot(value.drafts);
      const ids = value.draft_ids as unknown[];
      if (!ids.length || ids.length > drafts.length || new Set(ids).size !== ids.length
        || ids.some(id => typeof id !== "string" || !drafts.some(d => d.id === id))) continue;
      byId.set(value.id, { id: value.id, batch_id: value.batch_id, drafts, draft_ids: ids as string[],
        draftSort: assistantDraftSort(value.draftSort), ...(typeof value.error === "string" ? { error: value.error.slice(0, 4000) } : {}) });
    } catch { /* Ignore invalid local snapshots; never send them to the server. */ }
  }
  return [...byId.values()];
}

export function validateUndoResult(raw: unknown, recovery: AssistantUndoRecovery): AssistantUndoResult {
  const invalid = () => { throw new Error("撤销结果暂未核对，请重试原操作。"); };
  if (!raw || typeof raw !== "object") return invalid();
  const result = raw as AssistantUndoResult;
  if (typeof result.batch_id !== "string" || !UUID_PATTERN.test(result.batch_id) || result.batch_id === recovery.batch_id
    || !Array.isArray(result.undone_draft_ids) || result.undone_draft_ids.length !== recovery.draft_ids.length
    || new Set(result.undone_draft_ids).size !== result.undone_draft_ids.length
    || result.undone_draft_ids.some(id => !recovery.draft_ids.includes(id))) return invalid();
  let drafts: AssistantDraft[];
  try { drafts = savedDraftSnapshot(result.drafts); } catch { return invalid(); }
  if (drafts.length !== recovery.draft_ids.length || drafts.some(d => recovery.drafts.some(original => original.id === d.id))) return invalid();
  const fingerprint = (rows: ReturnType<typeof confirmationRows>) => rows.map(row => JSON.stringify(row)).sort();
  if (JSON.stringify(fingerprint(confirmationRows(drafts))) !== JSON.stringify(fingerprint(confirmationRows(recovery.drafts.filter(d => recovery.draft_ids.includes(d.id)))))) return invalid();
  return { batch_id: result.batch_id, drafts, undone_draft_ids: result.undone_draft_ids, replayed: !!result.replayed };
}

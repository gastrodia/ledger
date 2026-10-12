import { z } from "zod";
import type { AssistantCategory, AssistantDraft, AssistantDraftBatch, AssistantMember } from "@/lib/assistant";
const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
export const draftEditSchema = z.object({ batch_id: id, edits: z.array(z.object({
  draft_id: id, type: z.enum(["income", "expense"]).optional(), amount_cents: z.number().int().positive().max(999_999_999_999).optional(),
  category_id: id.nullable().optional(), member_id: id.nullable().optional(), transaction_date: date.optional(),
  description: z.string().max(500).optional(), payment_method: z.string().max(40).nullable().optional(), note: z.string().max(200).optional(),
}).strict()).min(1) }).strict();
export type AssistantDraftEdit = z.infer<typeof draftEditSchema>;
export const draftConfirmSchema = z.object({ batch_id: id, draft_ids: z.array(id).min(1) }).strict();
export type AssistantDraftConfirm = z.infer<typeof draftConfirmSchema>;
export const navigationSchema = z.object({ page: z.enum(["assistant", "transactions", "stats", "loans", "giftbooks", "gifts_given", "categories", "members", "notes"]),
  operation: z.enum(["open", "clear_chat", "sort"]), batch_id: id.nullable(), order: z.enum(["original", "date-asc", "date-desc"]).nullable(),
}).strict();
export type AssistantNavigation = z.infer<typeof navigationSchema>;
export const assistantPagePaths = { assistant: "/dashboard/assistant", transactions: "/dashboard", stats: "/dashboard/stats", loans: "/dashboard/loans", giftbooks: "/dashboard/giftbooks", gifts_given: "/dashboard/gifts-given", categories: "/dashboard/categories", members: "/dashboard/members", notes: "/dashboard/notes" };
export function validateDraftEdit(raw: unknown, batch: AssistantDraftBatch | null, categories: AssistantCategory[], members: AssistantMember[]): AssistantDraftEdit {
  const parsed = draftEditSchema.safeParse(raw);
  if (!parsed.success || !batch || parsed.data.batch_id !== batch.batch_id) throw new Error("要修改的草稿已变化，请核对当前卡片。");
  const edit = parsed.data;
  if (new Set(edit.edits.map(e => e.draft_id)).size !== edit.edits.length) throw new Error("同一笔草稿不能重复修改。");
  for (const patch of edit.edits) {
    const draft = batch.drafts.find(d => d.id === patch.draft_id);
    if (!draft || Object.keys(patch).length < 2) throw new Error("请明确要修改的草稿和字段。");
    if (patch.member_id != null && !members.some(m => m.id === patch.member_id)) throw new Error("指定成员不存在，请先添加成员。");
    if (patch.category_id != null && !categories.some(c => c.id === patch.category_id && c.type === (patch.type || draft.type))) throw new Error("分类不存在或收支类型不匹配。");
  }
  return edit;
}
export function applyDraftEdit<T extends AssistantDraft & { amount?: string }>(drafts: T[], raw: AssistantDraftEdit, categories: AssistantCategory[], members: AssistantMember[]) {
  const edit = validateDraftEdit(raw, { batch_id: raw.batch_id, status: "pending", drafts }, categories, members);
  return drafts.map(draft => {
    const patch = edit.edits.find(e => e.draft_id === draft.id);
    if (!patch) return draft;
    const { draft_id: _id, ...changes } = patch;
    void _id;
    const next = { ...draft, ...changes };
    if (patch.amount_cents !== undefined && "amount" in draft) next.amount = (patch.amount_cents / 100).toFixed(2);
    if (next.category_id && !categories.some(c => c.id === next.category_id && c.type === next.type)) next.category_id = null;
    return next;
  });
}
export const ASSISTANT_DRAFT_ACTION_PROMPT = `草稿动作只使用当前draft_batch的真实组ID和行ID，按明确描述、显示顺序或范围定位；有歧义时询问，不从历史重建或猜目标。已保存流水使用manage或event更正。
edit={batch_id,edits:[{draft_id,修改字段}]}：支持type、amount_cents、category_id、member_id、transaction_date、description、payment_method、note。amount_cents为整数分，只提供明确修订字段；改类型须类别匹配，无法确定的类别可为null待选择。保留其余行和字段。
confirm={batch_id,draft_ids}：准备明确范围内草稿的入账确认，页面展示金额与明细后等待批准；缺分类或成员须补充，不声称已入账。对已有确认方案的批准使用control，不重复生成确认卡。
navigation={page,operation,batch_id,order}：page仅assistant/transactions/stats/loans/giftbooks/gifts_given/categories/members/notes。operation=open展示对应入口；sort仅调整当前草稿组，order=original/date-asc/date-desc；clear_chat须确认且不删除已保存账本。不能提供模型自行决定的URL或离开Ledger。
这些动作的drafts=[]、query=null，其他动作字段为null或省略；页面实际应用或执行后的回执才构成结果。`;

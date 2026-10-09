import { z } from "zod";
import type { AssistantCategory, AssistantDraft, AssistantDraftBatch, AssistantMember } from "@/lib/assistant";
const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
export const draftEditSchema = z.object({ batch_id: id, edits: z.array(z.object({
  draft_id: id, type: z.enum(["income", "expense"]).optional(), amount_cents: z.number().int().positive().max(999_999_999_999).optional(),
  category_id: id.nullable().optional(), member_id: id.nullable().optional(), transaction_date: date.optional(),
  description: z.string().max(500).optional(), payment_method: z.string().max(40).nullable().optional(), note: z.string().max(200).optional(),
}).strict()).min(1).max(20) }).strict();
export type AssistantDraftEdit = z.infer<typeof draftEditSchema>;
export const draftConfirmSchema = z.object({ batch_id: id, draft_ids: z.array(id).min(1).max(20) }).strict();
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
export const ASSISTANT_DRAFT_ACTION_PROMPT = `
edit：对当前draft_batch任意字段做单笔或批量修改，使用edit={batch_id,edits:[{draft_id,要修改的字段}]}，其他动作字段null、drafts=[]、query=null。支持type、amount_cents(整数分)、category_id、member_id、transaction_date、description、payment_method、note；未提及字段必须省略，不填null覆盖原值。支持“第二笔改成28.5”“都改为昨天”“加油归交通”“红包是收入”“这几笔用微信付的”。依当前显示顺序、描述、金额、日期选择目标，有歧义先问。多笔可分别修改不同值。金额/日期条件必须依据draft_batch提供的数据，不凭历史猜。修改成员也可用update成员按钮。改单笔收支类型须匹配分类，无法确定分类时置null待补。不能通过edit修改已入账记录（使用manage）。
confirm：要求把当前草稿入账，返回confirm={batch_id,draft_ids:要入账的草稿ID}，其他动作字段null、drafts=[]、query=null。既支持本组全部也支持选定若干笔。只生成确认请求，页面展示金额与明细后等用户批准，不能声称已入账。缺分类或成员时引导补全，不让模型猜。
navigate：打开功能页，navigation={page:assistant/transactions/stats/loans/giftbooks/gifts_given/categories/members/notes,operation:open,batch_id:null,order:null}；整理当前草稿顺序用operation=sort、batch_id为当前草稿组、order=original/date-asc/date-desc；清空对话用operation=clear_chat，其余字段null，必须经用户确认。无模型决定的URL，不离开本应用，不自动操作真实付款或账户安全设置。`;

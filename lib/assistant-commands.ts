import type { AssistantActionPreview } from "@/lib/assistant-action-preview";
import type { LedgerEventContext } from "@/lib/ledger-event";
import { z } from "zod";
import { isCategoryIcon, isMemberAvatar } from "@/lib/entity-icon-catalog";

export const resourceNames = {
  transactions: "收支记录", categories: "分类", members: "家庭成员", loans: "借还记录",
  repayments: "归还记录", giftbooks: "礼簿", gift_records: "收礼记录", gifts_given: "送礼记录", notes: "便利贴",
} as const;
export type LedgerResource = keyof typeof resourceNames;
const id = z.string().uuid();
const text = z.string().max(2000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const money = z.number().positive().max(9_999_999_999.99).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.0001, "金额最多两位小数");
const quantity = z.number().positive().max(999_999_999);
const item = z.object({ item_name: z.string().min(1).max(255), quantity, unit: z.string().min(1).max(32), estimated_value: z.number().nonnegative().max(9_999_999_999.99) }).strict();
export const commandSchema = z.object({
  resource: z.enum(Object.keys(resourceNames) as [LedgerResource, ...LedgerResource[]]),
  operation: z.enum(["list", "create", "update", "delete", "reorder", "export", "duplicates", "link", "unlink"]),
  scope: z.enum(["one", "all"]),
  ids: z.array(id).max(50), parent_id: id.nullable(), parent_name: z.string().max(128).nullable(),
  filter: z.object({ keyword: z.string().max(200).nullable(), start_date: date.nullable(), end_date: date.nullable(),
    type: z.string().max(30).nullable(), category_id: id.nullable(), member_id: id.nullable(),
    status: z.enum(["unpaid", "partial", "outstanding", "settled", "archived", "active", "pinned"]).nullable(),
    amount_min: z.number().nonnegative().nullable(), amount_max: z.number().nonnegative().nullable(),
  }).strict(),
  values_json: z.string().max(16000),
}).strict();
export type LedgerCommand = z.infer<typeof commandSchema>;
export type LedgerRow = Record<string, unknown> & { id: string };
export const recordContextsSchema = z.array(z.object({
  resource: z.enum(Object.keys(resourceNames) as [LedgerResource, ...LedgerResource[]]),
  rows: z.array(z.record(z.string().max(64), z.unknown())).max(50),
}).strict()).max(3).refine(value => JSON.stringify(value).length <= 50000, "查询上下文过长，请缩小查询范围");
export const assistantCardContextsSchema = z.array(z.object({ id, summary: z.string().max(4000) }).strict()).max(10);
export type AssistantApproval = { id: string; summary: string; expires_at: string | null; count: number; preview?: AssistantActionPreview };
export type SavedTransactionUpdate = { batch_id: string; draft_id: string; transaction_id: string; type: "income" | "expense"; amount_cents: number; category_id: string | null; member_id: string | null; transaction_date: string; description: string };
export type AssistantActionResult = { targets?: Array<{ resource: LedgerResource; operation: "create" | "update" | "delete" | "reorder" | "link" | "unlink"; ids: string[] }>; transaction_updates?: SavedTransactionUpdate[]; replacement_approval?: AssistantApproval; id: string; status: "pending" | "executing" | "succeeded" | "failed" | "cancelled" | "expired"; text: string; completed?: number; preview?: AssistantActionPreview; event_context?: LedgerEventContext };
export type AssistantExport = { name: string; csv: string };

export const commandValueSchemas = {
  transactions: z.object({ type: z.enum(["income", "expense"]).optional(), amount: money.optional(), category_id: id.optional(), member_id: id.optional(), transaction_date: date.optional(), description: text.nullable().optional(), attachment_key: z.null().optional() }).strict(),
  categories: z.object({ name: z.string().trim().min(1).max(50).optional(), type: z.enum(["income", "expense"]).optional(), icon: z.string().refine(isCategoryIcon).optional() }).strict(),
  members: z.object({ name: z.string().trim().min(1).max(50).optional(), avatar: z.string().refine(isMemberAvatar).nullable().optional() }).strict(),
  loans: z.object({ direction: z.enum(["owed", "lent"]).optional(), subject_type: z.enum(["money", "item"]).optional(), counterparty_name: z.string().trim().min(1).max(128).optional(), amount: money.optional(), item_name: z.string().max(255).optional(), item_quantity: quantity.optional(), item_unit: z.string().max(32).optional(), occurred_at: date.optional(), notes: text.nullable().optional(), attachment_key: z.null().optional() }).strict(),
  repayments: z.object({ repaid_at: date.optional(), repaid_amount: money.optional(), repaid_quantity: quantity.optional(), notes: text.nullable().optional(), attachment_key: z.null().optional() }).strict(),
  giftbooks: z.object({ name: z.string().trim().min(1).max(128).optional(), event_type: z.string().max(50).nullable().optional(), event_date: date.nullable().optional(), location: text.nullable().optional(), description: text.nullable().optional() }).strict(),
  gift_records: z.object({ gift_type: z.enum(["cash", "item"]).optional(), counterparty_name: z.string().trim().min(1).max(128).optional(), gift_date: date.optional(), amount: money.optional(), item_name: z.string().max(255).optional(), quantity: quantity.optional(), unit: z.string().max(32).optional(), estimated_value: z.number().nonnegative().optional(), notes: text.nullable().optional(), attachment_key: z.null().optional() }).strict(),
  gifts_given: z.object({ recipient_name: z.string().trim().min(1).max(128).optional(), gift_date: date.optional(), occasion: text.nullable().optional(), notes: text.nullable().optional(), cash_amount: money.nullable().optional(), items: z.array(item).max(20).optional(), attachment_key: z.null().optional() }).strict(),
  notes: z.object({ title: z.string().max(255).nullable().optional(), content: z.string().trim().min(1).max(20000).describe("持久化备忘正文；时间安排中的日期须按today解析为YYYY-MM-DD具体日期，并保留时间与事项，不保存依赖阅读日期的相对日期").optional(), color: z.enum(["yellow", "pink", "green", "blue", "purple"]).optional(), pinned: z.boolean().optional(), archived: z.boolean().optional() }).strict(),
};
export function validateLedgerCommand(raw: unknown): LedgerCommand {
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) {
    // Report schema paths, not raw account values, so the next model step can
    // repair its tool call instead of asking the user to debug missing fields.
    const fields = parsed.error.issues.slice(0, 12).map(issue => `${issue.path.join(".") || "command"} (${issue.code})`).join("、");
    throw new Error(`操作条件不完整：工具参数格式无效，请按command schema修正这些字段：${fields}。无用筛选值填写null，不新增用户未授权的目标。`);
  }
  const c = parsed.data;
  if (new Set(c.ids).size !== c.ids.length || (c.filter.start_date && c.filter.end_date && c.filter.start_date > c.filter.end_date)) throw new Error("操作范围无效。");
  if (c.operation === "reorder" && c.resource !== "categories") throw new Error("当前只有分类支持自定义排序。");
  if (c.operation === "create" && c.resource === "transactions") throw new Error("新收支请先生成待确认草稿，再确认入账。");
  commandValues(c);
  return c;
}
export function commandValues(c: LedgerCommand): Record<string, unknown> {
  let raw: unknown;
  try { raw = JSON.parse(c.values_json); } catch { throw new Error("操作内容格式无效，请重新描述。"); }
  if (["link", "unlink"].includes(c.operation)) {
    if (!["loans", "repayments", "gift_records", "gifts_given"].includes(c.resource)) throw new Error("该记录不支持收支关联。");
    const link = (c.operation === "link" ? z.object({ transaction_id: id }).strict() : z.object({}).strict()).safeParse(raw);
    if (!link.success) throw new Error("请指定要关联的收支记录；解除关联时不需要填写其他字段。");
    return link.data;
  }
  const parsed = commandValueSchemas[c.resource].safeParse(raw);
  if (!parsed.success) throw new Error("操作字段无效，请检查金额、日期和必填信息。");
  const values: Record<string, unknown> = parsed.data;
  if (["list", "delete", "export", "reorder", "duplicates"].includes(c.operation) && Object.keys(values).length) throw new Error("查询或删除不能同时修改字段。");
  if (["create", "update"].includes(c.operation) && !Object.keys(values).length) throw new Error("请说明要填写或修改的内容。");
  return values;
}
export function validateCommandRow(resource: LedgerResource, row: Record<string, unknown>) {
  const required: Partial<Record<LedgerResource, string[]>> = {
    transactions: ["type", "amount", "category_id", "member_id", "transaction_date"], categories: ["name", "type"], members: ["name"],
    loans: ["direction", "subject_type", "counterparty_name", "occurred_at"], repayments: ["repaid_at"], giftbooks: ["name"],
    gift_records: ["gift_type", "counterparty_name", "gift_date"], gifts_given: ["recipient_name", "gift_date"], notes: ["content"],
  };
  const missing = required[resource]!.filter(key => row[key] == null || row[key] === "");
  if (missing.length) throw new Error(`请补充${missing.map(key => fieldNames[key] || key).join("、")}。`);
  if (resource === "loans" && (row.subject_type === "money" ? !(Number(row.amount) > 0) : !row.item_name || !(Number(row.item_quantity) > 0) || !row.item_unit)) throw new Error("请补充借还金额，或物品名称、数量和单位。");
  if (resource === "repayments" && !(Number(row.repaid_amount) > 0 || Number(row.repaid_quantity) > 0)) throw new Error("请补充归还金额或数量。");
  if (resource === "gift_records" && (row.gift_type === "cash" ? !(Number(row.amount) > 0) : !row.item_name || !(Number(row.quantity) > 0))) throw new Error("请补充礼金金额或礼品名称和数量。");
  if (resource === "gifts_given" && !(Number(row.cash_amount) > 0) && !(Array.isArray(row.items) && row.items.length)) throw new Error("请补充礼金或礼品明细。");
}
export const fieldNames: Record<string, string> = { transaction_id: "关联的收支", type: "收支类型", amount: "金额", category_id: "分类", member_id: "成员", transaction_date: "日期", description: "用途", name: "名称", icon: "图标", avatar: "头像", direction: "借还方向", subject_type: "钱款或物品", counterparty_name: "对方", occurred_at: "发生日期", notes: "备注", repaid_at: "归还日期", repaid_amount: "归还金额", repaid_quantity: "归还数量", item_name: "物品名称", item_quantity: "物品数量", item_unit: "单位", gift_type: "礼金或礼品", gift_date: "礼金日期", quantity: "数量", unit: "单位", estimated_value: "估值", recipient_name: "收礼人", cash_amount: "礼金", items: "礼品明细", occasion: "事由", event_type: "活动类型", event_date: "活动日期", location: "地点", title: "标题", content: "内容", color: "颜色", pinned: "置顶", archived: "归档", attachment_key: "附件" };
export const ASSISTANT_COMMAND_PROMPT = `manage操作Ledger现有数据，command={resource,operation,scope,ids,parent_id,parent_name,filter,values_json}；其他动作字段不用，drafts=[]、query=null。resource包括transactions、categories、members、loans、repayments、giftbooks、gift_records、gifts_given、notes。operation包括list、create、update、delete、reorder、export、duplicates、link、unlink。
scope必须为one或all，不能为null。create使用one且ids=[]；其他操作的one表示明确单笔，只有用户授权多笔范围时才all。ids来自当前实际读取、草稿映射或可用上下文，不猜ID。filter包含keyword,start_date,end_date,type,category_id,member_id,status,amount_min,amount_max，所有未使用值为null。keyword为用户原文中的字面名称或用途，不以语义类别冒充关键词；筛选条件共同生效。用户未限制时间时不擅自限制管理范围。单笔匹配多个目标由服务端拒绝并要求缩小范围。
values_json是JSON对象字符串；无字段修改为"{}"。金额使用元。只提供用户要求填写或修订的字段，未改字段省略，不用null覆盖；ID、金额、日期和权限仍由服务端核验。名称或日期已能明确定位时可直接准备影响预览，不必为了取得ID先额外list；需要现有完整字段时先读实际记录。
新增普通收支使用record；transactions/update可改type、amount、category_id、member_id、transaction_date、description，attachment_key:null表示移除附件。saved_batch更正使用原draft.id映射，保留未改字段与真实流水身份。
categories：name,type,icon；reorder仅分类支持，ids必须是filter.type所指类型下的完整排序。members：name,avatar。图标和头像仅可用系统标识，未指定省略。
loans：direction=owed/lent分别表示我欠别人/别人欠我；subject_type=money/item；counterparty_name,amount或item_name,item_quantity,item_unit,occurred_at,notes。借还filter.type为direction；status=unpaid表示未归还，partial表示部分归还，outstanding包含未归还和部分归还，settled表示结清。
repayments：repaid_at,repaid_amount或repaid_quantity,notes；parent_id或parent_name定位原借还。读取归还明细使用repayments，不用loans替代；全额结清必须读取真实未还数，不能猜金额。
giftbooks：name,event_type,event_date,location,description；仅用于礼簿本身。gift_records：gift_type=cash/item,counterparty_name,gift_date,amount或item_name,quantity,unit,estimated_value,notes；parent_id或parent_name定位礼簿。
gifts_given：recipient_name,gift_date,occasion,notes,cash_amount,items:[{item_name,quantity,unit,estimated_value}]。纯实物不填现金金额，估值不形成流水。items整组替换，修改前读取完整明细，不能丢弃用户未要求删除的条目。
notes：title,content,color=yellow/pink/green/blue/purple,pinned,archived。具体备忘请求可直接准备notes/create方案，不先多问一轮是否创建；保留原意与明确日期时间；notes.content中的日期安排必须以YYYY-MM-DD具体日历日期保存，相对日期按本轮today换算；同时保留具体时间和事项原意，不能保存会随阅读日期改变含义的相对日期。记录备忘不等于创建日程或主动通知，不支持的能力据实说明。礼貌表达的具体任务与纯能力询问根据完整意图区分，不按句式拦截。
钱款借还及送收礼使用event一次确认整件事项，不能分步重复生成台账与普通收支。物品独立台账仍可manage，估值不计现金流。link每次关联一个loans/repayments/gift_records/gifts_given来源，values_json={transaction_id:实际查询ID}；unlink为"{}"，两者不删除任何账目。
list/export返回真实记录，duplicates仅给出普通收支疑似重复候选，不自动认定重复或删除。附件上传须用户选文件，不能虚构地址。分类和成员使用中不能直接删除；借还和礼簿删除的关联影响由服务端展示。所有已保存数据写操作准备差异与影响预览后才批准执行；回复不能在执行凭据返回前声称成功。`;

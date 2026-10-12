import { z } from "zod";

const id = z.string().uuid().nullable().default(null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v).nullable().default(null);
export const eventKinds = { gift_given: "送礼", gift_received: "收礼", loan_lent: "借出", loan_borrowed: "借入", repayment_received: "收到还款", repayment_paid: "归还借款" } as const;
export type LedgerEventKind = keyof typeof eventKinds;
const giftItemSchema = z.object({
  item_name: z.string().trim().min(1).max(255),
  quantity: z.number().positive().max(1_000_000), unit: z.string().trim().max(32).nullable(),
  // Whole-line valuation in yuan, not a unit price or a cash payment.
  estimated_value: z.number().nonnegative().max(9_999_999_999.99).nullable(),
}).strict();
export const ledgerEventSchema = z.object({
  operation: z.enum(["create", "update", "undo"]),
  event_id: id, kind: z.enum(Object.keys(eventKinds) as [LedgerEventKind, ...LedgerEventKind[]]).nullable().default(null),
  counterparty: z.string().trim().min(1).max(128).nullable().default(null),
  amount_cents: z.number().int().positive().max(999_999_999_999).nullable().default(null), date,
  items: z.array(giftItemSchema).max(20).nullable().default(null),
  occasion: z.string().trim().max(255).nullable().default(null),
  transaction_amount_cents: z.number().int().positive().max(999_999_999_999).nullable().default(null),
  payment_recipient: z.string().trim().min(1).max(128).nullable().default(null),
  loan_id: id, book_id: id, book_name: z.string().trim().min(1).max(128).nullable().default(null),
  create_book: z.boolean().default(false), settle: z.boolean().default(false),
  category_id: id, member_id: id, note: z.string().max(2000).nullable().default(null),
  cashflow: z.enum(["auto", "new", "existing", "none"]).default("auto"), transaction_id: id,
  cashflow_basis: z.string().trim().min(1).max(4000).nullable().default(null),
  allow_duplicate: z.boolean().default(false),
}).strict();
export type LedgerEventInput = z.infer<typeof ledgerEventSchema>;
export type LedgerEventContext = { status: "pending" | "saved" | "undone"; event_id: string | null; input: LedgerEventInput };
export const eventContextSchema = z.object({ status: z.enum(["pending", "saved", "undone"]), event_id: id, input: ledgerEventSchema }).strict();
export type LedgerEventChoice = { label: string; input: LedgerEventInput };
/** Detect member-only choices structurally, including conversations saved before this UI was shared. */
export function ledgerEventMemberChoices(context: LedgerEventContext | undefined, choices: LedgerEventChoice[] | undefined): LedgerEventChoice[] | undefined {
  if (context?.status !== "pending" || !choices?.length) return;
  const base = ledgerEventSchema.safeParse(context.input);
  if (!base.success) return;
  const memberOnly = choices.every(choice => {
    const selected = ledgerEventSchema.safeParse(choice.input);
    if (!selected.success || !selected.data.member_id) return false;
    return JSON.stringify({ ...selected.data, member_id: null }) === JSON.stringify({ ...base.data, member_id: null });
  });
  return memberOnly ? choices : undefined;
}
export const eventType = (kind: LedgerEventKind): "income" | "expense" => ["gift_received", "loan_borrowed", "repayment_received"].includes(kind) ? "income" : "expense";
export const eventIsLoan = (kind: LedgerEventKind) => !kind.startsWith("gift_");
export const eventIsRepayment = (kind: LedgerEventKind) => kind.startsWith("repayment_");
export const eventSource = (kind: LedgerEventKind) => kind === "gift_given" ? { table: "given_gifts", type: "given_gift" }
  : kind === "gift_received" ? { table: "gift_records", type: "gift_group" }
  : eventIsRepayment(kind) ? { table: "loan_repayments", type: "repayment" } : { table: "loans", type: "loan" };
export function validateLedgerEvent(raw: unknown): LedgerEventInput {
  const parsed = ledgerEventSchema.safeParse(raw);
  if (!parsed.success) throw new Error("这件事的信息格式无效，请检查金额、日期和目标。");
  const input = parsed.data;
  if (input.operation !== "create" && !input.event_id) throw new Error("请先明确要整体修改或撤销的哪件事。");
  if (input.cashflow !== "existing" && input.transaction_id) throw new Error("关联已有流水时请选择对应流水模式。");
  if (input.kind && input.kind !== "gift_given" && (input.items !== null || input.occasion !== null || input.transaction_amount_cents !== null || input.payment_recipient !== null)) throw new Error("礼品明细和独立付款金额仅用于送礼，不能用于借还本金或收礼。");
  return input;
}
/** Item values never create cashflow. An explicit payment can differ from the gift cash. */
export const eventCashflowCents = (input: LedgerEventInput) => input.transaction_amount_cents ?? input.amount_cents;
export const LEDGER_EVENT_PROMPT = `event统一处理钱款送礼、收礼、借出、借入、收到归还、付出归还，以及有现金流的现金与实物混合送礼；台账、流水及关联作为一件事预览和确认，不分成manage与record重复执行。纯实物且没有现金付款的送礼或借还物品使用manage台账，估值不产生资金流水。
event字段：operation=create/update/undo，event_id，kind=gift_given/gift_received/loan_lent/loan_borrowed/repayment_received/repayment_paid，counterparty，amount_cents，date，loan_id，book_id，book_name，create_book，settle，category_id，member_id，note，cashflow=auto/new/existing/none，cashflow_basis，transaction_id，allow_duplicate，items，occasion，transaction_amount_cents，payment_recipient。金额amount_cents、transaction_amount_cents为整数分；items.estimated_value为元且表示该行总估值。
kind由整件事项的业务性质和资金方向确定，不依关键词或姓名猜测；借还本金只计资金流动，不计日常收入与消费。纯文字转账性质无法确定时先询问业务用途，不能自动当作消费、送礼或借款。图片仅能证明资金方向时提取待确认流水事实，不推断事件性质。
缺省date按提供的today；明确历史日期和原任务日期必须保留。未知字段为null，create_book/settle/allow_duplicate默认false，cashflow默认auto。成员只使用明确依据和真实ID，不默认唯一成员；成员、礼簿及原借款选择使用服务端已有选择流程。还款loan_id来自查询，姓名可由服务端定位；全额归还使用settle=true、amount_cents=null，由服务端读取余额，不能猜或分摊多笔。
auto核对已存在流水并提供选择；new仅在用户明确要求独立新增资金流水时使用。existing关联已记流水，transaction_id来自实际查询；没有ID时由服务端按实际条件查找选择，不凭空创建重复流水。none仅在用户明确整件事项不计资金流水时使用，cashflow_basis逐字引用当前事项原文或已接受回答中的依据。只涉及礼品估值的回答不取消独立明确的礼金流水。历史欠款是否伴随本次资金发生不明时先澄清。
allow_duplicate只有用户明确另一真实发生或确认保留独立记录时为true；相同对象、日期、金额不自动证明重复，也不自动授权重复。未核实不能重复写账。
送礼amount_cents只表示礼金，不含实物估值；items保留物品原名、quantity、unit、estimated_value，陌生名称不单独构成业务歧义。occasion为事由。transaction_amount_cents保存明确的实际付款，未给总付款为null，不能将礼金与估值相加猜现金支出。payment_recipient为代收或代办付款人，与counterparty分开；关系未确定先澄清，明确无关的支付保留为独立事项。付款与送礼价值差异保留在预览，不自动补手续费、退款或新流水。
event_context提供原事项身份与条件，不默认最近事项就是本轮对象。修订必须根据原任务或明确引用定位：pending时保留原operation和未改条件，只改明确字段；金额或日期改变须重新核对原流水匹配，不沿用失配transaction_id。saved时使用update或undo并保留原event_id；字段null表示未修改，items=[]才清空物品，不重新create。取消待执行预览使用control，撤销已保存事项使用event/undo。
礼簿不明确由服务端选择，只有明确新增礼簿才create_book=true。action=event时drafts=[]、query=null，其他动作字段不用。写入和成功结果由服务端执行凭据决定，模型仅提出待核对方案。`;

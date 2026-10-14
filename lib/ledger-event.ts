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
/** One real payment, independent of the gifts' valuation and event date. */
export const ledgerEventPaymentSchema = z.object({
  transaction_id: id,
  amount_cents: z.number().int().positive().max(999_999_999_999).nullable().default(null),
  date,
  category_id: id, member_id: id,
  description: z.string().trim().min(1).max(500),
  components: z.array(z.object({
    purpose: z.enum(["gift_cash", "purchase", "other"]),
    amount_cents: z.number().int().positive().max(999_999_999_999).nullable(),
    basis: z.string().trim().min(1).max(4000),
  }).strict()).min(1).max(20),
  cashflow: z.enum(["auto", "new", "existing"]).default("auto"),
  basis: z.string().trim().min(1).max(4000),
}).strict();
export type LedgerEventPayment = z.infer<typeof ledgerEventPaymentSchema>;
export const ledgerEventSchema = z.object({
  operation: z.enum(["create", "update", "undo"]).describe("新增用create，修改已保存事项用update，整体撤销用undo。"),
  event_id: id, kind: z.enum(Object.keys(eventKinds) as [LedgerEventKind, ...LedgerEventKind[]]).nullable().default(null),
  counterparty: z.string().trim().min(1).max(128).nullable().default(null),
  amount_cents: z.number().int().nonnegative().max(999_999_999_999).nullable().default(null), date,
  payments: z.array(ledgerEventPaymentSchema).max(20).nullable().default(null),
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
export type LedgerEventContext = { status: "pending" | "saved" | "undone"; event_id: string | null; input: LedgerEventInput; payment_review?: number[] };
export const eventContextSchema = z.object({ status: z.enum(["pending", "saved", "undone"]), event_id: id, input: ledgerEventSchema, payment_review: z.array(z.number().int().min(-1)).optional() }).strict();
export type LedgerEventChoice = { label: string; input: LedgerEventInput };
/** Server-owned row indexes identify which payments may edit accounting attribution.
 * -1 is the single cashflow of an event without a payments collection.
 * Old persisted field choices carry the same permission through their structured inputs.
 */
export function ledgerEventReviewIndexes(context: LedgerEventContext | undefined, choices?: LedgerEventChoice[]): number[] | undefined {
  if (context?.status !== "pending") return;
  if (context.payment_review) return context.payment_review;
  if (!choices?.length) return;
  const base = ledgerEventSchema.parse(context.input);
  const strip = (input: LedgerEventInput) => ({ ...input, member_id: null, category_id: null,
    payments: input.payments?.map(payment => ({ ...payment, member_id: null, category_id: null })) ?? null });
  const indexes = new Set<number>();
  for (const choice of choices) {
    const parsed = ledgerEventSchema.safeParse(choice.input);
    if (!parsed.success || JSON.stringify(strip(base)) !== JSON.stringify(strip(parsed.data))) return;
    const next = parsed.data;
    if (base.member_id !== next.member_id || base.category_id !== next.category_id) indexes.add(-1);
    base.payments?.forEach((payment, index) => {
      if (payment.member_id !== next.payments![index].member_id || payment.category_id !== next.payments![index].category_id) indexes.add(index);
    });
  }
  return indexes.size ? [...indexes] : undefined;
}
/** Only accounting fields on server-offered rows can change through the review card. */
export function isLedgerEventReviewSelection(context: LedgerEventContext, indexes: number[], selected: LedgerEventInput) {
  const base = ledgerEventSchema.parse(context.input);
  const expected = { ...base, ...(indexes.includes(-1) ? { member_id: selected.member_id, category_id: selected.category_id } : {}),
    payments: base.payments?.map((payment, index) => indexes.includes(index)
      ? { ...payment, member_id: selected.payments?.[index]?.member_id ?? null, category_id: selected.payments?.[index]?.category_id ?? null } : payment) ?? null };
  return JSON.stringify(expected) === JSON.stringify(selected);
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
  if (input.payments !== null) {
    if (!input.payments.length && input.cashflow !== "none") throw new Error("没有付款时需明确仅登记台账，不能遗漏现金流水。");
    if (input.cashflow === "none" && input.payments.length) throw new Error("仅登记台账不能同时提供付款流水。");
    const ids = input.payments.flatMap(payment => payment.transaction_id ? [payment.transaction_id] : []);
    if (new Set(ids).size !== ids.length) throw new Error("同一笔付款不能在送礼中重复关联。");
    if (input.transaction_id) throw new Error("多笔付款请逐笔指定流水，不再指定合计流水。");
  }
  if (input.kind && input.kind !== "gift_given" && (input.payments !== null || input.items !== null || input.occasion !== null || input.transaction_amount_cents !== null || input.payment_recipient !== null)) throw new Error("礼品明细和独立付款金额仅用于送礼，不能用于借还本金或收礼。");
  if (input.amount_cents === 0 && input.kind && input.kind !== "gift_given") throw new Error("钱款金额必须大于零。");
  if (input.payments !== null) {
    for (const payment of input.payments) payment.amount_cents = payment.components.every(component => component.amount_cents !== null)
      ? payment.components.reduce((total, component) => total + component.amount_cents!, 0) : null;
    if (input.cashflow !== "none" && input.amount_cents !== null) {
      const cash = input.payments.flatMap(payment => payment.components).filter(component => component.purpose === "gift_cash");
      if (cash.every(component => component.amount_cents !== null) && cash.reduce((total, component) => total + component.amount_cents!, 0) !== input.amount_cents)
        throw new Error("付款分项没有完整覆盖礼金。请核对礼金对应的实际付款，不可用购买款代替、遗漏礼金或自动补账；付款事实不明确时先澄清。");
    }
  }
  return input;
}
/** Item values never create cashflow. An explicit payment can differ from the gift cash. */
export const eventCashflowCents = (input: LedgerEventInput) => input.payments != null ? input.payments.every(payment => payment.amount_cents !== null) ? input.payments.reduce((total, payment) => total + payment.amount_cents!, 0) : null : input.transaction_amount_cents ?? input.amount_cents;
export const LEDGER_EVENT_PROMPT = `event统一处理钱款送礼、收礼、借出、借入、收到归还、付出归还，以及有现金流的现金与实物混合送礼；台账、流水及关联作为一件事预览和确认，不分成manage与record重复执行。纯实物且没有现金付款的送礼或借还物品使用manage台账，估值不产生资金流水。
event字段：operation=create/update/undo，event_id，kind=gift_given/gift_received/loan_lent/loan_borrowed/repayment_received/repayment_paid，counterparty，amount_cents，date，loan_id，book_id，book_name，create_book，settle，category_id，member_id，note，cashflow=auto/new/existing/none，cashflow_basis，transaction_id，allow_duplicate，items，occasion，transaction_amount_cents，payment_recipient。金额amount_cents、transaction_amount_cents为整数分；items.estimated_value为元且表示该行总估值。
kind由整件事项的业务性质和资金方向确定，不依关键词或姓名猜测；借还本金只计资金流动，不计日常收入与消费。纯文字转账性质无法确定时先询问业务用途，不能自动当作消费、送礼或借款。图片仅能证明资金方向时提取待确认流水事实，不推断事件性质。
缺省date按提供的today；明确历史日期和原任务日期必须保留。未知字段为null，create_book/settle/allow_duplicate默认false，cashflow默认auto。成员只使用明确依据和真实ID，不默认唯一成员；成员和分类不明确时保留null，交由现有记账卡片补齐，不为这些字段额外发起问答；礼簿及原借款选择使用服务端已有选择流程。还款loan_id来自查询，姓名可由服务端定位；全额归还使用settle=true、amount_cents=null，由服务端读取余额，不能猜或分摊多笔。
auto核对已存在流水并提供选择；new仅在用户明确要求独立新增资金流水时使用。existing关联已记流水，transaction_id来自实际查询；没有ID时由服务端按实际条件查找选择，不凭空创建重复流水。none仅在用户明确整件事项不计资金流水时使用，cashflow_basis逐字引用当前事项原文或已接受回答中的依据。只涉及礼品估值的回答不取消独立明确的礼金流水。历史欠款是否伴随本次资金发生不明时先澄清。
allow_duplicate只有用户明确另一真实发生或确认保留独立记录时为true；相同对象、日期、金额不自动证明重复，也不自动授权重复。未核实不能重复写账。
送礼amount_cents只表示礼金，不含实物估值；items保留物品原名、quantity、unit、estimated_value，陌生名称不单独构成业务歧义。occasion为事由。transaction_amount_cents保存明确的实际付款，未给总付款为null，不能将礼金与估值相加猜现金支出。payment_recipient为代收或代办付款人，与counterparty分开；关系未确定先澄清，明确无关的支付保留为独立事项。付款与送礼价值差异保留在预览，不自动补手续费、退款或新流水。
新送礼方案用payments逐笔表达真实付款（不是按礼品件数拆分）：transaction_id、amount_cents（整数分）、date、category_id、member_id、description、cashflow=auto/new/existing、basis（逐字引用已接受的付款事实）、components（本次支付涵盖的用途分项：purpose=gift_cash/purchase/other、amount_cents、basis）。同一次付款可有多个components，但同一笔用途金额不能跨付款重复计入；礼金实际付款必须有完整gift_cash分项，物品购买使用purchase，其他明确实际费用使用other。分项是实际金额，不是估值；分项或礼金付款事实未知则amount_cents=null并澄清，不编造差额。每笔amount_cents及全事件付款合计都由程序从components求和，transaction_amount_cents只保留旧单笔方案语义。每笔保留真实日期与归属，不能自动使用送礼日期覆盖购买日期。金额仅为估值时不得填实付；用户只确认新买需要入账但未说明实付时amount_cents=null并澄清。明确购买金额是付款事实，无须重复追问。礼金与购买付款都须完整纳入；已拥有实物估值不生成付款。一次实际付款可涵盖多种用途，不能按礼金和物品数机械拆分。
事项之间的语义引用由Agent解析为明确依赖和ID；上下文指向唯一且关系明确时直接采用，不因假想的其他对象重复追问；确有多个合理对象才澄清：先处理被引用的付款事项，成功后从执行回执或查询结果取得transaction_id，在后续送礼的payments中以existing关联。未完成的付款用workflow.depends_on等待完成，不制造未来ID或重复prepare_records。已有付款不能重新new。同一付款只在payments中出现一次；金额相同或文字相似不证明相同付款。用户只修改礼品/礼金价值时不擅自修改独立付款；明确修改付款才按transaction_id定位该笔，完整保留其他payments。新增付款transaction_id=null，移除付款从集合移除，已有ID不可替换为新ID重建。
event_context提供原事项身份与条件，不默认最近事项就是本轮对象。修订必须根据原任务或明确引用定位：pending时保留原operation和未改条件，只改明确字段；金额或日期改变须重新核对原流水匹配，不沿用失配transaction_id。saved时使用update或undo并保留原event_id；字段null表示未修改，items=[]才清空物品，不重新create。取消待执行预览使用control，撤销已保存事项使用event/undo。
礼簿不明确由服务端选择，只有明确新增礼簿才create_book=true。action=event时drafts=[]、query=null，其他动作字段不用。写入和成功结果由服务端执行凭据决定，模型仅提出待核对方案。`;

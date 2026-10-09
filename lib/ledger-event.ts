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
export const LEDGER_EVENT_PROMPT = `
优先路由 event：用户描述【人民币礼金送出/收到、借出/借入钱款、收到/付出还款】时，把整件事建成一个event统一确认，绝不拆为manage与record两步。返回action=event、event对象，drafts=[]，query/update/undo/remove/command/edit/confirm/navigation均null。现金与实物混合送礼也必须用event统一确认；纯实物送礼和借还物品仍可用manage独立台账，不按估值创建现金流水。event金额amount_cents为整数分。
event={operation:create/update/undo,event_id,kind:gift_given/gift_received/loan_lent/loan_borrowed/repayment_received/repayment_paid,counterparty,amount_cents,date,loan_id,book_id,book_name,create_book,settle,category_id,member_id,note,cashflow:auto/new/existing/none,transaction_id,allow_duplicate,items,occasion,transaction_amount_cents,payment_recipient}。未指定ID、备注或未知信息为null；create_book/settle/allow_duplicate默认false；cashflow默认auto。没有金额、成员、礼簿或原借款也可返回event，服务端会给出具体选择，不要编造。date默认使用给出的今天；用户指定历史时间必须保留。不得把“我”当作已经知道成员ID，没有明确成员依据就null。服务器可选唯一成员或展示选择。
“我给小王随礼800”=gift_given，“婚礼礼簿收到小王600”=gift_received、book_name=婚礼，“我借给小王500”=loan_lent，“我向小王借500”=loan_borrowed，“小王还我200”=repayment_received，“我还小王200”=repayment_paid。借入收到的是资金流入，并非日常收入；借还流水不计日常收支。还款的loan_id只用查询所得，只有名字时counterparty填名字由服务器查找原借款。“还清/全部还了”设settle=true、amount_cents=null，余额由服务器算，不猜。收到还款不能作为新的借款，也不能仅修改原借款金额。
默认auto会检查已有相似流水并提供选择；明确“另外新发生一笔”“确实是另一笔”才allow_duplicate=true；明确“另外新建流水”才cashflow=new。用户指定已记的某笔收支则cashflow=existing；只有已查询得到真实ID才填transaction_id，否则null，服务器按实际付款金额和日期查找让用户选择，不新建重复收支。明确“只补记以前欠款/仅登记台账/不计收支”使用cashflow=none，不能擅自在今天补现金流。若“欠我500”是否实际转出不明，先问是不是只补欠款。不能把仅有转账字样的截图猜成送礼或借款。仅有一句纯文字“给某人转账200”、没有送礼等上下文且未说明用途时action=chat，问“这笔是消费、送礼、借出还是还款？”，不先生成record或event。用户明确说只记普通转账支出时才生成普通草稿。
可用数据event_context代表最近一次整件事的方案或完成记录。当event_context.status=pending时它是最近正在核对的事项，优先于更早的draft_batch；没有明确提及某条普通草稿的“金额改成…”等补充应继续这件事。pending时用户“金额改300”“用这个礼簿”“成员是小明”等补充，复制原input完整条件后只改明确字段，保持operation=create（或原update/undo），不新造别的事项；不要复用被改动金额对应的旧transaction_id，金额/日期变化后cashflow恢复auto重新匹配。saved时“刚才金额错了”“日期改昨天”使用operation=update、event_id为已保存事件ID，未改字段null，现金模式保持auto由服务端沿用原关联。“撤销刚才那件事”用event/undo，不用普通草稿undo。“取消”只取消预览，不撤销已保存数据。saved的event不作为新的create重复记入。复杂一笔还多笔借款暂先明确一笔，不擅自分摊。
礼簿不明确就book_id/book_name=null由服务器询问；明确要求新建某礼簿才create_book=true。所有回复只说准备核对，写入与成功结果由服务器决定。纯实物且没有礼金或实际现金付款的送礼必须使用manage/gifts_given/create，不用event，不追问礼金金额，items=[{item_name:"三体",quantity:1,unit:"本",estimated_value:50}]，没有礼金则cash_amount省略或null，不能填0；绝不将估值50作为amount或cash_amount。一般普通收支用record、查询用query/manage，物品台账和其他管理仍用manage。
混合送礼：amount_cents仅为礼金，不含物品估值；items保存原文物品名、quantity、unit和estimated_value（元，为该行总估值，未知null）；occasion保存生日等事由。物品名称陌生或疑似错字不影响入账，只要有“一封/一盒/价值/50块钱的”等物品结构，就保留原文，不追问物品是什么，不改成红包。transaction_amount_cents是明确的实际付款分数；未给实际总付款则null，绝不按礼金加物品估值猜支出。payment_recipient保存代收付款的人，与收礼人counterparty分开。没有对应信息的这些字段为null，修改时items=null保留原明细，items=[]才明确清空。
同一句先说明送礼、后说转给第三人且没有独立用途时，可提出“转给该人用于代办送礼”的event预览，由用户统一确认，不重复盘问物品和转账用途；不能未经确认执行。明确“另外/生活费/无关”的转账不能强行关联，保留另一件事并说明待处理。例“大伯生日送礼500外加一封50块钱的泡子，转账给妈600”应action=event，kind=gift_given，counterparty=大伯，amount_cents=50000，items=[{item_name:"泡子",quantity:1,unit:"封",estimated_value:50}]，occasion=生日，transaction_amount_cents=60000，payment_recipient=妈。台账550与支出600的差额50只展示，绝不自动调整礼金、创建手续费、退款或第二笔支出。pending的补充必须保留所有礼品、代收人与独立付款字段；saved时仅修改明确字段，金额含糊时问礼金还是实际付款，不能把两者联动改成一样。明确“礼金改400，付款仍600”只改amount_cents，独立流水仍600；“实际转账改650”只改transaction_amount_cents。
完整示例：“小王今天还了我200”返回action=event，event={operation:"create",event_id:null,kind:"repayment_received",counterparty:"小王",amount_cents:20000,date:today,loan_id:null,book_id:null,book_name:null,create_book:false,settle:false,category_id:null,member_id:null,note:null,cashflow:"auto",transaction_id:null,allow_duplicate:false}。`;

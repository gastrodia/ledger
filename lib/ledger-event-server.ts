import { eventActionPreview, type AssistantActionPreview } from "@/lib/assistant-action-preview";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { saveAssistantApproval, getAssistantAction } from "@/lib/assistant-command-server";
import type { AssistantActionResult } from "@/lib/assistant-commands";
import { ensureLedgerEventsSchema } from "@/lib/ledger-event-schema";
import { eventCashflowCents, eventKinds, eventType, eventIsLoan, eventIsRepayment, eventSource, validateLedgerEvent, type LedgerEventInput, type LedgerEventPayment, type LedgerEventContext, type LedgerEventChoice } from "@/lib/ledger-event";

type Row = Record<string, unknown> & { id: string; _revision: string };
type Snapshot = { table: string; row: Row };
export type PreparedLedgerEvent = {
  payments?: PreparedEventPayment[]; removedPayments?: PreparedEventPayment[];
  preview?: AssistantActionPreview; event: true; input: LedgerEventInput; eventId: string; sourceId: string; transactionId: string | null;
  ownsTransaction: boolean; snapshots: Snapshot[]; sourceBefore?: Row; eventBefore?: Row; transactionBefore?: Row;
  categoryCreate?: { id: string; name: string; type: string }; bookCreate?: { id: string; name: string };
  loanState?: { id: string; revision: string; repaid: number; principal: number }; remaining?: number;
  summary: string; previousFlowKind: string | null;
};
const cents = (amount: unknown) => Math.round(Number(amount || 0) * 100);
const money = (amount: number) => `¥${(amount / 100).toFixed(2)}`;
const calendar = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : new Date(String(value)).toISOString().slice(0, 10);
const sourceAmount = (row: Row, kind: NonNullable<LedgerEventInput["kind"]>) => cents(kind === "gift_given" ? row.cash_amount : eventIsRepayment(kind) ? row.repaid_amount : row.amount);
const giftItemsValue = (input: LedgerEventInput) => (input.items || []).reduce((total, item) => total + cents(item.estimated_value), 0);
const normalizedItems = (items: unknown) => JSON.stringify((Array.isArray(items) ? items : []).map(item => ({
  item_name: item.item_name, quantity: Number(item.quantity), unit: item.unit || null,
  estimated_value: item.estimated_value == null ? null : Number(item.estimated_value),
})));
function giftSummary(input: LedgerEventInput, hasFlow: boolean, saved = false) {
  if (input.kind !== "gift_given") return "";
  const known = (input.items || []).every(item => item.estimated_value !== null);
  const value = (input.amount_cents || 0) + giftItemsValue(input);
  return (input.occasion ? `- 事由：${input.occasion}\n` : "") +
    `- 礼金：${money(input.amount_cents || 0)}\n` +
    (input.items || []).map(item => `- 物品：${item.item_name} × ${item.quantity}${item.unit || ""}，${item.estimated_value === null ? "未填写估值" : `该行价值 ${money(cents(item.estimated_value))}`}\n`).join("") +
    (input.items?.length ? `- 送礼合计价值：${known ? money(value) : "部分物品未估值，不合计"}（物品估值不另记支出）\n` : "") +
    (hasFlow && input.payment_recipient ? `- ${saved ? "付款用途" : "付款用途待核对"}：转给${input.payment_recipient}用于代办给${input.counterparty}的送礼${saved ? "" : "，请确认此关联理解"}\n` : "") +
    (hasFlow && known && eventCashflowCents(input) !== value ? `- 金额差异：实际付款 ${money(eventCashflowCents(input)!)}，送礼价值 ${money(value)}；付款${eventCashflowCents(input)! > value ? "多于" : "少于"}送礼价值 ${money(Math.abs(eventCashflowCents(input)! - value))}，仅保留差异，不自动补记或调整\n` : "");
}
async function rowById(userId: string, table: string, id: string): Promise<Row | undefined> {
  const dateColumn = ({ transactions: "transaction_date", loans: "occurred_at", loan_repayments: "repaid_at", given_gifts: "gift_date", gift_records: "gift_date", giftbooks: "event_date" } as Record<string, string>)[table];
  const dateField = dateColumn ? `,TO_CHAR(r.${dateColumn},'YYYY-MM-DD') AS ${dateColumn}` : "";
  return (await sql.query(`SELECT r.*${dateField},md5(to_jsonb(r)::text) AS _revision FROM ${table} r WHERE user_id=$1 AND id=$2`, [userId, id]))[0] as Row | undefined;
}
async function loanState(userId: string, loan: Row) {
  const rows = await sql.query(`SELECT COALESCE(SUM(repaid_amount),0)::text AS repaid,
    md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id),'[]'::jsonb)::text) AS revision
    FROM loan_repayments r WHERE user_id=$1 AND loan_id=$2`, [userId, loan.id]);
  return { id: loan.id, revision: String(rows[0].revision), repaid: cents(rows[0].repaid), principal: cents(loan.amount) };
}
export type PreparedEventPayment = {
  input: LedgerEventPayment; transactionId: string; ownsTransaction: boolean;
  previousFlowKind: string | null; transactionBefore?: Row;
};
function legacyPayment(input: LedgerEventInput, transactionId: string, ownsTransaction: boolean, previousFlowKind: string | null): PreparedEventPayment {
  return { transactionId, ownsTransaction, previousFlowKind, input: {
    transaction_id: transactionId, amount_cents: eventCashflowCents(input), date: input.date,
    category_id: input.category_id, member_id: input.member_id,
    description: `${eventKinds[input.kind!]} · ${input.counterparty}`, components: [{ purpose: "other", amount_cents: eventCashflowCents(input), basis: "原已确认方案" }], cashflow: ownsTransaction ? input.cashflow === "auto" ? "auto" : "new" : "existing", basis: input.cashflow_basis || "原已确认方案",
  } };
}
/** Legacy approvals keep their original IDs, amounts and ownership. */
export function preparedEventPayments(p: PreparedLedgerEvent): PreparedEventPayment[] {
  return p.payments ?? (p.transactionId ? [legacyPayment(p.input, p.transactionId, p.ownsTransaction, p.previousFlowKind)] : []);
}
async function prepareGiftPayments(userId: string, input: LedgerEventInput, eventBefore: Row | undefined,
  remember: (table: string, row: Row) => Row,
  clarify: (reply: string, choices?: LedgerEventChoice[]) => { reply: string; event_context: LedgerEventContext; event_choices: LedgerEventChoice[] }) {
  const original = eventBefore ? validateLedgerEvent(eventBefore.input) : null;
  const prior: PreparedEventPayment[] = eventBefore
    ? eventBefore.payments as PreparedEventPayment[] | null ?? (eventBefore.transaction_id ? [legacyPayment(original!, String(eventBefore.transaction_id), !!eventBefore.owns_transaction, eventBefore.original_flow_kind as string | null)] : []) : [];
  const links = eventBefore ? await sql.query("SELECT transaction_id FROM transaction_links WHERE user_id=$1 AND source_type='given_gift' AND source_id=$2 ORDER BY transaction_id", [userId, eventBefore.source_id]) : [];
  if (links.length !== prior.length || prior.some(payment => !links.some(link => link.transaction_id === payment.transactionId))) throw new Error("原关联已改变，请核对后再操作。");
  for (const payment of prior) {
    const row = await rowById(userId, "transactions", payment.transactionId);
    if (!row || row.type !== "expense" || cents(row.amount) !== payment.input.amount_cents || calendar(row.transaction_date) !== payment.input.date
      || (row.category_id || null) !== payment.input.category_id || (row.member_id || null) !== payment.input.member_id)
      throw new Error("关联流水已被删除或单独修改，请先核对原流水。");
    payment.transactionBefore = remember("transactions", row);
  }
  if (input.operation === "undo") {
    if (prior.some(payment => payment.ownsTransaction && payment.transactionBefore?.attachment_key)) throw new Error("这件事后来添加了附件，请先核对并移除附件再撤销，避免丢失凭证。");
    return { payments: prior, removedPayments: [] as PreparedEventPayment[] };
  }
  const payments: PreparedEventPayment[] = [];
  let needsReview = false;
  const choices = (index: number, patch: Partial<LedgerEventPayment>) => ({ ...input, payments: input.payments!.map((payment, i) => i === index ? { ...payment, ...patch } : payment) });
  for (const [index, payment] of input.payments!.entries()) {
    if (payment.amount_cents === null) return { question: clarify(`“${payment.description}”实际支付了多少？物品估值不会作为付款金额。`) };
    if (!payment.date) return { question: clarify(`“${payment.description}”实际付款日期是哪天？`) };
    const previous = prior.find(item => item.transactionId === payment.transaction_id);
    if (previous && !previous.ownsTransaction && (payment.amount_cents !== previous.input.amount_cents || payment.date !== previous.input.date
      || payment.category_id !== previous.input.category_id || payment.member_id !== previous.input.member_id)) throw new Error("这笔是原有流水，不能通过送礼修改金额、日期、成员或分类，请先核对原流水。");
    let before = previous?.transactionBefore;
    const owns = previous?.ownsTransaction ?? payment.cashflow !== "existing";
    if (!previous && payment.transaction_id && payment.cashflow !== "existing") throw new Error("引用已保存的付款必须关联原流水，不能用原ID新建支出。");
    if (!previous && (payment.cashflow === "auto" || payment.cashflow === "existing" && !payment.transaction_id)) {
      const candidates = await sql.query(`SELECT t.*,TO_CHAR(t.transaction_date,'YYYY-MM-DD') AS transaction_date FROM transactions t
        WHERE user_id=$1 AND type='expense' AND amount=$2::numeric AND transaction_date::date=$3::date
        AND NOT EXISTS(SELECT 1 FROM transaction_links l WHERE l.transaction_id=t.id) ORDER BY created_at DESC,id LIMIT 6`, [userId, payment.amount_cents / 100, payment.date]);
      if (candidates.length) return { question: clarify(`“${payment.description}”有同日同额流水，请核对是否关联，金额相同不代表同一笔付款。`, [
        ...candidates.slice(0, 5).map(row => ({ label: `关联：${row.description || "未填写用途"} · ${money(cents(row.amount))}`, input: choices(index, { cashflow: "existing", transaction_id: String(row.id) }) })),
        ...(payment.cashflow === "auto" ? [{ label: "这是另外一笔真实付款，新建支出", input: choices(index, { cashflow: "new" }) }] : []),
      ]) };
      if (payment.cashflow === "existing") return { question: clarify(`没有找到“${payment.description}”对应的原流水，请补充原付款信息；本次不会重复新建。`) };
    }
    if (!previous && payment.cashflow === "existing") {
      before = await rowById(userId, "transactions", payment.transaction_id!);
      if (!before || before.type !== "expense" || cents(before.amount) !== payment.amount_cents || calendar(before.transaction_date) !== payment.date) throw new Error("原付款的金额、日期或方向不匹配，请重新核对。");
      const linked = await sql.query("SELECT source_id FROM transaction_links WHERE user_id=$1 AND transaction_id=$2", [userId, before.id]);
      if (linked.length) throw new Error("这笔流水已经关联其他事项，请先核对原关联。");
      remember("transactions", before);
      payment.category_id = before.category_id as string | null; payment.member_id = before.member_id as string | null;
    }
    if (owns) {
      const members = await sql.query("SELECT r.*,md5(to_jsonb(r)::text) AS _revision FROM members r WHERE user_id=$1 ORDER BY created_at,id", [userId]) as Row[];
      const member = members.find(row => row.id === payment.member_id);
      if (!member || !payment.category_id) needsReview = true;
      if (member) remember("members", member);
      if (payment.category_id) {
        const category = await rowById(userId, "categories", payment.category_id);
        if (!category || category.type !== "expense") throw new Error("所选分类不存在或收支方向不匹配。");
        remember("categories", category);
      }
    }
    payments.push({ input: { ...payment }, transactionId: previous?.transactionId || before?.id || randomUUID(), ownsTransaction: owns,
      previousFlowKind: previous?.previousFlowKind ?? (before ? String(before.flow_kind) : null), transactionBefore: before });
  }
  const removedPayments = prior.filter(payment => !payments.some(next => next.transactionId === payment.transactionId));
  if (removedPayments.some(payment => payment.ownsTransaction && payment.transactionBefore?.attachment_key)) throw new Error("要移除的付款含有附件，请先核对并移除附件。");
  if (needsReview) return { question: { ...clarify("请核对付款账目，补齐人员和分类后继续。"), event_context: { status: "pending" as const, event_id: input.event_id, input, payment_review: payments.flatMap((payment, index) => payment.ownsTransaction ? [index] : []) } } };
  return { payments, removedPayments };
}

export async function prepareLedgerEvent(userId: string, conversationId: string, raw: unknown) {
  let input = validateLedgerEvent(raw);
  await ensureLedgerEventsSchema();
  const snapshots: Snapshot[] = [];
  const remember = (table: string, row: Row) => { if (!snapshots.some(s => s.table === table && s.row.id === row.id)) snapshots.push({ table, row }); return row; };
  const context = (): LedgerEventContext => ({ status: "pending", event_id: input.event_id, input: { ...input, ...(input.create_book ? { book_id: null } : {}) } });
  const clarify = (reply: string, choices: LedgerEventChoice[] = []) => ({ reply, event_context: context(), event_choices: choices });
  const choose = (label: string, patch: Partial<LedgerEventInput>): LedgerEventChoice => ({ label, input: { ...context().input, ...patch } });
  let eventBefore: Row | undefined, sourceBefore: Row | undefined, transactionBefore: Row | undefined;
  let eventId: string = randomUUID(), sourceId: string = randomUUID(), ownsTransaction = true;
  if (input.operation !== "create") {
    eventBefore = await rowById(userId, "ledger_events", input.event_id!);
    if (!eventBefore || eventBefore.state !== "saved") throw new Error("这件事不存在、已撤销，或不属于当前账号。请重新查询。");
    remember("ledger_events", eventBefore);
    const original = validateLedgerEvent(eventBefore.input);
    if (original.payments !== null && input.operation === "update" && input.payments === null
      && (input.transaction_amount_cents !== null || input.member_id !== null || input.category_id !== null))
      throw new Error("这件送礼含有独立付款，请按每笔原流水ID指定付款金额、成员或分类的修改，不能用合计字段覆盖。");
    if (input.kind && input.kind !== original.kind) throw new Error("不能把已保存的整件事改成另一种类型，请先撤销，再重新记录。");
    input = { ...original, ...Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== null && !["cashflow", "create_book", "allow_duplicate", "settle"].includes(key))),
      cashflow: original.cashflow, create_book: false, settle: input.settle, event_id: eventBefore.id, operation: input.operation };
    input = validateLedgerEvent(input);
    eventId = eventBefore.id; sourceId = String(eventBefore.source_id); ownsTransaction = !!eventBefore.owns_transaction;
    sourceBefore = await rowById(userId, eventSource(input.kind!).table, sourceId);
    if (!sourceBefore) throw new Error("原台账记录已被删除，无法整体修改或撤销。请先核对原记录。");
    remember(eventSource(input.kind!).table, sourceBefore);
    if (sourceAmount(sourceBefore, input.kind!) !== original.amount_cents) throw new Error("原台账金额已被单独修改，请先核对记录，不能覆盖未确认的变化。");
    if (input.kind === "gift_given" && (normalizedItems(sourceBefore.items) !== normalizedItems(original.items) || (sourceBefore.occasion || null) !== original.occasion)) throw new Error("原送礼物品或事由已被单独修改，请先核对，不能覆盖或撤销这些变化。");
    const sourceDate = sourceBefore.gift_date || sourceBefore.occurred_at || sourceBefore.repaid_at;
    if (calendar(sourceDate) !== original.date || (sourceBefore.recipient_name || sourceBefore.counterparty_name || original.counterparty) !== original.counterparty
      || (sourceBefore.subject_type && sourceBefore.subject_type !== "money") || (sourceBefore.gift_type && sourceBefore.gift_type !== "cash")) throw new Error("原台账日期、对方或类型已被单独修改，请先核对，不能覆盖这些变化。");
    if (eventIsRepayment(input.kind!) && input.loan_id !== original.loan_id) throw new Error("更换原借款请先整体撤销这次还款，再重新选择借款，避免误改两笔借款余额。");
    if (input.kind === "gift_received") {
      const group = await sql.query("SELECT id FROM gift_records WHERE user_id=$1 AND COALESCE(group_id,id)=$2", [userId, sourceId]);
      if (group.length !== 1) throw new Error("原收礼组后来增加了其他明细，请先核对整组，不能只撤销其中一部分资金。");
    }
    if (eventBefore.transaction_id && input.payments === null && !eventBefore.payments) {
      transactionBefore = await rowById(userId, "transactions", String(eventBefore.transaction_id));
      if (!transactionBefore || cents(transactionBefore.amount) !== eventCashflowCents(original) || transactionBefore.type !== eventType(input.kind!)) throw new Error("关联流水已被删除或单独修改，请先核对原流水。");
      remember("transactions", transactionBefore);
      const links = await sql.query("SELECT transaction_id FROM transaction_links WHERE user_id=$1 AND source_type=$2 AND source_id=$3", [userId, eventSource(input.kind!).type, sourceId]);
      if (links[0]?.transaction_id !== transactionBefore.id) throw new Error("原关联已改变，请核对后再操作。");
      if (!ownsTransaction && input.operation === "update" && (eventCashflowCents(input) !== eventCashflowCents(original) || input.date !== original.date)) throw new Error("这件事关联的是原有流水。为避免改动已有账目，请先撤销这次台账与关联，再用正确流水重新登记；原流水会保留。");
    }
    if (input.operation === "undo" && (sourceBefore.attachment_key || (ownsTransaction && transactionBefore?.attachment_key))) throw new Error("这件事后来添加了附件，请先核对并移除附件再撤销，避免丢失凭证。");
  }
  if (!input.kind) return clarify("这是送礼、收礼、借出、借入、收到还款，还是归还借款？");
  const kind = input.kind, type = eventType(kind);
  if (!input.counterparty) return clarify("请告诉我对方是谁。");
  if (!input.date) return clarify("请补充这件事实际发生的日期；仅补历史台账时也需要原发生日期。");
  let parentLoan: Row | undefined, parentBook: Row | undefined;
  let state: PreparedLedgerEvent["loanState"];
  let remaining: number | undefined;
  if (eventIsRepayment(kind)) {
    const direction = kind === "repayment_received" ? "lent" : "owed";
    if (input.loan_id) parentLoan = await rowById(userId, "loans", input.loan_id);
    else {
      const candidates = await sql.query(`SELECT r.*,TO_CHAR(r.occurred_at,'YYYY-MM-DD') AS occurred_at,md5(to_jsonb(r)::text) AS _revision,
        COALESCE((SELECT SUM(repaid_amount) FROM loan_repayments p WHERE p.user_id=r.user_id AND p.loan_id=r.id),0) AS repaid
        FROM loans r WHERE user_id=$1 AND counterparty_name=$2 AND direction=$3 AND subject_type='money'
        AND amount>COALESCE((SELECT SUM(repaid_amount) FROM loan_repayments p WHERE p.user_id=r.user_id AND p.loan_id=r.id),0)
        ORDER BY r.occurred_at DESC,r.id LIMIT 21`, [userId, input.counterparty, direction]) as Row[];
      if (!candidates.length) return clarify(`没有找到${input.counterparty}对应的未结清${direction === "lent" ? "借出" : "借入"}记录。请先核对对方或补记原借款，不能把还款直接记成新借款。`);
      if (candidates.length > 1) return clarify("找到多笔借款，请选择这次归还对应哪一笔。", candidates.slice(0, 20).map(row => choose(`${calendar(row.occurred_at)} · 原借款 ${money(cents(row.amount))} · 未还 ${money(cents(row.amount) - cents(row.repaid))}`, { loan_id: row.id })));
      parentLoan = candidates[0];
    }
    if (!parentLoan || parentLoan.direction !== direction || parentLoan.subject_type !== "money" || parentLoan.counterparty_name !== input.counterparty) throw new Error("原借款的对方、方向或钱款类型不匹配，请重新选择。");
    input.loan_id = parentLoan.id; remember("loans", parentLoan);
    state = await loanState(userId, parentLoan);
    const currentRepayment = sourceBefore ? sourceAmount(sourceBefore, kind) : 0;
    const available = state.principal - state.repaid + currentRepayment;
    if (input.settle && input.operation !== "undo") input.amount_cents = available;
    if (input.amount_cents !== null && input.operation !== "undo" && (input.amount_cents <= 0 || input.amount_cents > available)) throw new Error(`本次可归还本金最多 ${money(Math.max(0, available))}。如果包含利息，请将利息单独说明，不合并冲减本金。`);
    remaining = input.operation === "undo" ? state.principal - state.repaid + currentRepayment : available - (input.amount_cents || 0);
  } else if ((kind === "loan_lent" || kind === "loan_borrowed") && sourceBefore) {
    state = await loanState(userId, sourceBefore);
    if (input.operation === "undo" && state.repaid > 0) throw new Error("原借款已有归还记录，请先撤销相关归还，再撤销借款；不会留下孤立的归还流水。");
    if (input.operation === "update" && input.amount_cents !== null && input.amount_cents < state.repaid) throw new Error(`借款金额不能低于已归还的 ${money(state.repaid)}。`);
    remaining = (input.amount_cents || 0) - state.repaid;
  }
  if (input.amount_cents === null) return clarify("这次金额是多少？如果是结清原借款，可以回复“全部还清”。");
  let bookCreate: PreparedLedgerEvent["bookCreate"];
  if (kind === "gift_received") {
    if (input.book_id) parentBook = await rowById(userId, "giftbooks", input.book_id);
    else if (input.book_name) {
      const books = await sql.query("SELECT r.*,TO_CHAR(r.event_date,'YYYY-MM-DD') AS event_date,md5(to_jsonb(r)::text) AS _revision FROM giftbooks r WHERE user_id=$1 AND name=$2 ORDER BY id LIMIT 21", [userId, input.book_name]) as Row[];
      if (books.length > 1) return clarify("有多个同名礼簿，请选择具体的一个。", books.slice(0, 20).map(row => choose(`${row.name} · ${row.event_date ? calendar(row.event_date) : "未设日期"} · ${row.location || "未设地点"}`, { book_id: row.id })));
      parentBook = books[0];
      if (!parentBook && input.create_book) bookCreate = { id: randomUUID(), name: input.book_name };
      else if (!parentBook) return clarify(`还没有“${input.book_name}”礼簿。可以一起新建，确认前不会保存。`, [choose(`新建“${input.book_name}”礼簿并继续`, { create_book: true })]);
    } else {
      const books = await sql.query("SELECT giftbooks.*,TO_CHAR(event_date,'YYYY-MM-DD') AS event_date FROM giftbooks WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20", [userId]);
      return clarify("这笔收礼记入哪个礼簿？也可以告诉我新礼簿的名称。", books.map(row => choose(`${row.name}${row.event_date ? ` · ${calendar(row.event_date)}` : ""}`, { book_id: String(row.id) })));
    }
    if (!parentBook && !bookCreate) throw new Error("所选礼簿不存在，请重新选择。");
    if (parentBook) remember("giftbooks", parentBook);
    input.book_id = parentBook?.id || bookCreate!.id;
  }
  if (input.operation === "create" && !input.allow_duplicate) {
    const source = eventSource(kind), repayment = eventIsRepayment(kind);
    const amountColumn = kind === "gift_given" ? "cash_amount" : repayment ? "repaid_amount" : "amount";
    const dateColumn = kind.startsWith("gift_") ? "gift_date" : repayment ? "repaid_at" : "occurred_at";
    const counterpartyColumn = kind === "gift_given" ? "s.recipient_name" : repayment ? "loan.counterparty_name" : "s.counterparty_name";
    // Event inputs are audit snapshots. Only the live ledger determines duplicate candidates,
    // including filtering before the count/limit and rendering from that same source snapshot.
    const existing = await sql.query(`SELECT e.id,e.created_at,e.input,e.source_id,to_jsonb(s) AS current,
        TO_CHAR(s.${dateColumn},'YYYY-MM-DD') AS source_date,${counterpartyColumn} AS counterparty,COUNT(*) OVER() AS total
      FROM ledger_events e JOIN ${source.table} s ON s.id=e.source_id AND s.user_id=e.user_id
      ${repayment ? "JOIN loans loan ON loan.id=s.loan_id AND loan.user_id=s.user_id" : ""}
      WHERE e.user_id=$1 AND e.state='saved' AND e.kind=$2 AND e.source_type=$6
        AND ${counterpartyColumn}=$3 AND COALESCE(s.${amountColumn},0)=$4::numeric/100 AND s.${dateColumn}::date=$5::date
        ${kind === "gift_received" ? "AND s.direction='received' AND s.gift_type='cash'" : ""}
        ${eventIsLoan(kind) ? `AND ${repayment ? "loan" : "s"}.subject_type='money' AND ${repayment ? "loan" : "s"}.direction='${kind === "loan_lent" || kind === "repayment_received" ? "lent" : "owed"}'` : ""}
      ORDER BY e.created_at DESC,e.id LIMIT 5`, [userId, kind, input.counterparty, input.amount_cents, input.date, source.type]);
    if (existing.length) {
      const records = await Promise.all(existing.map(async row => {
        const registered = validateLedgerEvent(row.input);
        const current = row.current as Row;
        const flows = await sql.query(`SELECT t.*,TO_CHAR(t.transaction_date,'YYYY-MM-DD') AS date,m.name AS member_name,c.name AS category_name
          FROM transaction_links l JOIN transactions t ON t.id=l.transaction_id AND t.user_id=l.user_id
          LEFT JOIN members m ON m.id=t.member_id AND m.user_id=t.user_id
          LEFT JOIN categories c ON c.id=t.category_id AND c.user_id=t.user_id
          WHERE l.user_id=$1 AND l.source_type=$2 AND l.source_id=$3 ORDER BY t.transaction_date DESC,t.created_at,t.id`, [userId, source.type, row.source_id]);
        const detail = { ...registered, amount_cents: sourceAmount(current, kind),
          counterparty: String(row.counterparty), date: String(row.source_date), note: current.notes as string | null,
          ...(kind === "gift_given" ? { items: current.items as LedgerEventInput["items"], occasion: current.occasion as string | null } : {}) };
        const preview = eventActionPreview(detail, "", { rows: [] });
        return { id: String(row.id), title: `${eventKinds[registered.kind!]} · ${detail.counterparty}`,
          subtitle: [detail.date, detail.occasion].filter(Boolean).join(" · "),
          amount: money(detail.amount_cents!), rows: [
            { label: "登记时间", value: new Date(String(row.created_at)).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) },
            ...preview.sections.filter(section => section.title === "送礼明细").flatMap(section => section.rows),
            ...(detail.note ? [{ label: "备注", value: detail.note }] : []),
            { label: "当前关联流水", value: flows.length ? `${flows.length} 笔` : "无" },
            ...flows.map((flow, index) => ({ label: `流水 ${index + 1}`, value: `${flow.date} · ${flow.type === "income" ? "收入" : "支出"} ${money(cents(flow.amount))} · ${flow.description || "未填写用途"} · ${flow.member_name || "未指定成员"} · ${flow.category_name || "未指定分类"}` })),
          ] };
      }));
      const total = Number(existing[0].total);
      const preview: AssistantActionPreview = { title: "已登记的疑似重复事项", metrics: [], sections: [], records, notices: total > records.length
        ? [{ text: `共找到 ${total} 件，展示最近 ${records.length} 件；其余请到对应台账核对。`, tone: "attention" }] : [] };
      return clarify("发现同日、同对方、同台账金额的已登记事项，仅凭这些条件不能认定是同一件事。请核对以下记录及关联付款，再决定是否新增。", [
        { ...choose("已记过，不再新增这件事", {}), decision: "skip_creation", preview },
        choose("这是另外新发生的一笔，继续核对", { allow_duplicate: true }),
      ]);
    }
  }
  if (input.operation === "create" && input.cashflow === "none" && !input.cashflow_basis)
    return clarify("请明确是否仅登记台账，不计资金流水。", [choose("只登记台账，不计资金流水", { cashflow: "none", cashflow_basis: "只登记台账，不计资金流水" })]);
  let multi: { payments: PreparedEventPayment[]; removedPayments: PreparedEventPayment[] } | undefined;
  if (input.payments !== null) {
    const prepared = await prepareGiftPayments(userId, input, eventBefore, remember, clarify);
    if (prepared.question) return prepared.question;
    multi = { payments: prepared.payments!, removedPayments: prepared.removedPayments! };
    input.transaction_amount_cents = eventCashflowCents(input);
  }
  let transactionId: string | null = eventBefore?.transaction_id as string || null;
  if (!multi && input.operation === "create" && input.cashflow !== "none") {
    if (input.cashflow === "auto" || (input.cashflow === "existing" && !input.transaction_id)) {
      const candidates = await sql.query(`SELECT t.*,TO_CHAR(t.transaction_date,'YYYY-MM-DD') AS transaction_date FROM transactions t WHERE user_id=$1 AND type=$2 AND amount=$3::numeric
        AND transaction_date::date=$4::date AND NOT EXISTS(SELECT 1 FROM transaction_links l WHERE l.user_id=t.user_id AND l.transaction_id=t.id)
        ORDER BY CASE WHEN STRPOS(COALESCE(description,''),$5)>0 THEN 0 ELSE 1 END,created_at DESC,id LIMIT 6`, [userId, type, eventCashflowCents(input)! / 100, input.date, input.counterparty]);
      if (candidates.length) return clarify(`找到${candidates.length > 5 ? "多笔" : candidates.length + " 笔"}同日同额的已有流水。请核对是否为这件事；关联原流水不会重复入账。`, [
        ...candidates.slice(0, 5).map(row => choose(`关联：${row.description || "未填写用途"} · ${calendar(row.transaction_date)} · ${money(cents(row.amount))}`, { cashflow: "existing", transaction_id: String(row.id) })),
        ...(input.cashflow === "auto" ? [choose("都不是，新建一笔流水", { cashflow: "new" }), choose("只登记台账，不计资金流水", { cashflow: "none", cashflow_basis: "只登记台账，不计资金流水" })] : []),
      ]);
    }
    if (input.cashflow === "existing" && !input.transaction_id) return clarify("没有找到同日、同实际付款金额的未关联支出。请核对原支出的金额、日期或关联状态；本次不会新建支出。");
    if (input.cashflow === "existing") {
      transactionBefore = await rowById(userId, "transactions", input.transaction_id!);
      if (!transactionBefore || transactionBefore.type !== type || cents(transactionBefore.amount) !== eventCashflowCents(input) || calendar(transactionBefore.transaction_date) !== input.date) throw new Error("已有流水的方向、金额或日期不匹配，请重新选择。");
      const linked = await sql.query("SELECT source_id FROM transaction_links WHERE user_id=$1 AND transaction_id=$2", [userId, transactionBefore.id]);
      if (linked.length) throw new Error("这笔流水已经关联其他记录，请先核对原关联，避免重复登记。");
      remember("transactions", transactionBefore); ownsTransaction = false; transactionId = transactionBefore.id;
      input.category_id = transactionBefore.category_id as string | null; input.member_id = transactionBefore.member_id as string | null;
    } else { transactionId = randomUUID(); }
  }
  if (!multi && transactionId && ownsTransaction && input.operation !== "undo") {
    const members = await sql.query("SELECT r.*,md5(to_jsonb(r)::text) AS _revision FROM members r WHERE user_id=$1 ORDER BY created_at,id", [userId]) as Row[];
    const member = members.find(row => row.id === input.member_id);
    if (!member || !input.category_id) return { ...clarify("请核对账目，补齐人员和分类后继续。"), event_context: { ...context(), payment_review: [-1] } };
    remember("members", member);
    const category = await rowById(userId, "categories", input.category_id);
    if (!category || category.type !== type) throw new Error("所选分类不存在或收支方向不匹配。");
    remember("categories", category);
  }
  if (multi) transactionId = multi.payments[0]?.transactionId || null;
  const paymentRows = multi ? [...multi.payments.flatMap(payment => [{ label: `${payment.input.description} · ${payment.input.date}`,
    value: `${money(payment.input.amount_cents!)} · ${snapshots.find(s => s.table === "members" && s.row.id === payment.input.member_id)?.row.name || "原流水成员"} · ${snapshots.find(s => s.table === "categories" && s.row.id === payment.input.category_id)?.row.name || "原流水分类"} · ${input.operation === "undo" ? payment.ownsTransaction ? "撤销本次新建支出" : "解除关联，保留原支出" : payment.ownsTransaction ? payment.transactionBefore ? "修改原支出" : "新建支出" : "关联已有支出，不重复入账"}` }, ...payment.input.components.map(component => ({ label: ({ gift_cash: "礼金付款", purchase: "购买实物", other: "其他费用" })[component.purpose], value: `${money(component.amount_cents!)} · ${component.basis}` }))]),
    ...multi.removedPayments.map(payment => ({ label: payment.input.description, value: payment.ownsTransaction ? "移除关联并撤销本事项新建的支出" : "解除关联，保留原支出" }))] : null;
  const original = eventBefore ? validateLedgerEvent(eventBefore.input) : null;
  const beforeRemaining = state ? state.principal - state.repaid : undefined;
  const summary = `${input.operation === "undo" ? "准备撤销" : input.operation === "update" ? "准备整体修改" : "准备记录"}：${eventKinds[kind]} · ${input.counterparty} · ${money(input.amount_cents)}\n` +
    `- 日期：${input.date}\n` +
    giftSummary(input, !!transactionId) +
    (original && input.operation === "update" ? `- 金额：${money(original.amount_cents!)} → ${money(input.amount_cents)}\n` : "") +
    `- 台账：${input.operation === "undo" ? "撤销这次记录" : input.operation === "update" ? "同步修改原记录" : "新增一条记录"}${parentBook ? `，记入“${parentBook.name}”礼簿` : ""}\n` +
    (bookCreate ? `- 同时新建礼簿：“${bookCreate.name}”\n` : "") +
    (remaining !== undefined ? `- 剩余未还：${money(beforeRemaining!)} → ${money(remaining)}\n` : "") +
    (paymentRows ? paymentRows.map(row => `- ${row.label}：${row.value}\n`).join("") : `- 资金流水：${!transactionId ? "仅登记台账，不产生资金收支" : input.operation === "undo" ? ownsTransaction ? "撤销本次一起新建的流水" : "解除关联，保留原有流水" : ownsTransaction ? `${input.operation === "update" ? "同步修改" : "新建"}${type === "income" ? "流入" : "流出"} ${money(eventCashflowCents(input)!)}并关联` : `关联已有${type === "income" ? "收入" : "支出"} ${money(eventCashflowCents(input)!)}（${transactionBefore?.description || "未填写用途"}），不重复入账、不改原金额`}\n`) +
    (transactionId && input.operation !== "undo" ? `- 统计：${eventIsLoan(kind) ? "标记借还往来，仅计资金流入流出，不计日常收入与消费" : "计入日常收支"}\n` : "") +
    (input.member_id ? `- 成员：${snapshots.find(s => s.table === "members" && s.row.id === input.member_id)?.row.name || "沿用原流水成员"}\n` : "") +
    (input.note ? `- 备注：${input.note}\n` : "") +
    "\n尚未执行。回复“确认执行”一次完成全部操作，或回复“取消”。也可以直接说明要修改的内容。";
  const payload: PreparedLedgerEvent = { ...(multi || {}), event: true, input, eventId, sourceId, transactionId, ownsTransaction, snapshots, sourceBefore, eventBefore, transactionBefore,
    bookCreate, loanState: state, remaining, summary, previousFlowKind: eventBefore ? eventBefore.original_flow_kind as string | null : transactionBefore ? String(transactionBefore.flow_kind || "daily") : null };
  const plan = await saveAssistantApproval(userId, conversationId, payload, summary, 1, eventActionPreview(input, summary, { rows: [
    { label: "台账", value: input.operation === "undo" ? "撤销原事项" : input.operation === "update" ? "同步修改原记录" : "新增一条记录" },
    ...(paymentRows || [{ label: "资金流水", value: !transactionId ? "仅登记台账，不产生收支" : input.operation === "undo" ? ownsTransaction ? "撤销本次新建流水" : "解除关联，保留原流水" : ownsTransaction ? `${input.operation === "update" ? "同步修改" : "新建"}${type === "income" ? "收入" : "支出"} ${money(eventCashflowCents(input)!)}并关联` : "关联已有流水，不重复入账" }]),
    ...(parentBook ? [{ label: "礼簿", value: String(parentBook.name) }] : []),
    ...(bookCreate ? [{ label: "新建礼簿", value: bookCreate.name }] : []),
    ...(remaining !== undefined ? [{ label: "剩余未还", value: `${money(beforeRemaining!)} → ${money(remaining)}` }] : []),
    ...(input.member_id ? [{ label: "成员", value: String(snapshots.find(s => s.table === "members" && s.row.id === input.member_id)?.row.name || "沿用原流水成员") }] : []),
    ...(input.category_id ? [{ label: "分类", value: String(snapshots.find(s => s.table === "categories" && s.row.id === input.category_id)?.row.name || "沿用原流水分类") }] : []),
    ...(input.note ? [{ label: "备注", value: input.note }] : []),
  ] }));
  return { ...plan, event_context: { ...context(), input: context().input }, event_choices: [] };
}

/** The approval receipt and every financial write commit in one serializable transaction. */
export async function executeLedgerEvent(userId: string, actionId: string, p: PreparedLedgerEvent): Promise<AssistantActionResult> {
  const input = validateLedgerEvent(p.input), kind = input.kind!, source = eventSource(kind);
  const payments = preparedEventPayments(p), removedPayments = p.removedPayments || [];
  const statements: ReturnType<typeof sql.query<false, false>>[] = [];
  const query = (text: string, values: unknown[] = []) => statements.push(sql.query(text, values));
  // A failing assertion aborts the transaction, including preceding statements.
  const guard = (condition: string, values: unknown[]) => query(`SELECT 1 / (CASE WHEN (${condition}) THEN 1 ELSE 0 END) AS valid`, values);
  query("SELECT id FROM assistant_actions WHERE user_id=$1 AND id=$2 FOR UPDATE", [userId, actionId]);
  guard("EXISTS(SELECT 1 FROM assistant_actions WHERE user_id=$1 AND id=$2 AND status='pending')", [userId, actionId]);
  const hasConversations = await sql.query("SELECT to_regclass('public.assistant_task_conversations') IS NOT NULL AS present");
  if (hasConversations[0]?.present) {
    query("SELECT c.id FROM assistant_task_conversations c JOIN assistant_actions a ON a.conversation_id=c.id AND a.user_id=c.user_id WHERE a.user_id=$1 AND a.id=$2 FOR UPDATE OF c", [userId, actionId]);
    guard("NOT EXISTS(SELECT 1 FROM assistant_task_conversations c JOIN assistant_actions a ON a.conversation_id=c.id AND a.user_id=c.user_id WHERE a.user_id=$1 AND a.id=$2 AND c.cleared_at IS NOT NULL)", [userId, actionId]);
  }
  const agentKey = (p as PreparedLedgerEvent & { _agent_preview?: { goal_id: string } })._agent_preview;
  if (agentKey) {
    query("SELECT id FROM assistant_tasks WHERE user_id=$1 AND id=$2 FOR SHARE", [userId, agentKey.goal_id]);
    guard("EXISTS(SELECT 1 FROM assistant_tasks t JOIN assistant_actions a ON a.user_id=t.user_id AND a.conversation_id=t.conversation_id WHERE t.user_id=$1 AND t.id=$2 AND a.id=$3 AND t.status='succeeded' AND t.agent_checkpoint->>'status'='waiting_approval' AND t.agent_checkpoint->'pending_approval'->>'action_id'=$3)", [userId, agentKey.goal_id, actionId]);
  }
  // Fixed server-selected table names; request/model strings never become identifiers.
  for (const { table, row } of [...p.snapshots].sort((a, b) => `${a.table}/${a.row.id}`.localeCompare(`${b.table}/${b.row.id}`))) {
    query(`SELECT id FROM ${table} WHERE user_id=$1 AND id=$2 FOR UPDATE`, [userId, row.id]);
    guard(`EXISTS(SELECT 1 FROM ${table} r WHERE user_id=$1 AND id=$2 AND md5(to_jsonb(r)::text)=$3)`, [userId, row.id, row._revision]);
  }
  if (kind === "gift_received" && input.operation !== "create") guard("(SELECT COUNT(*) FROM gift_records WHERE user_id=$1 AND COALESCE(group_id,id)=$2)=1", [userId, p.sourceId]);
  if (p.loanState) {
    guard("(SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id),'[]'::jsonb)::text) FROM loan_repayments r WHERE user_id=$1 AND loan_id=$2)=$3", [userId, p.loanState.id, p.loanState.revision]);
    if (input.operation === "undo" && !eventIsRepayment(kind)) guard("NOT EXISTS(SELECT 1 FROM loan_repayments WHERE user_id=$1 AND loan_id=$2)", [userId, p.sourceId]);
  }
  if (input.operation === "create" && !input.allow_duplicate) guard("NOT EXISTS(SELECT 1 FROM ledger_events WHERE user_id=$1 AND state='saved' AND kind=$2 AND input->>'counterparty'=$3 AND (input->>'amount_cents')::bigint=$4 AND input->>'date'=$5)", [userId, kind, input.counterparty, input.amount_cents, input.date]);
  const previousIds = p.eventBefore ? p.eventBefore.payments ? (p.eventBefore.payments as PreparedEventPayment[]).map(payment => payment.transactionId) : p.eventBefore.transaction_id ? [String(p.eventBefore.transaction_id)] : [] : [];
  guard("(SELECT COUNT(*) FROM transaction_links WHERE user_id=$1 AND source_type=$2 AND source_id=$3)=$4 AND NOT EXISTS(SELECT 1 FROM transaction_links WHERE user_id=$1 AND source_type=$2 AND source_id=$3 AND NOT(transaction_id=ANY($5::varchar[])))", [userId, source.type, p.sourceId, previousIds.length, previousIds]);
  for (const payment of payments) {
    if (!previousIds.includes(payment.transactionId)) guard("NOT EXISTS(SELECT 1 FROM transaction_links WHERE transaction_id=$1)", [payment.transactionId]);
    if (!payment.transactionBefore && payment.input.cashflow === "auto") guard("NOT EXISTS(SELECT 1 FROM transactions t WHERE t.user_id=$1 AND t.type=$2 AND t.amount=$3::numeric AND t.transaction_date::date=$4::date AND NOT EXISTS(SELECT 1 FROM transaction_links l WHERE l.transaction_id=t.id))", [userId, eventType(kind), payment.input.amount_cents! / 100, payment.input.date]);
  }
  if (p.bookCreate) {
    guard("NOT EXISTS(SELECT 1 FROM giftbooks WHERE user_id=$1 AND name=$2)", [userId, p.bookCreate.name]);
    query("INSERT INTO giftbooks(id,user_id,name) VALUES($1,$2,$3)", [p.bookCreate.id, userId, p.bookCreate.name]);
  }
  if (p.categoryCreate) {
    guard("NOT EXISTS(SELECT 1 FROM categories WHERE user_id=$1 AND name=$2 AND type=$3)", [userId, p.categoryCreate.name, p.categoryCreate.type]);
    query("INSERT INTO categories(id,user_id,name,type,icon) VALUES($1,$2,$3,$4,'🎁')", [p.categoryCreate.id, userId, p.categoryCreate.name, p.categoryCreate.type]);
  }
  const amount = input.amount_cents! / 100;
  const savedInput = { ...input, event_id: p.eventId, ...(p.payments ? { payments: payments.map(payment => ({ ...payment.input, transaction_id: payment.transactionId })) } : {}) };
  const savedPayments = p.payments ? payments.map(({ input: paymentInput, transactionId, ownsTransaction, previousFlowKind }) => ({ input: { ...paymentInput, transaction_id: transactionId }, transactionId, ownsTransaction, previousFlowKind })) : null;
  const removePayment = (payment: PreparedEventPayment) => {
    query("DELETE FROM transaction_links WHERE user_id=$1 AND source_type=$2 AND source_id=$3 AND transaction_id=$4", [userId, source.type, p.sourceId, payment.transactionId]);
    if (payment.ownsTransaction) query("DELETE FROM transactions WHERE user_id=$1 AND id=$2", [userId, payment.transactionId]);
    else query("UPDATE transactions SET flow_kind=$3,updated_at=NOW() WHERE user_id=$1 AND id=$2", [userId, payment.transactionId, payment.previousFlowKind || "daily"]);
  };
  if (input.operation === "undo") {
    query("DELETE FROM transaction_links WHERE user_id=$1 AND source_type=$2 AND source_id=$3", [userId, source.type, p.sourceId]);
    query(`DELETE FROM ${source.table} WHERE user_id=$1 AND id=$2`, [userId, p.sourceId]);
    for (const payment of payments) removePayment(payment);
    query("UPDATE ledger_events SET state='undone',updated_at=NOW() WHERE user_id=$1 AND id=$2", [userId, p.eventId]);
  } else {
    const fields: Record<string, unknown> = kind === "gift_given" ? { recipient_name: input.counterparty, cash_amount: amount, items: JSON.stringify(input.items || []), occasion: input.occasion, gift_date: input.date, notes: input.note }
      : kind === "gift_received" ? { giftbook_id: input.book_id, group_id: p.sourceId, direction: "received", gift_type: "cash", counterparty_name: input.counterparty, amount, currency: "CNY", gift_date: input.date, notes: input.note }
      : eventIsRepayment(kind) ? { loan_id: input.loan_id, repaid_amount: amount, repaid_at: input.date, notes: input.note }
      : { direction: kind === "loan_lent" ? "lent" : "owed", subject_type: "money", counterparty_name: input.counterparty, amount, occurred_at: input.date, notes: input.note };
    const keys = Object.keys(fields), values = Object.values(fields);
    if (input.operation === "create") query(`INSERT INTO ${source.table}(id,user_id,${keys.join(",")}) VALUES($1,$2,${keys.map((_, i) => `$${i + 3}`).join(",")})`, [p.sourceId, userId, ...values]);
    else query(`UPDATE ${source.table} SET ${keys.map((key, i) => `${key}=$${i + 3}`).join(",")},updated_at=NOW() WHERE user_id=$1 AND id=$2`, [userId, p.sourceId, ...values]);
    for (const payment of removedPayments) removePayment(payment);
    for (const payment of payments) {
      const flowKind = eventIsLoan(kind) ? "loan" : "daily";
      const description = p.payments ? payment.input.description : `${eventKinds[kind]} · ${input.counterparty}${input.occasion ? ` · ${input.occasion}` : ""}${input.payment_recipient ? ` · 转给${input.payment_recipient}代办` : ""}${input.note ? ` · ${input.note}` : ""}`.slice(0, 500);
      if (payment.ownsTransaction) {
        const values = [payment.transactionId, userId, eventType(kind), payment.input.amount_cents! / 100, payment.input.date, payment.input.category_id, payment.input.member_id, description, flowKind];
        if (!previousIds.includes(payment.transactionId)) query("INSERT INTO transactions(id,user_id,type,amount,transaction_date,category_id,member_id,description,flow_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", values);
        else query("UPDATE transactions SET type=$3,amount=$4,transaction_date=$5,category_id=$6,member_id=$7,description=$8,flow_kind=$9,updated_at=NOW() WHERE id=$1 AND user_id=$2", values);
      } else query("UPDATE transactions SET flow_kind=$3,updated_at=NOW() WHERE user_id=$1 AND id=$2", [userId, payment.transactionId, flowKind]);
      if (!previousIds.includes(payment.transactionId)) query("INSERT INTO transaction_links(user_id,source_type,source_id,transaction_id,given_gift_id,loan_id,repayment_id) VALUES($1,$2,$3,$4,$5,$6,$7)", [userId, source.type, p.sourceId, payment.transactionId, source.type === "given_gift" ? p.sourceId : null, source.type === "loan" ? p.sourceId : null, source.type === "repayment" ? p.sourceId : null]);
    }
    if (input.operation === "create") query("INSERT INTO ledger_events(id,user_id,kind,source_type,source_id,transaction_id,owns_transaction,input,original_flow_kind,payments) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)", [p.eventId, userId, kind, source.type, p.sourceId, p.payments ? null : p.transactionId, p.payments ? false : p.ownsTransaction, JSON.stringify(savedInput), p.previousFlowKind, JSON.stringify(savedPayments)]);
    else query("UPDATE ledger_events SET input=$3::jsonb,payments=$4::jsonb,transaction_id=$5,updated_at=NOW() WHERE user_id=$1 AND id=$2", [userId, p.eventId, JSON.stringify(savedInput), JSON.stringify(savedPayments), p.payments ? null : p.transactionId]);
  }

  const result: AssistantActionResult = { id: actionId, status: "succeeded", completed: 1,
    text: `已${input.operation === "undo" ? "整体撤销" : input.operation === "update" ? "整体修改" : "保存"}：${eventKinds[kind]} · ${input.counterparty} · ${money(input.amount_cents!)}。${!p.transactionId ? "仅登记台账，没有产生资金流水。" : input.operation === "undo" ? p.ownsTransaction ? "台账与本次新建流水已一起撤销。" : "已解除关联，原有流水已保留并恢复原统计口径。" : p.ownsTransaction ? "台账、资金流水及关联已一起保存。" : "已关联原有流水，没有重复入账。"}${p.remaining !== undefined ? `剩余未还 ${money(p.remaining)}。` : ""}${p.transactionId && eventIsLoan(kind) && input.operation !== "undo" ? "借还往来不计日常收入与消费。" : ""}`,
    event_context: { status: input.operation === "undo" ? "undone" : "saved", event_id: p.eventId, input: savedInput } };
  const targetResource = kind === "gift_given" ? "gifts_given" : kind === "gift_received" ? "gift_records" : eventIsRepayment(kind) ? "repayments" : "loans";
  result.targets = [{ resource: targetResource, operation: input.operation === "undo" ? "delete" : input.operation, ids: [p.sourceId] }];
  for (const operation of ["create", "update", "delete"] as const) {
    const ids = [...payments.map(payment => ({ payment, removed: input.operation === "undo" })), ...removedPayments.map(payment => ({ payment, removed: true }))]
      .filter(({ payment, removed }) => (removed ? payment.ownsTransaction ? "delete" : "update" : payment.ownsTransaction && !previousIds.includes(payment.transactionId) ? "create" : "update") === operation).map(({ payment }) => payment.transactionId);
    if (ids.length) result.targets.push({ resource: "transactions", operation, ids });
  }
  if (p.payments) result.text = `已${input.operation === "undo" ? "整体撤销" : input.operation === "update" ? "整体修改" : "保存"}：${eventKinds[kind]} · ${input.counterparty}。` +
    (input.operation === "undo" ? "台账与本事项新建支出已撤销，原有支出保留并解除关联。" : `关联 ${payments.length} 笔支出，合计 ${money(eventCashflowCents(input)!)}。已有付款没有重复入账。`) + `\n${giftSummary(input, !!payments.length, true)}`;
  else if (kind === "gift_given" && (input.items?.length || input.transaction_amount_cents !== null)) result.text += `\n${giftSummary(input, !!p.transactionId, true)}${p.transactionId ? `关联支出：${money(eventCashflowCents(input)!)}。` : ""}`;
  query("UPDATE assistant_actions SET status='succeeded',result=$3::jsonb,updated_at=NOW() WHERE user_id=$1 AND id=$2", [userId, actionId, JSON.stringify(result)]);
  try {
    await sql.transaction(statements, { isolationLevel: "Serializable" });
    return result;
  } catch (error) {
    const current = await getAssistantAction(userId, actionId);
    if (current.status !== "pending") return current;
    // Unknown transport outcomes remain retryable through the same approval ID.
    const code = (error as { code?: string }).code;
    if (!code || !/^(22|23|40)/.test(code)) throw new Error("暂时未能核对执行结果。请查询本次操作状态或重试原确认，不要重新登记同一件事。");
    const failure: AssistantActionResult = { id: actionId, status: "failed", completed: 0, text: "记录或关联在确认期间发生变化，本次全部操作已回滚，没有部分入账。请重新描述以核对最新预览。" };
    await sql.query("UPDATE assistant_actions SET status='failed',result=$3::jsonb,updated_at=NOW() WHERE user_id=$1 AND id=$2 AND status='pending'", [userId, actionId, JSON.stringify(failure)]);
    return getAssistantAction(userId, actionId);
  }
}

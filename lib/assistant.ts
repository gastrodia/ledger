import { ASSISTANT_AGENT_DOMAIN_PROMPT } from "@/lib/assistant-agent-instructions";
import type { AssistantControl } from "@/lib/assistant-control";
import type { AssistantAgentMetadata } from "@/lib/assistant-agent-runtime";
import type { AssistantReplyView } from "@/lib/assistant-reply-view";
import { validateLedgerEvent, type LedgerEventInput, type LedgerEventContext, type LedgerEventChoice } from "@/lib/ledger-event";
import { validateLedgerCommand, type LedgerCommand, type AssistantApproval, type AssistantExport } from "@/lib/assistant-commands";
import { validateDraftEdit, draftConfirmSchema, navigationSchema, type AssistantDraftEdit, type AssistantDraftConfirm, type AssistantNavigation } from "@/lib/assistant-draft-actions";
export type AssistantCategory = { id: string; name: string; type: "income" | "expense"; icon?: string };
export type AssistantMember = { id: string; name: string; avatar?: string | null };
export type AssistantDraft = {
  id: string; type: "income" | "expense"; amount_cents: number;
  category_id: string | null; member_id: string | null;
  transaction_date: string; description: string; payment_method: string | null; note: string;
};
export type AssistantQuery = { scope?: "daily" | "cashflow"; start_date: string; end_date: string; type: "income" | "expense" | null; category_id: string | null; member_id: string | null; keyword: string | null };
export type AssistantDraftBatch = { batch_id: string; status: "pending"; drafts: (Pick<AssistantDraft, "id" | "type" | "description" | "member_id"> & Partial<AssistantDraft>)[] };
export type AssistantSavedBatch = { batch_id: string; status: "saved"; drafts: (Pick<AssistantDraft, "id" | "type" | "description" | "member_id"> & Partial<AssistantDraft>)[] };
export type AssistantUndo = { batch_id: string; draft_ids: string[] };
export type AssistantDraftRemoval = { batch_id: string; draft_ids: string[] };
export type AssistantDraftMemberUpdate = { batch_id: string; draft_ids: string[]; member_id: string };
export type AssistantDraftMemberChoice = { batch_id: string; draft_ids: string[]; member_id: null };
export type AssistantImageImportSummary = { image_count: number; extracted_count: number; removed_duplicates: number; skipped_zero_amounts?: number; retained_count: number; review_required: boolean; warnings: string[] };
export type AssistantPlan = { control?: AssistantControl; control_result?: import("@/lib/assistant-commands").AssistantActionResult; replaces_output_id?: string; analysis?: string; agent?: AssistantAgentMetadata; reply_view?: AssistantReplyView; action: "record" | "query" | "chat" | "update" | "undo" | "remove" | "manage" | "edit" | "confirm" | "navigate" | "event" | "control"; event?: LedgerEventInput | null; event_context?: LedgerEventContext; event_choices?: LedgerEventChoice[]; reply: string; drafts: AssistantDraft[]; query: AssistantQuery | null; update?: AssistantDraftMemberUpdate | AssistantDraftMemberChoice | null; undo?: AssistantUndo | null; remove?: AssistantDraftRemoval | null; record_context?: { resource: string; rows: Record<string, unknown>[] }; command?: LedgerCommand | null; approval?: AssistantApproval; export_file?: AssistantExport; edit?: AssistantDraftEdit | null; confirm?: AssistantDraftConfirm | null; navigation?: AssistantNavigation | null; import_summary?: AssistantImageImportSummary };
export type AssistantMemberSelection = { draft_id: string; member: AssistantMember };
// A provider page size, never a limit on a user request or review group.
export const ASSISTANT_RECORD_BATCH_SIZE = 20;
export const MAX_AMOUNT_CENTS = 999_999_999_999;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isCalendarDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export const ASSISTANT_SYSTEM_PROMPT = `${ASSISTANT_AGENT_DOMAIN_PROMPT}
输出一个符合AssistantPlan schema的JSON对象；action决定唯一动作，未使用的动作字段为null或省略，drafts在非record动作下为空数组，query仅在query动作下填写。Agent循环的步骤schema另有规定时以步骤契约为准。
record：提取当前授权范围内实际发生的人民币普通收支，amount_cents为正整数分，direction使用type=income/expense。用户明确的多次发生保留多笔，不能从历史重建已处理交易。系统自动分页提取完整原文并生成独立待确认草稿组，用户无需拆分请求。保留发生顺序、金额、日期、用途和明确的支付方式；资金方向不能只按用途猜测。
分类从可用数据中按语义选择最合适且与类型匹配的ID，没有合适类别为null。成员只按当前原文或原任务已接受回答中的明确依据填写真实ID；未指定或不能唯一匹配为null，由页面补充选择，不沿用历史成员或默认成员。金额、方向、币种等必要事实无法确定时具体澄清，其他明确事项继续保留。
日期使用YYYY-MM-DD；明确日期优先，相对日期按提供的today计算。原目标的相对日期保持初次请求基准，只有回答明确修订的日期使用answer_today。截图保留图内明示事实、行顺序和来源信息，不自行去重；优惠、汇总和最终零金额不构成交易。截图事实提取与最终业务分类分开，缺分类或成员不阻塞其他完整行。
query：只用于普通收支统计分析。scope=daily排除借还本金，cashflow包含借还资金流。提取用户授权的时间、类型、分类、成员和字面关键词，缺省统计时间为本月。数据库提供完整汇总，有限明细仅用于举例；不输出SQL，不在读取前编造数字。列出或导出记录、查询其他台账使用manage。
update：只修改draft_batch中明确选定草稿的成员，参数为{batch_id,draft_ids,member_id}；成员未确定可为null由页面选择。目标必须是当前可编辑草稿，指代不能唯一定位时询问。其他草稿字段用edit，已保存数据用manage。
remove：按明确范围将当前draft_batch中的目标行标记为不参与入账，可恢复；不删除已保存账本，不生成替代草稿，不要求额外删除审批。未填写成员不妨碍移除；没有匹配项或范围有歧义时说明或澄清。
undo：用户必须明确要求现在执行撤销；仅用于saved_batch中已保存行撤销后恢复草稿。能力和后果询问只解释，不能准备撤销。按提供的ID、显示顺序和明确范围选目标，不能将撤销变成新交易；没有saved_batch时仍可manage查询或管理已保存记录。
manage、event、edit、confirm、navigate分别遵循各自工具契约。钱款借还和送收礼由event统一核对台账与资金流水；普通转账业务性质不明时先澄清，不能猜成消费、借还或礼金。
chat：解释能力、回答事实或提出具体澄清问题。写请求需返回对应结构化方案，不能用聊天文字代替操作，也不能只按文字声称已完成。
更正现有输出时replaces_output_id必须引用card_contexts中明确对应的原输出；新事项不替换旧卡片，不根据最近卡片、同名或同金额自动关联。saved_batch里的草稿ID是原流水映射，已保存更正保留该身份，不能重新record或先撤销再记。`;

export function missingMemberDraft<T extends AssistantDraft>(drafts: T[], members: AssistantMember[]): T | undefined {
  return drafts.find(d => !members.some(m => m.id === d.member_id));
}

export function memberQuestionText(draft: AssistantDraft) {
  return draft.type === "expense" ? "支出人是谁？" : "这笔收入属于谁？";
}

export function unassignedMemberDrafts<T extends AssistantDraft & { softRemoved?: boolean }>(drafts: T[], members: AssistantMember[]): T[] {
  const memberIds = new Set(members.map(member => member.id));
  return drafts.filter(draft => !draft.softRemoved && !memberIds.has(draft.member_id || ""));
}

export function memberBatchQuestionText(drafts: AssistantDraft[]) {
  if (drafts.length === 1) return memberQuestionText(drafts[0]);
  if (drafts.length && drafts.every(draft => draft.type === "expense")) return `这 ${drafts.length} 笔支出的支出人是谁？`;
  if (drafts.length && drafts.every(draft => draft.type === "income")) return `这 ${drafts.length} 笔收入属于谁？`;
  return drafts.length ? `这 ${drafts.length} 笔账目属于谁？` : "这组账目属于谁？";
}

export function assignMissingDraftMembers<T extends AssistantDraft & { softRemoved?: boolean }>(drafts: T[], memberId: string, members: AssistantMember[]): T[] {
  const memberIds = new Set(members.map(member => member.id));
  if (!memberIds.has(memberId)) throw new Error("成员已变更，请重新加载后选择。");
  if (!drafts.some(draft => !draft.softRemoved && !memberIds.has(draft.member_id || ""))) throw new Error("本组成员已填写，请直接编辑卡片。");
  return drafts.map(draft => draft.softRemoved || memberIds.has(draft.member_id || "") ? draft : { ...draft, member_id: memberId });
}

export function assignDraftMember<T extends AssistantDraft>(drafts: T[], draftId: string, memberId: string, members: AssistantMember[]): T[] {
  if (!members.some(m => m.id === memberId)) throw new Error("成员已变更，请重新加载后选择。");
  const target = drafts.find(d => d.id === draftId);
  if (!target || members.some(m => m.id === target.member_id)) throw new Error("这笔账的成员已填写，请直接编辑卡片。");
  return drafts.map(d => d.id === draftId ? { ...d, member_id: memberId } : d);
}

export function validateDraftBatch(raw: unknown): AssistantDraftBatch | null {
  if (raw === undefined || raw === null) return null;
  const invalid = () => { throw new Error("待确认账单上下文无效，请刷新页面后重试。"); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const batch = raw as Record<string, unknown>;
  if (typeof batch.batch_id !== "string" || !UUID_PATTERN.test(batch.batch_id) || batch.status !== "pending"
    || (batch.commit !== undefined && batch.commit !== null)
    || !Array.isArray(batch.drafts) || batch.drafts.length < 1) return invalid();
  const ids = new Set<string>();
  const drafts = batch.drafts.map((value): AssistantDraftBatch["drafts"][number] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
    const draft = value as Record<string, unknown>;
    if (typeof draft.id !== "string" || !UUID_PATTERN.test(draft.id) || ids.has(draft.id)
      || !["income", "expense"].includes(draft.type as string) || typeof draft.description !== "string" || draft.description.length > 500
      || (draft.member_id !== null && (typeof draft.member_id !== "string" || !UUID_PATTERN.test(draft.member_id)))) return invalid();
    ids.add(draft.id);
    const extra: Partial<AssistantDraft> = {};
    if (draft.amount_cents !== undefined) {
      if (!Number.isSafeInteger(draft.amount_cents) || Number(draft.amount_cents) <= 0 || Number(draft.amount_cents) > MAX_AMOUNT_CENTS) return invalid();
      extra.amount_cents = Number(draft.amount_cents);
    }
    if (draft.transaction_date !== undefined) { if (!isCalendarDate(draft.transaction_date)) return invalid(); extra.transaction_date = draft.transaction_date; }
    if (draft.category_id !== undefined) { if (draft.category_id !== null && (typeof draft.category_id !== "string" || !UUID_PATTERN.test(draft.category_id))) return invalid(); extra.category_id = draft.category_id as string | null; }
    for (const key of ["payment_method", "note"] as const) if (typeof draft[key] === "string") extra[key] = String(draft[key]).slice(0, 200);
    return { id: draft.id, type: draft.type as AssistantDraft["type"], description: draft.description, member_id: draft.member_id as string | null, ...extra };
  });
  return { batch_id: batch.batch_id, status: "pending", drafts };
}

export function validateSavedBatch(raw: unknown): AssistantSavedBatch | null {
  if (raw === undefined || raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || (raw as Record<string, unknown>).status !== "saved") {
    throw new Error("已入账账单上下文无效，请刷新页面后重试。");
  }
  try {
    const batch = validateDraftBatch({ ...raw, status: "pending" })!;
    return { ...batch, status: "saved" };
  } catch {
    throw new Error("已入账账单上下文无效，请刷新页面后重试。");
  }
}

export function validateAssistantUndo(raw: unknown, batch: AssistantSavedBatch | null): AssistantUndo {
  const currentBatch = validateSavedBatch(batch);
  if (!currentBatch) throw new Error("没有可撤销的已入账账单，请使用账单卡片中的撤销入账。");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("撤销目标格式无效，请重试。");
  const undo = raw as Record<string, unknown>;
  if (undo.batch_id !== currentBatch.batch_id || !Array.isArray(undo.draft_ids) || !undo.draft_ids.length
     || new Set(undo.draft_ids).size !== undo.draft_ids.length
    || undo.draft_ids.some(id => typeof id !== "string" || !UUID_PATTERN.test(id) || !currentBatch.drafts.some(draft => draft.id === id))) {
    throw new Error("撤销目标账单已变更，请核对卡片后重试。");
  }
  return { batch_id: currentBatch.batch_id, draft_ids: undo.draft_ids as string[] };
}

export function validateDraftRemoval(raw: unknown, batch: AssistantDraftBatch | null): AssistantDraftRemoval {
  const current = validateDraftBatch(batch);
  if (!current) throw new Error("没有可删除的待确认草稿，请核对当前卡片。");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("草稿删除目标无效，请重试。");
  const removal = raw as Record<string, unknown>;
  if (removal.batch_id !== current.batch_id || !Array.isArray(removal.draft_ids) || !removal.draft_ids.length
     || new Set(removal.draft_ids).size !== removal.draft_ids.length
    || removal.draft_ids.some(id => typeof id !== "string" || !UUID_PATTERN.test(id) || !current.drafts.some(d => d.id === id))) {
    throw new Error("要删除的草稿已变化，请核对当前卡片后重试。");
  }
  return { batch_id: current.batch_id, draft_ids: removal.draft_ids as string[] };
}

function validateMemberUpdate(raw: unknown, drafts: Pick<AssistantDraft, "id">[], members: AssistantMember[]): AssistantDraftMemberUpdate;
function validateMemberUpdate(raw: unknown, drafts: Pick<AssistantDraft, "id">[], members: AssistantMember[], allowChoice: true): AssistantDraftMemberUpdate | AssistantDraftMemberChoice;
function validateMemberUpdate(raw: unknown, drafts: Pick<AssistantDraft, "id">[], members: AssistantMember[], allowChoice = false): AssistantDraftMemberUpdate | AssistantDraftMemberChoice {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("成员修改格式无效，请重试。");
  const update = raw as Record<string, unknown>;
  if (typeof update.batch_id !== "string" || !UUID_PATTERN.test(update.batch_id)
    || !((allowChoice && update.member_id === null) || (typeof update.member_id === "string" && members.some(member => member.id === update.member_id)))
    || !Array.isArray(update.draft_ids) || !update.draft_ids.length
    || new Set(update.draft_ids).size !== update.draft_ids.length
    || update.draft_ids.some(id => typeof id !== "string" || !UUID_PATTERN.test(id) || !drafts.some(draft => draft.id === id))) {
    throw new Error("成员或目标账单已变更，请核对卡片后重试。");
  }
  const target = { batch_id: update.batch_id, draft_ids: update.draft_ids as string[] };
  return update.member_id === null ? { ...target, member_id: null } : { ...target, member_id: update.member_id as string };
}

export function applyDraftMemberUpdate<T extends AssistantDraft>(drafts: T[], update: AssistantDraftMemberUpdate, members: AssistantMember[]): T[] {
  const validated = validateMemberUpdate(update, drafts, members);
  if (new Set(drafts.map(draft => draft.id)).size !== drafts.length) throw new Error("目标账单已变更，请核对卡片后重试。");
  const ids = new Set(validated.draft_ids);
  return drafts.map(draft => ids.has(draft.id) ? { ...draft, member_id: validated.member_id } : draft);
}

export function validatePlan(raw: unknown, categories: AssistantCategory[], members: AssistantMember[], makeId: () => string, batch: AssistantDraftBatch | null = null, savedBatch: AssistantSavedBatch | null = null, reviewedCardIds: string[] = []): AssistantPlan {
  // Some multimodal responses wrap the single schema object in an array.
  // Accept only one plan and still validate every field before presenting it.
  if (Array.isArray(raw) && raw.length === 1) raw = raw[0];
  if (!raw || typeof raw !== "object") throw new Error("AI 返回格式异常，请重试。");
  const p = raw as Record<string, unknown>;
  if (typeof p.action !== "string" || !["record", "query", "chat", "update", "undo", "remove", "manage", "edit", "confirm", "navigate", "event"].includes(p.action) || typeof p.reply !== "string" || p.reply.length > 4000 || !Array.isArray(p.drafts)) throw new Error("AI 返回格式异常，请重试。");
  for (const [action, key] of [["event", "event"], ["manage", "command"], ["edit", "edit"], ["confirm", "confirm"], ["navigate", "navigation"]]) {
    if (p.action !== action && p[key] != null) throw new Error(`AI 返回的操作不一致：action=${p.action}时${key}必须为null或省略；该字段仅用于action=${action}。请修正当前步骤字段，保留原任务清单。`);
  }
  if (["manage", "edit", "confirm", "navigate", "event"].includes(p.action) && (p.drafts.length || p.query !== null)) throw new Error(`AI 返回的操作不一致：action=${p.action}时drafts必须为空数组，query必须为null。请修正当前步骤字段，保留原任务清单。`);
  if (p.action !== "remove" && p.remove != null) throw new Error(`AI 返回的操作不一致：action=${p.action}时remove必须为null或省略。请修正当前步骤字段，保留原任务清单。`);
  if (p.action !== "update" && p.update !== undefined && p.update !== null) throw new Error(`AI 返回的操作不一致：action=${p.action}时update必须为null或省略。请修正当前步骤字段，保留原任务清单。`);
  if (p.action !== "undo" && p.undo !== undefined && p.undo !== null) throw new Error(`AI 返回的操作不一致：action=${p.action}时undo必须为null或省略。请修正当前步骤字段，保留原任务清单。`);
  if (p.action !== "record" && p.drafts.length) throw new Error("非记账操作不能包含新增草稿。");
  if (p.action !== "query" && p.query !== null) throw new Error("非查询操作的query必须为null。");
  const drafts = p.action === "record" ? p.drafts.map((value): AssistantDraft => {
    const d = value as AssistantDraft;
    if (!d || !["income", "expense"].includes(d.type) || !Number.isSafeInteger(d.amount_cents) || d.amount_cents <= 0 || d.amount_cents > MAX_AMOUNT_CENTS || !isCalendarDate(d.transaction_date) || typeof d.description !== "string" || d.description.length > 500) throw new Error("AI 识别到的金额或日期无效，请补充信息后重试。");
    if (d.category_id !== null && !categories.some(c => c.id === d.category_id && c.type === d.type)) throw new Error("分类不存在或收支类型不匹配，请重新选择。");
    if (d.member_id !== null && !members.some(m => m.id === d.member_id)) throw new Error("成员不存在，请重新选择。");
    const category = categories.find(c => c.id === d.category_id);
    const member = members.find(m => m.id === d.member_id);
    return { id: makeId(), type: d.type, amount_cents: d.amount_cents, category_id: category?.id || null, member_id: member?.id || null,
      transaction_date: d.transaction_date, description: d.description, payment_method: typeof d.payment_method === "string" ? d.payment_method.slice(0, 40) : null,
      note: [typeof d.note === "string" ? d.note.slice(0, 200) : "", !category ? "请选择分类" : "", !member ? "请选择家庭成员" : ""].filter(Boolean).join("；") };
  }) : [];
  let query: AssistantQuery | null = null;
  if (p.action === "query") {
    const q = p.query as AssistantQuery;
    if (!q || !isCalendarDate(q.start_date) || !isCalendarDate(q.end_date) || q.start_date > q.end_date || Date.parse(q.end_date) - Date.parse(q.start_date) > 366 * 5 * 86_400_000 || (q.type !== null && !["income", "expense"].includes(q.type))) throw new Error("查询日期无效或范围超过5年，请重新指定。");
    if ((q.category_id !== null && !categories.some(c => c.id === q.category_id && (!q.type || c.type === q.type))) || (q.member_id !== null && !members.some(m => m.id === q.member_id))) throw new Error("查询分类或成员无效，请重新指定。");
    if (q.keyword !== null && (typeof q.keyword !== "string" || q.keyword.length > 100)) throw new Error("查询关键词过长，请缩短后重试。");
    if (q.scope !== undefined && !["daily", "cashflow"].includes(q.scope)) throw new Error("统计口径无效。");
    query = q;
  }
  if (p.action === "record" && !drafts.length) throw new Error("没有识别到有效账单，请补充金额和用途。");
  let update: AssistantDraftMemberUpdate | AssistantDraftMemberChoice | null = null;
  let undo: AssistantUndo | null = null;
  let remove: AssistantDraftRemoval | null = null;
  // Model prose explains or asks; action progress is generated from validated data.
  let reply = p.action === "record" ? `已生成 ${drafts.length} 笔待确认草稿，请核对后确认入账。`
    : p.action === "query" ? "正在查询账本。" : p.reply;
  if (p.action === "update") {
    const currentBatch = validateDraftBatch(batch);
    if (!currentBatch) throw new Error("没有可修改的待确认账单，请直接编辑卡片。");
    if (p.drafts.length || p.query !== null) throw new Error("AI 返回的操作不一致，请重试。");
    update = validateMemberUpdate(p.update, currentBatch.drafts, members, true);
    if (update.batch_id !== currentBatch.batch_id) throw new Error("目标账单组已变更，请核对卡片后重试。");
    if (update.member_id === null) {
      const ids = new Set(update.draft_ids);
      const targets = currentBatch.drafts.filter(draft => ids.has(draft.id));
      const label = targets.every(draft => draft.type === "expense") ? "支出人" : "所属成员";
      reply = `请选择${targets.length === 1 ? "这笔" : `这 ${targets.length} 笔`}账目的${label}。`;
    } else {
      const member = members.find(value => value.id === update?.member_id)!;
      reply = `准备将本组 ${update.draft_ids.length} 笔账目的成员改为「${member.name}」，尚未修改草稿。`;
    }
  }
  if (p.action === "undo") {
    if (p.drafts.length || p.query !== null || (p.update !== undefined && p.update !== null)) throw new Error("AI 返回的操作不一致，请重试。");
    undo = validateAssistantUndo(p.undo, savedBatch);
    reply = `正在撤销这 ${undo.draft_ids.length} 笔入账，成功后将恢复为待确认草稿。`;
  }
  if (p.action === "remove") {
    if (p.drafts.length || p.query !== null) throw new Error("AI 返回的操作不一致，请重试。");
    remove = validateDraftRemoval(p.remove, batch);
    reply = `准备将 ${remove.draft_ids.length} 笔待确认草稿标记为移除，尚未处理。`;
  }
  const extras: Partial<AssistantPlan> = {};
  if (p.replaces_output_id != null) {
    if (typeof p.replaces_output_id !== "string" || !reviewedCardIds.includes(p.replaces_output_id)) throw new Error("替换目标不在当前卡片上下文中，请核对原卡片。");
    extras.replaces_output_id = p.replaces_output_id;
  }
  if (p.action === "event") { extras.event = validateLedgerEvent(p.event); reply = "正在核对台账与资金流水。"; }
  if (p.action === "manage") { extras.command = validateLedgerCommand(p.command); reply = "正在核对操作范围。"; }
  if (p.action === "edit") { extras.edit = validateDraftEdit(p.edit, validateDraftBatch(batch), categories, members); reply = "正在更新待确认草稿。"; }
  if (p.action === "confirm") {
    const target = draftConfirmSchema.safeParse(p.confirm);
    if (!target.success) throw new Error("入账目标无效。");
    extras.confirm = validateDraftRemoval(target.data, batch); reply = "请核对入账明细并确认。";
  }
  if (p.action === "navigate") {
    const nav = navigationSchema.safeParse(p.navigation);
    if (!nav.success) throw new Error("页面操作无效。");
    if (nav.data.operation === "sort" && (!batch || nav.data.batch_id !== batch.batch_id || !nav.data.order)) throw new Error("要排序的草稿组已变化。");
    extras.navigation = nav.data; reply = nav.data.operation === "clear_chat" ? "清空对话会移除本机消息和未入账草稿，已入账记录保留。确认清空吗？" : "已准备好。";
  }
  return { action: p.action as AssistantPlan["action"], reply, drafts, query, update, undo, ...(remove ? { remove } : {}), ...extras };
}

export function confirmationRows(raw: unknown) {
  if (!Array.isArray(raw) || raw.length < 1) throw new Error("请选择至少一笔账单。");
  return raw.map((value) => {
    const d = value as AssistantDraft;
    if (!d || !["income", "expense"].includes(d.type) || !Number.isSafeInteger(d.amount_cents) || d.amount_cents <= 0 || d.amount_cents > MAX_AMOUNT_CENTS) throw new Error("金额须大于0且最多两位小数。");
    if (typeof d.category_id !== "string" || !UUID_PATTERN.test(d.category_id)) throw new Error("每笔都需要选择分类。");
    if (typeof d.member_id !== "string" || !UUID_PATTERN.test(d.member_id)) throw new Error("每笔都需要选择家庭成员。");
    if (!isCalendarDate(d.transaction_date)) throw new Error("交易日期无效。");
    if (typeof d.description !== "string" || d.description.length > 500 || (d.payment_method !== null && (typeof d.payment_method !== "string" || d.payment_method.length > 40))) throw new Error("备注或支付方式格式无效。");
    const description = [d.description.trim(), d.payment_method ? `支付方式：${d.payment_method.trim()}` : ""].filter(Boolean).join(" · ");
    return { type: d.type, amount_cents: d.amount_cents, category_id: d.category_id, member_id: d.member_id, transaction_date: d.transaction_date, description };
  });
}

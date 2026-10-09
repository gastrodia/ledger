import { ledgerEventSchema } from "@/lib/ledger-event";
import { commandSchema } from "@/lib/assistant-commands";
import { draftEditSchema, draftConfirmSchema, navigationSchema } from "@/lib/assistant-draft-actions";
import { jsonSchema } from "ai";
import { z } from "zod";

// The SDK validates the response shape. Account ownership and financial rules
// remain in validatePlan, where the current categories and members are known.
const nullableString = z.string().nullable();
const imageSource = z.object({
  image_index: z.number().int().positive(), row_index: z.number().int().positive(),
  time: nullableString, transaction_id: nullableString,
  kind: z.enum(["statement", "receipt", "unknown"]).optional(),
}).strict();
const assistantOutput = z.object({
  action: z.enum(["record", "query", "chat", "update", "undo", "remove", "manage", "edit", "confirm", "navigate", "event"]).describe("query只用于普通收支统计；钱款送收礼和借还的记录/整体修改/撤销选event；其他台账查询管理选manage，并填写command，query置null。"),
  event: ledgerEventSchema.nullable().optional().default(null),
  command: commandSchema.nullable().optional().default(null),
  edit: draftEditSchema.nullable().optional().default(null),
  confirm: draftConfirmSchema.nullable().optional().default(null),
  navigation: navigationSchema.nullable().optional().default(null),
  reply: z.string(),
  drafts: z.array(z.object({
    type: z.enum(["income", "expense"]), amount_cents: z.number().int(),
    category_id: nullableString, member_id: nullableString,
    transaction_date: z.string(), description: z.string(),
    payment_method: nullableString, note: z.string(),
    source: imageSource.nullable().optional(),
  }).strict()),
  query: z.object({
    scope: z.enum(["daily", "cashflow"]).optional(),
    start_date: z.string(), end_date: z.string(),
    type: z.enum(["income", "expense"]).nullable(),
    category_id: nullableString, member_id: nullableString, keyword: nullableString,
  }).strict().nullable().describe("仅action=query时填写完整普通收支统计条件；其他动作包括借还查询均必须为null"),
  update: z.object({
    batch_id: z.string(), draft_ids: z.array(z.string()), member_id: nullableString,
  }).strict().nullable().optional().default(null),
  undo: z.object({
    batch_id: z.string(), draft_ids: z.array(z.string()),
  }).strict().nullable().optional().default(null),
  remove: z.object({
    batch_id: z.string(), draft_ids: z.array(z.string()),
  }).strict().nullable().optional().default(null),
}).strict();

export type AssistantModelOutput = z.infer<typeof assistantOutput>;

export const ASSISTANT_OUTPUT_SCHEMA = jsonSchema<AssistantModelOutput>(
  z.toJSONSchema(assistantOutput, { target: "draft-7" }) as Parameters<typeof jsonSchema>[0],
  { validate: value => {
    // Preserve the existing single-plan wrapper compatibility without accepting
    // multiple plans or letting a model recreate an existing batch.
    let normalized = Array.isArray(value) && value.length === 1 ? value[0] : value;
    // Empty notes are optional commentary, not financial data. Some image
    // responses use null or omit them despite the advertised string schema.
    // Provenance only controls conservative overlap matching; unusable source
    // metadata keeps the row for review instead of requiring another request.
    if (normalized && typeof normalized === "object" && !Array.isArray(normalized) && Array.isArray((normalized as { drafts?: unknown }).drafts)) {
      const plan = normalized as { drafts: unknown[] };
      normalized = { ...plan, drafts: plan.drafts.map(draft => {
        if (!draft || typeof draft !== "object" || Array.isArray(draft)) return draft;
        const row = { ...draft, note: "note" in draft ? draft.note ?? "" : "" };
        if (!("source" in draft) || draft.source == null) return row;
        const source = imageSource.safeParse(draft.source);
        return { ...row, source: source.success ? source.data : null };
      }) };
    }
    const result = assistantOutput.safeParse(normalized);
    return result.success ? { success: true, value: result.data } : { success: false, error: result.error };
  } },
);

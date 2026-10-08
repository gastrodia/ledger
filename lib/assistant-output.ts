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
  action: z.enum(["record", "query", "chat", "update", "undo"]),
  reply: z.string(),
  drafts: z.array(z.object({
    type: z.enum(["income", "expense"]), amount_cents: z.number().int(),
    category_id: nullableString, member_id: nullableString,
    transaction_date: z.string(), description: z.string(),
    payment_method: nullableString, note: z.string(),
    source: imageSource.nullable().optional(),
  }).strict()),
  query: z.object({
    start_date: z.string(), end_date: z.string(),
    type: z.enum(["income", "expense"]).nullable(),
    category_id: nullableString, member_id: nullableString, keyword: nullableString,
  }).strict().nullable(),
  update: z.object({
    batch_id: z.string(), draft_ids: z.array(z.string()), member_id: nullableString,
  }).strict().nullable().optional().default(null),
  undo: z.object({
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
    // Provenance only controls conservative overlap matching. Unusable source
    // metadata must not discard otherwise valid financial rows or trigger a
    // second paid recognition; the merger keeps these rows and warns for review.
    if (normalized && typeof normalized === "object" && !Array.isArray(normalized) && Array.isArray((normalized as { drafts?: unknown }).drafts)) {
      const plan = normalized as { drafts: unknown[] };
      normalized = { ...plan, drafts: plan.drafts.map(draft => {
        if (!draft || typeof draft !== "object" || Array.isArray(draft) || !("source" in draft) || draft.source == null) return draft;
        const source = imageSource.safeParse(draft.source);
        return { ...draft, source: source.success ? source.data : null };
      }) };
    }
    const result = assistantOutput.safeParse(normalized);
    return result.success ? { success: true, value: result.data } : { success: false, error: result.error };
  } },
);

import { jsonSchema } from "ai";
import { z } from "zod";

// The SDK validates the response shape. Account ownership and financial rules
// remain in validatePlan, where the current categories and members are known.
const nullableString = z.string().nullable();
const assistantOutput = z.object({
  action: z.enum(["record", "query", "chat", "update"]),
  reply: z.string(),
  drafts: z.array(z.object({
    type: z.enum(["income", "expense"]), amount_cents: z.number().int(),
    category_id: nullableString, member_id: nullableString,
    transaction_date: z.string(), description: z.string(),
    payment_method: nullableString, note: z.string(),
  }).strict()),
  query: z.object({
    start_date: z.string(), end_date: z.string(),
    type: z.enum(["income", "expense"]).nullable(),
    category_id: nullableString, member_id: nullableString, keyword: nullableString,
  }).strict().nullable(),
  update: z.object({
    batch_id: z.string(), draft_ids: z.array(z.string()), member_id: nullableString,
  }).strict().nullable().optional().default(null),
}).strict();

export type AssistantModelOutput = z.infer<typeof assistantOutput>;

export const ASSISTANT_OUTPUT_SCHEMA = jsonSchema<AssistantModelOutput>(
  z.toJSONSchema(assistantOutput, { target: "draft-7" }) as Parameters<typeof jsonSchema>[0],
  { validate: value => {
    // Preserve the existing single-plan wrapper compatibility without accepting
    // multiple plans or letting a model recreate an existing batch.
    const result = assistantOutput.safeParse(Array.isArray(value) && value.length === 1 ? value[0] : value);
    return result.success ? { success: true, value: result.data } : { success: false, error: result.error };
  } },
);

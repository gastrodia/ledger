import { validateLedgerEvent, type LedgerEventInput, type LedgerEventChoice } from "@/lib/ledger-event";
import type { AssistantAgentCheckpoint } from "@/lib/assistant-agent-runtime";

export type AssistantEventResolution = { operation_id: string; source_output_id: string; input: LedgerEventInput; pending: boolean };
function normalized(input: unknown) { try { return validateLedgerEvent(input); } catch { return undefined; } }
function equal(a: unknown, b: unknown) { const left = normalized(a), right = normalized(b); return !!left && !!right && JSON.stringify(left) === JSON.stringify(right); }
export function sameEventOccurrence(a: LedgerEventInput, b: LedgerEventInput) {
  const scope = (input: LedgerEventInput) => ({ ...input, allow_duplicate: false, member_id: null, category_id: null, note: null,
    transaction_amount_cents: input.transaction_amount_cents ?? input.amount_cents });
  return JSON.stringify(scope(a)) === JSON.stringify(scope(b));
}
/** Choices must originate in the most recent server event tool for this item. */
export function offeredAssistantEventChoices(c: AssistantAgentCheckpoint, operationId: string) {
  if (!c.operations?.some(item => item.id === operationId && item.action === "event" && !["completed", "cancelled", "failed"].includes(item.status))) return;
  const preview = [...c.tool_results].reverse().find(tool => tool.name === "event_preview" && tool.operation_id === operationId);
  const result = preview?.result as { event_context?: { input?: unknown } } | undefined;
  if (!result?.event_context?.input) return;
  const output = [...(c.outputs || [])].reverse().find(item => !item.receipt && item.plan.action === "event" && item.plan.event_choices?.length
    && equal(item.plan.event_context?.input, result.event_context!.input));
  if (!output) return;
  return { output_id: output.id, input: normalized(result.event_context.input)!, choices: output.plan.event_choices! };
}
export function resolveAssistantEventChoice(c: AssistantAgentCheckpoint, operationId: string, answer: string, selection?: LedgerEventInput): AssistantEventResolution | undefined {
  const offered = offeredAssistantEventChoices(c, operationId);
  if (!offered) return;
  let choice: LedgerEventChoice | undefined;
  if (selection) choice = offered.choices.find(item => equal(item.input, selection));
  else choice = offered.choices.find(item => item.label === answer.trim());
  if (!choice) return;
  return { operation_id: operationId, source_output_id: offered.output_id, input: normalized(choice.input)!, pending: true };
}

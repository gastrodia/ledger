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
export function isDuplicateEventQuestion(text: string) { return /同一笔|已经记过|是不是.{0,8}记过|(?:新发生|另.{0,6}一笔).{0,12}还是/.test(text); }
function newOccurrenceAnswer(text: string) {
  return /^(?:这是|这笔是|确实是|是)?(?:另外|额外|另)?新发生(?:的)?(?:一笔|一件|一次)?(?:[，,]?继续(?:核对|处理))?[。！!]?$/u.test(text.trim());
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
  if (!choice && !selection && newOccurrenceAnswer(answer)) {
    // Only the duplicate switch may differ. No amount, date, person, or cashflow
    // decision can be guessed from an affirmative duplicate answer.
    const matches = offered.choices.filter(item => item.input.allow_duplicate && !offered.input.allow_duplicate
      && equal({ ...item.input, allow_duplicate: false }, offered.input));
    if (matches.length === 1) choice = matches[0];
  }
  if (!choice) return;
  return { operation_id: operationId, source_output_id: offered.output_id, input: normalized(choice.input)!, pending: true };
}
/** Backfill old answers only through their owned output/answer continuation. */
export function recoverAssistantEventResolution(c: AssistantAgentCheckpoint) {
  const id = c.current_operation_id;
  if (!id || c.event_resolutions?.some(item => item.operation_id === id)) return false;
  const offered = offeredAssistantEventChoices(c, id);
  if (!offered) return false;
  for (const continuation of [...(c.continuations || [])].reverse()) {
    if (continuation.kind !== "answer" || continuation.output_id !== offered.output_id) continue;
    const answer = c.outputs?.find(output => output.user_message_id === continuation.message_id)?.input.message;
    if (!answer) continue;
    const resolved = resolveAssistantEventChoice(c, id, answer);
    if (!resolved) continue;
    const latest = c.outputs?.find(output => output.id === c.output_id);
    resolved.pending = isDuplicateEventQuestion(latest?.plan.reply || "");
    c.event_resolutions ??= []; c.event_resolutions.push(resolved); return true;
  }
  return false;
}

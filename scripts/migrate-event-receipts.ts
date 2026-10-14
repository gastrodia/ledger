import { ensureAssistantActionsSchema } from "../lib/assistant-command-server";

// bun --env-file=.env.local scripts/migrate-event-receipts.ts
await ensureAssistantActionsSchema();
console.log("Execution receipts migrated; ledger_events removed. Business records were preserved.");

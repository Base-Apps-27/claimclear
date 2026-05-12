// Single shared Playwright worker gate.
//
// The submit bot (`bot/batch-worker.ts` via `lib/batch-processor.ts`) and the
// read bot (`bot/portal-reader.ts` via `lib/portal-response-sync.ts`) MUST
// take turns on a single Chromium instance. Two browsers fighting over the
// same `bot-session/state.json` file will corrupt the session cookie and
// lock the MAS Freshdesk account (Task #725 step 3 / "Critical constraints"
// in `.local/tasks/task-725.md`).
//
// Both bots import the singleton `portalBrowserGate` from this module so
// every Playwright call funnels through one in-process boolean.

import { createWorkerGate, type WorkerGate } from "./worker-gate";

export const portalBrowserGate: WorkerGate<void> = createWorkerGate<void>();

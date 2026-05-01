// Fire-and-forget writer for the `state_events` observability log.
//
// Called from route handlers and background workers whenever a meaningful
// per-leg / per-invoice transition fires. Distinct from the `audit_logs`
// table — `audit_logs` is the human-facing activity feed (read by
// operators on the claim detail page), `state_events` is structured
// machine-data (sub-second AI-vs-operator timing, per-event-key counts,
// time-in-phase histograms — read by analytics/ops dashboards).
//
// The contract:
//   • NEVER throws. An observability log must never block the user-facing
//     write that triggered it. All errors are caught, logged via the api-
//     server's pino instance, and swallowed.
//   • Returns void, never a promise the caller is expected to await for
//     correctness. Callers may `void emitStateEvent(...)` — the only
//     reason to await is to keep test ordering deterministic.
//   • Accepts an optional `executor` parameter so the insert can join an
//     outer drizzle transaction. We chose **same-transaction** (rather
//     than a post-commit callback) because the observability stream must
//     match real state — if the outer write rolls back, the event row
//     should roll back with it. Pass `tx` from inside `db.transaction`,
//     omit it for fire-and-forget background writes.

import { db, stateEventsTable, type InsertStateEvent } from "@workspace/db";
import { logger } from "./logger";
import type { DbExecutor } from "./claim-transitions";

export type EmitStateEventInput = Pick<
  InsertStateEvent,
  "eventKey" | "claimId" | "invoiceGroupId" | "actorUserId" | "durationMs" | "metadata"
>;

export async function emitStateEvent(
  input: EmitStateEventInput,
  executor?: DbExecutor,
): Promise<void> {
  const ex: DbExecutor = executor ?? db;
  try {
    await ex.insert(stateEventsTable).values({
      eventKey: input.eventKey,
      claimId: input.claimId ?? null,
      invoiceGroupId: input.invoiceGroupId ?? null,
      actorUserId: input.actorUserId ?? null,
      durationMs: input.durationMs ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    // Observability never throws upward — if logging fails we log the
    // failure (best-effort) and move on. When called outside a transaction
    // the user-facing write that triggered this event is already committed
    // by the time we get here; when called inside a transaction the
    // surrounding caller is responsible for surfacing the error.
    logger.warn(
      { err, eventKey: input.eventKey, claimId: input.claimId, invoiceGroupId: input.invoiceGroupId },
      "emitStateEvent failed (swallowed)",
    );
  }
}

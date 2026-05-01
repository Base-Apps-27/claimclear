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

import { db, stateEventsTable, type InsertStateEvent } from "@workspace/db";
import { logger } from "./logger";

export type EmitStateEventInput = Pick<
  InsertStateEvent,
  "eventKey" | "claimId" | "invoiceGroupId" | "actorUserId" | "durationMs" | "metadata"
>;

export async function emitStateEvent(input: EmitStateEventInput): Promise<void> {
  try {
    await db.insert(stateEventsTable).values({
      eventKey: input.eventKey,
      claimId: input.claimId ?? null,
      invoiceGroupId: input.invoiceGroupId ?? null,
      actorUserId: input.actorUserId ?? null,
      durationMs: input.durationMs ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    // Observability never throws upward — if logging fails we log the
    // failure (best-effort) and move on. The user write that triggered
    // this event is already committed by the time we get here.
    logger.warn(
      { err, eventKey: input.eventKey, claimId: input.claimId, invoiceGroupId: input.invoiceGroupId },
      "emitStateEvent failed (swallowed)",
    );
  }
}

// Shared "qualifying user activity" predicate.
//
// Single source of truth for what counts as a personal-activity beat
// for the streak pip (`/dashboard/my-processed-today`) and the avatar
// hover card heatmap (`/dashboard/my-activity-summary`). Both
// endpoints filter `audit_logs` rows through this same predicate so
// the pip ring's "today" count and the hover-card stats can never
// disagree (Task #522).
//
// What counts (in addition to having a real `user_email` — system /
// bot identity rows are always excluded so cron sweeps and SSE bots
// can never inflate a personal counter):
//
//   * `leg_excluded` — only when `metadata->>'source' = 'manual'`
//     (excludes `auto_blank_sibling` and other system cascades).
//   * `outcome_changed` — claim-level closure (resolved, denied,
//     withdrawn, etc.).
//   * `group_outcome_changed` — group-level closure.
//   * `attestation_queued` — sending a leg for re-attest.
//   * `group_status_changed` — only when `metadata->>'to' =
//     'Portal Queued'` (queuing for portal; preserves the original
//     pip-ring semantics inside the broader set).
//   * `portal_submission_confirmed` — only when
//     `metadata->>'source' = 'manual'` (excludes
//     `portal_batch_sweeper` and any other system source).
//   * `closure_addressed` — closing a review / response awaiting
//     review.
//   * `attestation_queue_confirmed` and `mas_reattest_recorded_offline`
//     — confirming a re-attestation, including the offline path.
//   * `claims_imported` — uploading an invoice batch.
//
// New qualifying actions go HERE. Anything that mutates the predicate
// silently broadens both endpoints — that is the point.

import { sql, type SQL } from "drizzle-orm";
import { auditLogsTable } from "@workspace/db";

// Status values whose group `status_changed` events are themselves
// qualifying activity. Used by the SSE listener to decide whether
// to optimistically bump the pip without round-tripping the server.
// Kept separate from `QUALIFYING_AUDIT_ACTIONS` because the SSE
// channel does not carry the audit `action` string — it carries
// `toStatus` only — so the client-side predicate is necessarily
// status-shaped. The intersection with the audit predicate above is
// exactly `group_status_changed → 'Portal Queued'`; the other
// qualifying audit rows (outcome changes, attest confirms, etc.)
// flow through different SSE events or no SSE event at all and rely
// on the 60s polling refetch to reconcile.
export const QUALIFYING_GROUP_STATUS_TRANSITIONS = [
  "Portal Queued",
] as const;

// SQL fragment that selects only audit rows attributable to a real
// signed-in operator. The `userEmail` column is nullable (system
// rows stamp it `NULL`); we also defensively exclude the literal
// string "system" in case any old caller stamps it explicitly.
function realUserEmailExpr(): SQL {
  return sql`(
    ${auditLogsTable.userEmail} IS NOT NULL
    AND ${auditLogsTable.userEmail} <> ''
    AND ${auditLogsTable.userEmail} <> 'system'
  )`;
}

// The predicate. Compose into any aggregate query against
// `audit_logs` with `and(qualifyingActivityPredicate(), ...other
// filters)`. The action+metadata discriminators live inline so a
// single grouped scan can serve the heatmap.
export function qualifyingActivityPredicate(): SQL {
  return sql`(
    ${realUserEmailExpr()}
    AND (
      (${auditLogsTable.action} = 'leg_excluded'
        AND ${auditLogsTable.metadata}->>'source' = 'manual')
      OR ${auditLogsTable.action} = 'outcome_changed'
      OR ${auditLogsTable.action} = 'group_outcome_changed'
      OR ${auditLogsTable.action} = 'attestation_queued'
      OR (${auditLogsTable.action} = 'group_status_changed'
        AND ${auditLogsTable.metadata}->>'to' = 'Portal Queued')
      OR (${auditLogsTable.action} = 'portal_submission_confirmed'
        AND ${auditLogsTable.metadata}->>'source' = 'manual')
      OR ${auditLogsTable.action} = 'closure_addressed'
      OR ${auditLogsTable.action} = 'attestation_queue_confirmed'
      OR ${auditLogsTable.action} = 'mas_reattest_recorded_offline'
      OR ${auditLogsTable.action} = 'claims_imported'
    )
  )`;
}

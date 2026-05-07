// Day-complete celebration helper (Task #313).
//
// Decides whether all invoice groups dated for a given calendar day have
// reached a "concluded" state — i.e., no operator action is left for the day.
//
// "Concluded" means EITHER:
//   * the group's status is in the in-flight phase
//     (Portal Queued, Generating Email, Awaiting Response) — handed off
//     to the system or the payor; OR
//   * the group's status is in the closed phase
//     (Resolved, Denied, Withdrawn) — terminal; OR
//   * the group's outcome is Non-Issue or Withdrawn — dispute determined
//     not to need filing.
//
// A day is concluded when EVERY invoice group whose earliest claim date
// equals that day satisfies the rule above AND the day has at least one
// invoice group. An empty day NEVER triggers a celebration.
//
// On a successful day-complete detection, we insert a fresh
// `state_events` row with `event_key=day_completed_celebration` and
// `metadata.date=<ISO date>`. Task #495 dropped the partial unique
// index from migration 0019: deduplication now happens at the EDGE
// — `checkAndEmitDayCompleteForGroup` requires the caller to hand in
// the day-aggregate "concluded" state captured BEFORE its update, and
// only emits when the new state is the false→true edge. This lets a
// day that re-concludes after a manual revert celebrate again, and
// keeps the celebration logic close to the transition that caused it
// instead of buried in a database constraint.

import { sql } from "drizzle-orm";
import { db, invoiceGroupsTable, stateEventsTable } from "@workspace/db";
import { logger } from "./logger";
import { broadcastSystemEvent } from "./sse";
import type { DbExecutor } from "./claim-transitions";
import type { GroupTransitionActor } from "./group-transitions";

// Drizzle's `DbExecutor` type intentionally narrows to select/insert/update
// /delete so callers can't lean on transaction-only escape hatches. The
// `.execute()` raw-SQL method is always present on the underlying
// `NodePgDatabase` (and on a `tx` returned from `db.transaction`), so we
// cast through this helper for the raw `INSERT ... RETURNING` used by the
// emit path and the CTE used by `isDayConcluded`.
type DbWithExecute = DbExecutor & Pick<typeof db, "execute">;
const withExecute = (ex: DbExecutor): DbWithExecute => ex as DbWithExecute;

// Mirrors the `in-flight` and `closed` lifecycle-phase status sets.
// Kept here as a local copy so the api-server can run without importing
// the client-side `lifecycle-phase` module; if the lifecycle-phase
// vocabulary changes, both lists must be updated together.
const IN_FLIGHT_STATUSES = ["Portal Queued", "Generating Email", "Awaiting Response"] as const;
const CLOSED_STATUSES = ["Resolved", "Denied", "Withdrawn"] as const;
const CONCLUDED_OUTCOMES = ["Non-Issue", "Withdrawn"] as const;

const ALL_CONCLUDED_STATUSES = new Set<string>([...IN_FLIGHT_STATUSES, ...CLOSED_STATUSES]);
const ALL_CONCLUDED_OUTCOMES = new Set<string>(CONCLUDED_OUTCOMES);

function isGroupConcluded(g: { status: string; outcome: string }): boolean {
  return ALL_CONCLUDED_STATUSES.has(g.status) || ALL_CONCLUDED_OUTCOMES.has(g.outcome);
}

/**
 * Returns the calendar day a given invoice group belongs to. Returns
 * null if the group has no claims or no claims with a date.
 *
 * Reads the typed, indexed `invoice_groups.service_date` column
 * directly — the same canonical value used by the dashboard hero / queue
 * / groups list (Task #350) and maintained on every write path by
 * `recomputeGroupServiceDate`. `to_char` keeps the wire shape stable as
 * ISO YYYY-MM-DD for the day-complete celebration matcher. See Task #356.
 */
export async function getInvoiceGroupDay(
  groupId: number,
  executor?: DbExecutor,
): Promise<string | null> {
  const ex: DbExecutor = executor ?? db;
  const [row] = await ex
    .select({
      earliest: sql<string | null>`to_char(${invoiceGroupsTable.serviceDate}, 'YYYY-MM-DD')`,
    })
    .from(invoiceGroupsTable)
    .where(sql`${invoiceGroupsTable.id} = ${groupId}`);
  return row?.earliest ?? null;
}

/**
 * Aggregate query — returns true iff every invoice group dated `day`
 * is concluded per the rule above AND at least one such group exists.
 *
 * Single round-trip: reads every group's stored `service_date` alongside
 * its own status/outcome, then counts how many of the rows that map to
 * `day` are NOT concluded.
 */
export async function isDayConcluded(
  day: string,
  executor?: DbExecutor,
): Promise<boolean> {
  const ex: DbExecutor = executor ?? db;
  // Two-step CTE — read every group's stored `service_date` (Task #350)
  // alongside its own status/outcome, then count how many of the rows
  // that map to `day` are NOT in the concluded set. Reading the
  // canonical column instead of recomputing MIN(claims.date) per call
  // (Task #356) means the day-complete matcher and the dashboard
  // "must file today" hero can never disagree about which day a group
  // belongs to. We deliberately reference the CTE's own (status,
  // outcome) columns rather than the underlying table so the alias
  // survives PostgreSQL's name resolution.
  //
  // Wave C reader-switch note (Task #517): the in-flight + concluded
  // sets here overlap with the actionable set in non-trivial ways —
  // `Generating Email` lives in BOTH (it's "in-flight" from this
  // matcher's POV because the operator clicked "package", but it's
  // also "still on the filing clock" from the dashboard's POV). The
  // clean phase translation is therefore NOT a single phase membership
  // check; it would need to encode the same operator-intent residual
  // (`status IN ('Portal Queued','Generating Email','Awaiting Response')`)
  // as a `phase + status` predicate. Since this matcher is a low-
  // traffic admin probe and the writer trigger keeps `status`/`outcome`
  // synced with `phase`, we leave the legacy column reads in place
  // pending Wave D's writer rewire (which will introduce a `submitted_via`
  // claim column so the residual `status` check can be deleted across
  // the codebase in one pass). See §3.B of the Wave C continuation
  // handoff for the full residual-status rationale.
  const result = await withExecute(ex).execute(sql`
    WITH groups_for_day AS (
      SELECT
        ${invoiceGroupsTable.id}      AS group_id,
        ${invoiceGroupsTable.status}  AS status,
        ${invoiceGroupsTable.outcome} AS outcome,
        -- service_date is a real DATE column maintained by
        -- recomputeGroupServiceDate on every write path; to_char
        -- formats it as YYYY-MM-DD so the comparison key matches the
        -- ISO \`day\` argument.
        to_char(${invoiceGroupsTable.serviceDate}, 'YYYY-MM-DD') AS earliest_date
      FROM ${invoiceGroupsTable}
      WHERE ${invoiceGroupsTable.serviceDate} IS NOT NULL
    )
    SELECT
      COUNT(*) FILTER (WHERE earliest_date = ${day}) AS total,
      COUNT(*) FILTER (
        WHERE earliest_date = ${day}
          AND NOT (
            -- in-flight statuses (group is post-submit, awaiting reply)
            status::text IN ('Portal Queued', 'Generating Email', 'Awaiting Response')
            -- closed statuses (terminal). NB: the claim_status enum has no
            -- "Withdrawn" — withdrawal is captured purely as an outcome.
            OR status::text IN ('Resolved', 'Denied')
            -- outcome-driven closure (Non-Issue at triage, or withdrawn)
            OR outcome::text IN ('Non-Issue', 'Withdrawn')
          )
      ) AS unconcluded
    FROM groups_for_day
  `);
  const row = (result.rows ?? [])[0] as { total?: string | number; unconcluded?: string | number } | undefined;
  if (!row) return false;
  const total = Number(row.total ?? 0);
  const unconcluded = Number(row.unconcluded ?? 0);
  return total > 0 && unconcluded === 0;
}

function formatDayLabel(day: string): string {
  // Render a friendly "April 15, 2026" label. We parse the ISO date in UTC
  // so the label doesn't drift across host time zones (the input is a
  // service-date key, not a timestamp).
  const [yyyy, mm, dd] = day.split("-").map((n) => parseInt(n, 10));
  if (!yyyy || !mm || !dd) return day;
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Inserts a `day_completed_celebration` row for the given day and
 * broadcasts the celebration over the global system-events SSE
 * channel. Always emits — Task #495 moved deduplication to the edge
 * check in `checkAndEmitDayCompleteForGroup`, which only invokes this
 * helper on a true false→true transition. Direct callers (admin debug
 * endpoints, tests) are responsible for their own gating.
 *
 * Safe to call from any group transition path. NEVER throws — celebration
 * logging must not block a successful state-machine write.
 */
export async function tryEmitDayCompletedCelebration(opts: {
  day: string;
  triggeredByGroupId: number | null;
  actor: GroupTransitionActor;
  executor?: DbExecutor;
}): Promise<{ emitted: boolean }> {
  const { day, triggeredByGroupId, actor, executor } = opts;
  const ex: DbExecutor = executor ?? db;
  try {
    const dateLabel = formatDayLabel(day);
    const metadata = {
      date: day,
      dateLabel,
      triggeredByGroupId,
      triggeredByUserEmail: actor.userEmail,
      triggeredByUserName: actor.userName,
    };
    const result = await withExecute(ex).execute(sql`
      INSERT INTO ${stateEventsTable} (event_key, actor_user_id, metadata)
      VALUES (
        'day_completed_celebration',
        ${actor.userEmail ?? null},
        ${JSON.stringify(metadata)}::jsonb
      )
      RETURNING id
    `);
    const inserted = (result.rows ?? []).length > 0;
    if (!inserted) return { emitted: false };

    broadcastSystemEvent({
      type: "day_completed",
      date: day,
      dateLabel,
      timestamp: new Date().toISOString(),
    });
    return { emitted: true };
  } catch (err) {
    logger.warn(
      { err, day, triggeredByGroupId },
      "tryEmitDayCompletedCelebration failed (swallowed)",
    );
    return { emitted: false };
  }
}

/**
 * Convenience wrapper called from `transitionGroup*` after a state change
 * commits. The caller MUST capture `priorConcluded` before its UPDATE
 * runs (typically via `snapshotDayConcludedForGroup` below) and pass it
 * in here; we re-compute the post-update state and only emit on the
 * false→true edge. Without the snapshot the helper would re-fire for
 * every status nudge made on an already-concluded day.
 *
 * NEVER throws.
 */
export async function checkAndEmitDayCompleteForGroup(opts: {
  groupId: number;
  actor: GroupTransitionActor;
  priorConcluded: boolean;
  executor?: DbExecutor;
}): Promise<void> {
  const { groupId, actor, priorConcluded, executor } = opts;
  const ex: DbExecutor = executor ?? db;
  try {
    if (priorConcluded) return;
    const day = await getInvoiceGroupDay(groupId, ex);
    if (!day) return;
    const nowConcluded = await isDayConcluded(day, ex);
    if (!nowConcluded) return;
    await tryEmitDayCompletedCelebration({
      day,
      triggeredByGroupId: groupId,
      actor,
      executor: ex,
    });
  } catch (err) {
    logger.warn(
      { err, groupId },
      "checkAndEmitDayCompleteForGroup failed (swallowed)",
    );
  }
}

/**
 * Pre-update snapshot helper for the three `transitionGroup*` paths.
 * Returns whether the group's day was already day-aggregate concluded
 * BEFORE the caller's UPDATE statement runs. NEVER throws; on lookup
 * failure returns `false` so a transient read error can never suppress
 * a legitimate celebration (the post-update edge check still gates).
 */
export async function snapshotDayConcludedForGroup(
  groupId: number,
  executor?: DbExecutor,
): Promise<boolean> {
  const ex: DbExecutor = executor ?? db;
  try {
    const day = await getInvoiceGroupDay(groupId, ex);
    if (!day) return false;
    return await isDayConcluded(day, ex);
  } catch (err) {
    logger.warn(
      { err, groupId },
      "snapshotDayConcludedForGroup failed (returning false)",
    );
    return false;
  }
}

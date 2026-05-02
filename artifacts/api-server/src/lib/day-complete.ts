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
// On a successful day-complete detection, we attempt to insert a single
// `state_events` row with `event_key=day_completed_celebration` and
// `metadata.date=<ISO date>`. The partial unique index introduced in
// migration 0019 guarantees at most one row per day across concurrent
// transitions; if the row already exists the insert is a no-op and the
// celebration is NOT re-broadcast.

import { sql } from "drizzle-orm";
import { db, invoiceGroupsTable, claimsTable, stateEventsTable } from "@workspace/db";
import { logger } from "./logger";
import { broadcastSystemEvent } from "./sse";
import type { DbExecutor } from "./claim-transitions";
import type { GroupTransitionActor } from "./group-transitions";

// Drizzle's `DbExecutor` type intentionally narrows to select/insert/update
// /delete so callers can't lean on transaction-only escape hatches. The
// `.execute()` raw-SQL method is always present on the underlying
// `NodePgDatabase` (and on a `tx` returned from `db.transaction`), so we
// cast through this helper in the two spots where `ON CONFLICT ... DO
// NOTHING ... RETURNING` is the cleanest implementation.
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
 * Returns the calendar day a given invoice group belongs to (MIN of its
 * claims' service dates). Returns null if the group has no claims or no
 * claims with a date.
 *
 * `claims.date` is a typed DATE column (Task #351, migration 0022), so
 * MIN() yields a date directly — re-emitted as text so the JS callers
 * receive a YYYY-MM-DD string via postgres' ISO datestyle.
 */
export async function getInvoiceGroupDay(
  groupId: number,
  executor?: DbExecutor,
): Promise<string | null> {
  const ex: DbExecutor = executor ?? db;
  const [row] = await ex
    .select({
      earliest: sql<string | null>`MIN(${claimsTable.date})::text`,
    })
    .from(claimsTable)
    .where(sql`${claimsTable.invoiceGroupId} = ${groupId} AND ${claimsTable.date} IS NOT NULL`);
  return row?.earliest ?? null;
}

/**
 * Aggregate query — returns true iff every invoice group dated `day`
 * (via MIN of its claims' service dates) is concluded per the rule above
 * AND at least one such group exists.
 *
 * Single round-trip: groups every group's MIN(claims.date) and counts how
 * many of those whose earliest date equals the given day are NOT concluded.
 */
export async function isDayConcluded(
  day: string,
  executor?: DbExecutor,
): Promise<boolean> {
  const ex: DbExecutor = executor ?? db;
  // Two-step CTE — gather every group's earliest claim date alongside its
  // own status/outcome, then count how many of the rows that map to
  // `day` are NOT in the concluded set. We deliberately reference the
  // CTE's own (status, outcome) columns rather than the underlying table
  // so the alias survives PostgreSQL's name resolution.
  const result = await withExecute(ex).execute(sql`
    WITH groups_for_day AS (
      SELECT
        ${invoiceGroupsTable.id}      AS group_id,
        ${invoiceGroupsTable.status}  AS status,
        ${invoiceGroupsTable.outcome} AS outcome,
        -- claims.date is a typed DATE column (Task #351, migration
        -- 0022); MIN() yields a date and ::text formats it as
        -- YYYY-MM-DD so the comparison key matches the ISO \`day\`
        -- argument.
        MIN(${claimsTable.date})::text AS earliest_date
      FROM ${invoiceGroupsTable}
      INNER JOIN ${claimsTable}
        ON ${claimsTable.invoiceGroupId} = ${invoiceGroupsTable.id}
      WHERE ${claimsTable.date} IS NOT NULL
      GROUP BY ${invoiceGroupsTable.id}
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
 * Idempotently emits a `day_completed_celebration` row for the given day
 * and broadcasts the celebration over the global system-events SSE
 * channel — but ONLY when the row was newly inserted. If a celebration
 * for this day has already been logged, this is a no-op (no duplicate
 * row, no duplicate broadcast).
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
    // Use the inference clause (columns + WHERE) to match the partial
    // unique INDEX from migration 0019. Postgres will not accept
    // `ON CONSTRAINT <index-name>` here because partial unique indexes
    // are indexes, not table constraints — only the inference form
    // resolves them.
    const result = await withExecute(ex).execute(sql`
      INSERT INTO ${stateEventsTable} (event_key, actor_user_id, metadata)
      VALUES (
        'day_completed_celebration',
        ${actor.userEmail ?? null},
        ${JSON.stringify(metadata)}::jsonb
      )
      ON CONFLICT (event_key, ((metadata->>'date')))
      WHERE event_key = 'day_completed_celebration'
      DO NOTHING
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
 * commits. Looks up the day for the group, checks whether it just flipped
 * to concluded, and (if so) idempotently emits + broadcasts.
 *
 * NEVER throws.
 */
export async function checkAndEmitDayCompleteForGroup(opts: {
  groupId: number;
  actor: GroupTransitionActor;
  executor?: DbExecutor;
}): Promise<void> {
  const { groupId, actor, executor } = opts;
  const ex: DbExecutor = executor ?? db;
  try {
    const day = await getInvoiceGroupDay(groupId, ex);
    if (!day) return;
    const concluded = await isDayConcluded(day, ex);
    if (!concluded) return;
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

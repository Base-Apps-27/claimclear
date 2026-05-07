import { and, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { claimsTable, invoiceGroupsTable } from "@workspace/db";
import {
  CLAIM_EXPIRING_ACTIONABLE_STATUSES,
  CLAIM_SUBMITTED_STUCK_STATUSES,
  GROUP_SUBMITTED_STUCK_STATUSES,
} from "../routes/dashboard";
import { SOON_DAYS, URGENT_DAYS } from "./risk-config";

// `stuck` is the parallel "submitted but unconfirmed" tier introduced
// in Task #352 — same date math as `urgent` (deadline ≤ today), but a
// different status filter (Portal Queued / Processed vs. the pre-submit
// actionable set). Both tiers can be requested via `?expiring=` so the
// Queue can render a "stuck after submission" lane that is provably
// derived from the same source of truth as the dashboard's count.
export type ExpiringMode = "soon" | "urgent" | "stuck";

export function parseExpiringMode(raw: unknown): ExpiringMode | null {
  if (raw === "soon" || raw === "urgent" || raw === "stuck") return raw;
  return null;
}

// Pre-submit `urgent`/`soon` modes use the configured 30-day clock
// (URGENT_DAYS = 0, SOON_DAYS = 3). The `stuck` tier means "deadline
// already passed", so it pins to URGENT_DAYS so the SQL ≤ comparator
// produces "deadline - today ≤ 0".
function maxDaysFor(mode: ExpiringMode): number {
  if (mode === "urgent" || mode === "stuck") return URGENT_DAYS;
  return SOON_DAYS;
}

// `urgent` is strict-today (deadline EXACTLY today, after the weekend →
// Friday shift) — past-due rows are NOT urgent. This matches the
// `isUrgentDeadline` predicate in lib/dates.ts and the dashboard's
// `urgentCount` scalar so the "Must file today" filter on the claims
// and invoice-groups lists can never read more rows than the
// dashboard hero counts. `stuck` and `soon` keep their inclusive
// upper bound; only `urgent` collapses to a single day. See the
// must-file-today-parity contract test for the locked alignment.
function exactlyTodayFor(mode: ExpiringMode): boolean {
  return mode === "urgent";
}

// SQL fragment that yields the effective deadline (date type) for a given
// service-date expression: serviceDate + 30 days, then if the result lands on
// Saturday or Sunday, shifted back to the prior Friday so it reflects the day
// the office can actually file.
//
// `dateExpr` must be an expression of type `date` (or NULL). `claims.date`
// is now natively `date` (Task #351, migration 0022), so callers can pass
// the column reference directly — no NULLIF/text-cast wrapper needed.
function effectiveDeadlineSql(dateExpr: SQL): SQL {
  return sql`(
    CASE EXTRACT(DOW FROM (${dateExpr} + INTERVAL '30 days'))
      WHEN 6 THEN ((${dateExpr} + INTERVAL '30 days')::date - INTERVAL '1 day')::date
      WHEN 0 THEN ((${dateExpr} + INTERVAL '30 days')::date - INTERVAL '2 days')::date
      ELSE (${dateExpr} + INTERVAL '30 days')::date
    END
  )`;
}

function claimStatusCondition(mode: ExpiringMode): SQL {
  // Wave C reader-switch (claim level): claims do not have their own
  // `phase` column — phase lives on the parent invoice group. The
  // claim-level "actionable" set deliberately differs from the group
  // set: a Portal-Queued or Processed claim under a submitted parent
  // still has its own filing clock running (the dispute hasn't landed
  // a confirmation), so they remain in the actionable set.
  // CLAIM_EXPIRING_ACTIONABLE_STATUSES is exactly the per-claim
  // mirror of "parent phase ∈ {triage, ready_to_submit}", which is
  // why the §3.B note in the Wave C continuation handoff calls out
  // that the simpler `phase IN (...)` predicate would be a clean
  // replacement at the CLAIM level. We keep the per-claim `status`
  // filter here for now: it avoids a parent-table subquery in the
  // hot list path and stays semantically equivalent to the new
  // phase-based predicate. Wave D will swap this to a `submitted_via`
  // (or equivalent) claim column and read disposition + parent phase
  // directly. See docs/architecture/state-wave-c-continuation-handoff-prompt.md §3.B.
  const set = mode === "stuck"
    ? CLAIM_SUBMITTED_STUCK_STATUSES
    : CLAIM_EXPIRING_ACTIONABLE_STATUSES;
  const parts = set.map((s) => eq(claimsTable.status, s));
  return or(...parts) as SQL;
}

function groupPhaseCondition(mode: ExpiringMode): SQL {
  if (mode === "stuck") {
    // GROUP_SUBMITTED_STUCK_STATUSES = ["Portal Queued"]. Wave D-PR5:
    // any `Portal Queued` group with `submitted_via` stamped is now
    // promoted by the deriver to `phase='submitted'`, so the
    // stuck-after-submission tier reads `phase = submitted` paired with
    // the residual status hint that pins it to the portal-queued slice
    // (the writer never moves these rows out of `Portal Queued` until
    // the bot acks). Membership matches GROUP_SUBMITTED_STUCK_STATUSES
    // exactly.
    return and(
      eq(invoiceGroupsTable.phase, "submitted"),
      ...GROUP_SUBMITTED_STUCK_STATUSES.map((s) => eq(invoiceGroupsTable.status, s)),
    ) as SQL;
  }

  // Group-level "actionable, on-clock". Wave D-PR5 collapsed the
  // legacy `status != "Portal Queued"` exclusion: now that the
  // writer-rewire stamps `claims.submitted_via` at every operator
  // click site and the deriver promotes any group whose children
  // carry that stamp from `ready_to_submit` → `submitted`, the
  // pre-submit set is exactly `phase IN (triage, ready_to_submit)`.
  // No residual status carve-out required — membership still matches
  // GROUP_EXPIRING_ACTIONABLE_STATUSES bit-for-bit, locked by the
  // must-file-today-parity contract (Task #352).
  return or(
    eq(invoiceGroupsTable.phase, "triage"),
    eq(invoiceGroupsTable.phase, "ready_to_submit"),
  ) as SQL;
}

// `soon` is the strictly-future band (1..SOON_DAYS); today/overdue
// rows belong to `urgent`/`stuck`, never to `soon`.
function minDaysFor(mode: ExpiringMode): number | null {
  if (mode === "soon") return 1;
  return null;
}

export function buildClaimExpiringCondition(mode: ExpiringMode): SQL {
  const max = maxDaysFor(mode);
  const min = minDaysFor(mode);
  // claims.date is now a typed DATE column (Task #351, migration 0022)
  // so the column reference is directly usable as a date expression —
  // no NULLIF/text-cast safety net required.
  const dateExpr = sql`${claimsTable.date}`;
  const deadline = effectiveDeadlineSql(dateExpr);
  const conds: SQL[] = [
    sql`${dateExpr} IS NOT NULL` as SQL,
    claimStatusCondition(mode),
  ];
  if (exactlyTodayFor(mode)) {
    conds.push(sql`(${deadline} - CURRENT_DATE) = ${max}` as SQL);
  } else {
    conds.push(sql`(${deadline} - CURRENT_DATE) <= ${max}` as SQL);
    if (min !== null) {
      conds.push(sql`(${deadline} - CURRENT_DATE) >= ${min}` as SQL);
    }
  }
  return and(...conds) as SQL;
}

export function buildInvoiceGroupExpiringCondition(mode: ExpiringMode): SQL {
  const max = maxDaysFor(mode);
  const min = minDaysFor(mode);
  // Read the typed, indexed `invoice_groups.service_date` column instead
  // of recomputing MIN(claims.date) on every request. The column is
  // maintained on every write path by `recomputeGroupServiceDate`
  // (lib/group-service-date.ts); the system-health rollup runs a JS-side
  // drift check so any future write path that forgets to call the
  // helper surfaces as an ops alert. See Task #350. Pairs with the
  // typed `claims.date` work in Task #351 — both columns are now
  // calendar-correct without per-query NULLIF/text-cast wrappers.
  const dateExpr = sql`${invoiceGroupsTable.serviceDate}`;
  const deadline = effectiveDeadlineSql(dateExpr);
  const conds: SQL[] = [
    groupPhaseCondition(mode),
    isNotNull(invoiceGroupsTable.serviceDate) as SQL,
  ];
  if (exactlyTodayFor(mode)) {
    conds.push(sql`(${deadline} - CURRENT_DATE) = ${max}` as SQL);
  } else {
    conds.push(sql`(${deadline} - CURRENT_DATE) <= ${max}` as SQL);
    if (min !== null) {
      conds.push(sql`(${deadline} - CURRENT_DATE) >= ${min}` as SQL);
    }
  }
  return and(...conds) as SQL;
}

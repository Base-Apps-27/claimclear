import { and, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { claimsTable, invoiceGroupsTable } from "@workspace/db";
import {
  CLAIM_EXPIRING_ACTIONABLE_STATUSES,
  CLAIM_SUBMITTED_STUCK_STATUSES,
  GROUP_EXPIRING_ACTIONABLE_STATUSES,
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
  const set = mode === "stuck"
    ? CLAIM_SUBMITTED_STUCK_STATUSES
    : CLAIM_EXPIRING_ACTIONABLE_STATUSES;
  const parts = set.map((s) => eq(claimsTable.status, s));
  return or(...parts) as SQL;
}

function groupStatusCondition(mode: ExpiringMode): SQL {
  const set = mode === "stuck"
    ? GROUP_SUBMITTED_STUCK_STATUSES
    : GROUP_EXPIRING_ACTIONABLE_STATUSES;
  const parts = set.map((s) => eq(invoiceGroupsTable.status, s));
  return or(...parts) as SQL;
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
    groupStatusCondition(mode),
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

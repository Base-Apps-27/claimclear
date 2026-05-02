// Single source of truth for `invoice_groups.service_date` — the typed,
// indexed earliest-service-date column that powers the dashboard
// "FILE TODAY" hero, the Invoice Queue "must file today" tier, and the
// Groups list Service Date column. See Task #350 for context.
//
// Maintenance contract
// --------------------
// Every write path that can change the set of children for a group, or
// any child claim's `date`, MUST funnel its post-write recompute
// through `recomputeGroupServiceDate(groupId, executor?)`. The current
// callers are: import.ts (per group at end of loop), claims.ts (PATCH
// when date or invoiceGroupId changes — both sides recomputed when a
// leg moves between groups, POST when group is set, DELETE, exclude /
// include, mark / unmark sibling-duplicate), admin.ts
// /backfill-invoice-groups, and the one-shot
// `2026-05-invoice-group-service-date-backfill.ts` script.
//
// MIN semantics
// -------------
// We compute the calendar MIN over EVERY child claim's date — included
// AND excluded, included AND duplicate-of, regardless of leg sub-status.
// The 30-day filing clock is anchored on the earliest *trip* in the
// invoice group; excluding a leg from the dispute or marking it as a
// sibling duplicate doesn't move the trip date the payor billed for, so
// the deadline must keep using the same anchor. This matches the
// pre-Task #350 SQL (which had no leg-state filter) so the cutover is a
// pure data-shape swap, not a semantic change.
//
// Drift guard
// -----------
// `runServiceDateDriftCheck()` recomputes every group's expected value
// in JS and reports rows where the stored column disagrees. Wired into
// the system-health rollup so any future write path that forgets to
// call the helper surfaces as an ops signal instead of a silent skew.

import { eq } from "drizzle-orm";
import { db, claimsTable, invoiceGroupsTable } from "@workspace/db";
import { normalizeServiceDate } from "./dates";
import type { DbExecutor } from "./claim-transitions";
import { logger } from "./logger";

export interface RecomputeServiceDateResult {
  /** ISO YYYY-MM-DD or null — the value stored before the write. */
  previous: string | null;
  /** ISO YYYY-MM-DD or null — the value computed (and now stored). */
  next: string | null;
  /** True iff `previous !== next` (a row UPDATE actually fired). */
  changed: boolean;
}

/**
 * Render a Drizzle `date`-typed column read into a plain ISO YYYY-MM-DD
 * string. The `pg` driver hands `date` columns back as either a `Date`
 * (UTC midnight of the calendar day) or an already-ISO `string`
 * depending on driver/connection settings; this normalizes both to the
 * stable `YYYY-MM-DD` shape the rest of the codebase reasons about.
 */
function dateColumnToIso(value: Date | string | null): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, 10);
  // `Date` shape: `pg` treats `date` as UTC-midnight, so the UTC
  // calendar parts are the right answer.
  const y = value.getUTCFullYear();
  const m = value.getUTCMonth() + 1;
  const d = value.getUTCDate();
  if (!Number.isFinite(y)) return null;
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Pure helper, exported so tests can exercise the MIN semantics
 * without a DB. Picks the lexical MIN over the input dates after
 * routing each through `normalizeServiceDate`. Lexical MIN over ISO
 * YYYY-MM-DD strings equals calendar MIN, so no Date round-trip is
 * needed. Returns null when no input is parseable.
 */
export function pickEarliestServiceDate(
  rawDates: ReadonlyArray<string | null | undefined>,
): string | null {
  let earliest: string | null = null;
  for (const raw of rawDates) {
    const norm = normalizeServiceDate(raw);
    if (!norm) continue;
    if (earliest === null || norm < earliest) earliest = norm;
  }
  return earliest;
}

/**
 * Compute the expected `service_date` for a group in JS — the lexical
 * MIN of every child claim's `normalizeServiceDate(date)`.
 *
 * Returns null when the group has no parseable child date (no children,
 * all children blank, all children unparseable).
 */
async function computeExpectedServiceDate(
  groupId: number,
  executor: DbExecutor,
): Promise<string | null> {
  const rows = await executor
    .select({ date: claimsTable.date })
    .from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, groupId));

  return pickEarliestServiceDate(rows.map((r) => r.date));
}

/**
 * Recompute and persist `invoice_groups.service_date` for a single
 * group. Returns the `{ previous, next, changed }` triple so callers
 * (especially the one-shot backfill) can log diffs.
 *
 * No-op when the recomputed value matches what's already stored — keeps
 * `updated_at` from churning on every leg edit when the group's
 * earliest trip didn't move. Pass an `executor` (e.g. a transaction
 * handle) when the surrounding write itself is transactional so the
 * recompute participates in the same atomic unit.
 */
export async function recomputeGroupServiceDate(
  groupId: number,
  executor: DbExecutor = db,
): Promise<RecomputeServiceDateResult> {
  const [existing] = await executor
    .select({ serviceDate: invoiceGroupsTable.serviceDate })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.id, groupId));

  if (!existing) {
    // Group doesn't exist — nothing to do. Return a coherent triple so
    // callers don't have to special-case the missing row.
    return { previous: null, next: null, changed: false };
  }

  const previous = dateColumnToIso(existing.serviceDate as Date | string | null);
  const next = await computeExpectedServiceDate(groupId, executor);

  if (previous === next) {
    return { previous, next, changed: false };
  }

  await executor
    .update(invoiceGroupsTable)
    .set({ serviceDate: next })
    .where(eq(invoiceGroupsTable.id, groupId));

  return { previous, next, changed: true };
}

/**
 * Convenience wrapper for callers that touch two groups in one write
 * (the only such path is PATCH /claims/:id when an operator moves a leg
 * between groups). Recomputes both, deduplicates if equal, and tolerates
 * `null` so callers don't have to gate on "did the group actually move?".
 */
export async function recomputeGroupServiceDates(
  groupIds: ReadonlyArray<number | null | undefined>,
  executor: DbExecutor = db,
): Promise<Record<number, RecomputeServiceDateResult>> {
  const seen = new Set<number>();
  const out: Record<number, RecomputeServiceDateResult> = {};
  for (const raw of groupIds) {
    if (raw == null) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out[raw] = await recomputeGroupServiceDate(raw, executor);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Drift guard
// ─────────────────────────────────────────────────────────────────────

export interface ServiceDateDrift {
  groupId: number;
  invoiceNumber: string;
  /** ISO YYYY-MM-DD or null — what's stored in the column right now. */
  stored: string | null;
  /** ISO YYYY-MM-DD or null — what `recomputeGroupServiceDate` would write. */
  expected: string | null;
}

export interface ServiceDateDriftReport {
  totalGroups: number;
  driftCount: number;
  drift: ServiceDateDrift[];
}

/**
 * Read every group's stored `service_date` AND every child's `date` in
 * two flat queries, recompute the expected value in JS, and return the
 * rows where the stored column disagrees. Read-only — never writes.
 *
 * Used by the system-health rollup to surface "some write path forgot
 * to call recomputeGroupServiceDate" as an ops signal.
 *
 * `limit` caps the returned diff list so the rollup payload stays
 * bounded even if a regression skewed thousands of rows; `driftCount`
 * always reports the true total.
 */
export async function runServiceDateDriftCheck(
  limit = 50,
): Promise<ServiceDateDriftReport> {
  const [groups, claims] = await Promise.all([
    db
      .select({
        id: invoiceGroupsTable.id,
        invoiceNumber: invoiceGroupsTable.invoiceNumber,
        serviceDate: invoiceGroupsTable.serviceDate,
      })
      .from(invoiceGroupsTable),
    db
      .select({
        invoiceGroupId: claimsTable.invoiceGroupId,
        date: claimsTable.date,
      })
      .from(claimsTable),
  ]);

  const earliestByGroup = new Map<number, string>();
  for (const c of claims) {
    if (c.invoiceGroupId == null) continue;
    const norm = normalizeServiceDate(c.date);
    if (!norm) continue;
    const cur = earliestByGroup.get(c.invoiceGroupId);
    if (cur === undefined || norm < cur) earliestByGroup.set(c.invoiceGroupId, norm);
  }

  const drift: ServiceDateDrift[] = [];
  for (const g of groups) {
    const stored = dateColumnToIso(g.serviceDate as Date | string | null);
    const expected = earliestByGroup.get(g.id) ?? null;
    if (stored !== expected) {
      drift.push({ groupId: g.id, invoiceNumber: g.invoiceNumber, stored, expected });
    }
  }

  return {
    totalGroups: groups.length,
    driftCount: drift.length,
    drift: drift.slice(0, limit),
  };
}

/**
 * Best-effort wrapper used by the system-health rollup. Logs and
 * swallows any error so a transient DB hiccup never knocks the rollup
 * (and therefore the dashboard) over.
 */
export async function safeRunServiceDateDriftCheck(): Promise<ServiceDateDriftReport | null> {
  try {
    return await runServiceDateDriftCheck();
  } catch (err) {
    logger.warn({ err }, "runServiceDateDriftCheck failed (swallowed)");
    return null;
  }
}

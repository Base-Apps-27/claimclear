import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { claimsTable, invoiceGroupsTable } from "@workspace/db";
import {
  CLAIM_EXPIRING_ACTIONABLE_STATUSES,
  GROUP_EXPIRING_ACTIONABLE_STATUSES,
} from "../routes/dashboard";
import { SOON_DAYS, URGENT_DAYS } from "./risk-config";

export type ExpiringMode = "soon" | "urgent";

export function parseExpiringMode(raw: unknown): ExpiringMode | null {
  if (raw === "soon" || raw === "urgent") return raw;
  return null;
}

function maxDaysFor(mode: ExpiringMode): number {
  return mode === "urgent" ? URGENT_DAYS : SOON_DAYS;
}

// SQL fragment that yields the effective deadline (date type) for a given
// service-date expression: serviceDate + 30 days, then if the result lands on
// Saturday or Sunday, shifted back to the prior Friday so it reflects the day
// the office can actually file.
//
// Callers MUST pass an expression that's already a `date` (or NULL) — the
// `dateExpr` is referenced four times here and an inline `::date` cast on a
// non-castable text would 500 the whole query. Use `safeDateCast()` below
// (or pre-cast in a CTE/subquery) so empty strings degrade to NULL instead
// of raising "invalid input syntax for type date".
function effectiveDeadlineSql(dateExpr: SQL): SQL {
  return sql`(
    CASE EXTRACT(DOW FROM (${dateExpr} + INTERVAL '30 days'))
      WHEN 6 THEN ((${dateExpr} + INTERVAL '30 days')::date - INTERVAL '1 day')::date
      WHEN 0 THEN ((${dateExpr} + INTERVAL '30 days')::date - INTERVAL '2 days')::date
      ELSE (${dateExpr} + INTERVAL '30 days')::date
    END
  )`;
}

// Cast text-typed `claims.date` to `date` safely: empty strings become NULL
// (which `effectiveDeadlineSql` then propagates as NULL through the CASE),
// so a single bad row can't 500 the dashboard's expiring/urgent filters.
// Migration 0020 backfilled all rows to ISO; this guard is the safety net
// for any future stray non-ISO insert. */
function safeDateCast(textExpr: SQL): SQL {
  return sql`NULLIF(${textExpr}, '')::date`;
}

function actionableClaimStatusCondition(): SQL {
  const parts = CLAIM_EXPIRING_ACTIONABLE_STATUSES.map((s) => eq(claimsTable.status, s));
  return or(...parts) as SQL;
}

function actionableGroupStatusCondition(): SQL {
  const parts = GROUP_EXPIRING_ACTIONABLE_STATUSES.map((s) => eq(invoiceGroupsTable.status, s));
  return or(...parts) as SQL;
}

export function buildClaimExpiringCondition(mode: ExpiringMode): SQL {
  const max = maxDaysFor(mode);
  // Route the text-typed claims.date through safeDateCast so empty strings
  // and any future malformed inserts degrade to NULL (and get filtered out
  // by the IS NOT NULL guard) instead of 500ing the dashboard.
  const dateExpr = safeDateCast(sql`${claimsTable.date}`);
  return and(
    sql`${dateExpr} IS NOT NULL`,
    actionableClaimStatusCondition(),
    sql`(${effectiveDeadlineSql(dateExpr)} - CURRENT_DATE) <= ${max}`,
  ) as SQL;
}

export function buildInvoiceGroupExpiringCondition(mode: ExpiringMode): SQL {
  const max = maxDaysFor(mode);
  // Earliest service date across the group's child claims, computed as a
  // correlated subquery so the existing pagination / total-count queries on
  // invoice_groups stay flat (no JOIN that would inflate row counts).
  // NULLIF(...,'')::date keeps stray empty-string rows from raising
  // "invalid input syntax for type date" inside MIN().
  const earliestDateSubquery = sql`(
    SELECT MIN(NULLIF(c.date, '')::date)
    FROM claims c
    WHERE c.invoice_group_id = ${invoiceGroupsTable.id}
      AND c.date IS NOT NULL AND c.date <> ''
  )`;
  return and(
    actionableGroupStatusCondition(),
    sql`${earliestDateSubquery} IS NOT NULL`,
    sql`(${effectiveDeadlineSql(earliestDateSubquery)} - CURRENT_DATE) <= ${max}`,
  ) as SQL;
}

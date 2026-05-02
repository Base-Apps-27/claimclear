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
  // claims.date is now a typed DATE column (Task #351, migration 0022)
  // so the column reference is directly usable as a date expression —
  // no NULLIF/text-cast safety net required.
  const dateExpr = sql`${claimsTable.date}`;
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
  // claims.date is a typed DATE column, so MIN() yields a date directly.
  const earliestDateSubquery = sql`(
    SELECT MIN(c.date)
    FROM claims c
    WHERE c.invoice_group_id = ${invoiceGroupsTable.id}
      AND c.date IS NOT NULL
  )`;
  return and(
    actionableGroupStatusCondition(),
    sql`${earliestDateSubquery} IS NOT NULL`,
    sql`(${effectiveDeadlineSql(earliestDateSubquery)} - CURRENT_DATE) <= ${max}`,
  ) as SQL;
}

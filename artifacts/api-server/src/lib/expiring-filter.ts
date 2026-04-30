import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { claimsTable, invoiceGroupsTable } from "@workspace/db";
import { EXPIRING_ACTIONABLE_STATUSES } from "../routes/dashboard";

export type ExpiringMode = "soon" | "urgent";

// "Soon" matches the dashboard "Expiring Soon" section (filing deadline
// within 10 calendar days, after weekend shifting). "Urgent" is the narrower
// band that earns the red badge — items where the team needs to act in the
// next few business days.
const SOON_DAYS = 10;
const URGENT_DAYS = 3;

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
function effectiveDeadlineSql(dateExpr: SQL): SQL {
  return sql`(
    CASE EXTRACT(DOW FROM (${dateExpr}::date + INTERVAL '30 days'))
      WHEN 6 THEN ((${dateExpr}::date + INTERVAL '30 days')::date - INTERVAL '1 day')::date
      WHEN 0 THEN ((${dateExpr}::date + INTERVAL '30 days')::date - INTERVAL '2 days')::date
      ELSE (${dateExpr}::date + INTERVAL '30 days')::date
    END
  )`;
}

function actionableClaimStatusCondition(): SQL {
  const parts = EXPIRING_ACTIONABLE_STATUSES.map((s) => eq(claimsTable.status, s));
  return or(...parts) as SQL;
}

function actionableGroupStatusCondition(): SQL {
  const parts = EXPIRING_ACTIONABLE_STATUSES.map((s) => eq(invoiceGroupsTable.status, s));
  return or(...parts) as SQL;
}

export function buildClaimExpiringCondition(mode: ExpiringMode): SQL {
  const max = maxDaysFor(mode);
  const dateExpr = sql`${claimsTable.date}`;
  return and(
    sql`${claimsTable.date} IS NOT NULL`,
    actionableClaimStatusCondition(),
    sql`(${effectiveDeadlineSql(dateExpr)} - CURRENT_DATE) <= ${max}`,
  ) as SQL;
}

export function buildInvoiceGroupExpiringCondition(mode: ExpiringMode): SQL {
  const max = maxDaysFor(mode);
  // Earliest service date across the group's child claims, computed as a
  // correlated subquery so the existing pagination / total-count queries on
  // invoice_groups stay flat (no JOIN that would inflate row counts).
  const earliestDateSubquery = sql`(
    SELECT MIN(c.date::date)
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

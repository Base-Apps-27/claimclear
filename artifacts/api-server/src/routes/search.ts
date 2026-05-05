import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  claimsTable,
  invoiceGroupsTable,
  portalSubmissionsTable,
} from "@workspace/db";

import { asyncHandler } from "../lib/asyncHandler";
import { canSeeAmounts } from "../lib/role";

const router: IRouter = Router();

// Per-bucket cap. Small enough to keep the dropdown short and the query
// cheap, large enough that the operator usually sees their match without
// having to refine.
const PER_TYPE_LIMIT = 5;

/**
 * Universal header-search endpoint. Accepts a single `q` string and returns
 * a small, capped set of matches per record type. Search predicates mirror
 * the ILIKE clauses used by the dedicated list routes:
 *  - invoiceGroups → see buildInvoiceGroupWhere() in routes/invoice-groups.ts
 *  - claims        → see buildClaimsWhere() in routes/claims.ts
 *  - withdrawals   → see fetchAllRows() in routes/withdrawals.ts
 *  - portalSubmissions → fields snapshotted onto the row at draft time
 *
 * Money values are scrubbed for clerks (consistent with the per-list
 * `scrubMoneyFieldsArray` calls). No additional permission gating is
 * needed because the existing list endpoints don't gate visibility either
 * — clerks can already see these rows on the dedicated pages.
 */
router.get("/search", asyncHandler(async (req, res): Promise<void> => {
  const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!qRaw) {
    res.json({
      query: "",
      invoiceGroups: [],
      claims: [],
      withdrawals: [],
      portalSubmissions: [],
    });
    return;
  }

  const showAmounts = canSeeAmounts(req.user);
  const pat = `%${qRaw}%`;

  // ── Invoice groups ────────────────────────────────────────────────
  const invoiceGroupRows = await db
    .select({
      id: invoiceGroupsTable.id,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      clientNumber: invoiceGroupsTable.clientNumber,
      errorTypeName: invoiceGroupsTable.errorTypeName,
      status: invoiceGroupsTable.status,
      totalAmount: sql<string | null>`${invoiceGroupsTable.totalAmount}::text`,
      closureReason: invoiceGroupsTable.closureReason,
    })
    .from(invoiceGroupsTable)
    .where(
      and(
        // Hide closed (withdrawn / non-issue / denied) groups from this
        // bucket — those surface in the Withdrawals bucket below so we
        // don't double-list the same record.
        sql`${invoiceGroupsTable.closureReason} IS NULL`,
        or(
          ilike(invoiceGroupsTable.invoiceNumber, pat),
          ilike(invoiceGroupsTable.clientNumber, pat),
          ilike(invoiceGroupsTable.errorDetails, pat),
          ilike(invoiceGroupsTable.errorTypeName, pat),
        ) as SQL,
      ),
    )
    .orderBy(desc(invoiceGroupsTable.createdAt))
    .limit(PER_TYPE_LIMIT);

  // ── Claims ────────────────────────────────────────────────────────
  const claimRows = await db
    .select({
      id: claimsTable.id,
      confNumber: claimsTable.confNumber,
      refNumber: claimsTable.refNumber,
      clientNumber: claimsTable.clientNumber,
      errorTypeName: claimsTable.errorTypeName,
      status: claimsTable.status,
      claimAmount: sql<string | null>`${claimsTable.claimAmount}::text`,
      closureReason: claimsTable.closureReason,
    })
    .from(claimsTable)
    .where(
      and(
        sql`${claimsTable.closureReason} IS NULL`,
        or(
          ilike(claimsTable.confNumber, pat),
          ilike(claimsTable.refNumber, pat),
          ilike(claimsTable.clientNumber, pat),
          ilike(claimsTable.errorDetails, pat),
        ) as SQL,
      ),
    )
    .orderBy(desc(claimsTable.createdAt))
    .limit(PER_TYPE_LIMIT);

  // ── Withdrawals ───────────────────────────────────────────────────
  // Closed claims and closed groups, merged together. Mirrors the search
  // OR clauses from `fetchAllRows` in routes/withdrawals.ts.
  const closedClaimRows = await db
    .select({
      id: claimsTable.id,
      confNumber: claimsTable.confNumber,
      clientNumber: claimsTable.clientNumber,
      claimAmount: sql<string | null>`${claimsTable.claimAmount}::text`,
      closureReason: claimsTable.closureReason,
    })
    .from(claimsTable)
    .where(
      and(
        isNotNull(claimsTable.closureReason),
        or(
          ilike(claimsTable.confNumber, pat),
          ilike(claimsTable.clientNumber, pat),
          ilike(claimsTable.errorDetails, pat),
          ilike(claimsTable.errorTypeName, pat),
          ilike(claimsTable.closureNarrative, pat),
        ) as SQL,
      ),
    )
    .orderBy(desc(claimsTable.updatedAt))
    .limit(PER_TYPE_LIMIT);

  const closedGroupRows = await db
    .select({
      id: invoiceGroupsTable.id,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      clientNumber: invoiceGroupsTable.clientNumber,
      totalAmount: sql<string | null>`${invoiceGroupsTable.totalAmount}::text`,
      closureReason: invoiceGroupsTable.closureReason,
    })
    .from(invoiceGroupsTable)
    .where(
      and(
        isNotNull(invoiceGroupsTable.closureReason),
        or(
          ilike(invoiceGroupsTable.invoiceNumber, pat),
          ilike(invoiceGroupsTable.clientNumber, pat),
          ilike(invoiceGroupsTable.errorDetails, pat),
          ilike(invoiceGroupsTable.errorTypeName, pat),
          ilike(invoiceGroupsTable.closureNarrative, pat),
        ) as SQL,
      ),
    )
    .orderBy(desc(invoiceGroupsTable.updatedAt))
    .limit(PER_TYPE_LIMIT);

  const withdrawals = [
    ...closedGroupRows.map(g => ({
      kind: "group" as const,
      id: g.id,
      identifier: g.invoiceNumber ?? `Group #${g.id}`,
      clientNumber: g.clientNumber ?? null,
      amount: showAmounts ? g.totalAmount : null,
      closureReason: g.closureReason,
    })),
    ...closedClaimRows.map(c => ({
      kind: "claim" as const,
      id: c.id,
      identifier: c.confNumber ?? `Claim #${c.id}`,
      clientNumber: c.clientNumber ?? null,
      amount: showAmounts ? c.claimAmount : null,
      closureReason: c.closureReason,
    })),
  ].slice(0, PER_TYPE_LIMIT);

  // ── Portal submissions ───────────────────────────────────────────
  const portalRows = await db
    .select({
      id: portalSubmissionsTable.id,
      invoiceGroupId: portalSubmissionsTable.invoiceGroupId,
      invoiceNumber: portalSubmissionsTable.invoiceNumber,
      confNumber: portalSubmissionsTable.confNumber,
      clientNumber: portalSubmissionsTable.clientNumber,
      errorTypeName: portalSubmissionsTable.errorTypeName,
      status: portalSubmissionsTable.status,
      portalTicketId: portalSubmissionsTable.portalTicketId,
    })
    .from(portalSubmissionsTable)
    .where(
      or(
        ilike(portalSubmissionsTable.invoiceNumber, pat),
        ilike(portalSubmissionsTable.confNumber, pat),
        ilike(portalSubmissionsTable.clientNumber, pat),
        ilike(portalSubmissionsTable.errorDetails, pat),
        ilike(portalSubmissionsTable.errorTypeName, pat),
        ilike(portalSubmissionsTable.portalTicketId, pat),
      ) as SQL,
    )
    .orderBy(desc(portalSubmissionsTable.createdAt))
    .limit(PER_TYPE_LIMIT);

  res.json({
    query: qRaw,
    invoiceGroups: invoiceGroupRows.map(g => ({
      id: g.id,
      invoiceNumber: g.invoiceNumber,
      clientNumber: g.clientNumber,
      errorTypeName: g.errorTypeName,
      status: g.status,
      totalAmount: showAmounts ? g.totalAmount : null,
    })),
    claims: claimRows.map(c => ({
      id: c.id,
      confNumber: c.confNumber,
      refNumber: c.refNumber,
      clientNumber: c.clientNumber,
      errorTypeName: c.errorTypeName,
      status: c.status,
      claimAmount: showAmounts ? c.claimAmount : null,
    })),
    withdrawals,
    portalSubmissions: portalRows.map(p => ({
      id: p.id,
      invoiceGroupId: p.invoiceGroupId,
      invoiceNumber: p.invoiceNumber,
      confNumber: p.confNumber,
      clientNumber: p.clientNumber,
      errorTypeName: p.errorTypeName,
      status: p.status,
      portalTicketId: p.portalTicketId,
    })),
  });
}));

export default router;

import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, ilike, inArray, isNull, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, invoiceGroupsTable, auditLogsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { broadcastClaimEvent, broadcastGroupEvent } from "../lib/sse";

const router: IRouter = Router();

const WITHDRAWAL_REASONS = ["cannot_dispute", "non_issue", "denied_by_payor"] as const;
type WithdrawalReason = typeof WITHDRAWAL_REASONS[number];

type WithdrawalRow = {
  kind: "claim" | "invoice_group";
  id: number;
  identifier: string;
  clientNumber: string | null;
  errorTypeName: string | null;
  errorDetails: string | null;
  outcome: string;
  closureReason: WithdrawalReason;
  closureCategory: string | null;
  closureRootCause: string | null;
  closureNarrative: string | null;
  closureAccountabilityTags: string[] | null;
  amount: string | null;
  closedAt: string | null;
  closedBy: string | null;
  closureReviewState: string | null;
  closureCommunicatedTo: string | null;
  closureReviewNotes: string | null;
  closureAddressedAt: string | null;
  closureAddressedBy: string | null;
  addressed: boolean;
};

function parseReasons(raw: unknown): WithdrawalReason[] {
  if (typeof raw !== "string" || !raw) return [...WITHDRAWAL_REASONS];
  const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
  const filtered = parts.filter((r): r is WithdrawalReason => (WITHDRAWAL_REASONS as readonly string[]).includes(r));
  return filtered.length ? filtered : [...WITHDRAWAL_REASONS];
}

function isAddressed(reviewState: string | null, addressedAt: string | Date | null): boolean {
  if (reviewState === "acknowledged" || reviewState === "resolved") return true;
  return !!addressedAt;
}

async function fetchAllRows(query: Record<string, unknown>): Promise<WithdrawalRow[]> {
  const reasons = parseReasons(query.reason);
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const closedFrom = typeof query.closedFrom === "string" ? query.closedFrom : "";
  const closedTo = typeof query.closedTo === "string" ? query.closedTo : "";
  const hideAddressed = String(query.hideAddressed ?? "true") !== "false";

  const claimWhere: SQL[] = [inArray(claimsTable.closureReason, reasons as unknown as string[])];
  const groupWhere: SQL[] = [inArray(invoiceGroupsTable.closureReason, reasons as unknown as string[])];

  if (search) {
    const pat = `%${search}%`;
    claimWhere.push(or(
      ilike(claimsTable.confNumber, pat),
      ilike(claimsTable.clientNumber, pat),
      ilike(claimsTable.errorDetails, pat),
      ilike(claimsTable.errorTypeName, pat),
      ilike(claimsTable.closureNarrative, pat),
      ilike(claimsTable.closureCommunicatedTo, pat),
    )!);
    groupWhere.push(or(
      ilike(invoiceGroupsTable.invoiceNumber, pat),
      ilike(invoiceGroupsTable.clientNumber, pat),
      ilike(invoiceGroupsTable.errorDetails, pat),
      ilike(invoiceGroupsTable.errorTypeName, pat),
      ilike(invoiceGroupsTable.closureNarrative, pat),
      ilike(invoiceGroupsTable.closureCommunicatedTo, pat),
    )!);
  }

  if (closedFrom) {
    claimWhere.push(sql`${claimsTable.updatedAt} >= ${closedFrom}::timestamptz`);
    groupWhere.push(sql`${invoiceGroupsTable.updatedAt} >= ${closedFrom}::timestamptz`);
  }
  if (closedTo) {
    claimWhere.push(sql`${claimsTable.updatedAt} <= ${closedTo}::timestamptz`);
    groupWhere.push(sql`${invoiceGroupsTable.updatedAt} <= ${closedTo}::timestamptz`);
  }

  // Pull groups (closed at the group level).
  const groupRowsRaw = await db.select({
    id: invoiceGroupsTable.id,
    invoiceNumber: invoiceGroupsTable.invoiceNumber,
    clientNumber: invoiceGroupsTable.clientNumber,
    errorTypeName: invoiceGroupsTable.errorTypeName,
    errorDetails: invoiceGroupsTable.errorDetails,
    outcome: invoiceGroupsTable.outcome,
    closureReason: invoiceGroupsTable.closureReason,
    closureCategory: invoiceGroupsTable.closureCategory,
    closureRootCause: invoiceGroupsTable.closureRootCause,
    closureNarrative: invoiceGroupsTable.closureNarrative,
    closureAccountabilityTags: invoiceGroupsTable.closureAccountabilityTags,
    amount: invoiceGroupsTable.totalAmount,
    closedAt: sql<string | null>`COALESCE(${invoiceGroupsTable.closureAddressedAt}::text, ${invoiceGroupsTable.updatedAt}::text)`,
    closedBy: sql<string | null>`NULL::text`,
    closureReviewState: invoiceGroupsTable.closureReviewState,
    closureCommunicatedTo: invoiceGroupsTable.closureCommunicatedTo,
    closureReviewNotes: invoiceGroupsTable.closureReviewNotes,
    closureAddressedAt: invoiceGroupsTable.closureAddressedAt,
    closureAddressedBy: invoiceGroupsTable.closureAddressedBy,
    updatedAt: invoiceGroupsTable.updatedAt,
  }).from(invoiceGroupsTable).where(and(...groupWhere));

  const closedGroupIds = new Set(groupRowsRaw.map(g => g.id));

  // Pull claims that are closed but whose parent group (if any) is NOT
  // already in the withdrawals list — avoids double-counting.
  const claimRowsRaw = await db.select({
    id: claimsTable.id,
    confNumber: claimsTable.confNumber,
    invoiceGroupId: claimsTable.invoiceGroupId,
    clientNumber: claimsTable.clientNumber,
    errorTypeName: claimsTable.errorTypeName,
    errorDetails: claimsTable.errorDetails,
    outcome: claimsTable.outcome,
    closureReason: claimsTable.closureReason,
    closureCategory: claimsTable.closureCategory,
    closureRootCause: claimsTable.closureRootCause,
    closureNarrative: claimsTable.closureNarrative,
    closureAccountabilityTags: claimsTable.closureAccountabilityTags,
    amount: claimsTable.claimAmount,
    closedAt: sql<string | null>`COALESCE(${claimsTable.closureAddressedAt}::text, ${claimsTable.updatedAt}::text)`,
    closureReviewState: claimsTable.closureReviewState,
    closureCommunicatedTo: claimsTable.closureCommunicatedTo,
    closureReviewNotes: claimsTable.closureReviewNotes,
    closureAddressedAt: claimsTable.closureAddressedAt,
    closureAddressedBy: claimsTable.closureAddressedBy,
    updatedAt: claimsTable.updatedAt,
  }).from(claimsTable).where(and(...claimWhere));

  const groupRows: WithdrawalRow[] = groupRowsRaw.map(g => ({
    kind: "invoice_group",
    id: g.id,
    identifier: g.invoiceNumber,
    clientNumber: g.clientNumber,
    errorTypeName: g.errorTypeName,
    errorDetails: g.errorDetails,
    outcome: g.outcome,
    closureReason: g.closureReason as WithdrawalReason,
    closureCategory: g.closureCategory,
    closureRootCause: g.closureRootCause,
    closureNarrative: g.closureNarrative,
    closureAccountabilityTags: (g.closureAccountabilityTags as string[] | null) ?? null,
    amount: g.amount,
    closedAt: g.closedAt,
    closedBy: g.closedBy,
    closureReviewState: g.closureReviewState,
    closureCommunicatedTo: g.closureCommunicatedTo,
    closureReviewNotes: g.closureReviewNotes,
    closureAddressedAt: g.closureAddressedAt ? (g.closureAddressedAt as Date).toISOString() : null,
    closureAddressedBy: g.closureAddressedBy,
    addressed: isAddressed(g.closureReviewState, g.closureAddressedAt as Date | null),
  }));

  const claimRows: WithdrawalRow[] = claimRowsRaw
    .filter(c => c.invoiceGroupId == null || !closedGroupIds.has(c.invoiceGroupId))
    .map(c => ({
      kind: "claim",
      id: c.id,
      identifier: c.confNumber,
      clientNumber: c.clientNumber,
      errorTypeName: c.errorTypeName,
      errorDetails: c.errorDetails,
      outcome: c.outcome,
      closureReason: c.closureReason as WithdrawalReason,
      closureCategory: c.closureCategory,
      closureRootCause: c.closureRootCause,
      closureNarrative: c.closureNarrative,
      closureAccountabilityTags: (c.closureAccountabilityTags as string[] | null) ?? null,
      amount: c.amount,
      closedAt: c.closedAt,
      closedBy: null,
      closureReviewState: c.closureReviewState,
      closureCommunicatedTo: c.closureCommunicatedTo,
      closureReviewNotes: c.closureReviewNotes,
      closureAddressedAt: c.closureAddressedAt ? (c.closureAddressedAt as Date).toISOString() : null,
      closureAddressedBy: c.closureAddressedBy,
      addressed: isAddressed(c.closureReviewState, c.closureAddressedAt as Date | null),
    }));

  let rows = [...groupRows, ...claimRows];

  if (hideAddressed) {
    rows = rows.filter(r => !r.addressed);
  }

  return rows;
}

function sortRows(rows: WithdrawalRow[], sortKey: string, dir: "asc" | "desc"): WithdrawalRow[] {
  const mult = dir === "asc" ? 1 : -1;
  const cmp = (a: WithdrawalRow, b: WithdrawalRow): number => {
    let av: string | number | null = null;
    let bv: string | number | null = null;
    switch (sortKey) {
      case "reason":     av = a.closureReason; bv = b.closureReason; break;
      case "kind":       av = a.kind; bv = b.kind; break;
      case "identifier": av = a.identifier; bv = b.identifier; break;
      case "amount":     av = a.amount ? Number(a.amount) : 0; bv = b.amount ? Number(b.amount) : 0; break;
      case "addressed":  av = a.addressed ? 1 : 0; bv = b.addressed ? 1 : 0; break;
      case "closedAt":
      default:
        av = a.closedAt ?? ""; bv = b.closedAt ?? ""; break;
    }
    if (av === bv) return 0;
    if (av === null || av === undefined) return -1 * mult;
    if (bv === null || bv === undefined) return 1 * mult;
    return av > bv ? mult : -mult;
  };
  return rows.slice().sort(cmp);
}

router.get("/withdrawals", asyncHandler(async (req, res): Promise<void> => {
  const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit ?? "50"), 10) || 50));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
  const sortKey = (typeof req.query.sort === "string" && req.query.sort) ? req.query.sort : "closedAt";
  const dir = (req.query.dir === "asc" ? "asc" : "desc");

  const rows = await fetchAllRows(req.query as Record<string, unknown>);

  // Counts (computed on the *unfiltered-by-hideAddressed* set respecting all
  // other filters); we re-compute by toggling hideAddressed off.
  const countsRows = await fetchAllRows({ ...req.query, hideAddressed: "false" });
  const counts = {
    cannot_dispute:  countsRows.filter(r => r.closureReason === "cannot_dispute").length,
    non_issue:       countsRows.filter(r => r.closureReason === "non_issue").length,
    denied_by_payor: countsRows.filter(r => r.closureReason === "denied_by_payor").length,
    addressed:       countsRows.filter(r => r.addressed).length,
  };

  const sorted = sortRows(rows, sortKey, dir);
  const paged = sorted.slice(offset, offset + limit);

  res.json({ rows: paged, total: rows.length, counts });
}));

router.get("/withdrawals/export-csv", asyncHandler(async (req, res): Promise<void> => {
  const sortKey = (typeof req.query.sort === "string" && req.query.sort) ? req.query.sort : "closedAt";
  const dir = (req.query.dir === "asc" ? "asc" : "desc");

  const rows = await fetchAllRows(req.query as Record<string, unknown>);
  const sorted = sortRows(rows, sortKey, dir);

  const cols: { key: keyof WithdrawalRow; label: string }[] = [
    { key: "kind", label: "Kind" },
    { key: "identifier", label: "Identifier" },
    { key: "clientNumber", label: "Member #" },
    { key: "errorTypeName", label: "Error Type" },
    { key: "errorDetails", label: "Error Description" },
    { key: "outcome", label: "Outcome" },
    { key: "closureReason", label: "Reason" },
    { key: "closureCategory", label: "Category" },
    { key: "closureRootCause", label: "Root Cause" },
    { key: "amount", label: "Amount" },
    { key: "closedAt", label: "Closed At" },
    { key: "closureCommunicatedTo", label: "Communicated To" },
    { key: "closureReviewNotes", label: "Review Notes" },
    { key: "addressed", label: "Addressed" },
    { key: "closureAddressedAt", label: "Addressed At" },
    { key: "closureAddressedBy", label: "Addressed By" },
  ];

  const csvCell = (val: unknown): string => {
    if (val === null || val === undefined) return '""';
    const str = typeof val === "boolean" ? (val ? "Yes" : "No") : String(val);
    const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const header = cols.map(c => csvCell(c.label)).join(",");
  const body = sorted.map(r => cols.map(c => csvCell(r[c.key])).join(",")).join("\r\n");

  const today = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="withdrawals-${today}.csv"`);
  res.send([header, body].join("\r\n"));
}));

router.post("/withdrawals/bulk-address", asyncHandler(async (req, res): Promise<void> => {
  const { items, addressed } = req.body ?? {};
  if (!Array.isArray(items) || typeof addressed !== "boolean") {
    res.status(400).json({ error: "items (array) and addressed (boolean) are required" });
    return;
  }

  const claimIds = items.filter((i: any) => i && i.kind === "claim" && Number.isInteger(i.id)).map((i: any) => i.id as number);
  const groupIds = items.filter((i: any) => i && i.kind === "invoice_group" && Number.isInteger(i.id)).map((i: any) => i.id as number);

  const userEmail = req.user?.email ?? null;
  const userName = req.user?.displayName ?? null;
  const now = new Date();

  const claimUpdate: Record<string, unknown> = addressed
    ? { closureReviewState: "acknowledged", closureAddressedAt: now, closureAddressedBy: userName, closureAddressedByEmail: userEmail }
    : { closureReviewState: "pending", closureAddressedAt: null, closureAddressedBy: null, closureAddressedByEmail: null };

  let updated = 0;
  const closedReasons = ["cannot_dispute", "non_issue", "denied_by_payor"];

  if (claimIds.length > 0) {
    const updatedClaims = await db.update(claimsTable)
      .set(claimUpdate)
      .where(and(inArray(claimsTable.id, claimIds), inArray(claimsTable.closureReason, closedReasons)))
      .returning({ id: claimsTable.id });
    updated += updatedClaims.length;
    for (const c of updatedClaims) {
      await db.insert(auditLogsTable).values({
        claimId: c.id,
        action: addressed ? "closure_addressed" : "closure_review_state_changed",
        details: addressed ? "Marked addressed (bulk)" : "Cleared addressed (bulk)",
        userEmail,
        userName,
        metadata: { source: "withdrawals_bulk", to: addressed ? "acknowledged" : "pending" },
      });
      broadcastClaimEvent({ type: "claim_edited", claimId: c.id, userName, userEmail, timestamp: now.toISOString() });
    }
  }

  if (groupIds.length > 0) {
    const updatedGroups = await db.update(invoiceGroupsTable)
      .set(claimUpdate)
      .where(and(inArray(invoiceGroupsTable.id, groupIds), inArray(invoiceGroupsTable.closureReason, closedReasons)))
      .returning({ id: invoiceGroupsTable.id });
    updated += updatedGroups.length;
    for (const g of updatedGroups) {
      await db.insert(auditLogsTable).values({
        invoiceGroupId: g.id,
        action: addressed ? "closure_addressed" : "closure_review_state_changed",
        details: addressed ? "Marked addressed (bulk)" : "Cleared addressed (bulk)",
        userEmail,
        userName,
        metadata: { source: "withdrawals_bulk", to: addressed ? "acknowledged" : "pending" },
      });
      broadcastGroupEvent({ type: "group_edited", invoiceGroupId: g.id, userName, userEmail, timestamp: now.toISOString() });
    }
  }

  res.json({ updated });
}));

export default router;

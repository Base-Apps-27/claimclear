import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, ilike, inArray, isNull, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, invoiceGroupsTable, auditLogsTable, usersTable } from "@workspace/db";
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
  closedByName: string | null;
  closedByEmail: string | null;
  closureReviewState: string | null;
  closureCommunicatedTo: string | null;
  closureReviewNotes: string | null;
  closureAddressedAt: string | null;
  closureAddressedBy: string | null;
  closureAddressedByEmail: string | null;
  // Task #888/#889 — five-value responsibility column. Surfaced on every
  // withdrawal row so the drawer can render the responsibility badge and
  // the my-closures portal can scope its query through the same fetcher
  // (passing `closureResponsibility=foo,bar` in the query bag).
  closureResponsibility: string | null;
  addressed: boolean;
};

type Closer = { id: string; displayName: string | null; email: string | null };

// Audit-log actions that are emitted whenever an outcome changes (and which
// therefore identify the user who flipped the row to its current closed
// state). Both the claim-level and group-level transitions live here so the
// closer lookup works for both kinds of withdrawals.
const CLOSURE_AUDIT_ACTIONS = [
  "outcome_changed",
  "status_and_outcome_changed",
  "claim_outcome_changed",
  "group_outcome_changed",
  "group_status_and_outcome_changed",
] as const;

function parseReasons(raw: unknown): WithdrawalReason[] {
  if (typeof raw !== "string" || !raw) return [...WITHDRAWAL_REASONS];
  const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
  const filtered = parts.filter((r): r is WithdrawalReason => (WITHDRAWAL_REASONS as readonly string[]).includes(r));
  return filtered.length ? filtered : [...WITHDRAWAL_REASONS];
}

// `closedBy` is a comma-separated list of user ids, but the underlying audit
// log records the user's *email*. The frontend gets the id from the
// /withdrawals response (where we resolve email → user.id), so on the way
// back in we resolve the same way. An id that doesn't map to a known user
// (e.g. if a user was deleted) is treated as the email itself, which is the
// fallback id we hand back in the closers list.
function parseClosedBy(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return Array.from(new Set(raw.split(",").map(s => s.trim()).filter(Boolean)));
}

function isAddressed(reviewState: string | null, addressedAt: string | Date | null): boolean {
  // Task #889 — `acknowledged_by_party` (portal-side acknowledgement) is a
  // terminal state alongside the operator-side `acknowledged`/`resolved`.
  if (
    reviewState === "acknowledged" ||
    reviewState === "acknowledged_by_party" ||
    reviewState === "resolved"
  ) {
    return true;
  }
  return !!addressedAt;
}

// Task #889 — parse the closureResponsibility filter (comma-separated list
// of five-value enum strings). Empty / unparseable returns `null` so the
// fetcher knows to skip the filter entirely.
function parseResponsibilities(raw: unknown): string[] | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const allowed = new Set([
    "agent_mistake",
    "driver_mistake",
    "system_error",
    "external_payor",
    "no_one_process_limit",
  ]);
  const parts = raw.split(",").map(s => s.trim()).filter(s => allowed.has(s));
  return parts.length > 0 ? parts : null;
}

// Pull the latest closure-related audit-log entry per claim and per group in
// one pass, then build a lookup of "who last closed this row?". Callers can
// then both attach closer fields to rows AND filter rows by closer.
async function loadClosersFor(rows: WithdrawalRow[]): Promise<{
  byKey: Map<string, { email: string | null; name: string | null }>;
  emailToUser: Map<string, { id: string; firstName: string | null; lastName: string | null; email: string | null }>;
}> {
  const claimIds = rows.filter(r => r.kind === "claim").map(r => r.id);
  const groupIds = rows.filter(r => r.kind === "invoice_group").map(r => r.id);
  const byKey = new Map<string, { email: string | null; name: string | null }>();

  if (claimIds.length === 0 && groupIds.length === 0) {
    return { byKey, emailToUser: new Map() };
  }

  // Pull every closure-related audit row touching any of these claims/groups
  // in one statement, ordered newest-first. Below we walk the list and keep
  // the first hit per (kind, id) — far cheaper than N per-row queries even
  // on a large rail.
  const orParts: SQL[] = [];
  if (claimIds.length > 0) orParts.push(inArray(auditLogsTable.claimId, claimIds));
  if (groupIds.length > 0) orParts.push(inArray(auditLogsTable.invoiceGroupId, groupIds));

  const where = and(
    or(...orParts)!,
    inArray(auditLogsTable.action, CLOSURE_AUDIT_ACTIONS as unknown as string[]),
  );

  const auditRows = await db
    .select({
      claimId: auditLogsTable.claimId,
      invoiceGroupId: auditLogsTable.invoiceGroupId,
      userEmail: auditLogsTable.userEmail,
      userName: auditLogsTable.userName,
      timestamp: auditLogsTable.timestamp,
    })
    .from(auditLogsTable)
    .where(where)
    .orderBy(desc(auditLogsTable.timestamp));

  // Walk newest → oldest and keep the first hit per row. Only "winning"
  // entries (the latest one) end up in the map.
  for (const a of auditRows) {
    if (a.claimId != null) {
      const k = `claim:${a.claimId}`;
      if (!byKey.has(k)) byKey.set(k, { email: a.userEmail, name: a.userName });
    }
    if (a.invoiceGroupId != null) {
      const k = `invoice_group:${a.invoiceGroupId}`;
      if (!byKey.has(k)) byKey.set(k, { email: a.userEmail, name: a.userName });
    }
  }

  const emails = Array.from(new Set(
    Array.from(byKey.values()).map(v => v.email).filter((e): e is string => !!e),
  ));
  const emailToUser = new Map<string, { id: string; firstName: string | null; lastName: string | null; email: string | null }>();
  if (emails.length > 0) {
    const users = await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
      })
      .from(usersTable)
      .where(inArray(usersTable.email, emails));
    for (const u of users) {
      if (u.email) emailToUser.set(u.email.toLowerCase(), u);
    }
  }

  return { byKey, emailToUser };
}

function userDisplayName(u: { firstName: string | null; lastName: string | null; email: string | null }): string | null {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return name || u.email || null;
}

// Resolve the id we use for a closer: prefer the user's uuid (so the URL is
// stable across renames), fall back to the lowercased email so
// audit-log-only closers (e.g. users that have since been deleted) are still
// filterable.
function closerIdFor(email: string | null, emailToUser: Map<string, { id: string }>): string | null {
  if (!email) return null;
  const u = emailToUser.get(email.toLowerCase());
  return u?.id ?? email.toLowerCase();
}

async function fetchAllRows(query: Record<string, unknown>): Promise<WithdrawalRow[]> {
  const reasons = parseReasons(query.reason);
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const closedFrom = typeof query.closedFrom === "string" ? query.closedFrom : "";
  const closedTo = typeof query.closedTo === "string" ? query.closedTo : "";
  const hideAddressed = String(query.hideAddressed ?? "true") !== "false";
  const closedByIds = parseClosedBy(query.closedBy);
  const responsibilities = parseResponsibilities(query.closureResponsibility);
  // Task #889 — "awaiting party follow-through": only rows assigned to a
  // responsible role (closureResponsibility IS NOT NULL) and not yet
  // acknowledged by anyone. Used by both the Withdrawals filter chip and
  // (implicitly true) by /my-closures.
  const awaitingPartyOnly = String(query.awaitingParty ?? "false") === "true";

  const claimWhere: SQL[] = [inArray(claimsTable.closureReason, reasons as unknown as string[])];
  const groupWhere: SQL[] = [inArray(invoiceGroupsTable.closureReason, reasons as unknown as string[])];

  if (responsibilities) {
    claimWhere.push(inArray(claimsTable.closureResponsibility, responsibilities));
    groupWhere.push(inArray(invoiceGroupsTable.closureResponsibility, responsibilities));
  }
  if (awaitingPartyOnly) {
    claimWhere.push(isNotNull(claimsTable.closureResponsibility));
    groupWhere.push(isNotNull(invoiceGroupsTable.closureResponsibility));
  }

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
    closureReviewState: invoiceGroupsTable.closureReviewState,
    closureCommunicatedTo: invoiceGroupsTable.closureCommunicatedTo,
    closureReviewNotes: invoiceGroupsTable.closureReviewNotes,
    closureAddressedAt: invoiceGroupsTable.closureAddressedAt,
    closureAddressedBy: invoiceGroupsTable.closureAddressedBy,
    closureAddressedByEmail: invoiceGroupsTable.closureAddressedByEmail,
    closureResponsibility: invoiceGroupsTable.closureResponsibility,
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
    closureAddressedByEmail: claimsTable.closureAddressedByEmail,
    closureResponsibility: claimsTable.closureResponsibility,
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
    closedBy: null,
    closedByName: null,
    closedByEmail: null,
    closureReviewState: g.closureReviewState,
    closureCommunicatedTo: g.closureCommunicatedTo,
    closureReviewNotes: g.closureReviewNotes,
    closureAddressedAt: g.closureAddressedAt ? (g.closureAddressedAt as Date).toISOString() : null,
    closureAddressedBy: g.closureAddressedBy,
    closureAddressedByEmail: g.closureAddressedByEmail,
    closureResponsibility: g.closureResponsibility,
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
      closedByName: null,
      closedByEmail: null,
      closureReviewState: c.closureReviewState,
      closureCommunicatedTo: c.closureCommunicatedTo,
      closureReviewNotes: c.closureReviewNotes,
      closureAddressedAt: c.closureAddressedAt ? (c.closureAddressedAt as Date).toISOString() : null,
      closureAddressedBy: c.closureAddressedBy,
      closureAddressedByEmail: c.closureAddressedByEmail,
      closureResponsibility: c.closureResponsibility,
      addressed: isAddressed(c.closureReviewState, c.closureAddressedAt as Date | null),
    }));

  let rows = [...groupRows, ...claimRows];

  if (hideAddressed) {
    rows = rows.filter(r => !r.addressed);
  }

  // Stamp every row with its closer (derived from audit logs) so the
  // frontend can show "closed by X" and so the closedBy filter has the
  // right values to compare against.
  const { byKey, emailToUser } = await loadClosersFor(rows);
  for (const r of rows) {
    const closer = byKey.get(`${r.kind}:${r.id}`);
    if (!closer) continue;
    r.closedByEmail = closer.email;
    r.closedByName = closer.name;
    r.closedBy = closerIdFor(closer.email, emailToUser);
    // Prefer the canonical user display name over whatever was stamped on
    // the audit row at the time, so renames flow through.
    if (closer.email) {
      const u = emailToUser.get(closer.email.toLowerCase());
      if (u) r.closedByName = userDisplayName(u);
    }
  }

  if (closedByIds.length > 0) {
    const wanted = new Set(closedByIds.map(id => id.toLowerCase()));
    rows = rows.filter(r => r.closedBy != null && wanted.has(r.closedBy.toLowerCase()));
  }

  return rows;
}

// Build the "Closed by" facet options from a row set. Rows are expected to
// already have closer fields populated (so the caller has run
// `loadClosersFor`/`fetchAllRows`). We dedupe by closer id and sort
// alphabetically, with rows whose closer cannot be resolved omitted —
// they'll just be missing from the facet but still show up in the list.
function buildClosers(rows: WithdrawalRow[]): Closer[] {
  const seen = new Map<string, Closer>();
  for (const r of rows) {
    if (!r.closedBy) continue;
    if (seen.has(r.closedBy)) continue;
    seen.set(r.closedBy, {
      id: r.closedBy,
      displayName: r.closedByName,
      email: r.closedByEmail,
    });
  }
  return Array.from(seen.values()).sort((a, b) => {
    const an = (a.displayName ?? a.email ?? a.id).toLowerCase();
    const bn = (b.displayName ?? b.email ?? b.id).toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
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

  // Closers list mirrors the counts approach: we ignore both hideAddressed
  // AND closedBy so toggling closer checkboxes never causes other closers
  // to vanish from the rail. Other filters (search, reason, date range) DO
  // apply, which keeps the option list scoped to what the user is
  // currently looking at.
  const closersRows = await fetchAllRows({ ...req.query, hideAddressed: "false", closedBy: undefined });
  const closers = buildClosers(closersRows);

  const sorted = sortRows(rows, sortKey, dir);
  const paged = sorted.slice(offset, offset + limit);

  res.json({ rows: paged, total: rows.length, counts, closers });
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
    { key: "closedByName", label: "Closed By" },
    { key: "closedByEmail", label: "Closed By Email" },
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

// Task #889 — exported so /my-closures can reuse the canonical fetcher
// (with `closureResponsibility=...` injected). Keeping the underlying
// query in one place avoids two row-shaping codepaths diverging.
export { fetchAllRows, type WithdrawalRow };

export default router;

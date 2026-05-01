import { Router, type IRouter, type Request } from "express";
import { eq, or, ilike, desc, asc, and, count, inArray, isNull, isNotNull, ne, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { invoiceGroupsTable, claimsTable, auditLogsTable, notesTable, portalSubmissionsTable, portalResponsesTable, claimEvidenceTable, claimVerdictTable, claimStatusEnum } from "@workspace/db";
import { deriveLegSubStatus } from "@workspace/leg-state";
import { emitStateEvent } from "../lib/state-events";
import { allDisputedLegsResolved, RESOLVED_LEG_SUB_STATUSES } from "../lib/group-readiness";
import { computeGroupReadiness, loadGroupReadiness } from "../lib/group-packaging";
import { refreshGroupDerivedFields, getGroupMacroPhase } from "../lib/denormalized-cache";
import { getMacroPhase } from "../lib/macro-phase";
import { computeAttestationDelta } from "../lib/attestation";
import { asyncHandler } from "../lib/asyncHandler";
import { broadcastGroupEvent } from "../lib/sse";
import {
  transitionGroupStatus,
  transitionGroupOutcome,
  transitionGroupStatusAndOutcome,
  groupHasResponse,
  VALID_GROUP_STATUS_TRANSITIONS,
  VALID_GROUP_OUTCOME_BY_STATUS,
  SYSTEM_CONTROLLED_GROUP_STATUSES,
} from "../lib/group-transitions";
import { parseClosurePayload, ClosureValidationError, type NormalizedClosure, CLOSURE_DETAIL_FIELDS } from "../lib/closure-validation";
import { buildInvoiceGroupExpiringCondition, parseExpiringMode } from "../lib/expiring-filter";
import { effectiveDaysRemaining, isUrgentDeadline } from "../lib/dates";
import { EXPIRING_ACTIONABLE_STATUSES } from "./dashboard";

// A group is only "on the 30-day clock" while its status is one we still owe
// action on. Once it's filed (Awaiting Response) or otherwise terminal, the
// urgency signal stops applying, even if the calendar deadline has slipped.
const GROUP_ON_CLOCK_STATUSES = new Set<string>(EXPIRING_ACTIONABLE_STATUSES);

// Correlated subquery returning the earliest service date across the rides in
// a given invoice group. Used both as a sortable column and (separately) for
// row decoration so a single group's deadline math has one source of truth.
const earliestServiceDateExpr = sql<string | null>`(
  SELECT MIN(${claimsTable.date})
  FROM ${claimsTable}
  WHERE ${claimsTable.invoiceGroupId} = ${invoiceGroupsTable.id}
)`;

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

function actorFromReq(req: Request) {
  return {
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? null,
  };
}

function emitGroupEvent(invoiceGroupId: number, type: string, req: Request) {
  broadcastGroupEvent({
    type,
    invoiceGroupId,
    userName: req.user?.displayName ?? null,
    userEmail: req.user?.email ?? null,
    timestamp: new Date().toISOString(),
  });
}

const INVOICE_GROUP_SORTABLE_COLUMNS = {
  invoiceNumber: invoiceGroupsTable.invoiceNumber,
  rideCount: invoiceGroupsTable.rideCount,
  clientNumber: invoiceGroupsTable.clientNumber,
  errorTypeName: invoiceGroupsTable.errorTypeName,
  totalAmount: sql`${invoiceGroupsTable.totalAmount}::numeric`,
  status: invoiceGroupsTable.status,
  createdAt: invoiceGroupsTable.createdAt,
  serviceDate: earliestServiceDateExpr,
} as const;

function buildInvoiceGroupWhere(query: Record<string, unknown>): SQL | undefined {
  const { status, outcome, search, errorDetails: errorDetailsFilter, errorTypeId } = query;
  const createdFrom = query.createdFrom as string | undefined;
  const createdTo = query.createdTo as string | undefined;
  const amountMin = query.amountMin as string | undefined;
  const amountMax = query.amountMax as string | undefined;

  const conditions: SQL[] = [];

  if (status && typeof status === "string") {
    const statuses = status.split(",").map(s => s.trim()).filter(Boolean) as (typeof invoiceGroupsTable.status.enumValues)[number][];
    if (statuses.length === 1) {
      conditions.push(eq(invoiceGroupsTable.status, statuses[0]));
    } else if (statuses.length > 1) {
      const statusOr = or(...statuses.map(s => eq(invoiceGroupsTable.status, s)));
      if (statusOr) conditions.push(statusOr);
    }
  }

  if (outcome && typeof outcome === "string") {
    const outcomes = outcome.split(",").map(o => o.trim()).filter(Boolean) as (typeof invoiceGroupsTable.outcome.enumValues)[number][];
    if (outcomes.length === 1) {
      conditions.push(eq(invoiceGroupsTable.outcome, outcomes[0]));
    } else if (outcomes.length > 1) {
      const outcomeOr = or(...outcomes.map(o => eq(invoiceGroupsTable.outcome, o)));
      if (outcomeOr) conditions.push(outcomeOr);
    }
  }

  if (errorTypeId && typeof errorTypeId === "string") {
    const parts = errorTypeId.split(",").map(p => p.trim()).filter(Boolean);
    const hasUnassigned = parts.includes("__unassigned__");
    const ids = parts.filter(p => p !== "__unassigned__");
    const orParts: SQL[] = [];
    if (hasUnassigned) {
      const unassignedOr = or(isNull(invoiceGroupsTable.errorTypeId), eq(invoiceGroupsTable.errorTypeId, ""));
      if (unassignedOr) orParts.push(unassignedOr);
    }
    if (ids.length > 0) {
      orParts.push(inArray(invoiceGroupsTable.errorTypeId, ids));
    }
    if (orParts.length === 1) {
      conditions.push(orParts[0]);
    } else if (orParts.length > 1) {
      const combined = or(...orParts);
      if (combined) conditions.push(combined);
    }
  }

  if (search && typeof search === "string") {
    const searchPattern = `%${search}%`;
    const searchOr = or(
      ilike(invoiceGroupsTable.invoiceNumber, searchPattern),
      ilike(invoiceGroupsTable.clientNumber, searchPattern),
      ilike(invoiceGroupsTable.errorDetails, searchPattern),
      ilike(invoiceGroupsTable.errorTypeName, searchPattern),
    );
    if (searchOr) conditions.push(searchOr);
  }

  if (errorDetailsFilter === "empty") {
    const emptyOr = or(isNull(invoiceGroupsTable.errorDetails), eq(invoiceGroupsTable.errorDetails, ""));
    if (emptyOr) conditions.push(emptyOr);
  } else if (errorDetailsFilter === "present") {
    conditions.push(isNotNull(invoiceGroupsTable.errorDetails));
    conditions.push(ne(invoiceGroupsTable.errorDetails, ""));
  }

  if (createdFrom) {
    conditions.push(gte(invoiceGroupsTable.createdAt, new Date(createdFrom)));
  }
  if (createdTo) {
    const toDate = new Date(createdTo);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(invoiceGroupsTable.createdAt, toDate));
  }
  if (amountMin) {
    conditions.push(gte(sql`${invoiceGroupsTable.totalAmount}::numeric`, sql`${amountMin}::numeric`));
  }
  if (amountMax) {
    conditions.push(lte(sql`${invoiceGroupsTable.totalAmount}::numeric`, sql`${amountMax}::numeric`));
  }

  const expiringMode = parseExpiringMode(query.expiring);
  if (expiringMode) {
    conditions.push(buildInvoiceGroupExpiringCondition(expiringMode));
  }

  const macroPhase = query.macroPhase;
  if (macroPhase && typeof macroPhase === "string") {
    const phaseCondition = buildMacroPhaseCondition(macroPhase);
    if (phaseCondition) conditions.push(phaseCondition);
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

const STATUS_BY_PHASE = {
  "pre-submit": ["New", "Needs Evidence"],
  "in-flight": ["Portal Queued", "Generating Email", "Awaiting Response"],
  "response-pending": ["Ready to Review", "Needs Review"],
  "closed": ["Resolved", "Denied"],
  "on-hold": ["On Hold"],
} as const satisfies Record<string, ReadonlyArray<typeof claimStatusEnum.enumValues[number]>>;

function buildMacroPhaseCondition(phase: string): SQL | undefined {
  if (phase === "mas-action-required") {
    return and(
      isNull(invoiceGroupsTable.reattestCompletedAt),
      or(
        eq(invoiceGroupsTable.reattestRequired, true),
        sql`exists (
          select 1 from claims c
          where c.invoice_group_id = ${invoiceGroupsTable.id}
            and c.mas_action_required = 'cancel'
            and c.mas_action_completed_at is null
        )`,
      )!,
    );
  }
  if (phase === "awaiting-payout") {
    return isNotNull(invoiceGroupsTable.reattestCompletedAt);
  }
  if (phase in STATUS_BY_PHASE) {
    const statuses = STATUS_BY_PHASE[phase as keyof typeof STATUS_BY_PHASE];
    const statusCondition = inArray(invoiceGroupsTable.status, [...statuses]);
    if (phase === "response-pending") {
      return and(
        statusCondition,
        isNull(invoiceGroupsTable.reattestCompletedAt),
        or(
          isNull(invoiceGroupsTable.reattestRequired),
          eq(invoiceGroupsTable.reattestRequired, false),
        )!,
        sql`not exists (
          select 1 from claims c
          where c.invoice_group_id = ${invoiceGroupsTable.id}
            and c.mas_action_required = 'cancel'
            and c.mas_action_completed_at is null
        )`,
      );
    }
    return statusCondition;
  }
  return undefined;
}

// Default sort = earliest service date ascending (oldest first), so the rows
// closest to their 30-day filing deadline rise to the top. NULLs go last so
// groups missing a date don't squat at the front, and createdAt desc tiebreaks.
function buildInvoiceGroupOrderBy(sortCol: string | undefined, sortDir: string | undefined): SQL[] {
  if (sortCol && sortCol in INVOICE_GROUP_SORTABLE_COLUMNS) {
    const col = INVOICE_GROUP_SORTABLE_COLUMNS[sortCol as keyof typeof INVOICE_GROUP_SORTABLE_COLUMNS];
    const dirFn = sortDir === "asc" ? asc : desc;
    return [dirFn(col)];
  }
  return [
    sql`${earliestServiceDateExpr} ASC NULLS LAST`,
    desc(invoiceGroupsTable.createdAt),
  ];
}

router.get("/invoice-groups", asyncHandler(async (req, res): Promise<void> => {
  const { limit: limitStr, offset: offsetStr, sort, dir } = req.query;
  const limitVal = Math.min(parseInt(String(limitStr || "50"), 10), 500);
  const offsetVal = parseInt(String(offsetStr || "0"), 10);

  const where = buildInvoiceGroupWhere(req.query as Record<string, unknown>);
  const orderBy = buildInvoiceGroupOrderBy(sort as string, dir as string);

  const [totalResult] = await db.select({ count: count() }).from(invoiceGroupsTable).where(where);
  // Select earliestDate inline so the same correlated subquery the ORDER BY
  // uses also feeds row decoration — one source of truth, one round trip.
  const groupsRaw = await db
    .select({ row: invoiceGroupsTable, earliestDate: earliestServiceDateExpr })
    .from(invoiceGroupsTable)
    .where(where)
    .orderBy(...orderBy)
    .limit(limitVal)
    .offset(offsetVal);

  const today = new Date();
  const groupIds = groupsRaw.map(({ row }) => row.id);

  // Per-row leg-sub-status breakdown so the listing page can render the
  // tiny inline counters without a follow-up round trip per row. We fetch
  // only the four columns deriveLegSubStatus reads, then tally in JS.
  const legSubStatusByGroup = new Map<number, Record<string, number>>();
  if (groupIds.length > 0) {
    const legs = await db
      .select({
        invoiceGroupId: claimsTable.invoiceGroupId,
        includedInDispute: claimsTable.includedInDispute,
        errorTypeId: claimsTable.errorTypeId,
        holdReason: claimsTable.holdReason,
        sopOutcome: claimsTable.sopOutcome,
      })
      .from(claimsTable)
      .where(inArray(claimsTable.invoiceGroupId, groupIds));
    for (const leg of legs) {
      if (leg.invoiceGroupId == null) continue;
      const sub = deriveLegSubStatus(leg);
      const bucket = legSubStatusByGroup.get(leg.invoiceGroupId) ?? {};
      bucket[sub] = (bucket[sub] ?? 0) + 1;
      legSubStatusByGroup.set(leg.invoiceGroupId, bucket);
    }
  }

  const groups = groupsRaw.map(({ row, earliestDate }) => ({
    ...row,
    earliestDate,
    effectiveDaysLeft: effectiveDaysRemaining(earliestDate, today),
    // Status-aware: only flag as urgent if we still owe action.
    isUrgent: GROUP_ON_CLOCK_STATUSES.has(row.status) && isUrgentDeadline(earliestDate, today),
    legSubStatusCounts: legSubStatusByGroup.get(row.id) ?? {},
  }));

  // `?include=needs_classification` returns the inbox payload alongside
  // the regular list response so the queue page can fetch list +
  // inbox in a single round trip. Multiple `include` values can be
  // comma-separated (extension-friendly even though we only have one
  // today). Unknown values are silently ignored.
  const includeRaw = req.query.include;
  const includeSet = new Set(
    String(includeRaw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const responseBody: Record<string, unknown> = { groups, total: totalResult.count };
  if (includeSet.has("needs_classification")) {
    responseBody.needsClassificationInbox = await buildNeedsClassificationInbox();
  }

  res.json(responseBody);
}));

router.get("/invoice-groups/export-csv", asyncHandler(async (req, res): Promise<void> => {
  const { sort, dir, columns: columnsParam } = req.query;
  const where = buildInvoiceGroupWhere(req.query as Record<string, unknown>);
  const orderBy = buildInvoiceGroupOrderBy(sort as string, dir as string);

  const groups = await db.select().from(invoiceGroupsTable).where(where).orderBy(...orderBy);

  const requestedColumns = typeof columnsParam === "string" ? columnsParam.split(",").map(c => c.trim()) : null;

  const allColumns = [
    { key: "invoiceNumber", label: "Invoice #" },
    { key: "rideCount", label: "Rides" },
    { key: "clientNumber", label: "Client" },
    { key: "errorDetails", label: "Error Description" },
    { key: "errorTypeName", label: "Error Type" },
    { key: "totalAmount", label: "Total Amount" },
    { key: "status", label: "Status" },
    { key: "outcome", label: "Outcome" },
    { key: "createdAt", label: "Created Date" },
  ];

  const cols = requestedColumns
    ? allColumns.filter(c => requestedColumns.includes(c.key))
    : allColumns;

  const csvCell = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const header = cols.map(c => csvCell(c.label)).join(",");
  const rows = groups.map(g => {
    const row = cols.map(c => csvCell((g as Record<string, unknown>)[c.key]));
    return row.join(",");
  });

  const today = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="invoice-groups-${today}.csv"`);
  res.send([header, ...rows].join("\r\n"));
}));

// Classification Inbox summary — feeds the collapsible inbox on the queue
// page. Returns groups that contain at least one needs_classification leg,
// with a per-claim row payload (errorDetails, etc.) plus a `qualifying`
// flag indicating whether at least one sibling already has a classification
// (errorTypeId or non-empty errorDetails). Groups where every leg is blank
// are still surfaced — they need manual triage from the inbox.
// Inbox payload shape — exported so the openapi codegen and the list
// route's `?include=needs_classification` branch can both reference it.
export type InboxClaim = {
  id: number;
  confNumber: string;
  date: string | null;
  claimAmount: string | null;
  errorDetails: string | null;
  isBlank: boolean;
};
export type InboxGroup = {
  id: number;
  invoiceNumber: string | null;
  status: string;
  rideCount: number;
  totalAmount: string | null;
  clientNumber: string | null;
  needsClassificationCount: number;
  qualifyingSiblingCount: number;
  allBlank: boolean;
  claims: InboxClaim[];
};
export interface NeedsClassificationInbox {
  total: number;
  groups: InboxGroup[];
}

// Shared builder used by both `GET /invoice-groups/needs-classification`
// (kept for back-compat with already-deployed clients) and the new
// `GET /invoice-groups?include=needs_classification` branch. Single
// source of truth for the predicate (Needs Review only) and the sort
// order (qualifying siblings first, then all-blank).
async function buildNeedsClassificationInbox(): Promise<NeedsClassificationInbox> {
  const candidateLegs = await db
    .select({
      id: claimsTable.id,
      invoiceGroupId: claimsTable.invoiceGroupId,
      confNumber: claimsTable.confNumber,
      date: claimsTable.date,
      claimAmount: claimsTable.claimAmount,
      errorDetails: claimsTable.errorDetails,
      errorTypeId: claimsTable.errorTypeId,
      errorTypeName: claimsTable.errorTypeName,
      includedInDispute: claimsTable.includedInDispute,
      holdReason: claimsTable.holdReason,
      sopOutcome: claimsTable.sopOutcome,
    })
    .from(claimsTable)
    .innerJoin(invoiceGroupsTable, eq(claimsTable.invoiceGroupId, invoiceGroupsTable.id))
    // Predicate scoped to Needs Review only — that's where unclassified
    // groups live in the dispute lifecycle. New groups are still imports
    // that may not have been triaged into the dispute pipeline yet, so
    // they're explicitly excluded from the inbox.
    .where(eq(invoiceGroupsTable.status, "Needs Review"))
    .orderBy(asc(invoiceGroupsTable.id), asc(claimsTable.id));

  const groupIds = Array.from(new Set(candidateLegs.map((l) => l.invoiceGroupId).filter((x): x is number => x != null)));
  if (groupIds.length === 0) {
    return { total: 0, groups: [] };
  }

  const groupRows = await db
    .select({
      id: invoiceGroupsTable.id,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      status: invoiceGroupsTable.status,
      rideCount: invoiceGroupsTable.rideCount,
      totalAmount: invoiceGroupsTable.totalAmount,
      clientNumber: invoiceGroupsTable.clientNumber,
    })
    .from(invoiceGroupsTable)
    .where(inArray(invoiceGroupsTable.id, groupIds));
  const groupById = new Map(groupRows.map((g) => [g.id, g]));

  const byGroup = new Map<number, { qualifyingLegs: typeof candidateLegs; needsClassLegs: typeof candidateLegs }>();
  for (const leg of candidateLegs) {
    if (leg.invoiceGroupId == null) continue;
    const bucket = byGroup.get(leg.invoiceGroupId) ?? { qualifyingLegs: [], needsClassLegs: [] };
    const hasErrorDetails = typeof leg.errorDetails === "string" && leg.errorDetails.trim().length > 0;
    const hasErrorType = typeof leg.errorTypeId === "string" && leg.errorTypeId.length > 0;
    if (hasErrorDetails || hasErrorType) bucket.qualifyingLegs.push(leg);
    const sub = deriveLegSubStatus(leg);
    if (sub === "needs_classification") bucket.needsClassLegs.push(leg);
    byGroup.set(leg.invoiceGroupId, bucket);
  }

  const inboxGroups: InboxGroup[] = [];
  for (const [gid, { qualifyingLegs, needsClassLegs }] of byGroup) {
    if (needsClassLegs.length === 0) continue;
    const grp = groupById.get(gid);
    if (!grp) continue;
    const claims: InboxClaim[] = needsClassLegs.map((l) => ({
      id: l.id,
      confNumber: l.confNumber,
      date: l.date,
      claimAmount: l.claimAmount,
      errorDetails: l.errorDetails,
      isBlank: !(typeof l.errorDetails === "string" && l.errorDetails.trim().length > 0),
    }));
    inboxGroups.push({
      id: grp.id,
      invoiceNumber: grp.invoiceNumber,
      status: grp.status,
      rideCount: grp.rideCount,
      totalAmount: grp.totalAmount,
      clientNumber: grp.clientNumber,
      needsClassificationCount: needsClassLegs.length,
      qualifyingSiblingCount: qualifyingLegs.length,
      allBlank: qualifyingLegs.length === 0,
      claims,
    });
  }

  // Sort: groups with at least one qualifying sibling first (operator can
  // act immediately on those), then all-blank groups (need manual triage).
  inboxGroups.sort((a, b) => {
    if (a.allBlank !== b.allBlank) return a.allBlank ? 1 : -1;
    return a.id - b.id;
  });

  return {
    total: inboxGroups.reduce((acc, g) => acc + g.needsClassificationCount, 0),
    groups: inboxGroups,
  };
}

router.get("/invoice-groups/needs-classification", asyncHandler(async (_req, res): Promise<void> => {
  // Back-compat route — same payload, kept so existing clients keep
  // working through the deprecation window. New callers should prefer
  // `GET /invoice-groups?include=needs_classification` which embeds the
  // inbox alongside the regular list response.
  const inbox = await buildNeedsClassificationInbox();
  res.json(inbox);
}));

router.get("/invoice-groups/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const rides = await db.select().from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, id))
    .orderBy(desc(claimsTable.createdAt));

  const rideIds = rides.map((r) => r.id);
  const verdictMap = new Map<number, { latest: typeof claimVerdictTable.$inferSelect | null; latestAi: typeof claimVerdictTable.$inferSelect | null }>();
  if (rideIds.length > 0) {
    const allVerdicts = await db
      .select()
      .from(claimVerdictTable)
      .where(inArray(claimVerdictTable.claimId, rideIds))
      .orderBy(desc(claimVerdictTable.createdAt));
    for (const v of allVerdicts) {
      const slot = verdictMap.get(v.claimId) ?? { latest: null, latestAi: null };
      if (slot.latest === null) slot.latest = v;
      if (slot.latestAi === null && v.source === "ai_suggested") slot.latestAi = v;
      verdictMap.set(v.claimId, slot);
    }
  }
  const ridesWithVerdicts = rides.map((r) => {
    const slot = verdictMap.get(r.id);
    return {
      ...r,
      latestVerdict: slot?.latest ?? null,
      latestAiSuggestion: slot?.latestAi ?? null,
    };
  });

  const submissions = await db.select().from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.invoiceGroupId, id))
    .orderBy(desc(portalSubmissionsTable.createdAt));

  const notes = await db.select().from(notesTable)
    .where(eq(notesTable.invoiceGroupId, id))
    .orderBy(desc(notesTable.createdAt));

  const auditLogs = await db.select().from(auditLogsTable)
    .where(eq(auditLogsTable.invoiceGroupId, id))
    .orderBy(desc(auditLogsTable.timestamp));

  const responses = await db.select().from(portalResponsesTable)
    .where(eq(portalResponsesTable.invoiceGroupId, id))
    .orderBy(desc(portalResponsesTable.receivedAt));

  // A group is "partial" when at least one leg is on hold AND at least one is
  // not — i.e. the user has split the group so part of it can move forward
  // while another part is parked.
  const heldCount = rides.filter(r => r.status === "On Hold").length;
  const isPartial = heldCount > 0 && heldCount < rides.length;

  const macroPhase = getGroupMacroPhase(group);

  // "Ready to package" CTA payload — see lib/group-packaging.ts. Computed
  // off the rows we already loaded; no extra DB roundtrip. Frontend
  // (InvoiceGroupDetailV2 + Queue right-side panel in #232) renders the
  // CTA in enabled or disabled state from this payload.
  const packagingReadiness = computeGroupReadiness(group, rides);

  res.json({
    ...group,
    rides: ridesWithVerdicts,
    submissions,
    notes,
    auditLogs,
    responses,
    isPartial,
    macroPhase,
    packagingReadiness,
  });
}));

router.patch("/invoice-groups/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updateData: Partial<typeof invoiceGroupsTable.$inferInsert> = {};
  const allowedFields = [
    "errorDetails", "errorTypeId", "errorTypeName", "payorEmail",
    "evidenceNotes", "evidenceFiles", "evidenceChecklist",
  ] as const;
  for (const f of allowedFields) {
    if (req.body[f] !== undefined) {
      (updateData as Record<string, unknown>)[f] = req.body[f];
    }
  }

  const [previous] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!previous) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const actor = actorFromReq(req);

  // Atomic block — same shape as the claim PATCH: row update + group_edited
  // audit + (when applicable) auto_after_classify transition all run in one
  // drizzle transaction, so we never end up with the row updated but no
  // audit row, or vice versa.
  const { saved, advanced } = await db.transaction(async (tx) => {
    const [updated] = await tx.update(invoiceGroupsTable).set(updateData).where(eq(invoiceGroupsTable.id, id)).returning();
    if (!updated) throw new Error("Invoice group not found");

    await tx.insert(auditLogsTable).values({
      invoiceGroupId: id,
      action: "group_edited",
      details: `Invoice group ${updated.invoiceNumber} updated`,
      metadata: { fields: Object.keys(updateData) },
      ...actor,
    });

    // Auto-advance: same as the per-claim hook — first-time errorTypeId on
    // a New / Needs Review group pushes it to Needs Evidence.
    const becameClassified =
      Object.prototype.hasOwnProperty.call(updateData, "errorTypeId") &&
      typeof updated.errorTypeId === "string" && updated.errorTypeId.length > 0 &&
      (previous.errorTypeId === null || previous.errorTypeId === "") &&
      (previous.status === "New" || previous.status === "Needs Review");

    if (becameClassified) {
      const result = await transitionGroupStatus({
        groupId: id,
        newStatus: "Needs Evidence",
        source: "auto_after_classify",
        reason: `Auto-advanced after error type classified (${updated.errorTypeName ?? updated.errorTypeId})`,
        actor,
        systemOverride: true,
        executor: tx,
      });
      return { saved: updated, advanced: result.group };
    }

    return { saved: updated, advanced: null as typeof updated | null };
  });

  emitGroupEvent(id, "group_edited", req);
  res.json(advanced ?? saved);
}));

router.patch("/invoice-groups/:id/status", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { status, reason } = req.body;
  if (!status) { res.status(400).json({ error: "status is required" }); return; }

  try {
    const result = await transitionGroupStatus({
      groupId: id,
      newStatus: status,
      source: "manual",
      reason: reason || "Manual status change",
      actor: actorFromReq(req),
      extraFields: status === "On Hold" ? { holdReason: reason || null } : undefined,
    });
    res.json(result.group);
  } catch (err: any) {
    const msg = err.message || "Failed to update status";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

// POST /invoice-groups/:id/package — operator-driven flip from
// pre-submit (New|Needs Evidence) to Generating Email. Gated by the
// readiness helper in lib/group-packaging.ts: every non-held leg must
// have a sop_outcome set and at least one leg must be contestable.
//
// Generating Email is in SYSTEM_CONTROLLED_GROUP_STATUSES so the
// transition runs with `systemOverride: true`; this endpoint is the
// authorised system-controlled entry point. Standard audit/note/SSE
// semantics flow through `transitionGroupStatus` as usual.
router.post("/invoice-groups/:id/package", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const readiness = await loadGroupReadiness(id);
  if (readiness === null) {
    res.status(404).json({ error: "Invoice group not found" });
    return;
  }
  if (!readiness.ready) {
    // 409: the request is well-formed, the group exists, but its
    // current state precludes the action. Frontend renders the same
    // reason string in the disabled-CTA tooltip.
    res.status(409).json({ error: readiness.reason, packagingReadiness: readiness });
    return;
  }

  try {
    const result = await transitionGroupStatus({
      groupId: id,
      newStatus: "Generating Email",
      source: "operator_packaged",
      reason: "Operator clicked Ready to package",
      actor: actorFromReq(req),
      systemOverride: true,
    });
    // Recompute readiness post-transition so the client picks up the
    // new state in the same response (group is no longer pre-submit,
    // so `ready` will now be false with a "Group is Generating Email…"
    // reason — keeps the UI consistent if it re-renders from this body).
    const refreshed = await loadGroupReadiness(id);
    res.json({ ...result.group, packagingReadiness: refreshed });
  } catch (err: any) {
    // Map error families to standard HTTP semantics:
    //   • 404 — group disappeared between the readiness check and
    //     the transition (extremely narrow race window, but cheap to
    //     handle correctly).
    //   • 409 — `transitionGroupStatus` rejected the move because
    //     the current state precludes it (e.g. the group flipped
    //     out of pre-submit between our readiness check and the
    //     transition call). Same semantics as the readiness 409
    //     above — the request is well-formed but state is wrong.
    //   • 400 — validation/precondition failure that doesn't fit
    //     either of the above. Kept as a fallback so genuinely
    //     malformed transitions still surface cleanly.
    const msg = err.message || "Failed to package invoice group";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    // Transition layer raises errors with phrases like "invalid
    // transition", "not allowed", "current status", or
    // "cannot transition" for state-conflict cases. We prefer to
    // err on the side of 409 here so the frontend's "Cannot package
    // yet" toast handler kicks in (it already mirrors the readiness
    // 409 path) instead of the generic 400 fallback.
    if (
      msg.includes("invalid transition") ||
      msg.includes("not allowed") ||
      msg.includes("current status") ||
      msg.includes("cannot transition")
    ) {
      const refreshed = await loadGroupReadiness(id).catch(() => null);
      res.status(409).json({ error: msg, packagingReadiness: refreshed });
      return;
    }
    res.status(400).json({ error: msg });
  }
}));

router.patch("/invoice-groups/:id/outcome", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { outcome, approvedAmount, closureReason } = req.body;
  if (!outcome) { res.status(400).json({ error: "outcome is required" }); return; }

  if (outcome === "Denied") {
    if (closureReason !== undefined && closureReason !== "denied_by_payor") {
      res.status(400).json({ error: `Denied outcome implies closureReason=denied_by_payor; pass Withdrawn for staff-initiated closures.` });
      return;
    }
  }
  if (outcome === "Withdrawn" && closureReason !== "cannot_dispute") {
    res.status(400).json({ error: `Withdrawn outcome requires closureReason of "cannot_dispute".` });
    return;
  }
  if (outcome === "Non-Issue" && closureReason !== undefined && closureReason !== "non_issue") {
    res.status(400).json({ error: `Non-Issue outcome requires closureReason "non_issue".` });
    return;
  }

  let closure: NormalizedClosure | null = null;
  const effectiveReason = closureReason ?? (outcome === "Non-Issue" ? "non_issue" : closureReason);
  const reasonRequiresClosure =
    effectiveReason === "cannot_dispute" || effectiveReason === "non_issue";
  const wantsStructuredClosure =
    outcome === "Withdrawn" || outcome === "Non-Issue" || outcome === "Denied";
  const hasClosureFields =
    wantsStructuredClosure && CLOSURE_DETAIL_FIELDS.some((f) => req.body[f] !== undefined);
  // Denied accepts an optional structured closure (Denied-by-Payor with details);
  // it does NOT require one because the simple "outcome = Denied" path is also valid.
  if (wantsStructuredClosure && (hasClosureFields || reasonRequiresClosure)) {
    try {
      closure = parseClosurePayload({
        ...req.body,
        outcome,
        closureReason: effectiveReason,
      });
    } catch (err) {
      if (err instanceof ClosureValidationError) {
        res.status(400).json({ error: err.message, issues: err.issues });
        return;
      }
      throw err;
    }
  }

  let newStatus: string | undefined;
  if (outcome === "Approved" || outcome === "Partially Approved" || outcome === "Non-Issue" || outcome === "Withdrawn") {
    newStatus = "Resolved";
  } else if (outcome === "Denied") {
    newStatus = "Denied";
  }

  try {
    if (newStatus) {
      const result = await transitionGroupStatusAndOutcome({
        groupId: id,
        newStatus: newStatus as typeof invoiceGroupsTable.status.enumValues[number],
        newOutcome: outcome,
        source: "manual",
        reason: `Outcome set to ${outcome}`,
        actor: actorFromReq(req),
        extraFields: approvedAmount !== undefined ? { approvedAmount: String(approvedAmount) } : undefined,
        closureReason: effectiveReason ?? closureReason,
        closure,
      });
      res.json(result.group);
    } else {
      const result = await transitionGroupOutcome({
        groupId: id,
        newOutcome: outcome,
        source: "manual",
        reason: `Outcome set to ${outcome}`,
        actor: actorFromReq(req),
        approvedAmount: approvedAmount !== undefined ? String(approvedAmount) : undefined,
        closureReason: effectiveReason ?? closureReason,
        closure,
      });
      res.json(result.group);
    }
  } catch (err: any) {
    const msg = err.message || "Failed to update outcome";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.post("/invoice-groups/:id/triage", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { triageOutcome, errorTypeId, errorTypeName, notes: triageNotes } = req.body;
  if (!triageOutcome || !["non_issue", "issue_found"].includes(triageOutcome)) {
    res.status(400).json({ error: "triageOutcome must be 'non_issue' or 'issue_found'" });
    return;
  }

  const actor = actorFromReq(req);

  try {
    if (triageOutcome === "non_issue") {
      const result = await transitionGroupStatusAndOutcome({
        groupId: id,
        newStatus: "Resolved",
        newOutcome: "Non-Issue",
        source: "triage",
        reason: `Classified as non-issue${triageNotes ? `: ${triageNotes}` : ""}`,
        actor,
        extraFields: {
          triageNotes: triageNotes || null,
          triagedAt: new Date().toISOString(),
          totalAmount: "0",
        },
        childFields: {
          claimAmount: "0",
          approvedAmount: "0",
        },
      });
      res.json(result.group);
    } else {
      if (!errorTypeId || !errorTypeName) {
        res.status(400).json({ error: "errorTypeId and errorTypeName are required for issue_found" });
        return;
      }

      const result = await transitionGroupStatus({
        groupId: id,
        newStatus: "New",
        source: "triage",
        reason: `Issue identified during classification: ${errorTypeName}${triageNotes ? `. ${triageNotes}` : ""}`,
        actor,
        extraFields: {
          errorTypeId: String(errorTypeId),
          errorTypeName,
          triageNotes: triageNotes || null,
          triagedAt: new Date().toISOString(),
        },
      });
      res.json(result.group);
    }
  } catch (err: any) {
    const msg = err.message || "Failed to classify";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.post("/invoice-groups/:id/hold", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { reason } = req.body;

  try {
    const result = await transitionGroupStatus({
      groupId: id,
      newStatus: "On Hold",
      source: "manual",
      reason: reason || "No reason given",
      actor: actorFromReq(req),
      extraFields: { holdReason: reason || null },
    });
    res.json(result.group);
  } catch (err: any) {
    const msg = err.message || "Failed to place on hold";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.delete("/invoice-groups/:id/hold", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const resumeStatus = (group.holdPendingFrom || "Needs Evidence") as typeof group.status;

  try {
    const result = await transitionGroupStatus({
      groupId: id,
      newStatus: resumeStatus,
      source: "manual",
      reason: "Hold removed",
      actor: actorFromReq(req),
      systemOverride: true,
    });
    res.json(result.group);
  } catch (err: any) {
    const msg = err.message || "Failed to remove hold";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.post("/invoice-groups/bulk-assign-error-type", asyncHandler(async (req, res): Promise<void> => {
  const { groupIds, errorTypeId, errorTypeName } = req.body;
  if (!Array.isArray(groupIds) || groupIds.length === 0 || !errorTypeId) {
    res.status(400).json({ error: "groupIds array and errorTypeId are required" });
    return;
  }

  await db.update(invoiceGroupsTable)
    .set({ errorTypeId, errorTypeName: errorTypeName || null })
    .where(inArray(invoiceGroupsTable.id, groupIds));

  const actor = actorFromReq(req);
  for (const gid of groupIds) {
    await db.insert(auditLogsTable).values({
      invoiceGroupId: gid,
      action: "group_error_type_assigned",
      details: `Error type assigned: ${errorTypeName || errorTypeId}`,
      metadata: { errorTypeId, errorTypeName },
      ...actor,
    });
  }

  res.json({ success: true, updated: groupIds.length });
}));

router.get("/invoice-groups/:id/valid-transitions", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const activeSubmissions = await db.select().from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.invoiceGroupId, id),
      or(
        eq(portalSubmissionsTable.status, "pending"),
        eq(portalSubmissionsTable.status, "in_progress"),
      ),
    ));

  const hasActiveSubmission = activeSubmissions.length > 0;

  const allSubmissions = await db.select({ id: portalSubmissionsTable.id })
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.invoiceGroupId, id))
    .limit(1);
  const hasBeenSubmitted = allSubmissions.length > 0;

  const validStatuses = hasActiveSubmission ? [] : (VALID_GROUP_STATUS_TRANSITIONS[group.status] || []);
  const validOutcomes = VALID_GROUP_OUTCOME_BY_STATUS[group.status] || [];

  const canQueueForPortal = !hasActiveSubmission &&
    group.status === "Needs Evidence" &&
    !!group.errorTypeId;

  const childClaimIds = (await db.select({ id: claimsTable.id })
    .from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, id))).map(c => c.id);

  const latestResponseConditions = [eq(portalResponsesTable.invoiceGroupId, id)];
  if (childClaimIds.length > 0) {
    latestResponseConditions.push(inArray(portalResponsesTable.claimId, childClaimIds));
  }
  const latestResponse = await db.select().from(portalResponsesTable)
    .where(or(...latestResponseConditions))
    .orderBy(desc(portalResponsesTable.receivedAt))
    .limit(1);

  const latestResponseType = latestResponse.length > 0 ? latestResponse[0].responseType : null;
  const hasResponse = await groupHasResponse(id);

  let postResponseActions: string[] = [];
  if (group.status === "Needs Review" && latestResponseType) {
    if (["approval", "partial_approval"].includes(latestResponseType)) {
      postResponseActions = ["resolve_reattest", "resolve_new_invoice"];
    } else if (latestResponseType === "denial") {
      postResponseActions = ["mark_denied_by_payor", "re_dispute"];
    } else {
      postResponseActions = ["resolve_reattest", "resolve_new_invoice", "mark_denied_by_payor", "re_dispute"];
    }
  }

  res.json({
    validStatuses,
    validOutcomes,
    canQueueForPortal,
    hasActiveSubmission,
    hasBeenSubmitted,
    postResponseActions,
    latestResponseType,
    hasResponse,
  });
}));

router.get("/invoice-groups/:id/evidence", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const evidence = await db.select().from(claimEvidenceTable)
    .where(eq(claimEvidenceTable.invoiceGroupId, id))
    .orderBy(claimEvidenceTable.collectedAt);
  res.json({ evidence });
}));

router.post("/invoice-groups/:id/evidence", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { evidenceTypeId, evidenceTypeName, treeNodeId, imageUrl, notes } = req.body;
  if (!evidenceTypeName) {
    res.status(400).json({ error: "evidenceTypeName is required" });
    return;
  }

  const user = req.user;
  const [created] = await db.insert(claimEvidenceTable).values({
    claimId: null,
    invoiceGroupId: id,
    evidenceTypeId: evidenceTypeId || null,
    evidenceTypeName,
    treeNodeId: treeNodeId || null,
    imageUrl: imageUrl || null,
    notes: notes || null,
    collectedBy: user?.displayName || user?.email || null,
  }).returning();

  await db.insert(auditLogsTable).values({
    invoiceGroupId: id,
    action: "group_evidence_added",
    details: `Evidence collected: ${evidenceTypeName}`,
    metadata: { evidenceId: created.id, evidenceTypeId: evidenceTypeId || null, treeNodeId: treeNodeId || null },
    ...actorFromReq(req),
  });

  emitGroupEvent(id, "group_evidence_added", req);
  res.status(201).json(created);
}));

router.delete("/invoice-groups/:id/evidence/:evidenceId", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const evidenceId = parseInt(String(req.params.evidenceId), 10);
  if (isNaN(id) || isNaN(evidenceId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(claimEvidenceTable)
    .where(and(eq(claimEvidenceTable.id, evidenceId), eq(claimEvidenceTable.invoiceGroupId, id)));

  await db.delete(claimEvidenceTable)
    .where(and(eq(claimEvidenceTable.id, evidenceId), eq(claimEvidenceTable.invoiceGroupId, id)));

  if (existing) {
    await db.insert(auditLogsTable).values({
      invoiceGroupId: id,
      action: "group_evidence_removed",
      details: `Evidence removed: ${existing.evidenceTypeName}`,
      metadata: { evidenceId, evidenceTypeId: existing.evidenceTypeId, treeNodeId: existing.treeNodeId },
      ...actorFromReq(req),
    });
  }

  emitGroupEvent(id, "group_evidence_removed", req);
  res.json({ success: true });
}));

router.delete("/invoice-groups/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const actor = actorFromReq(req);
  await db.insert(auditLogsTable).values({
    invoiceGroupId: id,
    action: "group_deleted",
    details: `Invoice group ${existing.invoiceNumber} deleted`,
    ...actor,
  });

  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  res.sendStatus(204);
}));

router.patch("/invoice-groups/:id/closure-review", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const reason = (existing as any).closureReason as string | null;
  if (!reason || !["cannot_dispute", "non_issue", "denied_by_payor"].includes(reason)) {
    res.status(409).json({ error: "Closure review only applies to closed (withdrawn / non-issue) invoice groups." });
    return;
  }

  const { closureReviewNotes, closureCommunicatedTo, closureReviewState, addressed } = req.body ?? {};
  const updates: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(req.body, "closureReviewNotes")) {
    updates.closureReviewNotes = closureReviewNotes ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "closureCommunicatedTo")) {
    updates.closureCommunicatedTo = closureCommunicatedTo ?? null;
  }

  let stateChange: { from: string | null; to: string | null } | null = null;
  if (typeof addressed === "boolean") {
    if (addressed) {
      const actor = actorFromReq(req);
      updates.closureReviewState = "acknowledged";
      updates.closureAddressedAt = new Date();
      updates.closureAddressedBy = actor.userName;
      updates.closureAddressedByEmail = actor.userEmail;
    } else {
      updates.closureReviewState = "pending";
      updates.closureAddressedAt = null;
      updates.closureAddressedBy = null;
      updates.closureAddressedByEmail = null;
    }
    stateChange = { from: (existing as any).closureReviewState ?? null, to: updates.closureReviewState as string };
  } else if (Object.prototype.hasOwnProperty.call(req.body, "closureReviewState")) {
    if (closureReviewState !== null && !["pending", "acknowledged", "needs_revisit", "resolved"].includes(closureReviewState)) {
      res.status(400).json({ error: "Invalid closureReviewState" });
      return;
    }
    updates.closureReviewState = closureReviewState;
    if (closureReviewState === "acknowledged" || closureReviewState === "resolved") {
      const actor = actorFromReq(req);
      updates.closureAddressedAt = new Date();
      updates.closureAddressedBy = actor.userName;
      updates.closureAddressedByEmail = actor.userEmail;
    } else {
      updates.closureAddressedAt = null;
      updates.closureAddressedBy = null;
      updates.closureAddressedByEmail = null;
    }
    stateChange = { from: (existing as any).closureReviewState ?? null, to: closureReviewState };
  }

  if (Object.keys(updates).length === 0) {
    res.json(existing);
    return;
  }

  const [updated] = await db.update(invoiceGroupsTable).set(updates).where(eq(invoiceGroupsTable.id, id)).returning();

  // Audit-write rules mirror /claims/:id/closure-review — see that handler
  // for why "addressed" gets its own audit action while reopen and notes-only
  // edits use lower-key actions.
  const becameAddressed =
    stateChange != null &&
    stateChange.from !== stateChange.to &&
    (stateChange.to === "acknowledged" || stateChange.to === "resolved");
  if (becameAddressed) {
    await db.insert(auditLogsTable).values({
      invoiceGroupId: id,
      action: "closure_addressed",
      details: "Marked addressed",
      metadata: {
        from: stateChange!.from,
        to: stateChange!.to,
        closureCommunicatedTo: (updates.closureCommunicatedTo ?? (existing as any).closureCommunicatedTo) ?? null,
        closureReviewNotes: (updates.closureReviewNotes ?? (existing as any).closureReviewNotes) ?? null,
      },
      ...actorFromReq(req),
    });
  } else if (stateChange && stateChange.from !== stateChange.to) {
    await db.insert(auditLogsTable).values({
      invoiceGroupId: id,
      action: "closure_review_state_changed",
      details: `Closure review state: ${stateChange.from ?? "pending"} → ${stateChange.to ?? "pending"}`,
      metadata: { from: stateChange.from, to: stateChange.to },
      ...actorFromReq(req),
    });
  } else if (Object.prototype.hasOwnProperty.call(updates, "closureReviewNotes") || Object.prototype.hasOwnProperty.call(updates, "closureCommunicatedTo")) {
    await db.insert(auditLogsTable).values({
      invoiceGroupId: id,
      action: "closure_review_updated",
      details: "Closure review notes / communicated-to updated",
      metadata: {
        closureCommunicatedTo: (updates.closureCommunicatedTo ?? (existing as any).closureCommunicatedTo) ?? null,
        closureReviewNotes: (updates.closureReviewNotes ?? (existing as any).closureReviewNotes) ?? null,
      },
      ...actorFromReq(req),
    });
  }

  emitGroupEvent(id, "group_edited", req);
  res.json(updated);
}));

// Live counter for the "Responses Awaiting Review" sidebar badge. Counts
// invoice groups that have already been classified (errorTypeId is set) but
// are still in Needs Review — i.e., a payor response landed and a human
// verdict is still owed. Stage-1 unclassified items deliberately don't
// count; those belong to the Classification Inbox surface. Lives under
// /responses/... so the path mirrors the page route and so it doesn't
// collide with the existing /invoice-groups/:id parametric routes.
router.get("/responses/awaiting-review/count", asyncHandler(async (_req, res): Promise<void> => {
  const [row] = await db
    .select({ value: count() })
    .from(invoiceGroupsTable)
    .where(and(
      eq(invoiceGroupsTable.status, "Needs Review"),
      isNotNull(invoiceGroupsTable.errorTypeId),
      ne(invoiceGroupsTable.errorTypeId, ""),
    ));

  const masResult = await db.execute(sql`
    select count(distinct g.id)::int as count
    from invoice_groups g
    where (
      (g.reattest_required = true and g.reattest_completed_at is null)
      or exists (
        select 1
        from claims c
        where c.invoice_group_id = g.id
          and c.mas_action_required = 'cancel'
          and c.mas_action_completed_at is null
      )
    )
  `);
  const masRow = (masResult.rows?.[0] ?? {}) as { count?: number };

  res.json({
    count: row?.value ?? 0,
    masActionCount: masRow.count ?? 0,
  });
}));

// Per-invoice (group-level) state-machine endpoints (Task #196). Same
// shape as the per-leg endpoints: source-state contract → 409, discrete
// writes, audit_logs + state_events, refresh derived fields.

async function loadGroupOr404(id: number, res: any): Promise<typeof invoiceGroupsTable.$inferSelect | null> {
  const [g] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!g) { res.status(404).json({ error: "Invoice group not found" }); return null; }
  return g;
}

async function createGroupAuditLog(
  invoiceGroupId: number,
  action: string,
  details: string,
  req: Request,
  metadata?: Record<string, unknown>,
) {
  await db.insert(auditLogsTable).values({
    invoiceGroupId,
    action,
    details,
    metadata: metadata ?? null,
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? null,
  });
}


// POST /invoice-groups/:id/group-context — operator records the group-level
// "what's going on with this invoice" narrative used by the dispute write-
// up. Pre-submit only.
router.post("/invoice-groups/:id/group-context", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const context = (req.body?.context ?? "") as string;
  if (typeof context !== "string") { res.status(400).json({ error: "context must be a string" }); return; }

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  const phase = getMacroPhase(group.status);
  if (phase !== "pre-submit") {
    res.status(409).json({
      error: "Group context can only be set in pre-submit",
      expectedState: "pre-submit",
      actualState: phase,
    });
    return;
  }

  const [updated] = await db
    .update(invoiceGroupsTable)
    .set({ groupContext: context })
    .where(eq(invoiceGroupsTable.id, id))
    .returning();

  await createGroupAuditLog(id, "group_context_set", "Group context recorded", req, {
    contextLength: context.length,
  });
  await emitStateEvent({
    eventKey: "group.context_set",
    invoiceGroupId: id,
    actorUserId: req.user?.email ?? null,
    metadata: { contextLength: context.length },
  });
  emitGroupEvent(id, "group_context_set", req);
  res.json(updated);
}));

// POST /invoice-groups/:id/understanding-readback — operator confirms the
// "this is what I'm asking for" sentence before generating the preview.
// Source-state: pre-submit AND every disputed leg is resolved.
router.post("/invoice-groups/:id/understanding-readback", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const readback = (req.body?.readback ?? "") as string;
  if (!readback || typeof readback !== "string") {
    res.status(400).json({ error: "readback is required" });
    return;
  }

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  const phase = getMacroPhase(group.status);
  if (phase !== "pre-submit") {
    res.status(409).json({
      error: "Readback can only be confirmed in pre-submit",
      expectedState: "pre-submit",
      actualState: phase,
    });
    return;
  }

  const { ok, unresolved } = await allDisputedLegsResolved(id);
  if (!ok) {
    res.status(409).json({
      error: "Not all disputed legs are resolved",
      expectedState: "all-legs-resolved",
      actualState: `${unresolved}-unresolved`,
    });
    return;
  }

  const now = new Date();
  const [updated] = await db
    .update(invoiceGroupsTable)
    .set({
      understandingReadback: readback,
      understandingReadbackAt: now,
      understandingReadbackBy: req.user?.email ?? null,
    })
    .where(eq(invoiceGroupsTable.id, id))
    .returning();

  await createGroupAuditLog(id, "group_readback_confirmed", "Understanding readback confirmed", req, {
    readbackLength: readback.length,
  });
  await emitStateEvent({
    eventKey: "group.readback_confirmed",
    invoiceGroupId: id,
    actorUserId: req.user?.email ?? null,
    metadata: { readbackLength: readback.length },
  });
  emitGroupEvent(id, "readback_confirmed", req);
  res.json(updated);
}));

// POST /invoice-groups/:id/preview-generated — stamps that the operator
// has reviewed a preview. Does NOT transition the group. The transition
// happens on POST /portal-submissions. Source-state: pre-submit AND
// readback confirmed AND all legs resolved. Body is empty; the
// timestamp/identity come from the request.
router.post("/invoice-groups/:id/preview-generated", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  const phase = getMacroPhase(group.status);
  if (phase !== "pre-submit") {
    res.status(409).json({
      error: "Preview can only be generated in pre-submit",
      expectedState: "pre-submit",
      actualState: phase,
    });
    return;
  }
  if (group.understandingReadbackAt == null) {
    res.status(409).json({
      error: "Readback must be confirmed before preview generation",
      expectedState: "readback-confirmed",
      actualState: "no-readback",
    });
    return;
  }
  const { ok, unresolved } = await allDisputedLegsResolved(id);
  if (!ok) {
    res.status(409).json({
      error: "Not all disputed legs are resolved",
      expectedState: "all-legs-resolved",
      actualState: `${unresolved}-unresolved`,
    });
    return;
  }

  const now = new Date();
  const [updated] = await db
    .update(invoiceGroupsTable)
    .set({
      previewGeneratedAt: now,
      previewGeneratedBy: req.user?.email ?? null,
    })
    .where(eq(invoiceGroupsTable.id, id))
    .returning();

  await createGroupAuditLog(id, "group_preview_generated", "Dispute preview generated", req);
  await emitStateEvent({
    eventKey: "group.preview_generated",
    invoiceGroupId: id,
    actorUserId: req.user?.email ?? null,
    metadata: {},
  });
  emitGroupEvent(id, "preview_generated", req);
  res.json(updated);
}));

// POST /invoice-groups/:id/reattest/complete — stamps the group's MAS
// re-attest as complete and engages the attestation gate. Pre: phase
// is mas-action-required AND every leg with mas_action_required='cancel'
// has been completed.
router.post("/invoice-groups/:id/reattest/complete", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const note = (req.body?.note ?? null) as string | null;
  const masReference = (req.body?.masReference ?? null) as string | null;

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  // Source-state contract: the group must be in the
  // `mas-action-required` derived macro phase. The phase is computed
  // from {status, reattestRequired, reattestCompletedAt} — see
  // getGroupMacroPhase. Enforcing the phase (rather than the raw
  // `reattest_required` bit) keeps the contract honest if we later add
  // intermediate phases between response-pending and reattest.
  const phase = getGroupMacroPhase(group);
  if (phase !== "mas-action-required") {
    res.status(409).json({
      error: "Group is not in the mas-action-required phase",
      expectedState: "mas-action-required",
      actualState: phase,
    });
    return;
  }

  // Every leg owing a MAS cancel must have completed it first.
  const incompleteCancels = await db
    .select({ id: claimsTable.id })
    .from(claimsTable)
    .where(and(
      eq(claimsTable.invoiceGroupId, id),
      eq(claimsTable.masActionRequired, "cancel"),
      isNull(claimsTable.masActionCompletedAt),
    ));
  if (incompleteCancels.length > 0) {
    res.status(409).json({
      error: "Not all MAS cancel actions are complete",
      expectedState: "all-cancels-complete",
      actualState: `${incompleteCancels.length}-incomplete`,
    });
    return;
  }

  const now = new Date();
  const fullNote = masReference ? `${note ? note + " " : ""}(MAS ref: ${masReference})` : note;
  const [updated] = await db
    .update(invoiceGroupsTable)
    .set({
      reattestCompletedAt: now,
      reattestCompletedBy: req.user?.email ?? null,
      reattestNote: fullNote,
    })
    .where(eq(invoiceGroupsTable.id, id))
    .returning();

  await createGroupAuditLog(id, "mas_reattest_completed", "MAS re-attest completed", req, { note, masReference });
  await emitStateEvent({
    eventKey: "group.reattest_completed",
    invoiceGroupId: id,
    actorUserId: req.user?.email ?? null,
    metadata: { note, masReference },
  });

  // Trigger gate: graduate any leg with an operator-confirmed
  // Approved/Partial verdict from not_required → pending.
  const legs = await db.select().from(claimsTable).where(eq(claimsTable.invoiceGroupId, id));
  for (const leg of legs) {
    const [latestVerdict] = await db
      .select({ outcome: claimVerdictTable.outcome, source: claimVerdictTable.source })
      .from(claimVerdictTable)
      .where(eq(claimVerdictTable.claimId, leg.id))
      .orderBy(desc(claimVerdictTable.createdAt))
      .limit(1);
    if (
      latestVerdict &&
      latestVerdict.source === "operator_confirmed" &&
      (latestVerdict.outcome === "Approved" || latestVerdict.outcome === "Partial")
    ) {
      const delta = computeAttestationDelta(
        "Pending",
        leg.outcome === "Approved" || leg.outcome === "Partially Approved" ? leg.outcome : "Approved",
        { reattestCompletedAt: now },
      );
      if (Object.keys(delta).length > 0 && leg.attestationState === "not_required") {
        await db.update(claimsTable).set(delta).where(eq(claimsTable.id, leg.id));
      }
    }
  }

  await refreshGroupDerivedFields(id);
  emitGroupEvent(id, "reattest_completed", req);
  res.json(updated);
}));

export default router;

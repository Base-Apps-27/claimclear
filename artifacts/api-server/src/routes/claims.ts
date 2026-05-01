import { Router, type IRouter, type Request } from "express";
import { eq, or, ilike, desc, asc, and, count, inArray, isNull, isNotNull, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, auditLogsTable, notesTable, errorTypesTable, portalSubmissionsTable, portalResponsesTable, claimVerdictTable, invoiceGroupsTable, LEG_HOLD_REASONS, LEG_EXCLUSION_REASONS, VERDICT_OUTCOMES } from "@workspace/db";
import { deriveLegSubStatus, type LegSubStatus } from "@workspace/leg-state";
import { asyncHandler } from "../lib/asyncHandler";
import { broadcastClaimEvent } from "../lib/sse";
import {
  transitionClaimStatus,
  transitionClaimOutcome,
  transitionClaimStatusAndOutcome,
  VALID_MANUAL_STATUS_TRANSITIONS,
  VALID_OUTCOME_BY_STATUS,
  SYSTEM_CONTROLLED_STATUSES,
  excludeLegCore,
} from "../lib/claim-transitions";
import { transitionGroupStatus } from "../lib/group-transitions";
import { emitStateEvent } from "../lib/state-events";
import { refreshClaimDenormalizedCache, refreshGroupDerivedFields } from "../lib/denormalized-cache";
import { applyMasDerivationsForLeg } from "../lib/mas-derivations";
import { getMacroPhase, getGroupMacroPhase } from "../lib/macro-phase";
import { computeAttestationDelta } from "../lib/attestation";
import { parseClosurePayload, ClosureValidationError, type NormalizedClosure, CLOSURE_DETAIL_FIELDS } from "../lib/closure-validation";
import { buildClaimExpiringCondition, parseExpiringMode } from "../lib/expiring-filter";
import { effectiveDaysRemaining, isUrgentDeadline } from "../lib/dates";
import { CLAIM_EXPIRING_ACTIONABLE_STATUSES } from "./dashboard";

// A claim is only "on the 30-day clock" while its status is one we still
// owe action on. Once it's filed (Awaiting Response) or otherwise
// terminal, the urgency signal stops applying, even if the calendar
// deadline has slipped. Includes `Portal Queued` and `Processed` because
// stuck claims in those states still escalate against the 30-day clock —
// see the rule in dashboard.ts.
const CLAIM_ON_CLOCK_STATUSES = new Set<string>(CLAIM_EXPIRING_ACTIONABLE_STATUSES);

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

async function createAuditLog(claimId: number, action: string, details: string, req: Request, metadata?: Record<string, unknown>) {
  const userEmail = req.user?.email ?? null;
  const userName = req.user?.displayName ?? null;
  await db.insert(auditLogsTable).values({
    claimId,
    action,
    details,
    metadata: metadata ?? null,
    userEmail,
    userName,
  });
}

function emitClaimEvent(claimId: number, type: string, req: Request) {
  broadcastClaimEvent({
    type,
    claimId,
    userName: req.user?.displayName ?? null,
    userEmail: req.user?.email ?? null,
    timestamp: new Date().toISOString(),
  });
}

function actorFromReq(req: Request) {
  return {
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? null,
  };
}

const CLAIMS_SORTABLE_COLUMNS = {
  confNumber: claimsTable.confNumber,
  date: claimsTable.date,
  clientNumber: claimsTable.clientNumber,
  errorTypeName: claimsTable.errorTypeName,
  claimAmount: sql`${claimsTable.claimAmount}::numeric`,
  status: claimsTable.status,
  createdAt: claimsTable.createdAt,
} as const;

function buildClaimsWhere(query: Record<string, unknown>): SQL | undefined {
  const { status, outcome, search, errorTypeId } = query;
  const createdFrom = query.createdFrom as string | undefined;
  const createdTo = query.createdTo as string | undefined;
  const amountMin = query.amountMin as string | undefined;
  const amountMax = query.amountMax as string | undefined;
  const serviceDateFrom = query.serviceDateFrom as string | undefined;
  const serviceDateTo = query.serviceDateTo as string | undefined;
  const carNumber = query.carNumber as string | undefined;
  const clientNumber = query.clientNumber as string | undefined;

  const conditions: SQL[] = [];

  if (status && typeof status === "string") {
    const statuses = status.split(",").map(s => s.trim()).filter(Boolean) as (typeof claimsTable.status.enumValues)[number][];
    if (statuses.length === 1) {
      conditions.push(eq(claimsTable.status, statuses[0]));
    } else if (statuses.length > 1) {
      const statusOr = or(...statuses.map(s => eq(claimsTable.status, s)));
      if (statusOr) conditions.push(statusOr);
    }
  }

  if (outcome && typeof outcome === "string") {
    const outcomes = outcome.split(",").map(o => o.trim()).filter(Boolean) as (typeof claimsTable.outcome.enumValues)[number][];
    if (outcomes.length === 1) {
      conditions.push(eq(claimsTable.outcome, outcomes[0]));
    } else if (outcomes.length > 1) {
      const outcomeOr = or(...outcomes.map(o => eq(claimsTable.outcome, o)));
      if (outcomeOr) conditions.push(outcomeOr);
    }
  }

  if (errorTypeId && typeof errorTypeId === "string") {
    const parts = errorTypeId.split(",").map(p => p.trim()).filter(Boolean);
    const hasUnassigned = parts.includes("__unassigned__");
    const ids = parts.filter(p => p !== "__unassigned__");
    const orParts: SQL[] = [];
    if (hasUnassigned) {
      const unassignedOr = or(isNull(claimsTable.errorTypeId), eq(claimsTable.errorTypeId, ""));
      if (unassignedOr) orParts.push(unassignedOr);
    }
    if (ids.length > 0) {
      orParts.push(inArray(claimsTable.errorTypeId, ids));
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
      ilike(claimsTable.confNumber, searchPattern),
      ilike(claimsTable.refNumber, searchPattern),
      ilike(claimsTable.clientNumber, searchPattern),
      ilike(claimsTable.errorDetails, searchPattern),
    );
    if (searchOr) conditions.push(searchOr);
  }

  if (createdFrom) {
    conditions.push(gte(claimsTable.createdAt, new Date(createdFrom)));
  }
  if (createdTo) {
    const toDate = new Date(createdTo);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(claimsTable.createdAt, toDate));
  }
  if (amountMin) {
    conditions.push(gte(sql`${claimsTable.claimAmount}::numeric`, sql`${amountMin}::numeric`));
  }
  if (amountMax) {
    conditions.push(lte(sql`${claimsTable.claimAmount}::numeric`, sql`${amountMax}::numeric`));
  }
  if (serviceDateFrom) {
    conditions.push(gte(claimsTable.date, serviceDateFrom));
  }
  if (serviceDateTo) {
    conditions.push(lte(claimsTable.date, serviceDateTo));
  }
  if (carNumber && typeof carNumber === "string") {
    conditions.push(eq(claimsTable.carNumber, carNumber));
  }
  if (clientNumber && typeof clientNumber === "string") {
    conditions.push(eq(claimsTable.clientNumber, clientNumber));
  }

  const expiringMode = parseExpiringMode(query.expiring);
  if (expiringMode) {
    conditions.push(buildClaimExpiringCondition(expiringMode));
  }

  const legSubStatus = query.legSubStatus;
  if (legSubStatus && typeof legSubStatus === "string") {
    const subStatuses = legSubStatus.split(",").map(s => s.trim()).filter(Boolean);
    const subStatusOrs: SQL[] = [];
    for (const sub of subStatuses) {
      const cond = buildLegSubStatusCondition(sub);
      if (cond) subStatusOrs.push(cond);
    }
    if (subStatusOrs.length === 1) {
      conditions.push(subStatusOrs[0]);
    } else if (subStatusOrs.length > 1) {
      const combined = or(...subStatusOrs);
      if (combined) conditions.push(combined);
    }
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

// Mirror of `deriveLegSubStatus`, expressed as drizzle conditions so we
// can filter the claims list server-side. `frozen` is the one filter that
// bypasses the leg's own state — it asks "does this leg's parent group
// live past pre-submit?" — and is therefore expressed as an EXISTS subquery
// against `invoice_groups`.
function buildLegSubStatusCondition(sub: string): SQL | null {
  const notExcluded = or(
    isNull(claimsTable.includedInDispute),
    eq(claimsTable.includedInDispute, true),
  )!;
  const hasErrorType = and(
    isNotNull(claimsTable.errorTypeId),
    sql`${claimsTable.errorTypeId} <> ''`,
  )!;
  const noHold = and(
    isNull(claimsTable.holdReason),
    or(isNull(claimsTable.sopOutcome), sql`${claimsTable.sopOutcome} <> 'hold'`)!,
  )!;
  switch (sub) {
    case "excluded":
      return eq(claimsTable.includedInDispute, false);
    case "needs_classification":
      return and(
        notExcluded,
        or(isNull(claimsTable.errorTypeId), eq(claimsTable.errorTypeId, ""))!,
      )!;
    case "blocked":
      return and(
        notExcluded,
        hasErrorType,
        or(isNotNull(claimsTable.holdReason), eq(claimsTable.sopOutcome, "hold"))!,
      )!;
    case "investigating":
      return and(
        notExcluded,
        hasErrorType,
        noHold,
        isNull(claimsTable.sopOutcome),
      )!;
    case "ready":
      return and(
        notExcluded,
        hasErrorType,
        noHold,
        inArray(claimsTable.sopOutcome, ["portal_dispute", "dispute"]),
      )!;
    case "dropped":
      return and(
        notExcluded,
        hasErrorType,
        noHold,
        inArray(claimsTable.sopOutcome, ["cannot_dispute", "non_issue"]),
      )!;
    case "frozen":
      // Past-pre-submit parent: anything other than the two pre-submit
      // statuses qualifies, including On Hold, Portal Queued, Awaiting
      // Response, Resolved, etc.
      return sql`EXISTS (SELECT 1 FROM ${invoiceGroupsTable} ig WHERE ig.id = ${claimsTable.invoiceGroupId} AND ig.status NOT IN ('New', 'Needs Evidence'))`;
    default:
      return null;
  }
}

// Default sort = service date ascending (oldest first), so the rows closest to
// their 30-day filing deadline rise to the top. We push NULLs last so claims
// missing a service date don't squat at the front of the list, and we tiebreak
// by createdAt desc to keep newest imports above older ones with the same date.
function buildClaimsOrderBy(sortCol: string | undefined, sortDir: string | undefined): SQL[] {
  if (sortCol && sortCol in CLAIMS_SORTABLE_COLUMNS) {
    const col = CLAIMS_SORTABLE_COLUMNS[sortCol as keyof typeof CLAIMS_SORTABLE_COLUMNS];
    const dirFn = sortDir === "asc" ? asc : desc;
    return [dirFn(col)];
  }
  return [
    sql`${claimsTable.date} ASC NULLS LAST`,
    desc(claimsTable.createdAt),
  ];
}

router.get("/claims", asyncHandler(async (req, res): Promise<void> => {
  const { limit: limitStr, offset: offsetStr, sort, dir } = req.query;
  const limitVal = Math.min(parseInt(String(limitStr || "50"), 10), 500);
  const offsetVal = parseInt(String(offsetStr || "0"), 10);

  const where = buildClaimsWhere(req.query as Record<string, unknown>);
  const orderBy = buildClaimsOrderBy(sort as string, dir as string);

  const [totalResult] = await db.select({ count: count() }).from(claimsTable).where(where);
  const claimsRaw = await db.select().from(claimsTable).where(where)
    .orderBy(...orderBy)
    .limit(limitVal)
    .offset(offsetVal);

  const today = new Date();
  const claims = claimsRaw.map(claim => ({
    ...claim,
    effectiveDaysLeft: effectiveDaysRemaining(claim.date, today),
    // Status-aware: only flag as urgent if we still owe action.
    isUrgent: CLAIM_ON_CLOCK_STATUSES.has(claim.status) && isUrgentDeadline(claim.date, today),
  }));

  res.json({ claims, total: totalResult.count });
}));

router.get("/claims/export-csv", asyncHandler(async (req, res): Promise<void> => {
  const { sort, dir, columns: columnsParam } = req.query;
  const where = buildClaimsWhere(req.query as Record<string, unknown>);
  const orderBy = buildClaimsOrderBy(sort as string, dir as string);

  const claims = await db.select().from(claimsTable).where(where).orderBy(...orderBy);

  const requestedColumns = typeof columnsParam === "string" ? columnsParam.split(",").map(c => c.trim()) : null;

  const allColumns = [
    { key: "confNumber", label: "Conf #" },
    { key: "date", label: "Service Date" },
    { key: "clientNumber", label: "Client" },
    { key: "errorDetails", label: "Error Description" },
    { key: "errorTypeName", label: "Error Type" },
    { key: "claimAmount", label: "Amount" },
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
  const rows = claims.map(claim => {
    const row = cols.map(c => csvCell((claim as Record<string, unknown>)[c.key]));
    return row.join(",");
  });

  const today = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="claims-${today}.csv"`);
  res.send([header, ...rows].join("\r\n"));
}));

router.post("/claims", asyncHandler(async (req, res): Promise<void> => {
  const body = req.body;
  if (!body.confNumber) {
    res.status(400).json({ error: "confNumber is required" });
    return;
  }

  const [claim] = await db.insert(claimsTable).values({
    confNumber: body.confNumber,
    date: body.date || null,
    refNumber: body.refNumber || null,
    clientNumber: body.clientNumber || null,
    carNumber: body.carNumber || null,
    errorDetails: body.errorDetails || null,
    errorTypeId: body.errorTypeId || null,
    errorTypeName: body.errorTypeName || null,
    claimAmount: body.claimAmount || null,
    payorEmail: body.payorEmail || null,
  }).returning();

  await createAuditLog(claim.id, "claim_created", `Claim ${claim.confNumber} created`, req);
  emitClaimEvent(claim.id, "claim_created", req);
  res.status(201).json(claim);
}));

// Re-attestation queue list. Registered ahead of `/claims/:id` so the
// literal "attestation-pending" segment isn't swallowed by the parametric
// route (Express routes match in registration order). Filters by the
// caller-supplied `state` (pending | queued | completed) and only ever
// returns claims that have an Approved-family outcome — anything else
// implies attestationState=not_required.
router.get("/claims/attestation-pending", asyncHandler(async (req, res): Promise<void> => {
  const stateRaw = typeof req.query.state === "string" ? req.query.state : "queued";
  if (!["pending", "queued", "completed"].includes(stateRaw)) {
    res.status(400).json({ error: "state must be one of pending | queued | completed" });
    return;
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);

  const rows = await db
    .select()
    .from(claimsTable)
    .where(and(
      eq(claimsTable.attestationState, stateRaw),
      inArray(claimsTable.outcome, ["Approved", "Partially Approved"]),
    ))
    .orderBy(asc(claimsTable.attestationQueuedAt), asc(claimsTable.id))
    .limit(limit);

  // Build the per-claim "extras" payload that the queue review pane needs:
  // when the verdict was recorded (latest outcome_changed audit) and the
  // most recent payor response (portal/email). Both are looked up in two
  // batched queries instead of N+1, then collapsed in JS.
  const ids = rows.map((r) => r.id);
  const extras: Record<string, {
    verdictRecordedAt: string | null;
    lastResponseAt: string | null;
    lastResponseSubject: string | null;
    lastResponseSource: "email" | "portal" | "manual" | null;
  }> = {};
  for (const r of rows) {
    extras[String(r.id)] = {
      verdictRecordedAt: null,
      lastResponseAt: null,
      lastResponseSubject: null,
      lastResponseSource: null,
    };
  }
  if (ids.length > 0) {
    const [verdictLogs, lastResponses] = await Promise.all([
      db.select({
        claimId: auditLogsTable.claimId,
        timestamp: auditLogsTable.timestamp,
      }).from(auditLogsTable)
        .where(and(
          inArray(auditLogsTable.claimId, ids),
          inArray(auditLogsTable.action, ["outcome_changed", "claim_outcome_changed"]),
        ))
        .orderBy(desc(auditLogsTable.timestamp)),
      db.select({
        claimId: portalResponsesTable.claimId,
        createdAt: portalResponsesTable.createdAt,
        subject: portalResponsesTable.subject,
        source: portalResponsesTable.source,
      }).from(portalResponsesTable)
        .where(inArray(portalResponsesTable.claimId, ids))
        .orderBy(desc(portalResponsesTable.createdAt)),
    ]);
    // Both result sets are sorted desc, so the first hit per claimId wins.
    for (const log of verdictLogs) {
      if (log.claimId == null) continue;
      const key = String(log.claimId);
      if (extras[key] && extras[key].verdictRecordedAt == null) {
        extras[key].verdictRecordedAt = log.timestamp ? new Date(log.timestamp).toISOString() : null;
      }
    }
    for (const r of lastResponses) {
      if (r.claimId == null) continue;
      const key = String(r.claimId);
      if (extras[key] && extras[key].lastResponseAt == null) {
        extras[key].lastResponseAt = r.createdAt ? new Date(r.createdAt).toISOString() : null;
        extras[key].lastResponseSubject = r.subject ?? null;
        extras[key].lastResponseSource = (r.source as "email" | "portal" | "manual" | null) ?? null;
      }
    }
  }

  res.json({ claims: rows, extras });
}));

router.get("/claims/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  res.json(claim);
}));

router.patch("/claims/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updateData: Partial<typeof claimsTable.$inferInsert> = {};
  const allowedFields = ["confNumber", "date", "refNumber", "clientNumber", "carNumber", "errorDetails",
    "errorTypeId", "errorTypeName", "claimAmount", "payorEmail", "invoiceNumbers", "evidenceNotes",
    "evidenceFiles", "evidenceChecklist"] as const;
  for (const f of allowedFields) {
    if (req.body[f] !== undefined) {
      (updateData as Record<string, unknown>)[f] = req.body[f];
    }
  }

  const [previous] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!previous) { res.status(404).json({ error: "Claim not found" }); return; }

  // Atomic block: row edit + claim_edited audit + (when applicable) the
  // auto_after_classify status transition all run in one drizzle
  // transaction. If anything inside throws, the whole patch rolls back so
  // we never leave the row updated without its audit trail or the audit
  // written without the row update.
  const { saved, advanced } = await db.transaction(async (tx) => {
    const [updated] = await tx.update(claimsTable).set(updateData).where(eq(claimsTable.id, id)).returning();
    if (!updated) throw new Error("Claim not found");

    await tx.insert(auditLogsTable).values({
      claimId: id,
      action: "claim_edited",
      details: `Claim ${updated.confNumber} updated`,
      metadata: { fields: Object.keys(updateData) },
      userEmail: req.user?.email ?? null,
      userName: req.user?.displayName ?? null,
    });

    // Auto-advance: when staff classifies a New / Needs Review claim by
    // setting an errorTypeId for the first time, push it to "Needs Evidence"
    // so the workflow keeps moving without an extra click.
    const becameClassified =
      Object.prototype.hasOwnProperty.call(updateData, "errorTypeId") &&
      typeof updated.errorTypeId === "string" && updated.errorTypeId.length > 0 &&
      (previous.errorTypeId === null || previous.errorTypeId === "") &&
      (previous.status === "New" || previous.status === "Needs Review");

    if (becameClassified) {
      const result = await transitionClaimStatus({
        claimId: id,
        newStatus: "Needs Evidence",
        source: "auto_after_classify",
        reason: `Auto-advanced after error type classified (${updated.errorTypeName ?? updated.errorTypeId})`,
        actor: actorFromReq(req),
        systemOverride: true,
        executor: tx,
      });
      return { saved: updated, advanced: result.claim };
    }

    return { saved: updated, advanced: null as typeof updated | null };
  });

  emitClaimEvent(id, "claim_edited", req);
  res.json(advanced ?? saved);
}));

router.delete("/claims/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Claim not found" }); return; }

  await createAuditLog(id, "claim_deleted", `Claim ${existing.confNumber} deleted`, req);
  emitClaimEvent(id, "claim_deleted", req);
  await db.delete(claimsTable).where(eq(claimsTable.id, id));
  res.sendStatus(204);
}));

router.get("/claims/valid-transitions/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  // Submissions are now invoice-group-scoped, so we look up "is anything in
  // flight on this claim's parent group?" via claim.invoiceGroupId. Standalone
  // legs (no group) cannot have submissions.
  const activeSubmissions = claim.invoiceGroupId
    ? await db.select({ id: portalSubmissionsTable.id }).from(portalSubmissionsTable)
        .where(and(
          eq(portalSubmissionsTable.invoiceGroupId, claim.invoiceGroupId),
          inArray(portalSubmissionsTable.status, ["pending", "in_progress"])
        ))
    : [];

  const allSubmissions = claim.invoiceGroupId
    ? await db.select({ id: portalSubmissionsTable.id })
        .from(portalSubmissionsTable)
        .where(eq(portalSubmissionsTable.invoiceGroupId, claim.invoiceGroupId))
        .limit(1)
    : [];
  const hasBeenSubmitted = allSubmissions.length > 0;

  const validStatuses = activeSubmissions.length > 0 ? [] : (VALID_MANUAL_STATUS_TRANSITIONS[claim.status] || []);

  const validOutcomes: string[] = [];
  if (activeSubmissions.length === 0) {
    const allowed = VALID_OUTCOME_BY_STATUS[claim.status] || [];
    for (const o of allowed) {
      if (!validOutcomes.includes(o)) validOutcomes.push(o);
    }
  }

  const responses = await db.select({
    id: portalResponsesTable.id,
    responseType: portalResponsesTable.responseType,
    processed: portalResponsesTable.processed,
  }).from(portalResponsesTable)
    .where(eq(portalResponsesTable.claimId, id))
    .orderBy(desc(portalResponsesTable.createdAt));

  const hasResponses = responses.length > 0;
  const latestResponseType = hasResponses ? responses[0].responseType : null;

  const positiveTypes = ["approval", "partial_approval"];
  const negativeTypes = ["denial"];
  const isPositive = latestResponseType ? positiveTypes.includes(latestResponseType) : false;
  const isNegative = latestResponseType ? negativeTypes.includes(latestResponseType) : false;

  let postResponseActions: string[] = [];
  if (hasResponses && claim.status === "Needs Review") {
    if (isPositive) {
      postResponseActions = ["resolve_reattest", "resolve_new_invoice"];
    } else if (isNegative) {
      postResponseActions = ["mark_denied_by_payor", "re_dispute"];
    } else {
      postResponseActions = ["resolve_reattest", "resolve_new_invoice", "mark_denied_by_payor", "re_dispute"];
    }
  }

  res.json({
    currentStatus: claim.status,
    currentOutcome: claim.outcome,
    validStatuses,
    validOutcomes,
    hasActiveSubmission: activeSubmissions.length > 0,
    canQueueForPortal: !activeSubmissions.length && ["Needs Evidence", "Needs Review", "New"].includes(claim.status),
    hasBeenSubmitted,
    postResponseActions,
    latestResponseType,
    hasResponse: hasResponses,
  });
}));

router.patch("/claims/:id/status", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { status, _systemOverride } = req.body;
  if (!status) { res.status(400).json({ error: "status is required" }); return; }

  try {
    const result = await transitionClaimStatus({
      claimId: id,
      newStatus: status,
      source: "manual",
      reason: `Manual status change by user`,
      actor: actorFromReq(req),
      systemOverride: _systemOverride,
    });
    res.json(result.claim);
  } catch (err: any) {
    const msg = err.message || "Failed to change status";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    if (msg.includes("in progress")) { res.status(409).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.patch("/claims/:id/outcome", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { outcome, approvedAmount, invoiceNumbers, closureReason, _systemOverride } = req.body;
  if (!outcome) { res.status(400).json({ error: "outcome is required" }); return; }

  if (outcome === "Denied" && closureReason !== undefined && closureReason !== "denied_by_payor") {
    res.status(400).json({ error: `Denied outcome implies closureReason=denied_by_payor; pass Withdrawn for staff-initiated closures.` });
    return;
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
      const result = await transitionClaimStatusAndOutcome({
        claimId: id,
        newStatus,
        newOutcome: outcome,
        source: "manual",
        reason: `Manual outcome change by user`,
        actor: actorFromReq(req),
        extraFields: approvedAmount !== undefined
          ? { approvedAmount: approvedAmount === "" ? null : String(approvedAmount), ...(invoiceNumbers !== undefined ? { invoiceNumbers } : {}) }
          : (invoiceNumbers !== undefined ? { invoiceNumbers } : undefined),
        closureReason: effectiveReason ?? closureReason,
        closure,
      });
      res.json(result.claim);
      return;
    }

    const result = await transitionClaimOutcome({
      claimId: id,
      newOutcome: outcome,
      source: "manual",
      reason: `Manual outcome change by user`,
      actor: actorFromReq(req),
      systemOverride: _systemOverride,
      approvedAmount,
      invoiceNumbers,
      closureReason: effectiveReason ?? closureReason,
      closure,
    });
    res.json(result.claim);
  } catch (err: any) {
    const msg = err.message || "Failed to change outcome";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    if (msg.includes("in progress")) { res.status(409).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

// --- Re-attestation tracking ---------------------------------------------
// Three POST endpoints share the same idea: confirm or queue an off-system
// re-attestation in the payor portal. They differ only in (a) the resulting
// state and (b) the audit-log action key, so a reviewer can distinguish
// "attested at the moment of verdict" from "attested after the queue
// review" later. Auth is via the existing app middleware — no role gating
// (per task spec, accountability is preserved through the audit log).
type AttestActionKey =
  | "attestation_self_confirmed"
  | "attestation_queued"
  | "attestation_queue_confirmed";

// Per-action source-state contract. Each endpoint must only fire from the
// state it's meant to advance, otherwise the audit story (self-confirmed
// vs queue-confirmed) drifts from reality. Cross-state misuse → 409.
const ALLOWED_SOURCE_STATES: Record<AttestActionKey, ReadonlyArray<string>> = {
  attestation_self_confirmed: ["pending"],
  attestation_queued: ["pending"],
  attestation_queue_confirmed: ["queued"],
};

async function applyAttestationAction(opts: {
  claimId: number;
  action: AttestActionKey;
  note: string | null;
  req: Request;
}) {
  const { claimId, action, note, req } = opts;
  const [old] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!old) return { status: 404 as const, body: { error: "Claim not found" } };
  if (old.outcome !== "Approved" && old.outcome !== "Partially Approved") {
    return {
      status: 409 as const,
      body: { error: `Attestation is only meaningful for an Approved verdict. Current outcome is ${old.outcome}.` },
    };
  }
  if (old.attestationState === "completed") {
    return {
      status: 409 as const,
      body: { error: "This claim has already been marked as attested. Re-attestation is not reversible in v1." },
    };
  }
  const allowed = ALLOWED_SOURCE_STATES[action];
  if (!allowed.includes(old.attestationState)) {
    // Map each action to a user-readable description of where it can fire
    // from, so the 409 message helps the operator pick the right endpoint
    // instead of guessing.
    const expected = action === "attestation_queue_confirmed"
      ? "queued (use the queue-review confirm flow)"
      : action === "attestation_queued"
        ? "pending (the claim must be freshly Approved)"
        : "pending (the claim must be freshly Approved)";
    return {
      status: 409 as const,
      body: {
        error: `This endpoint can only be used when attestationState is ${expected}. Current state is "${old.attestationState}".`,
      },
    };
  }

  const actor = actorFromReq(req);
  const actorIdentity = actor.userEmail || actor.userName || "unknown";
  const now = new Date();

  let updateData: Partial<typeof claimsTable.$inferInsert>;
  let newState: "queued" | "completed";
  let detailLine: string;

  if (action === "attestation_queued") {
    newState = "queued";
    updateData = {
      attestationState: "queued",
      attestationQueuedAt: now,
      attestationQueuedBy: actorIdentity,
      attestationNote: note,
    };
    detailLine = `Queued for re-attestation by ${actorIdentity}`;
  } else {
    // Both self-confirm flows resolve to completed; the action key is what
    // distinguishes them in the audit log.
    newState = "completed";
    updateData = {
      attestationState: "completed",
      attestedAt: now,
      attestedBy: actorIdentity,
      attestationNote: note,
    };
    detailLine = action === "attestation_self_confirmed"
      ? `Re-attested in payor portal by ${actorIdentity}`
      : `Queued attestation confirmed by ${actorIdentity}`;
  }

  const [claim] = await db.update(claimsTable).set(updateData).where(eq(claimsTable.id, claimId)).returning();

  await db.insert(auditLogsTable).values({
    claimId,
    action,
    details: note ? `${detailLine} — ${note}` : detailLine,
    metadata: {
      from: old.attestationState,
      to: newState,
      note: note ?? null,
    },
    userEmail: actor.userEmail,
    userName: actor.userName,
  });

  emitClaimEvent(claimId, "attestation_updated", req);
  return { status: 200 as const, body: claim };
}

function parseAttestNote(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

router.post("/claims/:id/attest", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const result = await applyAttestationAction({
    claimId: id,
    action: "attestation_self_confirmed",
    note: parseAttestNote(req.body?.note),
    req,
  });
  res.status(result.status).json(result.body);
}));

router.post("/claims/:id/attest/queue", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const result = await applyAttestationAction({
    claimId: id,
    action: "attestation_queued",
    note: parseAttestNote(req.body?.note),
    req,
  });
  res.status(result.status).json(result.body);
}));

router.post("/claims/:id/attest/confirm", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const result = await applyAttestationAction({
    claimId: id,
    action: "attestation_queue_confirmed",
    note: parseAttestNote(req.body?.note),
    req,
  });
  res.status(result.status).json(result.body);
}));

router.patch("/claims/:id/evidence", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updateData: Partial<typeof claimsTable.$inferInsert> = {};
  if (req.body.evidenceFiles !== undefined) updateData.evidenceFiles = req.body.evidenceFiles;
  if (req.body.evidenceNotes !== undefined) updateData.evidenceNotes = req.body.evidenceNotes;
  if (req.body.evidenceChecklist !== undefined) updateData.evidenceChecklist = req.body.evidenceChecklist;

  const [claim] = await db.update(claimsTable).set(updateData).where(eq(claimsTable.id, id)).returning();
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  await createAuditLog(id, "evidence_submitted", "Evidence updated", req);
  emitClaimEvent(id, "evidence_updated", req);
  res.json(claim);
}));

// Per-leg hold (Task #196). Pre: sub-status ∈ {investigating, ready}.
// Body: { reason: LegHoldReason, note? }. Writes hold_reason +
// hold_placed_at; emits leg.hold_placed.
router.post("/claims/:id/hold", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Backward-compat: accept legacy `holdReason` body alongside new `reason`.
  const reason = (req.body?.reason ?? req.body?.holdReason) as string | undefined;
  const note = (req.body?.note ?? null) as string | null;
  if (!reason) { res.status(400).json({ error: "reason is required" }); return; }
  if (!(LEG_HOLD_REASONS as readonly string[]).includes(reason)) {
    res.status(400).json({ error: `reason must be one of: ${LEG_HOLD_REASONS.join(", ")}` });
    return;
  }

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  const subStatus = deriveLegSubStatus(leg);
  if (subStatus !== "investigating" && subStatus !== "ready") {
    res.status(409).json({
      error: "Cannot place hold from this leg state",
      expectedState: "investigating|ready",
      actualState: subStatus,
    });
    return;
  }

  const placedAtIso = new Date().toISOString();
  const [updated] = await db
    .update(claimsTable)
    .set({
      holdReason: reason,
      holdPlacedAt: placedAtIso,
      // hold_pending_from is a free-text "who are we waiting on" field on
      // the legacy schema; we leave it nullable here. The new sub-status
      // model doesn't require it but accepts an optional `note`.
      holdPendingFrom: note,
    })
    .where(eq(claimsTable.id, id))
    .returning();

  await createAuditLog(id, "leg_hold_placed", `Leg placed on hold: ${reason}`, req, {
    reason,
    note,
    previousSubStatus: subStatus,
  });
  await emitStateEvent({
    eventKey: "leg.hold_placed",
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    metadata: { reason, note },
  });
  await refreshClaimDenormalizedCache(id);
  emitClaimEvent(id, "hold_placed", req);

  res.json(updated);
}));

// Legacy hold-removal endpoint — same DELETE verb, new contract.
// Source-state precondition: leg sub-status is `blocked` AND hold_reason is
// the cause (sopOutcome=='hold' is a separate path resolved by sop-advance,
// not by this endpoint).
router.delete("/claims/:id/hold", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  const subStatus = deriveLegSubStatus(leg);
  if (subStatus !== "blocked" || !leg.holdReason) {
    res.status(409).json({
      error: "Leg is not on hold",
      expectedState: "blocked",
      actualState: subStatus,
    });
    return;
  }

  const [updated] = await db
    .update(claimsTable)
    .set({
      holdReason: null,
      holdPlacedAt: null,
      holdPendingFrom: null,
    })
    .where(eq(claimsTable.id, id))
    .returning();

  await createAuditLog(id, "leg_hold_cleared", "Leg hold cleared", req, {
    previousReason: leg.holdReason,
  });
  await emitStateEvent({
    eventKey: "leg.hold_cleared",
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    metadata: { previousReason: leg.holdReason },
  });
  await refreshClaimDenormalizedCache(id);
  emitClaimEvent(id, "hold_cleared", req);

  res.json(updated);
}));

// POST alias for DELETE /claims/:id/hold (same contract).
router.post("/claims/:id/clear-hold", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  const subStatus = deriveLegSubStatus(leg);
  if (subStatus !== "blocked" || !leg.holdReason) {
    res.status(409).json({
      error: "Leg is not on hold",
      expectedState: "blocked",
      actualState: subStatus,
    });
    return;
  }

  const [updated] = await db
    .update(claimsTable)
    .set({ holdReason: null, holdPlacedAt: null, holdPendingFrom: null })
    .where(eq(claimsTable.id, id))
    .returning();

  await createAuditLog(id, "leg_hold_cleared", "Leg hold cleared", req, { previousReason: leg.holdReason });
  await emitStateEvent({
    eventKey: "leg.hold_cleared",
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    metadata: { previousReason: leg.holdReason },
  });
  await refreshClaimDenormalizedCache(id);
  emitClaimEvent(id, "hold_cleared", req);

  res.json(updated);
}));

router.post("/claims/:id/clear-sop-hold", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  if (leg.sopOutcome !== "hold") {
    res.status(409).json({
      error: "Leg is not on a SOP hold",
      expectedState: "sop_outcome=hold",
      actualState: leg.sopOutcome ?? "null",
    });
    return;
  }

  const previousSopNodeId = leg.sopNodeId;
  const previousSopAnswersCount = Array.isArray(leg.sopAnswers) ? leg.sopAnswers.length : 0;

  const [updated] = await db
    .update(claimsTable)
    .set({ sopOutcome: null })
    .where(eq(claimsTable.id, id))
    .returning();

  await createAuditLog(id, "leg_sop_hold_cleared", "SOP hold cleared", req, {
    previousSopNodeId,
    previousSopAnswersCount,
  });
  await emitStateEvent({
    eventKey: "leg.sop_hold_cleared",
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    metadata: { previousSopNodeId },
  });
  await refreshClaimDenormalizedCache(id);
  if (leg.invoiceGroupId != null) await refreshGroupDerivedFields(leg.invoiceGroupId);
  emitClaimEvent(id, "sop_hold_cleared", req);

  res.json(updated);
}));

router.post("/claims/:id/triage", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { action, errorTypeId, errorTypeName, triageNotes } = req.body;
  if (!action || !["non_issue", "issue_found"].includes(action)) {
    res.status(400).json({ error: "action must be 'non_issue' or 'issue_found'" });
    return;
  }

  try {
    if (action === "non_issue") {
      const result = await transitionClaimStatusAndOutcome({
        claimId: id,
        newStatus: "Resolved",
        newOutcome: "Non-Issue",
        source: "triage",
        reason: `Classified as non-issue${triageNotes ? `: ${triageNotes}` : ""}`,
        actor: actorFromReq(req),
        extraFields: {
          claimAmount: "0",
          approvedAmount: "0",
          triageNotes: triageNotes || null,
          triagedAt: new Date().toISOString(),
        },
      });
      res.json(result.claim);
    } else {
      if (!errorTypeId || !errorTypeName) {
        res.status(400).json({ error: "errorTypeId and errorTypeName are required for issue_found" });
        return;
      }

      const result = await transitionClaimStatus({
        claimId: id,
        newStatus: "New",
        source: "triage",
        reason: `Issue identified during classification: ${errorTypeName}${triageNotes ? `. ${triageNotes}` : ""}`,
        actor: actorFromReq(req),
        systemOverride: true,
        extraFields: {
          errorTypeId: String(errorTypeId),
          errorTypeName,
          triageNotes: triageNotes || null,
          triagedAt: new Date().toISOString(),
        },
      });
      res.json(result.claim);
    }
  } catch (err: any) {
    const msg = err.message || "Failed to classify";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

const POST_RESPONSE_ACTIONS = ["resolve_reattest", "resolve_new_invoice", "mark_denied_by_payor", "re_dispute"] as const;
type PostResponseAction = typeof POST_RESPONSE_ACTIONS[number];

const POST_RESPONSE_ACTION_LABELS: Record<PostResponseAction, string> = {
  resolve_reattest: "Resolve — Reattest",
  resolve_new_invoice: "Resolve — New Invoice #",
  mark_denied_by_payor: "Mark as Denied by Payor",
  re_dispute: "Re-dispute with Additional Points",
};

router.post("/claims/:id/post-response-action", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { action, notes } = req.body;
  if (!action || !POST_RESPONSE_ACTIONS.includes(action)) {
    res.status(400).json({ error: `action must be one of: ${POST_RESPONSE_ACTIONS.join(", ")}` });
    return;
  }

  const typedAction = action as PostResponseAction;
  const actionLabel = POST_RESPONSE_ACTION_LABELS[typedAction];

  try {
    let result;
    switch (typedAction) {
      case "resolve_reattest":
        result = await transitionClaimStatusAndOutcome({
          claimId: id,
          newStatus: "Resolved",
          newOutcome: "Approved",
          source: "post_response_action",
          reason: `${actionLabel}${notes ? ` — ${notes}` : ""} (to be completed outside platform)`,
          actor: actorFromReq(req),
        });
        break;

      case "resolve_new_invoice":
        result = await transitionClaimStatusAndOutcome({
          claimId: id,
          newStatus: "Resolved",
          newOutcome: "Approved",
          source: "post_response_action",
          reason: `${actionLabel}${notes ? ` — ${notes}` : ""} (to be completed outside platform)`,
          actor: actorFromReq(req),
        });
        break;

      case "mark_denied_by_payor":
        result = await transitionClaimStatusAndOutcome({
          claimId: id,
          newStatus: "Denied",
          newOutcome: "Denied",
          source: "post_response_action",
          reason: `${actionLabel}${notes ? ` — ${notes}` : ""}`,
          actor: actorFromReq(req),
          closureReason: "denied_by_payor",
        });
        break;

      case "re_dispute":
        result = await transitionClaimStatus({
          claimId: id,
          newStatus: "Needs Evidence",
          source: "post_response_action",
          reason: `${actionLabel} — claim returned to evidence gathering for re-submission${notes ? `. ${notes}` : ""}`,
          actor: actorFromReq(req),
          systemOverride: true,
          extraFields: {
            sopNodeId: null,
            sopAnswers: [],
            sopOutcome: null,
            dropReason: null,
            dropNote: null,
            droppedAt: null,
            readyAt: null,
          },
        });
        break;
    }

    res.json(result!.claim);
  } catch (err: any) {
    const msg = err.message || "Failed to process post-response action";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.post("/claims/bulk-assign-error-type", asyncHandler(async (req, res): Promise<void> => {
  const { claimIds, errorTypeId } = req.body;
  if (!Array.isArray(claimIds) || claimIds.length === 0) {
    res.status(400).json({ error: "claimIds array is required" });
    return;
  }
  if (!errorTypeId) {
    res.status(400).json({ error: "errorTypeId is required" });
    return;
  }

  const [errorType] = await db.select({ id: errorTypesTable.id, name: errorTypesTable.name })
    .from(errorTypesTable)
    .where(eq(errorTypesTable.id, Number(errorTypeId)));

  if (!errorType) {
    res.status(404).json({ error: "Error type not found" });
    return;
  }

  const ids = claimIds.map((id: string | number) => Number(id)).filter((id: number) => !isNaN(id));
  if (ids.length === 0) {
    res.status(400).json({ error: "No valid claim IDs provided" });
    return;
  }

  const claims = await db.select({ id: claimsTable.id, confNumber: claimsTable.confNumber })
    .from(claimsTable)
    .where(inArray(claimsTable.id, ids));

  if (claims.length === 0) {
    res.status(404).json({ error: "No matching claims found" });
    return;
  }

  const errorTypeName = errorType.name;
  const userEmail = req.user?.email ?? null;
  const userName = req.user?.displayName ?? null;

  await db.transaction(async (tx) => {
    await tx.update(claimsTable)
      .set({ errorTypeId: String(errorTypeId), errorTypeName })
      .where(inArray(claimsTable.id, ids));

    for (const claim of claims) {
      await tx.insert(auditLogsTable).values({
        claimId: claim.id,
        action: "error_type_assigned",
        details: `Error type assigned: ${errorTypeName}`,
        metadata: { errorTypeId, errorTypeName },
        userEmail,
        userName,
      });
    }
  });

  for (const claim of claims) {
    emitClaimEvent(claim.id, "claim_edited", req);
  }

  res.json({ updated: claims.length });
}));

router.patch("/claims/:id/closure-review", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Claim not found" }); return; }

  const reason = (existing as any).closureReason as string | null;
  if (!reason || !["cannot_dispute", "non_issue", "denied_by_payor"].includes(reason)) {
    res.status(409).json({ error: "Closure review only applies to closed (withdrawn / denied / non-issue) claims." });
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

  const [updated] = await db.update(claimsTable).set(updates).where(eq(claimsTable.id, id)).returning();

  // Audit-write rules:
  //   * Transitioning the closure-review row INTO an "addressed" terminal
  //     state (acknowledged/resolved) is the supervisor's sign-off, so we
  //     write `closure_addressed` with the communicated-to + review notes
  //     baked into metadata. The activity feed renders this as a green
  //     "Addressed" entry without re-querying the row.
  //   * Reopening (back to pending) and other state churn falls through to
  //     `closure_review_state_changed` (no dedicated UI affordance).
  //   * Plain notes / communicated-to edits without a state flip stay on
  //     `closure_review_updated` so the timeline shows the supervisor was
  //     iterating on the write-up without claiming sign-off.
  const becameAddressed =
    stateChange != null &&
    stateChange.from !== stateChange.to &&
    (stateChange.to === "acknowledged" || stateChange.to === "resolved");
  if (becameAddressed) {
    await createAuditLog(
      id,
      "closure_addressed",
      "Marked addressed",
      req,
      {
        from: stateChange!.from,
        to: stateChange!.to,
        closureCommunicatedTo: (updates.closureCommunicatedTo ?? (existing as any).closureCommunicatedTo) ?? null,
        closureReviewNotes: (updates.closureReviewNotes ?? (existing as any).closureReviewNotes) ?? null,
      },
    );
  } else if (stateChange && stateChange.from !== stateChange.to) {
    await createAuditLog(
      id,
      "closure_review_state_changed",
      `Closure review state: ${stateChange.from ?? "pending"} → ${stateChange.to ?? "pending"}`,
      req,
      { from: stateChange.from, to: stateChange.to },
    );
  } else if (Object.prototype.hasOwnProperty.call(updates, "closureReviewNotes") || Object.prototype.hasOwnProperty.call(updates, "closureCommunicatedTo")) {
    await createAuditLog(id, "closure_review_updated", "Closure review notes / communicated-to updated", req, {
      closureCommunicatedTo: (updates.closureCommunicatedTo ?? (existing as any).closureCommunicatedTo) ?? null,
      closureReviewNotes: (updates.closureReviewNotes ?? (existing as any).closureReviewNotes) ?? null,
    });
  }

  emitClaimEvent(id, "claim_edited", req);
  res.json(updated);
}));

// Counts for the Responses Awaiting Review nav badge — one number per
// attestation state we care about. Lives under /attestation rather than
// /claims so the path doesn't clash with parametric /claims/:id routes.
router.get("/attestation/counts", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db
    .select({ state: claimsTable.attestationState, count: count() })
    .from(claimsTable)
    .where(and(
      inArray(claimsTable.outcome, ["Approved", "Partially Approved"]),
      inArray(claimsTable.attestationState, ["pending", "queued"]),
    ))
    .groupBy(claimsTable.attestationState);
  const out = { pending: 0, queued: 0 };
  for (const r of rows) {
    if (r.state === "pending") out.pending = r.count;
    else if (r.state === "queued") out.queued = r.count;
  }
  res.json(out);
}));

// Per-leg state-machine endpoints (Task #196 contracts). Each enforces
// a source-state precondition (409 with expected/actual on violation),
// writes an audit_logs + state_events row, and refreshes denormalized
// caches + MAS derivations as needed.

// Local SOP decision-tree shape (mirrors sop-analyzer's exported tree).
interface SopTreeOption {
  label: string;
  childId?: string;
  outcomeType?: string;
  outcomeLabel?: string;
}
interface SopTreeNode {
  id: string;
  question: string;
  options: SopTreeOption[];
}
interface SopTree {
  rootId: string;
  nodes: SopTreeNode[];
}

// Project the tree's outcomeType vocabulary onto the schema's pinned
// SOP_OUTCOMES vocabulary (`portal_dispute | dispute | hold |
// cannot_dispute | non_issue`). The tree models "internal" as a generic
// "deny without disputing" outcome — we land that on `cannot_dispute`,
// which is the closer of the two non-dispute terminal outcomes. The
// rarer `non_issue` case (operator decided the claim shouldn't have
// been opened) is reachable today only via the legacy /triage flow;
// the contracts task does not introduce a new tree-level outcome for
// it (operators can still reclassify or use the existing /triage path).
function mapTreeOutcomeToSopOutcome(o: string | undefined | null): string | null {
  switch (o) {
    case "portal_dispute": return "portal_dispute";
    case "dispute": return "dispute";
    case "hold": return "hold";
    case "internal": return "cannot_dispute";
    case "cannot_dispute": return "cannot_dispute";
    case "non_issue": return "non_issue";
    default: return null;
  }
}

const SOP_DROP_REASONS = new Set(["cannot_dispute", "non_issue"]);
const SOP_READY_REASONS = new Set(["portal_dispute", "dispute"]);

// POST /claims/:id/classify — assign an error type to a leg currently in
// `needs_classification`. This is the moment a leg becomes "real work" in
// the dispute pipeline.
router.post("/claims/:id/classify", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const errorTypeId = (req.body?.errorTypeId ?? "") as string;
  if (!errorTypeId) { res.status(400).json({ error: "errorTypeId is required" }); return; }

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  const subStatus = deriveLegSubStatus(leg);
  if (subStatus !== "needs_classification") {
    res.status(409).json({
      error: "Leg already classified",
      expectedState: "needs_classification",
      actualState: subStatus,
    });
    return;
  }

  const [errorType] = await db
    .select({ id: errorTypesTable.id, name: errorTypesTable.name })
    .from(errorTypesTable)
    .where(eq(errorTypesTable.id, Number(errorTypeId)));
  if (!errorType) { res.status(400).json({ error: "Unknown errorTypeId" }); return; }

  // Atomic block: row update + audit + (when applicable) parent-group
  // promote-on-last-classify cascade run inside one transaction so we
  // never end up with a classified leg whose parent group is left
  // stranded in Needs Review.
  const { updated } = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(claimsTable)
      .set({
        errorTypeId: String(errorType.id),
        errorTypeName: errorType.name,
      })
      .where(eq(claimsTable.id, id))
      .returning();

    await tx.insert(auditLogsTable).values({
      claimId: id,
      action: "leg_classified",
      details: `Leg classified as: ${errorType.name}`,
      metadata: {
        errorTypeId: String(errorType.id),
        errorTypeName: errorType.name,
      },
      userEmail: req.user?.email ?? null,
      userName: req.user?.displayName ?? null,
    });

    // Promote-on-last-classify: when the parent group is in Needs Review
    // and the leg we just classified was the last needs_classification
    // sibling, transition the group to Needs Evidence with
    // source=auto_after_classify so the standard auto-exclude-blank-siblings
    // hook fires from the same code path the group-level triage already
    // uses. This is the cascade that makes per-claim classification
    // self-driving from the inbox.
    if (leg.invoiceGroupId != null) {
      const [parent] = await tx
        .select({ status: invoiceGroupsTable.status })
        .from(invoiceGroupsTable)
        .where(eq(invoiceGroupsTable.id, leg.invoiceGroupId));
      if (parent?.status === "Needs Review") {
        const siblings = await tx
          .select({
            id: claimsTable.id,
            errorTypeId: claimsTable.errorTypeId,
            includedInDispute: claimsTable.includedInDispute,
            holdReason: claimsTable.holdReason,
            sopOutcome: claimsTable.sopOutcome,
          })
          .from(claimsTable)
          .where(eq(claimsTable.invoiceGroupId, leg.invoiceGroupId));
        const stillUnclassified = siblings.some((s) => deriveLegSubStatus(s) === "needs_classification");
        if (!stillUnclassified) {
          await transitionGroupStatus({
            groupId: leg.invoiceGroupId,
            newStatus: "Needs Evidence",
            source: "auto_after_classify",
            reason: `Auto-advanced after final leg classified (${errorType.name})`,
            actor: actorFromReq(req),
            systemOverride: true,
            executor: tx,
          });
        }
      }
    }

    return { updated: u };
  });

  await emitStateEvent({
    eventKey: "leg.classified",
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    metadata: { errorTypeId: String(errorType.id), errorTypeName: errorType.name },
  });
  await refreshClaimDenormalizedCache(id);
  if (leg.invoiceGroupId != null) await refreshGroupDerivedFields(leg.invoiceGroupId);
  emitClaimEvent(id, "classified", req);

  res.json(updated);
}));

// POST /claims/:id/sop-advance — record one step in the SOP walk.
// Body: { nodeId, answer }. Mid-walk advances follow childId; terminal
// stamps sop_outcome + ready_at (or drop_reason + dropped_at).
router.post("/claims/:id/sop-advance", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const nodeId = (req.body?.nodeId ?? "") as string;
  const answer = (req.body?.answer ?? "") as string;
  if (!nodeId || !answer) { res.status(400).json({ error: "nodeId and answer are required" }); return; }

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  const subStatus = deriveLegSubStatus(leg);
  if (subStatus !== "investigating") {
    res.status(409).json({
      error: "Leg is not in the SOP walk",
      expectedState: "investigating",
      actualState: subStatus,
    });
    return;
  }

  if (!leg.errorTypeId) { res.status(409).json({ error: "Leg has no error type" }); return; }
  const [errorType] = await db
    .select({ decisionTree: errorTypesTable.decisionTree })
    .from(errorTypesTable)
    .where(eq(errorTypesTable.id, Number(leg.errorTypeId)));
  if (!errorType?.decisionTree) {
    res.status(400).json({ error: "Error type has no decision tree" });
    return;
  }

  const tree = errorType.decisionTree as unknown as SopTree;
  const node = tree.nodes?.find((n) => n.id === nodeId);
  if (!node) {
    res.status(400).json({ error: `Unknown nodeId: ${nodeId}` });
    return;
  }
  const option = node.options?.find((o) => o.label === answer);
  if (!option) {
    res.status(400).json({
      error: `Answer "${answer}" is not a valid option for this node`,
      validOptions: node.options?.map((o) => o.label) ?? [],
    });
    return;
  }

  // The SOP audit trail is jsonb in the schema (TS type `unknown`);
  // we narrow to the documented row shape at the boundary. Keeping the
  // cast tight to the source-of-truth narrowing call avoids needing
  // an `as any` on the writeback below.
  type SopAnswerRow = { nodeId: string; answer: string; ts: string };
  const existingAnswers: SopAnswerRow[] = Array.isArray(leg.sopAnswers)
    ? (leg.sopAnswers as SopAnswerRow[])
    : [];
  const nextAnswers: SopAnswerRow[] = [
    ...existingAnswers,
    { nodeId, answer, ts: new Date().toISOString() },
  ];

  let nextNodeId: string | null = leg.sopNodeId;
  let nextSopOutcome: string | null = null;
  const updateData: Partial<typeof claimsTable.$inferInsert> = {
    sopAnswers: nextAnswers,
  };
  let isTerminal = false;

  if (option.childId) {
    nextNodeId = option.childId;
    updateData.sopNodeId = nextNodeId;
  } else {
    isTerminal = true;
    nextSopOutcome = mapTreeOutcomeToSopOutcome(option.outcomeType);
    if (!nextSopOutcome) {
      res.status(400).json({ error: `Terminal node has unknown outcomeType: ${option.outcomeType}` });
      return;
    }
    // Per contract: terminal sop-advance also persists sop_node_id to
    // the terminal node identifier so downstream consumers always have
    // the leg's last-visited node pointer (terminal or mid-walk).
    nextNodeId = nodeId;
    updateData.sopNodeId = nextNodeId;
    updateData.sopOutcome = nextSopOutcome;
    if (SOP_DROP_REASONS.has(nextSopOutcome)) {
      updateData.dropReason = nextSopOutcome;
      updateData.droppedAt = new Date();
    } else if (SOP_READY_REASONS.has(nextSopOutcome)) {
      updateData.readyAt = new Date();
    }
  }

  let [updated] = await db
    .update(claimsTable)
    .set(updateData)
    .where(eq(claimsTable.id, id))
    .returning();

  // Contract: every sop-advance writes a `leg_sop_advanced` audit row
  // regardless of whether the step was a terminal or mid-walk one. The
  // `isTerminal` + `sopOutcome` metadata distinguishes the two kinds.
  await createAuditLog(
    id,
    "leg_sop_advanced",
    isTerminal ? `SOP terminal reached: ${nextSopOutcome}` : `SOP step: ${nodeId} → ${answer}`,
    req,
    { nodeId, answer, isTerminal, sopOutcome: nextSopOutcome },
  );
  await emitStateEvent({
    eventKey: isTerminal ? "leg.sop_terminal" : "leg.sop_advanced",
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    metadata: { nodeId, answer, sopOutcome: nextSopOutcome },
  });

  // MAS-action-required derivation: terminal `cannot_dispute` implies the
  // operator must cancel the trip in MAS post-response. Fire even on
  // mid-walk transitions for consistency (no-op when no new sopOutcome).
  if (isTerminal) {
    const masUpdated = await applyMasDerivationsForLeg(id, null);
    if (masUpdated) updated = masUpdated;
  }
  await refreshClaimDenormalizedCache(id);
  if (leg.invoiceGroupId != null) await refreshGroupDerivedFields(leg.invoiceGroupId);
  emitClaimEvent(id, isTerminal ? "sop_terminal" : "sop_advanced", req);

  res.json(updated);
}));

// POST /claims/:id/conclude-leg — operator-driven shortcut that resolves a
// leg to a terminal SOP outcome without walking the decision tree
// (Task #265). Used by the Queue Panel A "conclude" buttons:
// reason="non_issue"      → leg drops as a non-issue;
// reason="cannot_dispute" → leg drops as non-contestable.
// Implementation mirrors the terminal-step branch of /sop-advance: stamps
// sop_outcome + drop_reason + dropped_at, applies MAS derivations,
// refreshes the leg + group caches.
const CONCLUDE_LEG_REASONS = new Set(["non_issue", "cannot_dispute"]);
router.post("/claims/:id/conclude-leg", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const reason = (req.body?.reason ?? "") as string;
  const note = typeof req.body?.note === "string" ? (req.body.note as string) : null;
  if (!CONCLUDE_LEG_REASONS.has(reason)) {
    res.status(400).json({
      error: `reason must be one of: ${Array.from(CONCLUDE_LEG_REASONS).join(", ")}`,
    });
    return;
  }

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  if (leg.invoiceGroupId == null) {
    res.status(409).json({
      error: "Leg must belong to an invoice group",
      expectedState: "has-group",
      actualState: "no-group",
    });
    return;
  }
  const [parentGroup] = await db
    .select()
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.id, leg.invoiceGroupId));
  if (!parentGroup) {
    res.status(409).json({
      error: "Leg must belong to an invoice group",
      expectedState: "has-group",
      actualState: "missing-group",
    });
    return;
  }
  const phase = getGroupMacroPhase(parentGroup);
  if (phase !== "pre-submit") {
    res.status(409).json({
      error: "Leg can only be concluded in pre-submit",
      expectedState: "pre-submit",
      actualState: phase,
    });
    return;
  }

  const subStatus = deriveLegSubStatus(leg);
  if (subStatus === "ready" || subStatus === "dropped" || subStatus === "excluded") {
    res.status(409).json({
      error: `Leg already resolved (${subStatus}); no conclusion needed`,
      expectedState: "open",
      actualState: subStatus,
    });
    return;
  }

  const now = new Date();
  let [updated] = await db
    .update(claimsTable)
    .set({
      sopOutcome: reason,
      dropReason: reason,
      droppedAt: now,
    })
    .where(eq(claimsTable.id, id))
    .returning();

  await createAuditLog(
    id,
    "leg_concluded",
    `Leg concluded as ${reason}${note ? `: ${note}` : ""}`,
    req,
    { reason, note },
  );
  await emitStateEvent({
    eventKey: "leg.concluded",
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    metadata: { reason, note },
  });
  const masUpdated = await applyMasDerivationsForLeg(id, null);
  if (masUpdated) updated = masUpdated;
  await refreshClaimDenormalizedCache(id);
  await refreshGroupDerivedFields(leg.invoiceGroupId);
  emitClaimEvent(id, "concluded", req);

  res.json(updated);
}));

// POST /claims/:id/per-leg-context — operator records the leg-specific
// narrative used by the dispute write-up assembly. Source-state contract:
// the leg's parent invoice group must be in `pre-submit` (per-leg context
// only matters before the submission preview is generated).
router.post("/claims/:id/per-leg-context", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const context = (req.body?.context ?? "") as string;
  if (typeof context !== "string") { res.status(400).json({ error: "context must be a string" }); return; }

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  if (leg.invoiceGroupId == null) {
    res.status(409).json({
      error: "Per-leg context requires the leg to belong to an invoice group",
      expectedState: "has-group",
      actualState: "no-group",
    });
    return;
  }
  const [parentGroup] = await db
    .select()
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.id, leg.invoiceGroupId));
  if (!parentGroup) {
    res.status(409).json({
      error: "Per-leg context requires the leg to belong to an invoice group",
      expectedState: "has-group",
      actualState: "missing-group",
    });
    return;
  }
  const phase = getGroupMacroPhase(parentGroup);
  if (phase !== "pre-submit") {
    res.status(409).json({
      error: "Per-leg context can only be set in pre-submit",
      expectedState: "pre-submit",
      actualState: phase,
    });
    return;
  }

  const [updated] = await db
    .update(claimsTable)
    .set({ perLegContext: context.length === 0 ? null : context })
    .where(eq(claimsTable.id, id))
    .returning();

  await createAuditLog(id, "leg_per_leg_context_set", "Per-leg context recorded", req, {
    contextLength: context.length,
  });
  await emitStateEvent({
    eventKey: "leg.per_leg_context_set",
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    metadata: { contextLength: context.length },
  });
  emitClaimEvent(id, "per_leg_context_set", req);

  res.json(updated);
}));

// POST /claims/:id/exclude — mark a needs_classification leg as "not a
// dispute candidate". The leg disappears from the dispute work queues but
// stays visible on the invoice as a clean line.
router.post("/claims/:id/exclude", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const reason = (req.body?.reason ?? "") as string;
  const note = (req.body?.note ?? null) as string | null;

  if (!(LEG_EXCLUSION_REASONS as readonly string[]).includes(reason)) {
    res.status(400).json({ error: `reason must be one of: ${LEG_EXCLUSION_REASONS.join(", ")}` });
    return;
  }
  if (reason === "other" && (!note || !note.trim())) {
    res.status(400).json({ error: "note required when reason=other" });
    return;
  }

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  const subStatus = deriveLegSubStatus(leg);
  if (subStatus !== "needs_classification") {
    res.status(409).json({
      error: "Cannot exclude from this leg state",
      expectedState: "needs_classification",
      actualState: subStatus,
    });
    return;
  }

  // Use the shared excludeLegCore helper so manual + auto exclusions
  // produce identical writes (row update + audit row with the same
  // metadata shape). The route is still responsible for the cross-cutting
  // side effects that don't belong inside a leg-level transition: state
  // events, the denormalized cache refresh, the SSE broadcast, and the
  // promote-on-last-resolved cascade.
  //
  // The cascade matters for the all-blank Inbox flow: an operator who
  // marks every blank leg as `non_issue` from the inbox should land the
  // parent group in Needs Evidence (where there's nothing to do — and
  // that's correct, the group is now fully resolved without a dispute).
  // Mirrors the cascade in `/claims/:id/classify`.
  const updated = await db.transaction(async (tx) => {
    const { claim } = await excludeLegCore({
      claimId: id,
      reason,
      note,
      source: "manual",
      actor: { userEmail: req.user?.email ?? null, userName: req.user?.displayName ?? null },
      leg,
      trustCallerStateGuard: true,
      ex: tx,
    });

    if (leg.invoiceGroupId != null) {
      const [parent] = await tx
        .select({ status: invoiceGroupsTable.status })
        .from(invoiceGroupsTable)
        .where(eq(invoiceGroupsTable.id, leg.invoiceGroupId));
      if (parent?.status === "Needs Review") {
        const siblings = await tx
          .select({
            id: claimsTable.id,
            errorTypeId: claimsTable.errorTypeId,
            includedInDispute: claimsTable.includedInDispute,
            holdReason: claimsTable.holdReason,
            sopOutcome: claimsTable.sopOutcome,
          })
          .from(claimsTable)
          .where(eq(claimsTable.invoiceGroupId, leg.invoiceGroupId));
        const stillUnclassified = siblings.some((s) => deriveLegSubStatus(s) === "needs_classification");
        if (!stillUnclassified) {
          await transitionGroupStatus({
            groupId: leg.invoiceGroupId,
            newStatus: "Needs Evidence",
            source: "auto_after_classify",
            reason: `Auto-advanced after final unclassified leg excluded (${reason})`,
            actor: actorFromReq(req),
            systemOverride: true,
            executor: tx,
          });
        }
      }
    }

    return claim;
  });

  await emitStateEvent({
    eventKey: "leg.excluded",
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    metadata: { reason },
  });
  await refreshClaimDenormalizedCache(id);
  if (leg.invoiceGroupId != null) await refreshGroupDerivedFields(leg.invoiceGroupId);
  emitClaimEvent(id, "excluded", req);

  res.json(updated);
}));

// POST /claims/:id/include — re-include a previously excluded leg while the
// parent group is still in pre-submit. Two-stage source-state check: leg
// sub-status must be `excluded`, then the parent group must be pre-submit.
router.post("/claims/:id/include", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const note = (req.body?.note ?? null) as string | null;

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  const subStatus = deriveLegSubStatus(leg);
  if (subStatus !== "excluded") {
    res.status(409).json({
      error: "Leg is not excluded",
      expectedState: "excluded",
      actualState: subStatus,
    });
    return;
  }

  if (leg.invoiceGroupId != null) {
    const [parentGroup] = await db
      .select()
      .from(invoiceGroupsTable)
      .where(eq(invoiceGroupsTable.id, leg.invoiceGroupId));
    if (parentGroup) {
      const phase = getGroupMacroPhase(parentGroup);
      if (phase !== "pre-submit") {
        res.status(409).json({
          error: "Cannot re-include a leg after the group leaves pre-submit",
          expectedState: "pre-submit",
          actualState: phase,
        });
        return;
      }
    }
  }

  const [updated] = await db
    .update(claimsTable)
    .set({ includedInDispute: true })
    .where(eq(claimsTable.id, id))
    .returning();

  await createAuditLog(id, "leg_included", `Leg re-included in dispute${note ? `: ${note}` : ""}`, req, {
    note,
    previousSubStatus: "excluded",
  });
  await emitStateEvent({
    eventKey: "leg.included",
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    metadata: {},
  });
  await refreshClaimDenormalizedCache(id);
  if (leg.invoiceGroupId != null) await refreshGroupDerivedFields(leg.invoiceGroupId);
  emitClaimEvent(id, "included", req);

  res.json(updated);
}));

// POST /claims/:id/reclassify — rewind the leg back to needs_classification.
// Allowed from {investigating, ready, dropped, blocked}. Refused if the
// leg has been included in any submitted portal submission (we'd
// invalidate an outgoing dispute). Clears every error-type / SOP / hold
// field so the leg is fully re-startable.
router.post("/claims/:id/reclassify", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  const subStatus = deriveLegSubStatus(leg);
  const allowed: LegSubStatus[] = ["investigating", "ready", "dropped", "blocked"];
  if (!allowed.includes(subStatus)) {
    res.status(409).json({
      error: "Cannot reclassify from this leg state",
      expectedState: allowed.join("|"),
      actualState: subStatus,
    });
    return;
  }

  let previousGroupPhase: string | null = null;
  if (leg.invoiceGroupId != null) {
    const [parentGroup] = await db
      .select({
        status: invoiceGroupsTable.status,
        reattestRequired: invoiceGroupsTable.reattestRequired,
        reattestCompletedAt: invoiceGroupsTable.reattestCompletedAt,
      })
      .from(invoiceGroupsTable)
      .where(eq(invoiceGroupsTable.id, leg.invoiceGroupId))
      .limit(1);
    if (parentGroup) {
      previousGroupPhase = getGroupMacroPhase(parentGroup);
      const blockedPhases = new Set(["mas-action-required", "awaiting-payout", "closed"]);
      if (blockedPhases.has(previousGroupPhase)) {
        res.status(409).json({
          error: "Cannot reclassify after the group reaches MAS/payout/closed; use the admin-correction flow",
          expectedState: "group_phase ∈ {pre-submit, in-flight, response-pending, on-hold}",
          actualState: previousGroupPhase,
        });
        return;
      }
    }
  }

  // Submissions are group-scoped post-cutover, so the reclassify-block guard
  // checks for any in-flight or submitted submission on this leg's parent
  // group — reclassifying a leg whose group has gone out the door would
  // invalidate the dispute regardless of which leg it was attributed to.
  const submittedCount = leg.invoiceGroupId
    ? await db
        .select({ id: portalSubmissionsTable.id })
        .from(portalSubmissionsTable)
        .where(and(
          eq(portalSubmissionsTable.invoiceGroupId, leg.invoiceGroupId),
          inArray(portalSubmissionsTable.status, ["submitted", "in_progress"]),
        ))
        .limit(1)
    : [];
  if (submittedCount.length > 0) {
    res.status(409).json({
      error: "Cannot reclassify a leg whose invoice group has been submitted to the payor",
      expectedState: "no_submission",
      actualState: "submission_exists",
    });
    return;
  }

  const previousMasActionRequired = leg.masActionRequired ?? null;
  const previousMasActionCompletedAt = leg.masActionCompletedAt != null;

  const [updated] = await db
    .update(claimsTable)
    .set({
      errorTypeId: null,
      errorTypeName: null,
      sopNodeId: null,
      sopAnswers: [],
      sopOutcome: null,
      dropReason: null,
      dropNote: null,
      droppedAt: null,
      readyAt: null,
      holdReason: null,
      holdPlacedAt: null,
      holdPendingFrom: null,
      masActionRequired: null,
      masActionCompletedAt: null,
      masActionCompletedBy: null,
      masActionNote: null,
    })
    .where(eq(claimsTable.id, id))
    .returning();

  await createAuditLog(id, "leg_reclassified", "Leg reclassified — error type and SOP cleared", req, {
    previousSubStatus: subStatus,
    previousErrorTypeId: leg.errorTypeId,
    previousMasActionRequired,
    previousMasActionCompletedAt,
    previousGroupPhase,
  });
  await emitStateEvent({
    eventKey: "leg.reclassified",
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    metadata: {
      previousErrorTypeId: leg.errorTypeId,
      previousMasActionRequired,
      previousMasActionCompletedAt,
      previousGroupPhase,
    },
  });
  await refreshClaimDenormalizedCache(id);
  if (leg.invoiceGroupId != null) await refreshGroupDerivedFields(leg.invoiceGroupId);
  emitClaimEvent(id, "reclassified", req);

  res.json(updated);
}));

// POST /claims/:id/verdict — append-only writer for claim_verdict.
// Refreshes claims.outcome from the latest verdict; operator
// confirmations also fire MAS derivation + attestation gate.
router.post("/claims/:id/verdict", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const source = (req.body?.source ?? "") as string;
  const outcome = (req.body?.outcome ?? "") as string;
  const note = (req.body?.note ?? null) as string | null;
  const confidence = req.body?.confidence ?? null;
  const reasoning = (req.body?.reasoning ?? null) as string | null;
  const inspectionTimeMs = req.body?.inspectionTimeMs ?? null;

  if (source !== "ai_suggested" && source !== "operator_confirmed") {
    res.status(400).json({ error: "source must be ai_suggested or operator_confirmed" });
    return;
  }
  if (!(VERDICT_OUTCOMES as readonly string[]).includes(outcome)) {
    res.status(400).json({ error: `outcome must be one of: ${VERDICT_OUTCOMES.join(", ")}` });
    return;
  }

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  if (leg.invoiceGroupId == null) {
    res.status(409).json({
      error: "Leg has no parent invoice group; verdicts are group-scoped",
      expectedState: "response-pending",
      actualState: "no_group",
    });
    return;
  }
  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, leg.invoiceGroupId));
  if (!group) {
    res.status(409).json({ error: "Parent invoice group missing" });
    return;
  }

  // Use the group-aware macro phase so a group already past
  // response-pending (e.g. reattest in flight) cannot accept new
  // verdicts via the bare claim_status check.
  const macroPhase = getGroupMacroPhase(group);
  if (macroPhase !== "response-pending") {
    res.status(409).json({
      error: "Group is not in the response-pending phase",
      expectedState: "response-pending",
      actualState: macroPhase,
    });
    return;
  }

  // Verdicts (AI or operator) only apply to legs that were actually
  // submitted to the payor. Both source-state checks are enforced
  // uniformly.
  if (!leg.includedInDispute) {
    res.status(409).json({
      error: "Leg was not included in the dispute",
      expectedState: "included_in_dispute",
      actualState: "excluded",
    });
    return;
  }
  const submittedSopOutcomes = new Set(["portal_dispute", "dispute"]);
  if (!submittedSopOutcomes.has(leg.sopOutcome ?? "")) {
    res.status(409).json({
      error: "Cannot record a verdict on a leg that wasn't submitted",
      expectedState: "sop_outcome ∈ {portal_dispute, dispute}",
      actualState: leg.sopOutcome ?? "null",
    });
    return;
  }

  const [verdictRow] = await db.insert(claimVerdictTable).values({
    claimId: id,
    source,
    outcome,
    note,
    confidence: confidence != null ? String(confidence) : null,
    reasoning,
    createdBy: req.user?.email ?? null,
    inspectionTimeMs: inspectionTimeMs != null ? Number(inspectionTimeMs) : null,
  }).returning();

  await createAuditLog(
    id,
    source === "ai_suggested" ? "leg_verdict_suggested" : "leg_verdict_confirmed",
    `Verdict ${outcome} (${source})`,
    req,
    { source, outcome, confidence, inspectionTimeMs },
  );
  await emitStateEvent({
    eventKey: source === "ai_suggested" ? "leg.verdict_suggested" : "leg.verdict_confirmed",
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    durationMs: inspectionTimeMs != null ? Number(inspectionTimeMs) : null,
    metadata: { source, outcome, confidence },
  });

  // Cache refresh runs unconditionally — the denormalized
  // `claims.outcome` tracks the latest claim_verdict row regardless of
  // source. Operator-only side effects (MAS derivation, attestation
  // gate, group derivations) follow.
  await refreshClaimDenormalizedCache(id);

  if (source === "operator_confirmed") {
    await applyMasDerivationsForLeg(id, outcome);

    // Attestation gate: re-read the leg post-cache-refresh and apply
    // the gate against the group we already loaded.
    const [legAfter] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
    if (legAfter) {
      const attDelta = computeAttestationDelta(leg.outcome, legAfter.outcome, group);
      if (Object.keys(attDelta).length > 0) {
        await db.update(claimsTable).set(attDelta).where(eq(claimsTable.id, id));
      }
    }
    await refreshGroupDerivedFields(leg.invoiceGroupId);
  }
  emitClaimEvent(id, "verdict_recorded", req);

  res.json(verdictRow);
}));

// POST /claims/:id/mas-action/complete — operator stamps that they
// completed the MAS cancel for this leg. Source-state contract:
// `mas_action_required = 'cancel'` AND `mas_action_completed_at IS NULL`.
router.post("/claims/:id/mas-action/complete", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const note = (req.body?.note ?? null) as string | null;
  const masReference = (req.body?.masReference ?? null) as string | null;

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  if (leg.masActionRequired !== "cancel") {
    res.status(409).json({
      error: "Leg does not have an open MAS cancel action",
      expectedState: "mas_action_required=cancel",
      actualState: leg.masActionRequired ?? "null",
    });
    return;
  }
  if (leg.masActionCompletedAt != null) {
    res.status(409).json({
      error: "MAS action already completed",
      expectedState: "mas_action_completed_at=null",
      actualState: "completed",
    });
    return;
  }

  const fullNote = masReference ? `${note ? note + " " : ""}(MAS ref: ${masReference})` : note;
  const [updated] = await db
    .update(claimsTable)
    .set({
      masActionCompletedAt: new Date(),
      masActionCompletedBy: req.user?.email ?? null,
      masActionNote: fullNote,
    })
    .where(eq(claimsTable.id, id))
    .returning();

  await createAuditLog(id, "mas_cancel_completed", "MAS cancel completed", req, { note, masReference });
  await emitStateEvent({
    eventKey: "leg.mas_action_completed",
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    metadata: { note, masReference },
  });
  await refreshClaimDenormalizedCache(id);
  if (leg.invoiceGroupId != null) await refreshGroupDerivedFields(leg.invoiceGroupId);
  emitClaimEvent(id, "mas_cancel_completed", req);

  res.json(updated);
}));

export default router;

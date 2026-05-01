import { Router, type IRouter, type Request } from "express";
import { eq, or, ilike, desc, asc, and, count, inArray, isNull, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, auditLogsTable, notesTable, errorTypesTable, portalSubmissionsTable, portalResponsesTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { broadcastClaimEvent } from "../lib/sse";
import {
  transitionClaimStatus,
  transitionClaimOutcome,
  transitionClaimStatusAndOutcome,
  VALID_MANUAL_STATUS_TRANSITIONS,
  VALID_OUTCOME_BY_STATUS,
  SYSTEM_CONTROLLED_STATUSES,
} from "../lib/claim-transitions";
import { parseClosurePayload, ClosureValidationError, type NormalizedClosure, CLOSURE_DETAIL_FIELDS } from "../lib/closure-validation";
import { buildClaimExpiringCondition, parseExpiringMode } from "../lib/expiring-filter";
import { effectiveDaysRemaining, isUrgentDeadline } from "../lib/dates";
import { EXPIRING_ACTIONABLE_STATUSES } from "./dashboard";

// A claim is only "on the 30-day clock" while its status is one we still owe
// action on. Once it's filed (Awaiting Response) or otherwise terminal, the
// urgency signal stops applying, even if the calendar deadline has slipped.
const CLAIM_ON_CLOCK_STATUSES = new Set<string>(EXPIRING_ACTIONABLE_STATUSES);

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

  return conditions.length > 0 ? and(...conditions) : undefined;
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

  const activeSubmissions = await db.select().from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.claimId, id),
      inArray(portalSubmissionsTable.status, ["pending", "in_progress"])
    ));

  const allSubmissions = await db.select({ id: portalSubmissionsTable.id })
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.claimId, id))
    .limit(1);
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

router.post("/claims/:id/hold", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { holdReason, holdPendingFrom } = req.body;
  if (!holdReason) { res.status(400).json({ error: "holdReason is required" }); return; }

  try {
    const result = await transitionClaimStatus({
      claimId: id,
      newStatus: "On Hold",
      source: "manual",
      reason: `Hold placed: ${holdReason}`,
      actor: actorFromReq(req),
      systemOverride: true,
      extraFields: {
        holdReason,
        holdPendingFrom: holdPendingFrom || null,
        holdPlacedAt: new Date().toISOString(),
      },
    });
    res.json(result.claim);
  } catch (err: any) {
    const msg = err.message || "Failed to place hold";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.delete("/claims/:id/hold", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const result = await transitionClaimStatus({
      claimId: id,
      newStatus: "Needs Evidence",
      source: "manual",
      reason: "Hold removed from claim",
      actor: actorFromReq(req),
      systemOverride: true,
      extraFields: {
        holdReason: null,
        holdPendingFrom: null,
        holdPlacedAt: null,
      },
    });
    res.json(result.claim);
  } catch (err: any) {
    const msg = err.message || "Failed to remove hold";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.patch("/claims/:id/workflow", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // TEMP STUB — removed in cutover task. The legacy `workflow_progress`
  // JSONB column has been dropped (see Task #195). The new per-leg state
  // machine writes to discrete columns through the contracts task. This
  // endpoint is left as a no-op write that still emits the audit + bus
  // event so that any in-flight UI calls don't 404 during the transition.
  void req.body;
  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  await createAuditLog(id, "workflow_step", "Workflow progress updated (stub)", req);
  emitClaimEvent(id, "workflow_updated", req);
  res.json(claim);
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
          // TEMP STUB — removed in cutover task. The legacy
          // `workflow_progress` JSONB column has been dropped; the
          // contracts task will reset the per-leg sop_node_id /
          // sop_answers / sop_outcome / ready_at fields here instead.
          extraFields: {},
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


export default router;

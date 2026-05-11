import { Router, type IRouter, type Request } from "express";
import { eq, ne, or, ilike, desc, asc, and, count, inArray, isNull, isNotNull, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, auditLogsTable, notesTable, errorTypesTable, portalSubmissionsTable, portalResponsesTable, claimVerdictTable, invoiceGroupsTable, claimEvidenceTable, LEG_HOLD_REASONS, LEG_EXCLUSION_REASONS, VERDICT_OUTCOMES } from "@workspace/db";
import { deriveLegSubStatus, type LegSubStatus } from "@workspace/leg-state";
import { asyncHandler } from "../lib/asyncHandler";
import { anthropic } from "@workspace/integrations-anthropic-ai";
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
import { blockMutationOnTourSampleClaim } from "../lib/tour-sample";
import { emitStateEvent } from "../lib/state-events";
import { refreshClaimDenormalizedCache, refreshGroupDerivedFields } from "../lib/denormalized-cache";
import { recomputeGroupServiceDate } from "../lib/group-service-date";
import { applyMasDerivationsForLeg } from "../lib/mas-derivations";
import { setClaimDisposition, sopOutcomeToDisposition } from "../lib/leg-state/set-claim-disposition";
import { getGroupMacroPhase } from "../lib/macro-phase";
import { computeAttestationDelta } from "../lib/attestation";
import { parseClosurePayload, ClosureValidationError, type NormalizedClosure, CLOSURE_DETAIL_FIELDS } from "../lib/closure-validation";
import { buildClaimExpiringCondition, parseExpiringMode } from "../lib/expiring-filter";
import { effectiveDaysRemaining, isAtOrPastEffectiveDeadline, isUrgentDeadline } from "../lib/dates";
import { canSeeAmounts, dropAmountFiltersForUser, scrubMoneyFields, scrubMoneyFieldsArray } from "../lib/role";
import { denyClerk } from "../middlewares/denyClerk";
import {
  CLAIM_EXPIRING_ACTIONABLE_STATUSES,
  CLAIM_SUBMITTED_STUCK_STATUSES,
} from "./dashboard";
import { isGroupOperatorDone } from "../lib/operator-attention";

// A claim is only "on the 30-day clock" while its status is one we still
// owe action on. Once it's filed (Awaiting Response) or otherwise
// terminal, the urgency signal stops applying, even if the calendar
// deadline has slipped. Includes `Portal Queued` and `Processed` because
// stuck claims in those states still escalate against the 30-day clock —
// see the rule in dashboard.ts.
const CLAIM_ON_CLOCK_STATUSES = new Set<string>(CLAIM_EXPIRING_ACTIONABLE_STATUSES);

// Subset of CLAIM_ON_CLOCK_STATUSES that means "we already submitted
// this — don't re-file, chase a confirmation". Used to decorate list
// rows with `submittedStuck` so the UI can render the parallel
// "stuck after submission" badge variant (Task #352). Pairs with
// `isUrgent` rather than replacing it: stuck rows are also urgent
// today, but the operator's next action is different (chase, not file).
const CLAIM_STUCK_STATUSES = new Set<string>(CLAIM_SUBMITTED_STUCK_STATUSES);

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
  // claims.date is a typed DATE column (Task #351, migration 0022) —
  // sortable directly, no cast required.
  date: claimsTable.date,
  clientNumber: claimsTable.clientNumber,
  errorTypeName: claimsTable.errorTypeName,
  claimAmount: sql`${claimsTable.claimAmount}::numeric`,
  status: claimsTable.status,
  createdAt: claimsTable.createdAt,
} as const;

// Always hide the global tour-sample row from every list/aggregate
// query. The row exists only so the in-app guided tour can navigate
// to a real detail page (steps 18 & 20). See migration 0029 +
// routes/tour.ts.
const HIDE_TOUR_SAMPLE_CLAIM = eq(claimsTable.isTourSample, false);

function buildClaimsWhere(
  query: Record<string, unknown>,
  opts: { skipLegSubStatus?: boolean } = {},
): SQL | undefined {
  const { status, outcome, search, errorTypeId } = query;
  const createdFrom = query.createdFrom as string | undefined;
  const createdTo = query.createdTo as string | undefined;
  const amountMin = query.amountMin as string | undefined;
  const amountMax = query.amountMax as string | undefined;
  const serviceDateFrom = query.serviceDateFrom as string | undefined;
  const serviceDateTo = query.serviceDateTo as string | undefined;
  const carNumber = query.carNumber as string | undefined;
  const clientNumber = query.clientNumber as string | undefined;

  const conditions: SQL[] = [HIDE_TOUR_SAMPLE_CLAIM];

  let statusFilterIncludesExpired = false;
  if (status && typeof status === "string") {
    const statuses = status.split(",").map(s => s.trim()).filter(Boolean) as (typeof claimsTable.status.enumValues)[number][];
    statusFilterIncludesExpired = statuses.includes("Expired");
    if (statuses.length === 1) {
      conditions.push(eq(claimsTable.status, statuses[0]));
    } else if (statuses.length > 1) {
      const statusOr = or(...statuses.map(s => eq(claimsTable.status, s)));
      if (statusOr) conditions.push(statusOr);
    }
  }

  // Mirror the Expired filter on `invoice-groups`: hide Expired by
  // default; opt in via `?includeExpired=true` or by explicitly
  // selecting Expired in the status filter. Disputed children inherit
  // their parent group's Expired status via `syncChildRides`, so this
  // SQL-level guard is sufficient — no JS post-filter required.
  const includeExpiredFlag = String(query.includeExpired ?? "").toLowerCase() === "true";
  // `urgent` (≤ today) and `stuck` (past deadline) intentionally
  // include past-deadline rows; `soon` (1..SOON_DAYS) does not.
  const expiringModeRaw = parseExpiringMode(query.expiring);
  const expiringModeIncludesPastDeadline =
    expiringModeRaw === "urgent" || expiringModeRaw === "stuck";
  if (!includeExpiredFlag && !statusFilterIncludesExpired) {
    conditions.push(ne(claimsTable.status, "Expired"));
    // Hide rows whose effective filing deadline has slipped (any
    // status with a service date) — payors won't accept the
    // submission. Bypassed under `?expiring=urgent|stuck`, where
    // past-deadline rows are the point of the view.
    if (!expiringModeIncludesPastDeadline) {
      const dateExpr = sql`${claimsTable.date}`;
      const effectiveDeadlineSql = sql`(
        CASE EXTRACT(DOW FROM (${dateExpr} + INTERVAL '30 days'))
          WHEN 6 THEN ((${dateExpr} + INTERVAL '30 days')::date - INTERVAL '1 day')::date
          WHEN 0 THEN ((${dateExpr} + INTERVAL '30 days')::date - INTERVAL '2 days')::date
          ELSE (${dateExpr} + INTERVAL '30 days')::date
        END
      )`;
      conditions.push(
        sql`NOT (${dateExpr} IS NOT NULL AND ${effectiveDeadlineSql} < CURRENT_DATE)`,
      );
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
    // claims.date is a typed DATE column (Task #351, migration 0022),
    // so the comparison is calendar-correct without any cast.
    conditions.push(sql`${claimsTable.date} >= ${serviceDateFrom}::date`);
  }
  if (serviceDateTo) {
    conditions.push(sql`${claimsTable.date} <= ${serviceDateTo}::date`);
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

  const legSubStatus = opts.skipLegSubStatus ? undefined : query.legSubStatus;
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
export function buildLegSubStatusCondition(sub: string): SQL | null {
  const notExcluded = or(
    isNull(claimsTable.includedInDispute),
    eq(claimsTable.includedInDispute, true),
  )!;
  // `duplicate` takes precedence over the SOP-derived sub-statuses in
  // deriveLegSubStatus (excluded > duplicate > rest). All non-`excluded`,
  // non-`duplicate` filters must therefore exclude duplicates so the SQL
  // tally matches the JS derivation.
  const notDuplicate = isNull(claimsTable.duplicateOfClaimId);
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
    case "duplicate":
      // Sibling Duplicate — leg is included in dispute but rolls up to a
      // primary leg in the same invoice (trip-overriding error).
      return and(notExcluded, isNotNull(claimsTable.duplicateOfClaimId))!;
    case "needs_classification":
      return and(
        notExcluded,
        notDuplicate,
        or(isNull(claimsTable.errorTypeId), eq(claimsTable.errorTypeId, ""))!,
      )!;
    case "blocked":
      return and(
        notExcluded,
        notDuplicate,
        hasErrorType,
        or(isNotNull(claimsTable.holdReason), eq(claimsTable.sopOutcome, "hold"))!,
      )!;
    case "investigating":
      return and(
        notExcluded,
        notDuplicate,
        hasErrorType,
        noHold,
        isNull(claimsTable.sopOutcome),
      )!;
    case "ready":
      return and(
        notExcluded,
        notDuplicate,
        hasErrorType,
        noHold,
        inArray(claimsTable.sopOutcome, ["portal_dispute", "dispute"]),
      )!;
    case "dropped":
      return and(
        notExcluded,
        notDuplicate,
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
    // claims.date is a typed DATE column (Task #351, migration 0022) —
    // ascending sort with NULLS LAST keeps date-less rows out of the
    // urgent-deadline part of the list.
    sql`${claimsTable.date} ASC NULLS LAST`,
    desc(claimsTable.createdAt),
  ];
}

router.get("/claims", asyncHandler(async (req, res): Promise<void> => {
  const { limit: limitStr, offset: offsetStr, sort, dir } = req.query;
  const limitVal = Math.min(parseInt(String(limitStr || "50"), 10), 500);
  const offsetVal = parseInt(String(offsetStr || "0"), 10);

  // Strip amountMin/amountMax for clerks so filter results can't leak
  // existence-of-amount information.
  dropAmountFiltersForUser(req.query as Record<string, unknown>, req.user);

  const where = buildClaimsWhere(req.query as Record<string, unknown>);
  const orderBy = buildClaimsOrderBy(sort as string, dir as string);

  // Task #557 — counts query for the per-leg sub-status tab strip on
  // the forensic-search Claims page. Counts respect every other filter
  // (search, error type, dates, amount, etc.) but DELIBERATELY ignore
  // the active sub-status tab so each tab shows the size of *its* slice
  // independent of the current selection. One round trip via SUM(CASE).
  const whereForCounts = buildClaimsWhere(req.query as Record<string, unknown>, {
    skipLegSubStatus: true,
  });
  const buildCountSql = (sub: string): SQL => {
    const cond = buildLegSubStatusCondition(sub)!;
    return sql<number>`COALESCE(SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END), 0)::int`;
  };
  const [totalResult] = await db.select({ count: count() }).from(claimsTable).where(where);
  const [countsRow] = await db
    .select({
      needs_classification: buildCountSql("needs_classification"),
      investigating: buildCountSql("investigating"),
      blocked: buildCountSql("blocked"),
      ready: buildCountSql("ready"),
      dropped: buildCountSql("dropped"),
      frozen: buildCountSql("frozen"),
    })
    .from(claimsTable)
    .where(whereForCounts);
  const legSubStatusCounts = {
    needs_classification: countsRow?.needs_classification ?? 0,
    investigating: countsRow?.investigating ?? 0,
    blocked: countsRow?.blocked ?? 0,
    ready: countsRow?.ready ?? 0,
    dropped: countsRow?.dropped ?? 0,
    frozen: countsRow?.frozen ?? 0,
  };
  const claimsRaw = await db.select().from(claimsTable).where(where)
    .orderBy(...orderBy)
    .limit(limitVal)
    .offset(offsetVal);

  // Task #541: per-row badge stamping (`isUrgent` / `submittedStuck`)
  // must respect the parent group's operator-done state. A claim
  // whose parent group is post-submit / closed / outcome-resolved no
  // longer needs an "act today" badge — the chase happens in the
  // dashboard's separate stuck-after-submission tier. We resolve the
  // parent phase + outcome in a single batched lookup so the per-row
  // mapping below stays a pure transform. See operator-attention.ts.
  const parentGroupIds = Array.from(
    new Set(claimsRaw.map((c) => c.invoiceGroupId).filter((x): x is number => x != null)),
  );
  const parentDoneById = new Map<number, boolean>();
  // Task #557 — invoice-first Claims (forensic-search) page mirrors the
  // parent group's `invoiceNumber`, canonical `phase`, and derived
  // macro-phase onto each leg row so the per-row phase chip + invoice
  // click-through render with one fetch.
  const parentMetaById = new Map<
    number,
    { invoiceNumber: string | null; phase: string | null; macroPhase: string | null }
  >();
  if (parentGroupIds.length > 0) {
    const parents = await db
      .select({
        id: invoiceGroupsTable.id,
        invoiceNumber: invoiceGroupsTable.invoiceNumber,
        phase: invoiceGroupsTable.phase,
        outcome: invoiceGroupsTable.outcome,
        status: invoiceGroupsTable.status,
        reattestRequired: invoiceGroupsTable.reattestRequired,
        reattestCompletedAt: invoiceGroupsTable.reattestCompletedAt,
      })
      .from(invoiceGroupsTable)
      .where(inArray(invoiceGroupsTable.id, parentGroupIds));
    for (const p of parents) {
      parentDoneById.set(p.id, isGroupOperatorDone({ phase: p.phase, outcome: p.outcome }));
      parentMetaById.set(p.id, {
        invoiceNumber: p.invoiceNumber ?? null,
        phase: p.phase ?? null,
        macroPhase: getGroupMacroPhase({
          phase: p.phase,
          status: p.status,
          reattestRequired: p.reattestRequired,
          reattestCompletedAt: p.reattestCompletedAt,
        }),
      });
    }
  }

  const today = new Date();
  const claims = claimsRaw.map(claim => {
    const parentDone = claim.invoiceGroupId != null
      ? parentDoneById.get(claim.invoiceGroupId) === true
      : false;
    // Status-aware AND operator-done aware: only flag as urgent if we
    // still owe action (parent NOT operator-done) AND the deadline is
    // exactly today. `isUrgentDeadline` enforces strict-equality
    // semantics; past-due rows on still-actionable parents fall
    // through to the `submittedStuck` chase tier below rather than
    // inflating "Today".
    const urgent =
      !parentDone &&
      CLAIM_ON_CLOCK_STATUSES.has(claim.status) &&
      isUrgentDeadline(claim.date, today);
    const meta = claim.invoiceGroupId != null
      ? parentMetaById.get(claim.invoiceGroupId) ?? null
      : null;
    return {
      ...claim,
      invoiceNumber: meta?.invoiceNumber ?? null,
      groupPhase: meta?.phase ?? null,
      groupMacroPhase: meta?.macroPhase ?? null,
      effectiveDaysLeft: effectiveDaysRemaining(claim.date, today),
      isUrgent: urgent,
      // Task #352 + #541. Post-submit "stuck" tier — same calendar
      // predicate as before, but now also gated on the parent group
      // still needing operator attention. A claim under a parent that
      // has already moved off the operator's queue (Resolved /
      // Withdrawn / Non-Issue) must NOT keep pulsing its row-level
      // "Stuck" badge — the chase has either landed or no longer
      // applies. The dashboard's group-level stuck tier is a separate
      // surface and is unaffected by this row-flag change.
      submittedStuck:
        !parentDone &&
        CLAIM_STUCK_STATUSES.has(claim.status) &&
        isAtOrPastEffectiveDeadline(claim.date, today),
    };
  });

  res.json({
    claims: scrubMoneyFieldsArray(claims, req.user),
    total: totalResult.count,
    legSubStatusCounts,
  });
}));

router.get("/claims/export-csv", denyClerk, asyncHandler(async (req, res): Promise<void> => {
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

  // Admit two families of attestation-pending claims:
  //   (1) Approved / Partially-Approved verdict — the historical case;
  //       attestation_state moves to pending via `computeAttestationDelta`
  //       when the operator records the verdict.
  //   (2) Status = "MAS Eligible" — the post-upload triage bridge case;
  //       attestation_state moves to pending via
  //       `engageMasEligibleAttestationCascade` when an operator marks
  //       the parent group MAS-Eligible. The leg's outcome stays Pending
  //       in this branch (the formal verdict only lands when the group
  //       moves to Resolved), so without this OR clause the legs would
  //       be silently filtered out of the queue even though their
  //       attestation_state is correctly set to pending.
  const rows = await db
    .select()
    .from(claimsTable)
    .where(and(
      HIDE_TOUR_SAMPLE_CLAIM,
      eq(claimsTable.attestationState, stateRaw),
      or(
        inArray(claimsTable.outcome, ["Approved", "Partially Approved"]),
        eq(claimsTable.status, "MAS Eligible"),
      ),
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

  res.json(scrubMoneyFields(claim, req.user));
}));

router.patch("/claims/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await blockMutationOnTourSampleClaim(id, res)) return;

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

  // The PATCH allowedFields list above intentionally excludes
  // `invoiceGroupId`, so a leg cannot move between groups via this
  // route — only the parent group's earliest-service-date might shift,
  // and only when `date` is in the patch and actually changes. We
  // recompute after the transaction commits so the side effect runs
  // against the post-write row state.
  const dateChanged =
    Object.prototype.hasOwnProperty.call(updateData, "date") &&
    updateData.date !== previous.date;

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

  // Refresh the parent group's earliest-service-date column when the
  // edit moved the leg's `date`. Outside the txn so the recompute reads
  // the committed row; no-op when the MIN didn't actually shift.
  if (dateChanged && saved.invoiceGroupId != null) {
    await recomputeGroupServiceDate(saved.invoiceGroupId);
  }

  emitClaimEvent(id, "claim_edited", req);
  res.json(advanced ?? saved);
}));

// Task #411 audit, Tier 5: `DELETE /claims/:id` was removed because no
// UI ever called it (an admin destructive-action page was never built),
// which left a permanently-unreachable mutation in the surface area —
// exactly the "endpoint promises an action no caller can request" anti-
// pattern this task eradicates. If a real admin UI is needed later,
// re-introduce the route alongside the page that calls it (and gate
// with `requireAdmin`), don't restore an orphan endpoint.

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

  // Hotfix #635 (2026-05-09): broaden the per-leg gate to accept both
  // legacy `Needs Review` and post-#547 `Ready to Review`. The matcher
  // calls `transitionClaimStatus` with MATCHER_CLASSIFIED_TARGET_STATUS
  // ("Ready to Review") on every classified payor reply, so a strict
  // `claim.status === "Needs Review"` check dead-gated the per-leg
  // post-response action set on every modern claim.
  let postResponseActions: string[] = [];
  if (hasResponses && (claim.status === "Needs Review" || claim.status === "Ready to Review")) {
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
  if (await blockMutationOnTourSampleClaim(id, res)) return;

  const { status } = req.body;
  if (!status) { res.status(400).json({ error: "status is required" }); return; }

  try {
    const result = await transitionClaimStatus({
      claimId: id,
      newStatus: status,
      source: "manual",
      reason: `Manual status change by user`,
      actor: actorFromReq(req),
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
  if (await blockMutationOnTourSampleClaim(id, res)) return;

  const { outcome, approvedAmount, invoiceNumbers, closureReason } = req.body;
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

  await db.update(claimsTable).set(updateData).where(eq(claimsTable.id, claimId));

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

  // Audit 2026-05-08 / Fix #2: `attestationState` IS a disposition
  // deriver input (verdict_approved + attest_pending → `attest_pending`,
  // attest_queued → `attest_queued`, completed → `attested`, etc.).
  // The direct UPDATE above bypasses the canonical helpers, so refresh
  // here to keep `claims.disposition` lockstep before we return the row
  // to the caller.
  await refreshClaimDenormalizedCache(claimId);
  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId));

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
  if (await blockMutationOnTourSampleClaim(id, res)) return;
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
  if (await blockMutationOnTourSampleClaim(id, res)) return;
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
  if (await blockMutationOnTourSampleClaim(id, res)) return;
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
  if (await blockMutationOnTourSampleClaim(id, res)) return;

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
  if (await blockMutationOnTourSampleClaim(id, res)) return;

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
  if (await blockMutationOnTourSampleClaim(id, res)) return;

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  // Gate on the column we're actually clearing. The legacy "subStatus
  // must be blocked" check is too strict: deriveLegSubStatus
  // short-circuits via `disposition` when it's set (Wave-C+), so a
  // leg can carry holdReason while subStatus comes back as
  // `investigating`/`ready`. The release endpoint's purpose is to
  // clear hold_reason — refuse only when there's nothing to clear.
  if (!leg.holdReason) {
    res.status(409).json({
      error: "Leg is not on hold",
      expectedState: "holdReason set",
      actualState: deriveLegSubStatus(leg),
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
  if (await blockMutationOnTourSampleClaim(id, res)) return;

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  // Same relaxed gate as DELETE /claims/:id/hold — see comment there.
  if (!leg.holdReason) {
    res.status(409).json({
      error: "Leg is not on hold",
      expectedState: "holdReason set",
      actualState: deriveLegSubStatus(leg),
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
  if (await blockMutationOnTourSampleClaim(id, res)) return;

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
  if (await blockMutationOnTourSampleClaim(id, res)) return;

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
  if (await blockMutationOnTourSampleClaim(id, res)) return;

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

router.post("/claims/bulk-assign-error-type", denyClerk, asyncHandler(async (req, res): Promise<void> => {
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

  const requestedIds = claimIds.map((id: string | number) => Number(id))
    .filter((id: number) => !isNaN(id));
  if (requestedIds.length === 0) {
    res.status(400).json({ error: "No valid claim IDs provided" });
    return;
  }

  const claims = await db.select({
    id: claimsTable.id,
    confNumber: claimsTable.confNumber,
    invoiceGroupId: claimsTable.invoiceGroupId,
    status: claimsTable.status,
    errorTypeId: claimsTable.errorTypeId,
  })
    .from(claimsTable)
    .where(inArray(claimsTable.id, requestedIds));

  // Pivot B2 (Task #471): the invoice-first model says an invoice's
  // dispute reason **is** its error type — per-leg divergence within
  // one invoice has no real-world meaning (MAS won't accept it). If
  // any of the requested legs belong to an invoice group, refuse with
  // a stable 409 + code so callers (and any out-of-tree integrations)
  // get a fail-loud signal to route through
  // `POST /invoice-groups/bulk-assign-error-type` instead. We do NOT
  // auto-translate the request server-side — that would hide the
  // architectural rule. Legacy un-grouped legs (invoiceGroupId IS NULL)
  // remain handled here for back-compat.
  const groupedClaims = claims.filter(c => c.invoiceGroupId != null);
  if (groupedClaims.length > 0) {
    const groupIds = Array.from(new Set(
      groupedClaims.map(c => c.invoiceGroupId as number),
    )).sort((a, b) => a - b);
    res.status(409).json({
      error: "Bulk error-type assignment must go through the invoice-group endpoint when any selected leg belongs to an invoice group.",
      code: "use_group_endpoint",
      groupIds,
    });
    return;
  }

  // Task #411 audit, Tier 4: previously this endpoint returned only
  // `{ updated: N }`, which silently masked the case where some of
  // the requested IDs didn't exist (already deleted by another
  // operator, typo'd id from a stale selection, etc). Operators saw
  // "Updated 5 claims" when only 3 actually changed. We now compute
  // the unmatched ids and surface them as `skipped` so the UI can
  // tell the operator exactly which conf numbers didn't apply.
  const matchedIds = new Set(claims.map(c => c.id));
  const skipped = requestedIds
    .filter((id: number) => !matchedIds.has(id))
    .map((id: number) => ({ id, refNumber: null as string | null, reason: "not_found" as const }));

  if (claims.length === 0) {
    res.status(404).json({
      error: "No matching claims found",
      updated: 0,
      updatedItems: [],
      skipped,
    });
    return;
  }

  const errorTypeName = errorType.name;
  const userEmail = req.user?.email ?? null;
  const userName = req.user?.displayName ?? null;

  // Snapshot the qualifying-for-auto-advance set BEFORE the bulk
  // update so the per-row transition below sees the same "first-time
  // classification" predicate the single-claim PATCH at /claims/:id uses
  // (status was New or Needs Review AND errorTypeId was previously empty).
  const autoAdvanceCandidates = claims.filter(c =>
    (c.status === "New" || c.status === "Needs Review") &&
    (c.errorTypeId === null || c.errorTypeId === ""),
  );

  await db.transaction(async (tx) => {
    await tx.update(claimsTable)
      .set({ errorTypeId: String(errorTypeId), errorTypeName })
      .where(inArray(claimsTable.id, claims.map(c => c.id)));

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

  // Audit 2026-05-08 / Fix #5: parity with single-claim PATCH /claims/:id.
  // When that endpoint sets `errorTypeId` for the first time on a New /
  // Needs Review claim, it auto-advances the status to "Needs Evidence"
  // via `transitionClaimStatus` (which also refreshes disposition).
  // Bulk-assign skipped that step, leaving the bulk path's rows stranded
  // in "New" with an errorType — out of sync with single-claim behavior.
  // Run the transition per-qualifying-row outside the txn above; the
  // canonical helper carries its own atomicity + refresh.
  const actor = actorFromReq(req);
  for (const claim of autoAdvanceCandidates) {
    await transitionClaimStatus({
      claimId: claim.id,
      newStatus: "Needs Evidence",
      source: "auto_after_classify",
      reason: `Auto-advanced after error type classified (${errorTypeName})`,
      actor,
      systemOverride: true,
    });
  }

  for (const claim of claims) {
    emitClaimEvent(claim.id, "claim_edited", req);
  }

  res.json({
    updated: claims.length,
    updatedItems: claims.map(c => ({ id: c.id, refNumber: c.confNumber })),
    skipped,
  });
}));

router.patch("/claims/:id/closure-review", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await blockMutationOnTourSampleClaim(id, res)) return;

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
  // Mirror of the admit predicate in /claims/attestation-pending: count
  // both Approved-family verdict legs AND MAS-Eligible-routed legs.
  // See the longer comment on that route for the rationale.
  const rows = await db
    .select({ state: claimsTable.attestationState, count: count() })
    .from(claimsTable)
    .where(and(
      or(
        inArray(claimsTable.outcome, ["Approved", "Partially Approved"]),
        eq(claimsTable.status, "MAS Eligible"),
      ),
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
  if (await blockMutationOnTourSampleClaim(id, res)) return;
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
            // Sibling-duplicate legs derive to "duplicate" ahead of
            // "needs_classification"; omitting this column would cause
            // them to look unclassified and incorrectly block the
            // auto-advance cascade. See Task #196 / sibling-duplicate spec.
            duplicateOfClaimId: claimsTable.duplicateOfClaimId,
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
  if (await blockMutationOnTourSampleClaim(id, res)) return;
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
  }

  // Wave D-PR2b: terminal SOP outcomes flow through `setClaimDisposition`
  // so the canonical `claims.disposition` column is stamped alongside
  // the legacy mirrors (sop_outcome, drop_reason, dropped_at, ready_at)
  // in one UPDATE. Mid-walk advances bypass the writer (no terminal
  // disposition to stamp) and just save sopAnswers/sopNodeId; the
  // downstream `refreshClaimDenormalizedCache` recomputes their
  // `classifying` disposition from `errorTypeId != null`.
  let updated: typeof claimsTable.$inferSelect | null;
  if (isTerminal && nextSopOutcome) {
    updated = await setClaimDisposition(id, sopOutcomeToDisposition(nextSopOutcome), {
      isTerminal: true,
      extraFields: updateData,
    });
  } else {
    [updated] = await db
      .update(claimsTable)
      .set(updateData)
      .where(eq(claimsTable.id, id))
      .returning();
  }

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

// ────────────────────────────────────────────────────────────────────────
// Task #525 — Per-leg SOP rewind & restart.
//
// Three mutating endpoints + one read-only impact-preview endpoint let
// the queue v3 wizard pop the last SOP answer, jump back to a prior
// node, or wipe a leg's walk while preserving its `errorTypeId`. When
// the parent invoice group already has a generated dispute draft
// (`previewGeneratedAt` set) or a reviewed stamp (`draftReviewedAt`
// set), a rewind requires the explicit `discardDraft: true` flag so
// the cached subject/body get cleared atomically. Without the flag
// the server returns 409 carrying the impact preview so the client
// can render the heavy R5 confirm dialog.
//
// Auth + role gating: every mutating endpoint applies `denyClerk` (the
// per-leg `/sop-advance` predates the role split and runs without it,
// but rewind is destructive enough to gate consistently with the bulk
// SOP routes; tests pin the 403 for clerks).
// ────────────────────────────────────────────────────────────────────────

type RewindAction = "back-step" | "jump" | "restart";

type SopAnswerRow = { nodeId: string; answer: string; ts: string };

function asSopAnswerRows(raw: unknown): SopAnswerRow[] {
  return Array.isArray(raw) ? (raw as SopAnswerRow[]) : [];
}

interface RewindPlan {
  // How many recorded answers will be removed by the action.
  answersToPop: number;
  // The leg's nextSopNodeId after the rewind. For back-step / jump
  // this is the popped row's nodeId (or the slice-from row's nodeId).
  // For restart it's the tree's rootId.
  nextSopNodeId: string | null;
  // Snapshot of the verdict that will be cleared, if currently terminal.
  currentSopOutcome: string | null;
  // True iff the leg currently carries a terminal verdict that the
  // rewind will clear (sopOutcome / dropReason / readyAt all null out).
  clearsTerminal: boolean;
  // Restart removes claim_evidence rows tied to the walk. Other actions
  // leave evidence alone so the operator can re-bind it on the next
  // pass. This is the count of rows that WILL be deleted (always 0 for
  // back-step / jump).
  evidenceWillBeCleared: number;
}

/** Pure planner: never touches the DB. Caller is responsible for
 *  loading the leg + tree and validating preconditions. */
function planRewind(
  leg: typeof claimsTable.$inferSelect,
  action: RewindAction,
  targetNodeId: string | null,
  tree: SopTree | null,
  evidenceCount: number,
): RewindPlan | { error: string; status: 400 | 409 } {
  const answers = asSopAnswerRows(leg.sopAnswers);

  if (action === "back-step") {
    if (answers.length === 0) {
      return { status: 409, error: "Leg has no recorded SOP answers to pop" };
    }
    const popped = answers[answers.length - 1];
    return {
      answersToPop: 1,
      nextSopNodeId: popped.nodeId,
      currentSopOutcome: leg.sopOutcome,
      clearsTerminal: leg.sopOutcome != null,
      evidenceWillBeCleared: 0,
    };
  }

  if (action === "jump") {
    if (!targetNodeId) {
      return { status: 400, error: "nodeId is required for jump" };
    }
    if (answers.length === 0) {
      return { status: 409, error: "Leg has no recorded SOP answers to jump from" };
    }
    const idx = answers.findIndex((a) => a.nodeId === targetNodeId);
    if (idx < 0) {
      return {
        status: 409,
        error: `nodeId "${targetNodeId}" was never visited in this leg's walk`,
      };
    }
    const toPop = answers.length - idx;
    return {
      answersToPop: toPop,
      nextSopNodeId: targetNodeId,
      currentSopOutcome: leg.sopOutcome,
      clearsTerminal: leg.sopOutcome != null,
      evidenceWillBeCleared: 0,
    };
  }

  // restart
  return {
    answersToPop: answers.length,
    nextSopNodeId: tree?.rootId ?? null,
    currentSopOutcome: leg.sopOutcome,
    clearsTerminal: leg.sopOutcome != null,
    evidenceWillBeCleared: evidenceCount,
  };
}

interface DraftImpact {
  draftWillBeDiscarded: boolean;
  previewGeneratedAt: Date | null;
  draftReviewedAt: Date | null;
}

function computeDraftImpact(
  group: typeof invoiceGroupsTable.$inferSelect | null,
): DraftImpact {
  if (!group) {
    return { draftWillBeDiscarded: false, previewGeneratedAt: null, draftReviewedAt: null };
  }
  const previewGeneratedAt = group.previewGeneratedAt ?? null;
  const draftReviewedAt = group.draftReviewedAt ?? null;
  return {
    draftWillBeDiscarded: previewGeneratedAt != null || draftReviewedAt != null,
    previewGeneratedAt,
    draftReviewedAt,
  };
}

async function loadTreeForLeg(leg: typeof claimsTable.$inferSelect): Promise<SopTree | null> {
  if (!leg.errorTypeId) return null;
  const [errorType] = await db
    .select({ decisionTree: errorTypesTable.decisionTree })
    .from(errorTypesTable)
    .where(eq(errorTypesTable.id, Number(leg.errorTypeId)));
  return (errorType?.decisionTree as unknown as SopTree | null) ?? null;
}

async function countWalkEvidence(claimId: number): Promise<number> {
  const rows = await db
    .select({ id: claimEvidenceTable.id })
    .from(claimEvidenceTable)
    .where(and(
      eq(claimEvidenceTable.claimId, claimId),
      isNotNull(claimEvidenceTable.treeNodeId),
    ));
  return rows.length;
}

// GET /claims/:id/sop-rewind-impact — light read-only preview of what a
// rewind action would change. Powers R5's light-vs-heavy confirm
// dialog (heavy ⇔ `draftWillBeDiscarded === true`).
router.get("/claims/:id/sop-rewind-impact", denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const action = String(req.query.action ?? "") as RewindAction;
  if (action !== "back-step" && action !== "jump" && action !== "restart") {
    res.status(400).json({ error: "action must be one of: back-step, jump, restart" });
    return;
  }
  const targetNodeId = req.query.nodeId != null ? String(req.query.nodeId) : null;

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  const tree = await loadTreeForLeg(leg);
  const evidenceCount = action === "restart" ? await countWalkEvidence(id) : 0;
  const plan = planRewind(leg, action, targetNodeId, tree, evidenceCount);
  if ("error" in plan) {
    res.status(plan.status).json({ error: plan.error });
    return;
  }

  let draftImpact: DraftImpact = { draftWillBeDiscarded: false, previewGeneratedAt: null, draftReviewedAt: null };
  if (leg.invoiceGroupId != null) {
    const [group] = await db
      .select()
      .from(invoiceGroupsTable)
      .where(eq(invoiceGroupsTable.id, leg.invoiceGroupId));
    draftImpact = computeDraftImpact(group ?? null);
  }

  res.json({
    action,
    answersToPop: plan.answersToPop,
    nextSopNodeId: plan.nextSopNodeId,
    currentSopOutcome: plan.currentSopOutcome,
    clearsTerminal: plan.clearsTerminal,
    evidenceWillBeCleared: plan.evidenceWillBeCleared,
    draftWillBeDiscarded: draftImpact.draftWillBeDiscarded,
    previewGeneratedAt: draftImpact.previewGeneratedAt,
    draftReviewedAt: draftImpact.draftReviewedAt,
  });
}));

interface RewindExecuteParams {
  req: Request;
  res: import("express").Response;
  legId: number;
  action: RewindAction;
  targetNodeId: string | null;
  discardDraft: boolean;
}

async function executeRewind(params: RewindExecuteParams): Promise<void> {
  const { req, res, legId, action, targetNodeId, discardDraft } = params;

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, legId));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }
  if (!leg.errorTypeId) {
    res.status(409).json({
      error: "Leg has no error type — nothing to rewind",
      expectedState: "classified",
      actualState: "unclassified",
    });
    return;
  }

  const tree = await loadTreeForLeg(leg);
  if (action === "restart" && !tree) {
    res.status(400).json({ error: "Error type has no decision tree" });
    return;
  }
  const evidenceCount = action === "restart" ? await countWalkEvidence(legId) : 0;
  const plan = planRewind(leg, action, targetNodeId, tree, evidenceCount);
  if ("error" in plan) {
    res.status(plan.status).json({ error: plan.error });
    return;
  }

  // Draft-invalidation gate. If the parent group has a generated draft
  // or a reviewed stamp, the operator must opt in via `discardDraft`.
  let parentGroup: typeof invoiceGroupsTable.$inferSelect | null = null;
  if (leg.invoiceGroupId != null) {
    const [g] = await db
      .select()
      .from(invoiceGroupsTable)
      .where(eq(invoiceGroupsTable.id, leg.invoiceGroupId));
    parentGroup = g ?? null;
  }
  const draftImpact = computeDraftImpact(parentGroup);
  if (draftImpact.draftWillBeDiscarded && !discardDraft) {
    res.status(409).json({
      code: "draft_discard_required",
      error: "Parent group has a generated dispute draft. Re-send with discardDraft=true to proceed.",
      impact: {
        action,
        answersToPop: plan.answersToPop,
        nextSopNodeId: plan.nextSopNodeId,
        currentSopOutcome: plan.currentSopOutcome,
        clearsTerminal: plan.clearsTerminal,
        evidenceWillBeCleared: plan.evidenceWillBeCleared,
        draftWillBeDiscarded: true,
        previewGeneratedAt: draftImpact.previewGeneratedAt,
        draftReviewedAt: draftImpact.draftReviewedAt,
      },
    });
    return;
  }

  const answers = asSopAnswerRows(leg.sopAnswers);
  const nextAnswers: SopAnswerRow[] =
    action === "restart"
      ? []
      : action === "back-step"
        ? answers.slice(0, -1)
        : answers.slice(0, answers.findIndex((a) => a.nodeId === targetNodeId));

  // Wave D-PR2b clearing path: this route writes legacy mirror columns
  // to null directly. The cache helper recomputes the canonical
  // `disposition` from the cleared inputs (back to `classifying`
  // because `errorTypeId` is preserved). See the doc comment in
  // `lib/leg-state/set-claim-disposition.ts` ("Clearing paths").
  const update: Partial<typeof claimsTable.$inferInsert> = {
    sopAnswers: nextAnswers,
    sopNodeId: plan.nextSopNodeId,
    sopOutcome: null,
    dropReason: null,
    dropNote: null,
    droppedAt: null,
    readyAt: null,
    // MAS derivation re-runs from the cleared sopOutcome — reset to
    // null so a popped `cannot_dispute` terminal stops requiring a
    // MAS cancellation. Mirrors the reclassify route.
    masActionRequired: null,
    masActionCompletedAt: null,
    masActionCompletedBy: null,
    masActionNote: null,
  };

  let updated: typeof claimsTable.$inferSelect | null = null;
  let groupAfterDraftDiscard: typeof invoiceGroupsTable.$inferSelect | null = parentGroup;

  await db.transaction(async (tx) => {
    const [u] = await tx
      .update(claimsTable)
      .set(update)
      .where(eq(claimsTable.id, legId))
      .returning();
    updated = u;

    if (action === "restart") {
      await tx
        .delete(claimEvidenceTable)
        .where(and(
          eq(claimEvidenceTable.claimId, legId),
          isNotNull(claimEvidenceTable.treeNodeId),
        ));
    }

    if (discardDraft && parentGroup && draftImpact.draftWillBeDiscarded) {
      const [gAfter] = await tx
        .update(invoiceGroupsTable)
        .set({
          previewGeneratedAt: null,
          previewGeneratedBy: null,
          draftSubject: null,
          draftDescriptionHtml: null,
          aiBaselineSubject: null,
          aiBaselineDescriptionHtml: null,
          draftReviewedAt: null,
          draftReviewedBy: null,
        })
        .where(eq(invoiceGroupsTable.id, parentGroup.id))
        .returning();
      groupAfterDraftDiscard = gAfter ?? parentGroup;

      await tx.insert(auditLogsTable).values({
        invoiceGroupId: parentGroup.id,
        action: "group_draft_discarded",
        details: `Dispute draft discarded as part of leg #${legId} ${action}`,
        metadata: {
          source: "leg_sop_rewound",
          claimId: legId,
          rewindAction: action,
          previewGeneratedAt: draftImpact.previewGeneratedAt,
          draftReviewedAt: draftImpact.draftReviewedAt,
        },
        userEmail: req.user?.email ?? null,
        userName: req.user?.displayName ?? null,
      });
    }

    await tx.insert(auditLogsTable).values({
      claimId: legId,
      invoiceGroupId: leg.invoiceGroupId,
      action: "leg_sop_rewound",
      details:
        action === "restart"
          ? "SOP walk restarted"
          : action === "back-step"
            ? "SOP walk rewound one step"
            : `SOP walk jumped back to node ${targetNodeId}`,
      metadata: {
        kind: action,
        targetNodeId,
        answersPopped: plan.answersToPop,
        clearedSopOutcome: plan.currentSopOutcome,
        evidenceCleared: plan.evidenceWillBeCleared,
        draftDiscarded: draftImpact.draftWillBeDiscarded && discardDraft,
        previousSopNodeId: leg.sopNodeId,
      },
      userEmail: req.user?.email ?? null,
      userName: req.user?.displayName ?? null,
    });
  });

  await emitStateEvent({
    eventKey: "leg.sop_rewound",
    claimId: legId,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    metadata: {
      kind: action,
      targetNodeId,
      answersPopped: plan.answersToPop,
      draftDiscarded: draftImpact.draftWillBeDiscarded && discardDraft,
    },
  });
  await refreshClaimDenormalizedCache(legId);
  if (leg.invoiceGroupId != null) await refreshGroupDerivedFields(leg.invoiceGroupId);
  emitClaimEvent(legId, "sop_rewound", req);

  void groupAfterDraftDiscard; // explicit no-op — surface var keeps the
                                // discard branch readable; not returned
                                // (client refetches the group via SSE).
  res.json(updated);
}

router.post("/claims/:id/sop-back-step", denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await blockMutationOnTourSampleClaim(id, res)) return;
  const discardDraft = req.body?.discardDraft === true;
  await executeRewind({ req, res, legId: id, action: "back-step", targetNodeId: null, discardDraft });
}));

router.post("/claims/:id/sop-jump", denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await blockMutationOnTourSampleClaim(id, res)) return;
  const nodeId = typeof req.body?.nodeId === "string" ? req.body.nodeId : null;
  if (!nodeId) { res.status(400).json({ error: "nodeId is required" }); return; }
  const discardDraft = req.body?.discardDraft === true;
  await executeRewind({ req, res, legId: id, action: "jump", targetNodeId: nodeId, discardDraft });
}));

router.post("/claims/:id/sop-restart", denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await blockMutationOnTourSampleClaim(id, res)) return;
  const discardDraft = req.body?.discardDraft === true;
  await executeRewind({ req, res, legId: id, action: "restart", targetNodeId: null, discardDraft });
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
  if (await blockMutationOnTourSampleClaim(id, res)) return;
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

  // Wave D-PR2b: stamp canonical disposition alongside legacy mirrors
  // (sop_outcome + drop_reason + dropped_at) in one UPDATE. Conclude-leg
  // is always terminal — the operator is short-circuiting the SOP walk
  // to a terminal outcome — so `isTerminal: true` lets the writer stamp
  // drop_reason from the inverted mirror.
  const now = new Date();
  let updated = await setClaimDisposition(id, sopOutcomeToDisposition(reason), {
    isTerminal: true,
    droppedAt: now,
  });

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
  if (await blockMutationOnTourSampleClaim(id, res)) return;
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

// POST /claims/:id/per-leg-context-readback — Task #372 AI clarification
// gate. The operator's raw, unstructured per-leg note is sent to Claude;
// the model returns a cleaned-up restatement that the operator can
// review side-by-side and Accept (which then persists via
// `/per-leg-context`). No DB writes happen here — only an audit row so
// the activity feed shows the readback was performed. This mirrors the
// preflight-understanding pattern used at the group submission gate
// (portal-submissions.ts: `preflight-understanding`).
//
// We deliberately keep this endpoint simple: there is no state to read
// beyond the raw text from the operator. The leg's existing context
// stays untouched until the operator clicks Accept on the clarified
// output.
router.post("/claims/:id/per-leg-context-readback", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await blockMutationOnTourSampleClaim(id, res)) return;
  const raw = (req.body?.context ?? "") as string;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    res.status(400).json({ error: "context (non-empty string) is required" });
    return;
  }

  // Resolve the leg to (a) confirm it exists, (b) feed identifying
  // metadata into the prompt so the model can reference it naturally,
  // and (c) gate the call on pre-submit phase (a leg whose group has
  // already been submitted shouldn't be re-clarifying its context).
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
      error: "Per-leg context can only be clarified in pre-submit",
      expectedState: "pre-submit",
      actualState: phase,
    });
    return;
  }

  const errorTypeName = leg.errorTypeName || "Unclassified";
  const confNumber = leg.confNumber || `CLM-${leg.id}`;
  const systemPrompt =
    "You are an operator-assist for an NEMT claims dispute team. The operator just typed a quick, unstructured per-leg note explaining what's special about a single leg of a multi-leg invoice. Your job is to restate the same facts in a single tight paragraph (2 to 4 sentences) suitable for handing to the dispute write-up bot. Do not invent facts or speculate. Preserve every concrete detail (times, distances, amounts, names) verbatim. Drop filler and shorthand. If the note is internally contradictory or genuinely ambiguous, restate it faithfully and add a single bracketed clarification request at the end (e.g. '[Operator: which trip leg does \"the second pickup\" refer to?]'). Return only the restatement — no preamble, no JSON.";
  const prompt = `Leg ${confNumber} (error type: ${errorTypeName}).
Operator's raw per-leg note:
${raw.trim()}

Restate the note as described in the system prompt.`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
    system: systemPrompt,
  });
  const textBlock = message.content.find((b: { type: string }) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    res.status(502).json({ error: "Empty AI response" });
    return;
  }
  const readback = (textBlock as { type: "text"; text: string }).text.trim();

  await createAuditLog(id, "leg_per_leg_context_readback", "Per-leg context readback returned", req, {
    rawLength: raw.length,
    readbackLength: readback.length,
  });

  res.json({ readback });
}));

// POST /claims/:id/exclude — mark a needs_classification leg as "not a
// dispute candidate". The leg disappears from the dispute work queues but
// stays visible on the invoice as a clean line.
router.post("/claims/:id/exclude", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await blockMutationOnTourSampleClaim(id, res)) return;

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
  // Task #689 — `handled_offline` requires a substantive note (>=10
  // chars after trimming) so the activity timeline carries enough
  // context to explain why the leg was removed without re-opening it.
  if (reason === "handled_offline" && (!note || note.trim().length < 10)) {
    res.status(400).json({ error: "note required (>=10 characters) when reason=handled_offline" });
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
      // Task #689 — distinct audit action for the "Remove — handled
      // offline" exit so the activity timeline reads "Removed —
      // handled offline" instead of the generic leg-excluded line.
      ...(reason === "handled_offline"
        ? {
            auditAction: "claim_removed_handled_offline",
            auditDetailsPrefix: "Removed — handled offline",
          }
        : {}),
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
            // Sibling-duplicate legs derive to "duplicate" ahead of
            // "needs_classification"; omitting this column would cause
            // them to look unclassified and incorrectly block the
            // auto-advance cascade. See Task #196 / sibling-duplicate spec.
            duplicateOfClaimId: claimsTable.duplicateOfClaimId,
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
  if (leg.invoiceGroupId != null) {
    await refreshGroupDerivedFields(leg.invoiceGroupId);
    // No-op when the MIN(date) didn't move (excluding a leg never
    // changes its `date` value), but routing through the canonical
    // helper keeps every leg-state write path on the same code path.
    await recomputeGroupServiceDate(leg.invoiceGroupId);
  }
  emitClaimEvent(id, "excluded", req);

  res.json(updated);
}));

// POST /claims/:id/include — re-include a previously excluded leg while the
// parent group is still in pre-submit. Two-stage source-state check: leg
// sub-status must be `excluded`, then the parent group must be pre-submit.
router.post("/claims/:id/include", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await blockMutationOnTourSampleClaim(id, res)) return;
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
  if (leg.invoiceGroupId != null) {
    await refreshGroupDerivedFields(leg.invoiceGroupId);
    // Re-include never changes the leg's `date`, so the MIN can't move
    // — but route through the canonical helper so every leg-state write
    // path stays on the same code path. See lib/group-service-date.ts.
    await recomputeGroupServiceDate(leg.invoiceGroupId);
  }
  emitClaimEvent(id, "included", req);

  res.json(updated);
}));

// POST /claims/:id/duplicate-of — mark a leg as a sibling duplicate of
// another leg in the same invoice group. The marked leg derives to
// sub-status `duplicate` (see lib/leg-state) and short-circuits its own
// SOP walk; the gauntlet's gate then pairs its resolution with the
// primary's (see lib/group-readiness).
//
// Validation:
// - Both legs must exist.
// - Self-reference is rejected (a leg cannot be its own duplicate).
// - Both legs must belong to the same invoice group.
// - The primary cannot itself be a sibling duplicate (no chains: A→B→C
//   would make the gate semantics ambiguous).
// - The leg being marked must currently be in {needs_classification,
//   investigating, blocked, ready, dropped}. We refuse from `excluded`
//   (re-include first) and from `duplicate` (use the unmark endpoint
//   first to switch primaries — this keeps event history honest).
// - Parent group must still be pre-submit (no rewriting after filing).
router.post("/claims/:id/duplicate-of", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await blockMutationOnTourSampleClaim(id, res)) return;

  const primaryIdRaw = req.body?.primaryClaimId;
  const primaryId = typeof primaryIdRaw === "number" ? primaryIdRaw : parseInt(String(primaryIdRaw ?? ""), 10);
  if (!Number.isFinite(primaryId)) {
    res.status(400).json({ error: "primaryClaimId required (number)" });
    return;
  }
  if (primaryId === id) {
    res.status(400).json({ error: "A leg cannot be a duplicate of itself" });
    return;
  }

  const note = (req.body?.note ?? null) as string | null;

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  const [primary] = await db.select().from(claimsTable).where(eq(claimsTable.id, primaryId));
  if (!primary) { res.status(404).json({ error: "Primary claim not found" }); return; }

  if (leg.invoiceGroupId == null || leg.invoiceGroupId !== primary.invoiceGroupId) {
    res.status(400).json({ error: "Primary must belong to the same invoice group" });
    return;
  }

  if (primary.duplicateOfClaimId != null) {
    // Disallow chains. The operator should pick the *true* primary directly.
    res.status(400).json({
      error: "Primary is itself a sibling duplicate; pick the original primary",
      primaryPointsAt: primary.duplicateOfClaimId,
    });
    return;
  }

  // Disallow making this leg a duplicate when other legs already point to
  // *it* as primary — that would create an implicit chain
  // (dependent → leg → primary). The operator must first un-mark the
  // dependents so the relationship stays a flat A ← {B, C, …} fan-out.
  const dependents = await db
    .select({ id: claimsTable.id, confNumber: claimsTable.confNumber })
    .from(claimsTable)
    .where(eq(claimsTable.duplicateOfClaimId, id));
  if (dependents.length > 0) {
    res.status(400).json({
      error: "Cannot mark this leg as a sibling duplicate; other legs already point to it as primary (would create a chain)",
      dependentClaimIds: dependents.map((d) => d.id),
    });
    return;
  }

  const subStatus = deriveLegSubStatus(leg);
  const ALLOWED: ReadonlySet<LegSubStatus> = new Set([
    "needs_classification", "investigating", "blocked", "ready", "dropped",
  ]);
  if (!ALLOWED.has(subStatus)) {
    res.status(409).json({
      error: "Cannot mark this leg as duplicate from its current state",
      actualState: subStatus,
      allowedStates: [...ALLOWED],
    });
    return;
  }

  const [parentGroup] = await db
    .select()
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.id, leg.invoiceGroupId));
  if (parentGroup) {
    const phase = getGroupMacroPhase(parentGroup);
    if (phase !== "pre-submit") {
      res.status(409).json({
        error: "Cannot mark a duplicate after the group leaves pre-submit",
        actualState: phase,
      });
      return;
    }
  }

  const [updated] = await db
    .update(claimsTable)
    .set({ duplicateOfClaimId: primaryId })
    .where(eq(claimsTable.id, id))
    .returning();

  await createAuditLog(
    id,
    "leg_marked_duplicate",
    `Marked as sibling duplicate of CLM-${primary.confNumber || primaryId}${note ? `: ${note}` : ""}`,
    req,
    { primaryClaimId: primaryId, primaryConfNumber: primary.confNumber, previousSubStatus: subStatus, note },
  );
  await emitStateEvent({
    eventKey: "leg.marked_duplicate",
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    metadata: { primaryClaimId: primaryId, previousSubStatus: subStatus },
  });
  await refreshClaimDenormalizedCache(id);
  await refreshGroupDerivedFields(leg.invoiceGroupId);
  // Marking a leg as a sibling duplicate doesn't change its `date`, so
  // the group's MIN can't shift — recomputing here is a defensive
  // no-op that keeps every group-mutating leg-state route funneling
  // through the canonical helper. See lib/group-service-date.ts.
  await recomputeGroupServiceDate(leg.invoiceGroupId);
  emitClaimEvent(id, "marked_duplicate", req);

  res.json(updated);
}));

// DELETE /claims/:id/duplicate-of — clear the sibling-duplicate pointer
// on a leg. The leg derives back to its underlying state (typically
// `needs_classification` if no errorType is set, or whichever state its
// other fields imply). Pre-submit only.
router.delete("/claims/:id/duplicate-of", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await blockMutationOnTourSampleClaim(id, res)) return;

  const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!leg) { res.status(404).json({ error: "Claim not found" }); return; }

  if (leg.duplicateOfClaimId == null) {
    res.status(409).json({ error: "Leg is not marked as a duplicate" });
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
          error: "Cannot unmark a duplicate after the group leaves pre-submit",
          actualState: phase,
        });
        return;
      }
    }
  }

  const previousPrimaryId = leg.duplicateOfClaimId;

  const [updated] = await db
    .update(claimsTable)
    .set({ duplicateOfClaimId: null })
    .where(eq(claimsTable.id, id))
    .returning();

  await createAuditLog(
    id,
    "leg_unmarked_duplicate",
    `Cleared sibling-duplicate pointer (was CLM-${previousPrimaryId})`,
    req,
    { previousPrimaryClaimId: previousPrimaryId },
  );
  await emitStateEvent({
    eventKey: "leg.unmarked_duplicate",
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    metadata: { previousPrimaryClaimId: previousPrimaryId },
  });
  await refreshClaimDenormalizedCache(id);
  if (leg.invoiceGroupId != null) {
    await refreshGroupDerivedFields(leg.invoiceGroupId);
    // Same defensive no-op as the mark route above — un-marking doesn't
    // mutate `date`, but the canonical helper is the single sanctioned
    // write path for `service_date`.
    await recomputeGroupServiceDate(leg.invoiceGroupId);
  }
  emitClaimEvent(id, "unmarked_duplicate", req);

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
  if (await blockMutationOnTourSampleClaim(id, res)) return;

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
  if (await blockMutationOnTourSampleClaim(id, res)) return;
  const source = (req.body?.source ?? "") as string;
  const outcome = (req.body?.outcome ?? "") as string;
  const note = (req.body?.note ?? null) as string | null;
  const confidence = req.body?.confidence ?? null;
  const reasoning = (req.body?.reasoning ?? null) as string | null;
  const inspectionTimeMs = req.body?.inspectionTimeMs ?? null;
  // Task #301: opt-in flag for the legacy reconcile path. When true, the
  // sop_outcome gate is skipped (but every other source-state check still
  // runs). Reserved for legs that pre-date the invoice-group flow and
  // never had `sop_outcome` populated. Requires a non-empty operator note
  // so the audit row carries a human-supplied reason.
  const reconcile = req.body?.reconcile === true;

  if (
    source !== "ai_suggested" &&
    source !== "operator_confirmed" &&
    source !== "operator_draft"
  ) {
    res.status(400).json({
      error: "source must be ai_suggested, operator_confirmed, or operator_draft",
    });
    return;
  }
  if (!(VERDICT_OUTCOMES as readonly string[]).includes(outcome)) {
    res.status(400).json({ error: `outcome must be one of: ${VERDICT_OUTCOMES.join(", ")}` });
    return;
  }
  if (reconcile) {
    // Reconcile is operator-only — the AI never lands on a pre-group leg.
    if (source !== "operator_confirmed") {
      res.status(400).json({ error: "reconcile is only valid with source=operator_confirmed" });
      return;
    }
    if (typeof note !== "string" || note.trim().length === 0) {
      res.status(400).json({ error: "reconcile requires a non-empty note" });
      return;
    }
  }
  // Task #343: drafts are operator-only and don't carry the calibration
  // payload an AI suggestion does. Strip those fields out so we never
  // accidentally persist confidence/reasoning/inspection on a draft row.
  const isDraft = source === "operator_draft";

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
  // uniformly. The `reconcile` flag bypasses ONLY the sop_outcome gate
  // below — `included_in_dispute` is still required.
  if (!leg.includedInDispute) {
    res.status(409).json({
      error: "Leg was not included in the dispute",
      expectedState: "included_in_dispute",
      actualState: "excluded",
    });
    return;
  }
  const submittedSopOutcomes = new Set(["portal_dispute", "dispute"]);
  if (!reconcile && !submittedSopOutcomes.has(leg.sopOutcome ?? "")) {
    res.status(409).json({
      error: "Cannot record a verdict on a leg that wasn't submitted",
      reason: "leg_not_in_submission",
      expectedState: "sop_outcome ∈ {portal_dispute, dispute}",
      actualState: leg.sopOutcome ?? "null",
    });
    return;
  }

  const [verdictRow] = await db.insert(claimVerdictTable).values({
    claimId: id,
    source,
    // Drafts deliberately drop note/confidence/reasoning/inspection fields
    // — the picker no longer collects them and they're calibration-only
    // signals that don't apply to a non-terminal selection.
    outcome,
    note: isDraft ? null : note,
    confidence: !isDraft && confidence != null ? String(confidence) : null,
    reasoning: isDraft ? null : reasoning,
    createdBy: req.user?.email ?? null,
    inspectionTimeMs: !isDraft && inspectionTimeMs != null ? Number(inspectionTimeMs) : null,
  }).returning();

  // Audit + state-event metadata carries `reason: "legacy_reconciliation"`
  // when the reconcile bypass was used so the row is traceable in audit
  // and observability without inventing a separate action key.
  const auditMetadata: Record<string, unknown> = {
    source,
    outcome,
    confidence,
    inspectionTimeMs,
  };
  const eventMetadata: Record<string, unknown> = { source, outcome, confidence };
  if (reconcile) {
    auditMetadata.reason = "legacy_reconciliation";
    eventMetadata.reason = "legacy_reconciliation";
  }
  // Action / event keys per source. Drafts are append-only like the
  // others but get their own vocabulary so the audit trail makes the
  // non-terminal nature obvious.
  const auditAction =
    source === "ai_suggested"
      ? "leg_verdict_suggested"
      : source === "operator_draft"
        ? "leg_verdict_drafted"
        : "leg_verdict_confirmed";
  const eventKey =
    source === "ai_suggested"
      ? "leg.verdict_suggested"
      : source === "operator_draft"
        ? "leg.verdict_drafted"
        : "leg.verdict_confirmed";
  await createAuditLog(
    id,
    auditAction,
    reconcile
      ? `Verdict ${outcome} (${source}, legacy_reconciliation)`
      : `Verdict ${outcome} (${source})`,
    req,
    auditMetadata,
  );
  await emitStateEvent({
    eventKey,
    claimId: id,
    invoiceGroupId: leg.invoiceGroupId,
    actorUserId: req.user?.email ?? null,
    durationMs: !isDraft && inspectionTimeMs != null ? Number(inspectionTimeMs) : null,
    metadata: eventMetadata,
  });

  // Cache refresh runs for the two terminal sources only. Drafts MUST
  // NOT touch the denormalized `claims.outcome` — that column is what
  // moves the group out of `response-pending`, and Step 4 hasn't been
  // committed yet. (See `refreshClaimDenormalizedCache` for the matching
  // server-side filter that ignores draft rows when picking the latest
  // verdict.)  Operator-only side effects (MAS derivation, attestation
  // gate, group derivations) follow.
  if (!isDraft) {
    await refreshClaimDenormalizedCache(id);
  }

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
  emitClaimEvent(id, isDraft ? "verdict_drafted" : "verdict_recorded", req);

  res.json(verdictRow);
}));

// DELETE /claims/:id/verdict/draft — Task #344. Hard-deletes every
// `operator_draft` row for the leg so the per-leg picker on Responses
// Awaiting Review can render with no pill lit. This is the "click the
// lit pill to clear" affordance: operators who pick Approved/Denied
// by mistake can unset the draft without having to confirm the
// opposite verdict first.
//
// Append-only-ness is preserved for terminal verdict rows
// (`operator_confirmed`, `ai_suggested`) — those are NEVER touched
// here. Drafts are explicitly transient state with no downstream
// effects (no MAS, no attestation, no denormalized cache write), so
// hard-delete is safe.
//
// Idempotent: when there are no drafts to clear, returns
// `clearedCount: 0` without error.
router.delete("/claims/:id/verdict/draft", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await blockMutationOnTourSampleClaim(id, res)) return;

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

  // Same group-aware macro phase gate as POST /verdict — once Step 4
  // has been committed (drafts promoted, group moved on), there's no
  // longer a draft to clear and we refuse the call.
  const macroPhase = getGroupMacroPhase(group);
  if (macroPhase !== "response-pending") {
    res.status(409).json({
      error: "Group is not in the response-pending phase",
      expectedState: "response-pending",
      actualState: macroPhase,
    });
    return;
  }

  const deleted = await db
    .delete(claimVerdictTable)
    .where(and(
      eq(claimVerdictTable.claimId, id),
      eq(claimVerdictTable.source, "operator_draft"),
    ))
    .returning({ id: claimVerdictTable.id });

  // Audit + state-event are only worth writing when something actually
  // changed — keeps the audit log clean for the idempotent no-op case.
  if (deleted.length > 0) {
    await createAuditLog(
      id,
      "leg_verdict_draft_cleared",
      `Cleared ${deleted.length} draft verdict row(s) for ${leg.confNumber}`,
      req,
      { clearedCount: deleted.length },
    );
    await emitStateEvent({
      eventKey: "leg.verdict_draft_cleared",
      claimId: id,
      invoiceGroupId: leg.invoiceGroupId,
      actorUserId: req.user?.email ?? null,
      durationMs: null,
      metadata: { clearedCount: deleted.length },
    });
    emitClaimEvent(id, "verdict_draft_cleared", req);
  }

  res.json({ clearedCount: deleted.length });
}));

// POST /claims/:id/mas-action/complete — operator stamps that they
// completed the MAS cancel for this leg. Source-state contract:
// `mas_action_required = 'cancel'` AND `mas_action_completed_at IS NULL`.
router.post("/claims/:id/mas-action/complete", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await blockMutationOnTourSampleClaim(id, res)) return;
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

import { Router, type IRouter, type Request } from "express";
import { eq, or, ilike, desc, asc, and, count, inArray, isNull, isNotNull, ne, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { invoiceGroupsTable, claimsTable, auditLogsTable, notesTable, portalSubmissionsTable, portalResponsesTable, claimEvidenceTable, claimVerdictTable, claimStatusEnum, errorTypesTable } from "@workspace/db";
import { deriveLegSubStatus } from "@workspace/leg-state";
import { emitStateEvent } from "../lib/state-events";
import { allDisputedLegsResolved, RESOLVED_LEG_SUB_STATUSES } from "../lib/group-readiness";
import { computeGroupReadiness } from "../lib/group-packaging";
import { refreshGroupDerivedFields, getGroupMacroPhase, refreshClaimDenormalizedCache } from "../lib/denormalized-cache";
import { getMacroPhase } from "../lib/macro-phase";
import { computeAttestationDelta } from "../lib/attestation";
import { applyMasDerivationsForLeg } from "../lib/mas-derivations";
import { asyncHandler } from "../lib/asyncHandler";
import { broadcastGroupEvent, broadcastClaimEvent } from "../lib/sse";
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
import {
  isPayorDenialReasonCode,
  PAYOR_DENIAL_REASON_CODES,
} from "@workspace/payor-denial-reasons";
import { buildInvoiceGroupExpiringCondition, parseExpiringMode } from "../lib/expiring-filter";
import { effectiveDaysRemaining, isAtOrPastEffectiveDeadline, isUrgentDeadline, serverTodayKey } from "../lib/dates";
import { canSeeAmounts, dropAmountFiltersForUser, scrubMoneyFields, scrubMoneyFieldsArray } from "../lib/role";
import { denyClerk } from "../middlewares/denyClerk";
import {
  generatePortalDraftForGroup,
  GroupNotFoundError,
  LLMUnavailableError,
  NoEligibleLegsError,
} from "./portal-submissions";
import {
  GROUP_EXPIRING_ACTIONABLE_STATUSES,
  GROUP_SUBMITTED_STUCK_STATUSES,
} from "./dashboard";
import {
  classifyGroupServiceDateReason,
  GROUP_SERVICE_DATE_REASONS,
  type GroupServiceDateReason,
  type ServiceDateReasonLeg,
} from "../lib/group-no-date-reason";

// A group is only "on the 30-day clock" while its status is one we still
// owe action on. Once it's `Portal Queued` (operator submitted via the
// portal — clock satisfied), `Awaiting Response`, or otherwise concluded
// the urgency signal stops applying at the GROUP level, even if the
// calendar deadline has slipped. See dashboard.ts for the full rule and
// why this set diverges from the claim-level set.
const GROUP_ON_CLOCK_STATUSES = new Set<string>(GROUP_EXPIRING_ACTIONABLE_STATUSES);

// Earliest service date for a group is read straight off the typed,
// indexed `invoice_groups.service_date` column. Maintained on every
// write path by `recomputeGroupServiceDate` (lib/group-service-date.ts);
// see Task #350 for the cutover from the per-query MIN() subquery this
// expression replaces. The select returns ISO YYYY-MM-DD via `to_char`
// so the JS deadline helpers receive the same shape they always have,
// regardless of whether the `pg` driver hands `date` back as Date or
// string at the connection level. (Pairs with Task #351, which made
// `claims.date` itself a typed DATE column — the recompute helper now
// reads typed Date values straight off `claims.date`.)
const earliestServiceDateExpr = sql<string | null>`to_char(${invoiceGroupsTable.serviceDate}, 'YYYY-MM-DD')`;

// "Submitted but unconfirmed" — Task #352. Subset of statuses that
// represent groups the operator has already pushed through the portal.
// At the GROUP level only `Portal Queued` qualifies (Processed is
// claim-only). The per-row `submittedStuck` flag drives the parallel
// "stuck after submission" badge variant on the Queue and lists; it
// pairs with `isUrgent` rather than replacing it (stuck rows are also
// urgent today, but the operator's next action is "chase confirmation"
// not "file the dispute").
const GROUP_STUCK_STATUSES = new Set<string>(GROUP_SUBMITTED_STUCK_STATUSES);

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
  // Post-upload triage bridge filter: scope the listing to a single
  // import batch so the bridge UI can show ONLY the groups created by
  // the just-completed import. The batch tag is a free-form text
  // column populated by the importer (`import_<timestamp>`); we accept
  // an exact match only to keep the predicate cheap and unambiguous.
  const importBatch = query.importBatch as string | undefined;

  const conditions: SQL[] = [];

  if (importBatch && typeof importBatch === "string" && importBatch.length > 0) {
    conditions.push(eq(invoiceGroupsTable.importBatch, importBatch));
  }

  let statusFilterIncludesExpired = false;
  if (status && typeof status === "string") {
    const statuses = status.split(",").map(s => s.trim()).filter(Boolean) as (typeof invoiceGroupsTable.status.enumValues)[number][];
    statusFilterIncludesExpired = statuses.includes("Expired");
    if (statuses.length === 1) {
      conditions.push(eq(invoiceGroupsTable.status, statuses[0]));
    } else if (statuses.length > 1) {
      const statusOr = or(...statuses.map(s => eq(invoiceGroupsTable.status, s)));
      if (statusOr) conditions.push(statusOr);
    }
  }

  // Hide Expired by default everywhere. The flag is opt-in via the
  // `Show expired` toggle on the Queue / Claims / Groups pages, or
  // implicitly enabled when the caller already filtered to a status
  // set that includes Expired (in which case suppressing the rows
  // they explicitly asked for would be confusing). See spec.
  const includeExpiredFlag = String(query.includeExpired ?? "").toLowerCase() === "true";
  // `urgent` (≤ today) and `stuck` (past deadline) intentionally
  // include past-deadline rows; `soon` (1..SOON_DAYS) does not.
  const expiringModeRaw = parseExpiringMode(query.expiring);
  const expiringModeIncludesPastDeadline =
    expiringModeRaw === "urgent" || expiringModeRaw === "stuck";
  if (!includeExpiredFlag && !statusFilterIncludesExpired) {
    conditions.push(ne(invoiceGroupsTable.status, "Expired"));
    // Hide groups whose effective filing deadline has slipped (any
    // status with a service date). Bypassed under
    // `?expiring=urgent|stuck`, where those rows are the view.
    if (!expiringModeIncludesPastDeadline) {
      const dateExpr = sql`${invoiceGroupsTable.serviceDate}`;
      const effectiveDeadlineSql = sql`(
        CASE EXTRACT(DOW FROM (${dateExpr} + INTERVAL '30 days'))
          WHEN 6 THEN ((${dateExpr} + INTERVAL '30 days')::date - INTERVAL '1 day')::date
          WHEN 0 THEN ((${dateExpr} + INTERVAL '30 days')::date - INTERVAL '2 days')::date
          ELSE (${dateExpr} + INTERVAL '30 days')::date
        END
      )`;
      conditions.push(
        sql`NOT (${invoiceGroupsTable.serviceDate} IS NOT NULL AND ${effectiveDeadlineSql} < CURRENT_DATE)`,
      );
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

  // `errorTypeAssigned=true` restricts to classified groups so the
  // Verdict Pending workspace's count reflects the visible rows.
  const errorTypeAssignedFlag = String(query.errorTypeAssigned ?? "").toLowerCase() === "true";
  if (errorTypeAssignedFlag) {
    conditions.push(isNotNull(invoiceGroupsTable.errorTypeId));
    conditions.push(ne(invoiceGroupsTable.errorTypeId, ""));
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

  // Missing-service-date facet (Task #353). The sub-reason filter
  // implies the boolean filter, so passing only `missingServiceDateReason`
  // is enough — this matches the contract documented on the openapi
  // spec and keeps the URL short for deep-linkable filter chips.
  const missingReasonRaw = typeof query.missingServiceDateReason === "string"
    ? query.missingServiceDateReason
    : "";
  const missingReason = missingReasonRaw && missingReasonRaw !== "has_date"
    && (GROUP_SERVICE_DATE_REASONS as readonly string[]).includes(missingReasonRaw)
    ? (missingReasonRaw as Exclude<GroupServiceDateReason, "has_date">)
    : null;
  const missingFlag = String(query.missingServiceDate ?? "").toLowerCase() === "true";
  if (missingReason || missingFlag) {
    conditions.push(buildMissingServiceDateCondition(missingReason));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

// SQL builder for the "Missing service date" facet. The base predicate
// is `service_date IS NULL`; the optional sub-reason narrows further
// using EXISTS subqueries against `claims` so the work stays in the
// database (no JS-side post-filter that would break pagination + counts).
//
// Keep these SQL fragments aligned with the JS classifier in
// `lib/group-no-date-reason.ts`:
//   - parse_failed is effectively unreachable now that `claims.date`
//     is a typed DATE column (NULL == no date; non-null always parses)
//     so we treat it as the empty set in SQL.
//   - all_dated_legs_excluded uses `is distinct from false` so an
//     unset `included_in_dispute` (which the schema defaults to true)
//     and an explicit `true` are both treated as "active".
function buildMissingServiceDateCondition(
  reason: Exclude<GroupServiceDateReason, "has_date"> | null,
): SQL {
  const baseNull = isNull(invoiceGroupsTable.serviceDate);

  if (reason === "no_claims") {
    return and(
      baseNull,
      sql`not exists (
        select 1 from claims c
        where c.invoice_group_id = ${invoiceGroupsTable.id}
      )`,
    ) as SQL;
  }

  if (reason === "no_dated_claims") {
    return and(
      baseNull,
      sql`exists (
        select 1 from claims c
        where c.invoice_group_id = ${invoiceGroupsTable.id}
      )`,
      sql`not exists (
        select 1 from claims c
        where c.invoice_group_id = ${invoiceGroupsTable.id}
          and c.date is not null
      )`,
    ) as SQL;
  }

  if (reason === "all_dated_legs_excluded") {
    return and(
      baseNull,
      sql`exists (
        select 1 from claims c
        where c.invoice_group_id = ${invoiceGroupsTable.id}
          and c.date is not null
      )`,
      sql`not exists (
        select 1 from claims c
        where c.invoice_group_id = ${invoiceGroupsTable.id}
          and c.date is not null
          and c.included_in_dispute is distinct from false
          and c.duplicate_of_claim_id is null
      )`,
    ) as SQL;
  }

  if (reason === "parse_failed") {
    // Unreachable in the typed-DATE world (see comment above). Match
    // the empty set so the filter renders no rows rather than silently
    // collapsing to "everything missing".
    return and(baseNull, sql`false`) as SQL;
  }

  return baseNull;
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
        // Defensive guard for Task #299: the inbox UI's row hint comes
        // from `pickLatestReviewableResponse` over portal_responses
        // linked directly to the group. If a reclassifier has demoted
        // every response on file to acknowledgment / abstain — leaving
        // nothing reviewable — the row would render blank. Hide those
        // groups from the list endpoint so they can't reappear in the
        // inbox while a heal backfill catches up. Reviewable types
        // mirror the REVIEWABLE_RESPONSE_TYPES set in
        // artifacts/claimclear/src/components/queue-response-review-panel.tsx.
        sql`exists (
          select 1 from portal_responses pr
          where pr.invoice_group_id = ${invoiceGroupsTable.id}
            and pr."responseType" in (
              'approval', 'denial', 'partial_approval', 'info_request', 'other'
            )
        )`,
        // Task #321 — "I replied — wait for payor again": hide groups whose
        // operator clicked the wait-for-payor flip when the latest inbound
        // response is older than that flip. The list re-includes the row
        // automatically once a newer response arrives (received_at
        // newer than awaiting_payor_again_at), so this is a self-resetting
        // suppression rather than a sticky archive.
        or(
          isNull(invoiceGroupsTable.awaitingPayorAgainAt),
          sql`exists (
            select 1 from portal_responses pr
            where pr.invoice_group_id = ${invoiceGroupsTable.id}
              and pr.received_at > ${invoiceGroupsTable.awaitingPayorAgainAt}
          )`,
        )!,
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

  dropAmountFiltersForUser(req.query as Record<string, unknown>, req.user);

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
  // only the columns deriveLegSubStatus reads PLUS `date`, which the
  // service-date-reason classifier (Task #353) needs to label the empty
  // state when `service_date` came back null. One leg fetch, two
  // derivations — keeps the list endpoint at the same round-trip count.
  const legSubStatusByGroup = new Map<number, Record<string, number>>();
  const reasonLegsByGroup = new Map<number, ServiceDateReasonLeg[]>();
  if (groupIds.length > 0) {
    const legs = await db
      .select({
        invoiceGroupId: claimsTable.invoiceGroupId,
        date: claimsTable.date,
        includedInDispute: claimsTable.includedInDispute,
        errorTypeId: claimsTable.errorTypeId,
        holdReason: claimsTable.holdReason,
        sopOutcome: claimsTable.sopOutcome,
        // duplicateOfClaimId is read by deriveLegSubStatus to surface the
        // `duplicate` sub-status (Sibling Duplicate). Without it, those
        // legs would mis-tally into needs_classification/investigating.
        duplicateOfClaimId: claimsTable.duplicateOfClaimId,
      })
      .from(claimsTable)
      .where(inArray(claimsTable.invoiceGroupId, groupIds));
    for (const leg of legs) {
      if (leg.invoiceGroupId == null) continue;
      const sub = deriveLegSubStatus(leg);
      const bucket = legSubStatusByGroup.get(leg.invoiceGroupId) ?? {};
      bucket[sub] = (bucket[sub] ?? 0) + 1;
      legSubStatusByGroup.set(leg.invoiceGroupId, bucket);

      const reasonBucket = reasonLegsByGroup.get(leg.invoiceGroupId) ?? [];
      reasonBucket.push({
        date: typeof leg.date === "string" ? leg.date : leg.date == null ? null : String(leg.date),
        includedInDispute: leg.includedInDispute,
        duplicateOfClaimId: leg.duplicateOfClaimId,
      });
      reasonLegsByGroup.set(leg.invoiceGroupId, reasonBucket);
    }
  }

  const groups = groupsRaw.map(({ row, earliestDate }) => {
    const urgent = GROUP_ON_CLOCK_STATUSES.has(row.status) && isUrgentDeadline(earliestDate, today);
    return {
      ...row,
      earliestDate,
      effectiveDaysLeft: effectiveDaysRemaining(earliestDate, today),
      // Status-aware: only flag as urgent if we still owe action.
      isUrgent: urgent,
      // Task #352. Same date math as `isUrgent`, narrowed to the
      // post-submit "stuck" status set so the UI can render the
      // distinct "stuck after submission" badge variant. Note: at the
      // GROUP level `isUrgent` and `submittedStuck` are mutually
      // exclusive because GROUP_ON_CLOCK_STATUSES (pre-submit only)
      // and GROUP_STUCK_STATUSES (Portal Queued) don't overlap. We
      // emit both flags so consumers can branch on whichever surface
      // they need without recomputing the deadline.
      submittedStuck:
        GROUP_STUCK_STATUSES.has(row.status) && isAtOrPastEffectiveDeadline(earliestDate, today),
      legSubStatusCounts: legSubStatusByGroup.get(row.id) ?? {},
      serviceDateReason: classifyGroupServiceDateReason(
        earliestDate,
        reasonLegsByGroup.get(row.id) ?? [],
      ),
    };
  });

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
  const responseBody: Record<string, unknown> = {
    groups,
    total: totalResult.count,
    // Server-clock "today" stamp (Task #294). The per-row `isUrgent` /
    // `effectiveDaysLeft` flags above were computed against `today`;
    // embedding the matching key lets the client invalidate sister
    // deadline-driven queries (other lanes, dashboard summary, etc.)
    // when a future response carries a different date — replacing the
    // per-page midnight `setTimeout` we used to wire from queue.tsx and
    // dashboard.tsx. See `lib/server-day-rollover.ts` on the client.
    today: serverTodayKey(today),
  };
  if (includeSet.has("needs_classification")) {
    responseBody.needsClassificationInbox = await buildNeedsClassificationInbox();
  }

  responseBody.groups = scrubMoneyFieldsArray(groups, req.user);
  if (responseBody.needsClassificationInbox && !canSeeAmounts(req.user)) {
    const inbox = responseBody.needsClassificationInbox as NeedsClassificationInbox;
    responseBody.needsClassificationInbox = {
      ...inbox,
      groups: inbox.groups.map((g) => ({
        ...g,
        totalAmount: null,
        claims: g.claims.map((c) => ({ ...c, claimAmount: null })),
      })),
    };
  }

  res.json(responseBody);
}));

router.get("/invoice-groups/export-csv", denyClerk, asyncHandler(async (req, res): Promise<void> => {
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
      // Required for deriveLegSubStatus to surface `duplicate` so Sibling
      // Duplicate legs aren't mis-counted into needs_classification.
      duplicateOfClaimId: claimsTable.duplicateOfClaimId,
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

  const groupRowRaw = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!groupRowRaw[0]) { res.status(404).json({ error: "Invoice group not found" }); return; }
  const group = scrubMoneyFields(groupRowRaw[0], req.user);

  const rides = await db.select().from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, id))
    .orderBy(desc(claimsTable.createdAt));

  const rideIds = rides.map((r) => r.id);
  // Per-leg verdict slots used by the picker on Responses Awaiting Review.
  //
  // - `latest`     — newest *terminal* row (`ai_suggested` or
  //                  `operator_confirmed`). Drives the historical "AI
  //                  suggested X / you confirmed Y" rendering and the
  //                  Step-3 "already confirmed" pill state. Drafts are
  //                  excluded so a draft never overwrites a real
  //                  confirmation in the UI.
  // - `latestAi`   — newest `ai_suggested` row, used to label the
  //                  AI-prefilled pill.
  // - `latestDraft`— newest `operator_draft` row (Task #343). Lights
  //                  up the picker pill before Step 4 commits and is
  //                  what drives the actionable-leg counter that
  //                  unlocks Step 4.
  const verdictMap = new Map<number, {
    latest: typeof claimVerdictTable.$inferSelect | null;
    latestAi: typeof claimVerdictTable.$inferSelect | null;
    latestDraft: typeof claimVerdictTable.$inferSelect | null;
  }>();
  if (rideIds.length > 0) {
    const allVerdicts = await db
      .select()
      .from(claimVerdictTable)
      .where(inArray(claimVerdictTable.claimId, rideIds))
      .orderBy(desc(claimVerdictTable.createdAt));
    for (const v of allVerdicts) {
      const slot = verdictMap.get(v.claimId) ?? { latest: null, latestAi: null, latestDraft: null };
      if (slot.latest === null && v.source !== "operator_draft") slot.latest = v;
      if (slot.latestAi === null && v.source === "ai_suggested") slot.latestAi = v;
      if (slot.latestDraft === null && v.source === "operator_draft") slot.latestDraft = v;
      verdictMap.set(v.claimId, slot);
    }
  }
  // Scrub per-ride money for clerks — the rides array would otherwise
  // leak claimAmount even though the top-level group row is scrubbed.
  const ridesWithVerdicts = scrubMoneyFieldsArray(
    rides.map((r) => {
      const slot = verdictMap.get(r.id);
      return {
        ...r,
        latestVerdict: slot?.latest ?? null,
        latestAiSuggestion: slot?.latestAi ?? null,
        latestDraft: slot?.latestDraft ?? null,
      };
    }),
    req.user,
  );

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

  // Channel hint for the Submit button (Task #265): if the assigned
  // errorType has useDirectEmail=true the submission goes via direct
  // email; otherwise via the portal. Joined here so the UI doesn't have
  // to make a second roundtrip per group view.
  let useDirectEmail: boolean | null = null;
  if (group.errorTypeId) {
    const errorTypeIdNum = Number(group.errorTypeId);
    if (Number.isFinite(errorTypeIdNum)) {
      const [et] = await db.select({ useDirectEmail: errorTypesTable.useDirectEmail })
        .from(errorTypesTable)
        .where(eq(errorTypesTable.id, errorTypeIdNum));
      if (et) useDirectEmail = !!et.useDirectEmail;
    }
  }

  // Service-date reason (Task #353) — surfaced on the detail payload
  // so the header strip in `<InvoiceGroupDetailV2 />` can render the
  // same labeled empty state the list cell shows. The classifier reads
  // the rides array we already loaded, so no extra round trip. The
  // helper short-circuits to `has_date` when `service_date` is set.
  const dbServiceDate = (group as { serviceDate?: string | Date | null }).serviceDate ?? null;
  const serviceDateIso =
    dbServiceDate instanceof Date
      ? dbServiceDate.toISOString().slice(0, 10)
      : typeof dbServiceDate === "string"
        ? dbServiceDate.slice(0, 10)
        : null;
  const serviceDateReason: GroupServiceDateReason = classifyGroupServiceDateReason(
    serviceDateIso,
    rides.map((r) => ({
      date: typeof r.date === "string" ? r.date : r.date == null ? null : String(r.date),
      includedInDispute: r.includedInDispute,
      duplicateOfClaimId: r.duplicateOfClaimId,
    })),
  );

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
    useDirectEmail,
    earliestDate: serviceDateIso,
    serviceDateReason,
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

// NOTE: The former POST /invoice-groups/:id/package endpoint (the
// operator-driven flip into "Generating Email") was removed. The only
// status-changing path out of pre-submit is now the submission gauntlet's
// `generate-preview` → `submit-now` flow on the leg/group detail page.
// `loadGroupReadiness` + `packagingReadiness` on the detail response are
// retained as a passive readiness signal — they describe whether every
// leg's worktree is done — but no endpoint flips status on the operator's
// behalf any more.

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

// POST /invoice-groups/:id/mark-mas-eligible — dedicated entry point for
// the post-upload triage bridge (Phase 2 of the bridge work). Distinct
// from the generic PATCH /status because:
//
//   1. It tags the audit trail with `source: "post_upload_bridge"` so we
//      can later trace bridge-driven flows separately from generic
//      status flips (analytics + debugging).
//   2. It hard-codes the destination so a buggy client can't send the
//      wrong status here.
//   3. It returns the count of legs that just got auto-routed into the
//      attestation queue (`attestationsEngaged`) so the bridge UI can
//      show "queued N legs for attestation" without a follow-up fetch.
//
// The transition itself runs through `transitionGroupStatus`, which
// invokes `engageMasEligibleAttestationCascade` as a side-effect (see
// the cascade's docstring in lib/attestation.ts). Calling this endpoint
// against a group already in MAS Eligible is a no-op transition (409)
// — the bridge UI guards against that by hiding the button once the
// group is already MAS Eligible.
router.post("/invoice-groups/:id/mark-mas-eligible", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { reason } = req.body ?? {};

  try {
    const result = await transitionGroupStatus({
      groupId: id,
      newStatus: "MAS Eligible",
      source: "post_upload_bridge",
      reason: reason || "Marked MAS Eligible from post-upload bridge",
      actor: actorFromReq(req),
    });

    // Count how many legs in this group are now `pending` attestation —
    // this is the cascade's observable result. Counts disputed, non-held
    // legs (matches the cascade's predicate). The count is for UI
    // feedback only; the cascade has already run and is the source of
    // truth.
    const pendingRows = await db
      .select({ id: claimsTable.id })
      .from(claimsTable)
      .where(and(
        eq(claimsTable.invoiceGroupId, id),
        eq(claimsTable.attestationState, "pending"),
        isNotNull(claimsTable.errorTypeId),
      ));

    res.json({ ...result.group, attestationsEngaged: pendingRows.length });
  } catch (err: any) {
    const msg = err.message || "Failed to mark MAS Eligible";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    // 409 covers both "current status precludes the move" and "already
    // in MAS Eligible" (no-op transition rejected by the transition
    // helper). Standard semantics across the rest of this router.
    res.status(409).json({ error: msg });
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

router.post("/invoice-groups/bulk-assign-error-type", denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const { groupIds, errorTypeId, errorTypeName } = req.body;
  if (!Array.isArray(groupIds) || groupIds.length === 0 || !errorTypeId) {
    res.status(400).json({ error: "groupIds array and errorTypeId are required" });
    return;
  }

  const requestedIds = (groupIds as Array<string | number>)
    .map((id) => Number(id))
    .filter((id) => !isNaN(id));

  // Task #411 audit, Tier 4: previously this endpoint blindly returned
  // `{ updated: groupIds.length }` even when zero rows actually changed
  // (e.g. groupIds pointed at deleted invoice groups). We now look up
  // the rows that actually exist and report a per-row breakdown so the
  // toast can surface "Updated 3, skipped 2 (#INV-… not found)".
  const existing = await db.select({
    id: invoiceGroupsTable.id,
    invoiceNumber: invoiceGroupsTable.invoiceNumber,
  })
    .from(invoiceGroupsTable)
    .where(inArray(invoiceGroupsTable.id, requestedIds));

  const matchedIds = new Set(existing.map((g) => g.id));
  const skipped = requestedIds
    .filter((id) => !matchedIds.has(id))
    .map((id) => ({ id, refNumber: null as string | null, reason: "not_found" as const }));

  if (existing.length === 0) {
    res.status(404).json({
      success: false,
      updated: 0,
      updatedItems: [],
      skipped,
    });
    return;
  }

  await db.update(invoiceGroupsTable)
    .set({ errorTypeId, errorTypeName: errorTypeName || null })
    .where(inArray(invoiceGroupsTable.id, existing.map((g) => g.id)));

  const actor = actorFromReq(req);
  for (const g of existing) {
    await db.insert(auditLogsTable).values({
      invoiceGroupId: g.id,
      action: "group_error_type_assigned",
      details: `Error type assigned: ${errorTypeName || errorTypeId}`,
      metadata: { errorTypeId, errorTypeName },
      ...actor,
    });
  }

  res.json({
    success: true,
    updated: existing.length,
    updatedItems: existing.map((g) => ({ id: g.id, refNumber: g.invoiceNumber })),
    skipped,
  });
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
    // Task #321: surfaced so the Responses Awaiting Review UI can decide
    // whether the "I replied — wait for payor again" button should be
    // enabled (button is disabled when this stamp is newer than the
    // latest inbound response's received_at — i.e. the group has already
    // been flipped off the list).
    awaitingPayorAgainAt: group.awaitingPayorAgainAt
      ? group.awaitingPayorAgainAt.toISOString()
      : null,
  });
}));

// ---------------------------------------------------------------------------
// Task #321 — Responses Awaiting Review: per-group payor-denial-reason
// signal + "I replied — wait for payor again" flip.
//
// Both endpoints share the same source-state contract (Needs Review +
// at least one inbound response). They do NOT change `status`/`outcome`
// — they only stamp the new lightweight columns and emit an audit row.
// See lib/payor-denial-reasons for the rationale on keeping the
// denial-reason vocabulary separate from the heavyweight `closure_*`
// columns.
// ---------------------------------------------------------------------------

router.post("/invoice-groups/:id/payor-denial-reason", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { reason, note } = (req.body ?? {}) as { reason?: unknown; note?: unknown };

  if (typeof reason !== "string" || !isPayorDenialReasonCode(reason)) {
    res.status(400).json({
      error: `Invalid reason. Expected one of: ${PAYOR_DENIAL_REASON_CODES.join(", ")}.`,
    });
    return;
  }

  const noteValue = typeof note === "string" ? note : note == null ? null : null;
  if (reason === "payor_other" && (!noteValue || noteValue.trim().length === 0)) {
    res.status(400).json({
      error: `\`note\` is required (and must be non-empty) when \`reason\` is "payor_other".`,
    });
    return;
  }

  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  if (group.status !== "Needs Review") {
    res.status(409).json({
      error: "Payor denial reason can only be recorded while the group is awaiting review.",
      expectedState: "status=Needs Review",
      actualState: `status=${group.status}`,
    });
    return;
  }

  const hasResponse = await groupHasResponse(id);
  if (!hasResponse) {
    res.status(409).json({
      error: "Payor denial reason can only be recorded after at least one payor response has arrived.",
      expectedState: "at least one inbound portal_responses row for the group",
      actualState: "no inbound responses on file",
    });
    return;
  }

  const actor = actorFromReq(req);
  const now = new Date();
  const noteForDb = noteValue && noteValue.trim().length > 0 ? noteValue.trim() : null;
  const actorLabel = actor.userName || actor.userEmail || null;

  const [updated] = await db.update(invoiceGroupsTable)
    .set({
      payorDenialReason: reason,
      payorDenialReasonNote: noteForDb,
      payorDenialReasonAt: now,
      payorDenialReasonBy: actorLabel,
    })
    .where(eq(invoiceGroupsTable.id, id))
    .returning();

  await db.insert(auditLogsTable).values({
    invoiceGroupId: id,
    action: "payor_denial_reason_recorded",
    details: `Payor denial reason recorded: ${reason}${noteForDb ? ` (note: ${noteForDb})` : ""}`,
    metadata: {
      reason,
      note: noteForDb,
      previousReason: group.payorDenialReason ?? null,
      previousNote: group.payorDenialReasonNote ?? null,
    },
    ...actor,
  });

  emitGroupEvent(id, "group_payor_denial_reason_recorded", req);
  res.json(updated);
}));

router.post("/invoice-groups/:id/awaiting-payor-again", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Optional operator note. Non-string / null collapses to null. Trim,
  // then drop pure-whitespace so the audit row only carries content
  // worth surfacing back to the operator on the timeline.
  const rawNote = (req.body ?? {}) as { note?: unknown };
  const noteForDb = (() => {
    if (typeof rawNote.note !== "string") return null;
    const trimmed = rawNote.note.trim();
    return trimmed.length > 0 ? trimmed : null;
  })();

  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  if (group.status !== "Needs Review") {
    res.status(409).json({
      error: "Group can only be flipped back to awaiting-payor-again while it is in Needs Review.",
      expectedState: "status=Needs Review",
      actualState: `status=${group.status}`,
    });
    return;
  }

  const hasResponse = await groupHasResponse(id);
  if (!hasResponse) {
    res.status(409).json({
      error: "Group cannot be flipped back to awaiting-payor-again before any payor response has arrived.",
      expectedState: "at least one inbound portal_responses row for the group",
      actualState: "no inbound responses on file",
    });
    return;
  }

  const now = new Date();
  const [updated] = await db.update(invoiceGroupsTable)
    .set({ awaitingPayorAgainAt: now })
    .where(eq(invoiceGroupsTable.id, id))
    .returning();

  await db.insert(auditLogsTable).values({
    invoiceGroupId: id,
    action: "awaiting_payor_again",
    details: noteForDb
      ? `Operator marked the group as awaiting the payor again — hidden from Responses Awaiting Review until a newer response arrives. Note: ${noteForDb}`
      : `Operator marked the group as awaiting the payor again — hidden from Responses Awaiting Review until a newer response arrives.`,
    metadata: {
      previousAwaitingPayorAgainAt: group.awaitingPayorAgainAt
        ? group.awaitingPayorAgainAt.toISOString()
        : null,
      newAwaitingPayorAgainAt: now.toISOString(),
      note: noteForDb,
    },
    ...actorFromReq(req),
  });

  emitGroupEvent(id, "group_awaiting_payor_again", req);
  res.json(updated);
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

// Task #411 audit, Tier 5: `DELETE /invoice-groups/:id/evidence/:evidenceId`
// and `DELETE /invoice-groups/:id` were removed — neither had any UI caller
// (group-level evidence delete was never wired into the detail page; the
// group delete had no admin destructive-action surface either). Per the
// endpoint-action contract rule, an orphan mutation is not allowed to
// linger in the surface area. Re-introduce these alongside the UI that
// calls them, gated with `requireAdmin` if appropriate.

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
      // Task #299: keep the sidebar/dashboard badge in sync with the
      // Stage 2 inbox list filter — only count groups that actually
      // have a reviewable payor reply on file. Without this, blank
      // "Needs Review" rows that the inbox already hides would still
      // bump the badge.
      sql`exists (
        select 1 from portal_responses pr
        where pr.invoice_group_id = ${invoiceGroupsTable.id}
          and pr."responseType" in (
            'approval', 'denial', 'partial_approval', 'info_request', 'other'
          )
      )`,
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

// POST /invoice-groups/:id/preview-generated — generates the AI dispute
// write-up for the group AND stamps that a preview is on file. One
// click does both pieces of work because the gauntlet UI shows the
// "Review & edit dispute write-up" textarea immediately once
// `previewGeneratedAt` is set — if the timestamp is stamped without the
// LLM having actually written anything, the textarea sits empty and
// the operator has nothing to review (the bug Task #410-followup fixed).
//
// Source-state: pre-submit AND every disputed leg resolved. The
// understanding readback is OPTIONAL and does not gate preview
// generation. Body is empty; the timestamp/identity come from the
// request and the optional context (specialCircumstances /
// understandingReadback) is read off the group.
//
// On success, populates four columns on `invoice_groups`:
//   - `previewGeneratedAt` / `previewGeneratedBy` — gate stamps.
//   - `aiBaselineSubject` / `aiBaselineDescriptionHtml` — the raw AI
//     output, used as the "regenerate-from" reference and as a fallback
//     if the operator clears their edits.
//   - `draftSubject` / `draftDescriptionHtml` — the editable draft the
//     UI hydrates the textarea from. Initially equal to the baseline.
// Also clears `draftReviewedAt` / `draftReviewedBy` because regenerating
// the AI write-up invalidates any prior review (operator must re-mark).
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
  // Note: the understanding readback is OPTIONAL and no longer gates
  // preview generation. Operators can generate the preview as soon as
  // every disputed leg is resolved.
  const { ok, unresolved } = await allDisputedLegsResolved(id);
  if (!ok) {
    res.status(409).json({
      error: "Not all disputed legs are resolved",
      expectedState: "all-legs-resolved",
      actualState: `${unresolved}-unresolved`,
    });
    return;
  }

  let draft;
  try {
    draft = await generatePortalDraftForGroup(
      {
        invoiceGroupId: id,
        understandingReadback: group.understandingReadback ?? null,
      },
      req,
    );
  } catch (err) {
    if (err instanceof NoEligibleLegsError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof LLMUnavailableError) {
      res.status(502).json({ error: err.message });
      return;
    }
    if (err instanceof GroupNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }

  const now = new Date();
  const [updated] = await db
    .update(invoiceGroupsTable)
    .set({
      previewGeneratedAt: now,
      previewGeneratedBy: req.user?.email ?? null,
      draftSubject: draft.subject,
      draftDescriptionHtml: draft.descriptionHtml,
      aiBaselineSubject: draft.subject,
      aiBaselineDescriptionHtml: draft.descriptionHtml,
      draftEditedAt: now,
      draftEditedBy: req.user?.email ?? null,
      draftReviewedAt: null,
      draftReviewedBy: null,
    })
    .where(eq(invoiceGroupsTable.id, id))
    .returning();

  await createGroupAuditLog(id, "group_preview_generated", "Dispute preview generated", req, {
    sourceSubmissionId: draft.submission.id,
    descriptionLength: draft.descriptionHtml.length,
  });
  await emitStateEvent({
    eventKey: "group.preview_generated",
    invoiceGroupId: id,
    actorUserId: req.user?.email ?? null,
    metadata: { sourceSubmissionId: draft.submission.id },
  });
  emitGroupEvent(id, "preview_generated", req);
  res.json(updated);
}));

// ─────────────────────────────────────────────────────────────────────────
// Editable AI dispute draft (Task #265)
//
// The group carries the operator-edited write-up that gets submitted (via
// portal or email). `regenerate` seeds the draft from the latest portal-
// submissions draft (which is what /portal-submissions/generate-preview
// produces). `save-draft` persists operator edits and clears the reviewed
// flag. `mark-reviewed` is the gate Submit checks.
// ─────────────────────────────────────────────────────────────────────────

router.post("/invoice-groups/:id/draft", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const subject = req.body?.subject;
  const descriptionHtml = req.body?.descriptionHtml;
  if (subject !== undefined && subject !== null && typeof subject !== "string") {
    res.status(400).json({ error: "subject must be a string or null" });
    return;
  }
  if (descriptionHtml !== undefined && descriptionHtml !== null && typeof descriptionHtml !== "string") {
    res.status(400).json({ error: "descriptionHtml must be a string or null" });
    return;
  }

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  const phase = getMacroPhase(group.status);
  if (phase !== "pre-submit") {
    res.status(409).json({
      error: "Draft can only be edited in pre-submit",
      expectedState: "pre-submit",
      actualState: phase,
    });
    return;
  }

  const now = new Date();
  const updateSet: Partial<typeof invoiceGroupsTable.$inferInsert> = {
    draftEditedAt: now,
    draftEditedBy: req.user?.email ?? null,
    // Any edit invalidates the prior review acknowledgement.
    draftReviewedAt: null,
    draftReviewedBy: null,
  };
  if (subject !== undefined) updateSet.draftSubject = subject;
  if (descriptionHtml !== undefined) updateSet.draftDescriptionHtml = descriptionHtml;

  const [updated] = await db
    .update(invoiceGroupsTable)
    .set(updateSet)
    .where(eq(invoiceGroupsTable.id, id))
    .returning();

  await createGroupAuditLog(id, "group_draft_edited", "Dispute draft edited", req, {
    subjectLength: typeof subject === "string" ? subject.length : null,
    descriptionLength: typeof descriptionHtml === "string" ? descriptionHtml.length : null,
  });
  await emitStateEvent({
    eventKey: "group.draft_edited",
    invoiceGroupId: id,
    actorUserId: req.user?.email ?? null,
    metadata: {
      subjectLength: typeof subject === "string" ? subject.length : null,
      descriptionLength: typeof descriptionHtml === "string" ? descriptionHtml.length : null,
    },
  });
  emitGroupEvent(id, "draft_edited", req);
  res.json(updated);
}));

router.post("/invoice-groups/:id/draft/regenerate", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  const phase = getMacroPhase(group.status);
  if (phase !== "pre-submit") {
    res.status(409).json({
      error: "Draft can only be regenerated in pre-submit",
      expectedState: "pre-submit",
      actualState: phase,
    });
    return;
  }

  // Run the LLM pipeline fresh. Previously this endpoint copied the
  // subject/body off the most recent `portal_submissions` draft row,
  // which made "Regenerate from preview" a no-op once the group's
  // `aiBaseline*` columns were filled by `/preview-generated` (the
  // last draft already holds the same text). Calling the helper means
  // each click of "Regenerate from preview" actually produces a fresh
  // AI take — which is what the button label promises.
  let draft;
  try {
    draft = await generatePortalDraftForGroup(
      {
        invoiceGroupId: id,
        understandingReadback: group.understandingReadback ?? null,
      },
      req,
    );
  } catch (err) {
    if (err instanceof NoEligibleLegsError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof LLMUnavailableError) {
      res.status(502).json({ error: err.message });
      return;
    }
    if (err instanceof GroupNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }

  const now = new Date();
  const [updated] = await db
    .update(invoiceGroupsTable)
    .set({
      draftSubject: draft.subject,
      draftDescriptionHtml: draft.descriptionHtml,
      aiBaselineSubject: draft.subject,
      aiBaselineDescriptionHtml: draft.descriptionHtml,
      draftEditedAt: now,
      draftEditedBy: req.user?.email ?? null,
      draftReviewedAt: null,
      draftReviewedBy: null,
    })
    .where(eq(invoiceGroupsTable.id, id))
    .returning();

  await createGroupAuditLog(id, "group_draft_regenerated", "Dispute draft regenerated from AI baseline", req, {
    sourceSubmissionId: draft.submission.id,
  });
  await emitStateEvent({
    eventKey: "group.draft_regenerated",
    invoiceGroupId: id,
    actorUserId: req.user?.email ?? null,
    metadata: { sourceSubmissionId: draft.submission.id },
  });
  emitGroupEvent(id, "draft_regenerated", req);
  res.json(updated);
}));

router.post("/invoice-groups/:id/draft/mark-reviewed", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  const phase = getMacroPhase(group.status);
  if (phase !== "pre-submit") {
    res.status(409).json({
      error: "Draft can only be marked reviewed in pre-submit",
      expectedState: "pre-submit",
      actualState: phase,
    });
    return;
  }
  if (!group.draftDescriptionHtml || group.draftDescriptionHtml.trim().length === 0) {
    res.status(409).json({
      error: "Draft is empty — generate a preview before marking it reviewed",
      expectedState: "draft-present",
      actualState: "draft-empty",
    });
    return;
  }

  const now = new Date();
  const [updated] = await db
    .update(invoiceGroupsTable)
    .set({
      draftReviewedAt: now,
      draftReviewedBy: req.user?.email ?? null,
    })
    .where(eq(invoiceGroupsTable.id, id))
    .returning();

  await createGroupAuditLog(id, "group_draft_reviewed", "Dispute draft marked reviewed", req);
  await emitStateEvent({
    eventKey: "group.draft_reviewed",
    invoiceGroupId: id,
    actorUserId: req.user?.email ?? null,
    metadata: {},
  });
  emitGroupEvent(id, "draft_reviewed", req);
  res.json(updated);
}));

// POST /invoice-groups/:id/promote-verdict-drafts — Task #343 Step 4
// commit primitive. For each leg whose latest verdict is an
// `operator_draft`, insert a fresh `operator_confirmed` row carrying
// the same outcome inside a single DB transaction. Then run the same
// per-leg side effects the `/claims/:id/verdict` route runs for
// `operator_confirmed` (denormalized cache refresh, MAS derivation,
// attestation gate) and finally call `refreshGroupDerivedFields` once
// for the parent.
//
// Source-state contract: the parent group MUST be in the
// `response-pending` macro phase. Outside that phase Step 4 isn't
// reachable in the UI, and promoting drafts could collide with
// already-attested or closed state. Returns 409 with the canonical
// {expectedState, actualState} payload otherwise.
//
// Drafts attached to legs that are filtered out of the actionable
// picker (excluded via `sop_outcome` ∈ {cannot_dispute, non_issue} or
// duplicates that follow another leg) are still promoted — they're
// recorded against the leg history just like any other operator
// confirmation. The picker UI prevents drafts from landing on those
// legs in the first place, but if a draft somehow exists we don't
// want to silently strand it.
//
// Idempotent: a re-run with no fresh drafts returns
// `promotedCount: 0, promotedClaimIds: []` and is a no-op.
router.post("/invoice-groups/:id/promote-verdict-drafts", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  // Pick the latest verdict per leg in a single roundtrip. We sort by
  // (claimId asc, createdAt desc) so the first row per leg in our scan
  // is the latest. Only legs whose latest row is an `operator_draft`
  // get promoted; legs whose latest is already `operator_confirmed`
  // (or whose only row is `ai_suggested`) are skipped.
  //
  // Note: we scan for drafts BEFORE enforcing the phase guard so that
  // a re-run with no drafts left to promote always succeeds as a
  // no-op. This matters for the Step 4 commit retry path: if the
  // first attempt succeeded at promotion but failed at the downstream
  // re-attest/closure call, the group's phase may have already moved
  // past `response-pending`. The user's retry must still be able to
  // call this endpoint without hitting a 409 — there's nothing left
  // to promote, so there's nothing to guard against.
  const legs = await db
    .select({ id: claimsTable.id })
    .from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, id));
  const legIds = legs.map((l) => l.id);
  if (legIds.length === 0) {
    res.json({ promotedCount: 0, promotedClaimIds: [] });
    return;
  }

  const allVerdicts = await db
    .select()
    .from(claimVerdictTable)
    .where(inArray(claimVerdictTable.claimId, legIds))
    .orderBy(asc(claimVerdictTable.claimId), desc(claimVerdictTable.createdAt));

  const draftsToPromote: Array<{ claimId: number; outcome: string }> = [];
  let lastClaimId: number | null = null;
  for (const v of allVerdicts) {
    if (v.claimId === lastClaimId) continue;
    lastClaimId = v.claimId;
    if (v.source === "operator_draft") {
      draftsToPromote.push({ claimId: v.claimId, outcome: v.outcome });
    }
  }

  if (draftsToPromote.length === 0) {
    res.json({ promotedCount: 0, promotedClaimIds: [] });
    return;
  }

  // Phase guard only applies when there's actual work to do. A group
  // outside `response-pending` should never have fresh drafts (the
  // picker UI is gated on phase), but if one somehow exists it's
  // safer to refuse than to collide with already-attested or closed
  // state.
  const phase = getGroupMacroPhase(group);
  if (phase !== "response-pending") {
    res.status(409).json({
      error: "Group is not in the response-pending phase",
      expectedState: "response-pending",
      actualState: phase,
    });
    return;
  }

  // Atomic insert of every promotion row. Side effects (MAS, attestation,
  // cache refresh) run after the transaction commits so they observe the
  // confirmed verdicts. Doing them inside the txn would still be correct,
  // but each helper opens its own connection-bound queries; keeping them
  // outside the txn matches the pattern already used by
  // `/claims/:id/verdict`.
  const promotedClaimIds: number[] = [];
  await db.transaction(async (tx) => {
    for (const d of draftsToPromote) {
      await tx.insert(claimVerdictTable).values({
        claimId: d.claimId,
        source: "operator_confirmed",
        outcome: d.outcome,
        note: null,
        confidence: null,
        reasoning: null,
        createdBy: req.user?.email ?? null,
        inspectionTimeMs: null,
      });
      promotedClaimIds.push(d.claimId);
    }
  });

  // Per-leg side effects mirror the `operator_confirmed` arm of
  // `/claims/:id/verdict`. Re-load the leg between cache-refresh and
  // attestation-delta so the gate sees the post-refresh outcome.
  for (const d of draftsToPromote) {
    const [legBefore] = await db.select().from(claimsTable).where(eq(claimsTable.id, d.claimId));
    if (!legBefore) continue;
    await refreshClaimDenormalizedCache(d.claimId);
    await applyMasDerivationsForLeg(d.claimId, d.outcome);
    const [legAfter] = await db.select().from(claimsTable).where(eq(claimsTable.id, d.claimId));
    if (legAfter) {
      const attDelta = computeAttestationDelta(legBefore.outcome, legAfter.outcome, group);
      if (Object.keys(attDelta).length > 0) {
        await db.update(claimsTable).set(attDelta).where(eq(claimsTable.id, d.claimId));
      }
    }

    await createAuditLog(
      d.claimId,
      "leg_verdict_confirmed",
      `Verdict ${d.outcome} (operator_confirmed, promoted_from_draft)`,
      req,
      { source: "operator_confirmed", outcome: d.outcome, reason: "promoted_from_draft" },
    );
    await emitStateEvent({
      eventKey: "leg.verdict_confirmed",
      claimId: d.claimId,
      invoiceGroupId: id,
      actorUserId: req.user?.email ?? null,
      metadata: { source: "operator_confirmed", outcome: d.outcome, reason: "promoted_from_draft" },
    });
    broadcastClaimEvent({
      type: "verdict_recorded",
      claimId: d.claimId,
      userName: req.user?.displayName ?? null,
      userEmail: req.user?.email ?? null,
      timestamp: new Date().toISOString(),
    });
  }

  await refreshGroupDerivedFields(id);
  await createGroupAuditLog(
    id,
    "group_verdict_drafts_promoted",
    `Promoted ${promotedClaimIds.length} draft verdict${promotedClaimIds.length === 1 ? "" : "s"} to operator_confirmed`,
    req,
    { promotedClaimIds, promotedCount: promotedClaimIds.length },
  );
  emitGroupEvent(id, "verdict_drafts_promoted", req);

  res.json({ promotedCount: promotedClaimIds.length, promotedClaimIds });
}));

// Helper: same shape as createGroupAuditLog but writes against a leg
// (so the audit row threads through the per-claim activity feed). The
// route above needs both flavours — claim-level for each promotion +
// group-level for the umbrella event — so we declare the leg helper
// next to the only caller that needs it.
async function createAuditLog(
  claimId: number,
  action: string,
  details: string,
  req: Request,
  metadata?: Record<string, unknown>,
) {
  await db.insert(auditLogsTable).values({
    claimId,
    action,
    details,
    metadata: metadata ?? null,
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? null,
  });
}

// POST /invoice-groups/:id/reattest/complete — stamps the group's MAS
// re-attest as complete and engages the attestation gate. Pre: phase
// is mas-action-required AND every leg with mas_action_required='cancel'
// has been completed.
//
// Admin override (Task #333): when `recordedOffline=true` is set on
// the body, an admin actor with a >=10-char trimmed `offlineNote`
// bypasses the macro-phase + cancel-completeness preconditions and
// stamps the same columns. The audit row uses the distinct
// `mas_reattest_recorded_offline` action so the activity feed can
// distinguish a checklist-driven completion from an after-the-fact
// recording. Same `group.reattest_completed` SSE event is emitted so
// listeners (dashboards, queue counters, attestation gate) react
// identically.
router.post("/invoice-groups/:id/reattest/complete", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const note = (req.body?.note ?? null) as string | null;
  const masReference = (req.body?.masReference ?? null) as string | null;
  const recordedOffline = req.body?.recordedOffline === true;
  const offlineNoteRaw = (req.body?.offlineNote ?? "") as string;
  const offlineNote = typeof offlineNoteRaw === "string" ? offlineNoteRaw.trim() : "";

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  if (recordedOffline) {
    // Admin override path: enforce admin role + a meaningful note,
    // then skip phase + cancel-completeness preconditions. The path
    // still stamps the same completion columns and graduates legs.
    if (req.user?.role !== "admin") {
      res.status(403).json({ error: "Admin access required for offline re-attest recording" });
      return;
    }
    if (offlineNote.length < 10) {
      res.status(400).json({
        error: "offlineNote is required and must be at least 10 characters",
        field: "offlineNote",
      });
      return;
    }
  } else {
    // Standard path: source-state contract — the group must be in
    // the `mas-action-required` derived macro phase. The phase is
    // computed from {status, reattestRequired, reattestCompletedAt} —
    // see getGroupMacroPhase. Enforcing the phase (rather than the
    // raw `reattest_required` bit) keeps the contract honest if we
    // later add intermediate phases between response-pending and
    // reattest.
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
  }

  const now = new Date();
  const fullNote = recordedOffline
    ? offlineNote
    : (masReference ? `${note ? note + " " : ""}(MAS ref: ${masReference})` : note);
  const [updated] = await db
    .update(invoiceGroupsTable)
    .set({
      reattestCompletedAt: now,
      reattestCompletedBy: req.user?.email ?? null,
      reattestNote: fullNote,
    })
    .where(eq(invoiceGroupsTable.id, id))
    .returning();

  if (recordedOffline) {
    await createGroupAuditLog(
      id,
      "mas_reattest_recorded_offline",
      "MAS re-attest recorded (offline)",
      req,
      { offlineNote, recordedOffline: true },
    );
  } else {
    await createGroupAuditLog(id, "mas_reattest_completed", "MAS re-attest completed", req, { note, masReference });
  }
  await emitStateEvent({
    eventKey: "group.reattest_completed",
    invoiceGroupId: id,
    actorUserId: req.user?.email ?? null,
    metadata: recordedOffline
      ? { recordedOffline: true, offlineNote }
      : { note, masReference },
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

// POST /invoice-groups/:id/reattest/queue — atomic group-level
// "Queue for re-attest later" path used by the Re-attest modal.
//
// Replaces the per-leg fan-out the modal used to do (loop calling
// `POST /claims/:id/attest/queue` for every Approved leg, then a
// separate `awaiting-payor-again` flip). The fan-out tripped on
// the Task #196 attestation gate — when the group's MAS re-attest
// hasn't been stamped yet, every leg sits at `attestation_state =
// 'not_required'`, and the per-leg `/attest/queue` endpoint requires
// the source state to be `pending` (ALLOWED_SOURCE_STATES in
// claims.ts). The queue action IS the operator commit, so this
// endpoint flips eligible legs straight to `queued` without going
// through the gate.
//
// In one transaction:
//   * find every disputed leg whose latest verdict is
//     `operator_confirmed` Approved/Partial and whose
//     attestation_state is still owed (not `completed` or `queued`);
//   * set attestation_state='queued' + queued_at + queued_by + note
//     on each;
//   * stamp `awaiting_payor_again_at = now` on the group so it drops
//     off Responses Awaiting Review;
//   * write one `attestation_queued` audit row + state event per
//     leg, plus one umbrella `group_reattest_queued_bulk` audit row
//     + state event on the group.
//
// Per-leg `/claims/:id/attest/queue` stays the source of truth for
// the Attestation Queue page's per-row queue action.
router.post("/invoice-groups/:id/reattest/queue", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Optional operator note. Same shape as the per-leg /attest/queue
  // (AttestationActionBody): trim, drop pure-whitespace.
  const rawNote = (req.body ?? {}) as { note?: unknown };
  const noteForDb = (() => {
    if (typeof rawNote.note !== "string") return null;
    const trimmed = rawNote.note.trim();
    return trimmed.length > 0 ? trimmed : null;
  })();

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  // Same source-state contract as `/awaiting-payor-again`: this is
  // the "drop the group off Responses Awaiting Review" leg of the
  // operation, so the group must be in Needs Review with at least
  // one inbound payor response on file. Without these guards the
  // bulk-queue would silently re-stamp `awaitingPayorAgainAt` on a
  // group whose state doesn't justify it.
  if (group.status !== "Needs Review") {
    res.status(409).json({
      error: "Group can only be bulk-queued for re-attestation while it is in Needs Review.",
      expectedState: "status=Needs Review",
      actualState: `status=${group.status}`,
    });
    return;
  }
  const hasResponse = await groupHasResponse(id);
  if (!hasResponse) {
    res.status(409).json({
      error: "Group cannot be bulk-queued for re-attestation before any payor response has arrived.",
      expectedState: "at least one inbound portal_responses row for the group",
      actualState: "no inbound responses on file",
    });
    return;
  }

  const actor = actorFromReq(req);
  const actorIdentity = actor.userEmail || actor.userName || "unknown";
  const now = new Date();

  // Find every leg in the group that's eligible for the bulk queue.
  // Eligibility:
  //   * outcome is Approved or Partially Approved (the only outcomes
  //     where attestation is meaningful — matches applyAttestationAction);
  //   * latest claim_verdict row is `source = 'operator_confirmed'`
  //     with outcome Approved/Partial (the operator has actually
  //     committed the verdict, not just left a draft);
  //   * attestation_state is NOT already `completed` (one-way street;
  //     applyAttestationAction enforces the same rule) and NOT already
  //     `queued` (no point re-stamping a row that's already on the
  //     queue with the prior queued_at/by).
  const candidateLegs = await db
    .select()
    .from(claimsTable)
    .where(and(
      eq(claimsTable.invoiceGroupId, id),
      isNotNull(claimsTable.errorTypeId),
      inArray(claimsTable.outcome, ["Approved", "Partially Approved"]),
    ));

  const eligibleLegs: typeof claimsTable.$inferSelect[] = [];
  for (const leg of candidateLegs) {
    if (leg.attestationState === "completed" || leg.attestationState === "queued") continue;
    const [latestVerdict] = await db
      .select({ outcome: claimVerdictTable.outcome, source: claimVerdictTable.source })
      .from(claimVerdictTable)
      .where(eq(claimVerdictTable.claimId, leg.id))
      .orderBy(desc(claimVerdictTable.createdAt))
      .limit(1);
    if (
      latestVerdict
      && latestVerdict.source === "operator_confirmed"
      && (latestVerdict.outcome === "Approved" || latestVerdict.outcome === "Partial")
    ) {
      eligibleLegs.push(leg);
    }
  }

  if (eligibleLegs.length === 0) {
    res.status(409).json({
      error: "No eligible legs to queue — the group has no Approved/Partial operator-confirmed legs still owing an attestation.",
      expectedState: "at least one disputed leg with operator_confirmed Approved/Partial verdict and attestation_state in (not_required, pending)",
      actualState: `${candidateLegs.length}-candidate legs, 0 eligible`,
    });
    return;
  }

  // All-or-nothing: a partial failure mid-loop would leave half the
  // group queued and the other half not, plus stamp awaiting_payor_again
  // on a group whose legs only partly moved. Wrap every write in a
  // single drizzle transaction so a failure rolls all of them back.
  const updatedGroup = await db.transaction(async (tx) => {
    for (const leg of eligibleLegs) {
      await tx.update(claimsTable)
        .set({
          attestationState: "queued",
          attestationQueuedAt: now,
          attestationQueuedBy: actorIdentity,
          attestationNote: noteForDb,
        })
        .where(eq(claimsTable.id, leg.id));

      await tx.insert(auditLogsTable).values({
        claimId: leg.id,
        action: "attestation_queued",
        details: noteForDb
          ? `Queued for re-attestation by ${actorIdentity} (bulk via group #${id}) — ${noteForDb}`
          : `Queued for re-attestation by ${actorIdentity} (bulk via group #${id})`,
        metadata: {
          from: leg.attestationState,
          to: "queued",
          note: noteForDb,
          bulk: true,
          source: "group_reattest_queue",
          invoiceGroupId: id,
        },
        userEmail: actor.userEmail,
        userName: actor.userName,
      });

      await emitStateEvent({
        eventKey: "leg.attestation_queued",
        claimId: leg.id,
        invoiceGroupId: id,
        actorUserId: actor.userEmail,
        metadata: {
          from: leg.attestationState,
          to: "queued",
          bulk: true,
          source: "group_reattest_queue",
        },
      }, tx);
    }

    const [g] = await tx.update(invoiceGroupsTable)
      .set({ awaitingPayorAgainAt: now })
      .where(eq(invoiceGroupsTable.id, id))
      .returning();

    const queuedLegIds = eligibleLegs.map((l) => l.id);
    await tx.insert(auditLogsTable).values({
      invoiceGroupId: id,
      action: "group_reattest_queued_bulk",
      details: noteForDb
        ? `${actorIdentity} queued ${queuedLegIds.length} leg${queuedLegIds.length === 1 ? "" : "s"} for re-attestation and flipped the group back to awaiting payor — Note: ${noteForDb}`
        : `${actorIdentity} queued ${queuedLegIds.length} leg${queuedLegIds.length === 1 ? "" : "s"} for re-attestation and flipped the group back to awaiting payor.`,
      metadata: {
        queuedLegIds,
        legCount: queuedLegIds.length,
        previousAwaitingPayorAgainAt: group.awaitingPayorAgainAt
          ? group.awaitingPayorAgainAt.toISOString()
          : null,
        newAwaitingPayorAgainAt: now.toISOString(),
        note: noteForDb,
      },
      userEmail: actor.userEmail,
      userName: actor.userName,
    });

    await emitStateEvent({
      eventKey: "group.reattest_queued_bulk",
      invoiceGroupId: id,
      actorUserId: actor.userEmail,
      metadata: {
        queuedLegIds,
        legCount: queuedLegIds.length,
        note: noteForDb,
      },
    }, tx);

    return g;
  });

  // Post-commit fan-out: SSE broadcasts and denormalized-cache refresh.
  // These run after the transaction commits because (a) SSE listeners
  // shouldn't be told a row moved before its row is actually visible,
  // and (b) the cache refresh helpers issue their own queries that
  // would race the not-yet-committed writes.
  for (const leg of eligibleLegs) {
    broadcastClaimEvent({
      type: "attestation_updated",
      claimId: leg.id,
      userName: req.user?.displayName ?? null,
      userEmail: req.user?.email ?? null,
      timestamp: now.toISOString(),
    });
  }
  emitGroupEvent(id, "group_reattest_queued_bulk", req);
  emitGroupEvent(id, "group_awaiting_payor_again", req);
  await refreshGroupDerivedFields(id);

  res.json({ group: updatedGroup, queuedLegIds: eligibleLegs.map((l) => l.id) });
}));

export default router;

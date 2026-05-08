import { Router, type IRouter, type Request } from "express";
import { eq, or, ilike, desc, asc, and, count, inArray, isNull, isNotNull, ne, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { invoiceGroupsTable, claimsTable, auditLogsTable, notesTable, portalSubmissionsTable, portalResponsesTable, claimEvidenceTable, claimVerdictTable, claimStatusEnum, errorTypesTable, stateEventsTable } from "@workspace/db";
import { deriveLegSubStatus } from "@workspace/leg-state";
import { emitStateEvent } from "../lib/state-events";
import { allDisputedLegsResolved, RESOLVED_LEG_SUB_STATUSES } from "../lib/group-readiness";
import { computeGroupReadiness } from "../lib/group-packaging";
import { refreshGroupDerivedFields, refreshClaimDenormalizedCache } from "../lib/denormalized-cache";
import { getGroupMacroPhase } from "../lib/macro-phase";
import { computeAttestationDelta } from "../lib/attestation";
import { applyMasDerivationsForLeg } from "../lib/mas-derivations";
import { setClaimDisposition, sopOutcomeToDisposition } from "../lib/leg-state/set-claim-disposition";
import { asyncHandler } from "../lib/asyncHandler";
import { broadcastGroupEvent, broadcastClaimEvent } from "../lib/sse";
import { blockMutationOnTourSampleGroup } from "../lib/tour-sample";
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
import { recomputeGroupServiceDate } from "../lib/group-service-date";
import { canSeeAmounts, dropAmountFiltersForUser, scrubMoneyFields, scrubMoneyFieldsArray } from "../lib/role";
import { denyClerk } from "../middlewares/denyClerk";
import { requireAuth } from "../middlewares/requireAuth";
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
import { isGroupOperatorDone } from "../lib/operator-attention";
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

// Display axis (Wave D-PR6 §3.E): the listing page's "Sort by status"
// column header sorts the visible status name alphabetically — keep
// on `status`, not `phase`. Phase is a coarse 5-bucket grouping that
// would scramble the within-phase ordering the operator reads
// (e.g. "Awaiting Response" and "Ready to Review" both sit under
// `phase='submitted'` and would tie under a phase sort).
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

  // Always hide the global tour-sample row from every list/aggregate
  // query. The row exists only so the in-app guided tour can navigate
  // to a real detail page (steps 18 & 20). See migration 0029 +
  // routes/tour.ts.
  conditions.push(eq(invoiceGroupsTable.isTourSample, false));

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

  // Task #546 — drill-in filter for the "what's hidden from the inbox"
  // chips on the Responses Awaiting Review page. The bucket SQL is
  // shared with `/responses/awaiting-review/hidden-counts` so the chip
  // count and the click-through list can never disagree by construction.
  const inboxHiddenRaw = typeof query.inboxHiddenBucket === "string"
    ? query.inboxHiddenBucket
    : "";
  if (inboxHiddenRaw === "unclassified" || inboxHiddenRaw === "awaitingPayorAgain" || inboxHiddenRaw === "acknowledgmentOnly") {
    conditions.push(buildInboxHiddenBucketCondition(inboxHiddenRaw));
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

// Audit 2026-05-08 / Fix #4 (canonical macro-phase boundary, Option A):
// PHASES_BY_MACRO replaces the legacy STATUS_BY_PHASE map. The list-tab
// filter now reads off `invoice_groups.phase` so the cohort matches what
// every detail-page reader (`getGroupMacroPhase(group)`) bucketed the
// row as. Concretely this moves "Portal Queued" and "Generating Email"
// rows OUT of the in-flight tab and INTO pre-submit — that's the boundary
// the canonical PHASE_TO_MACRO mapping in `lib/macro-phase.ts` enforces
// and the boundary every dashboard tile + detail page already used.
//
// `on-hold` is still sourced from legacy status: the phase column treats
// hold as a flag and backfills hold-suspended rows to `triage`. The
// canonical reader (`getGroupLifecyclePhaseFromGroup`) does the same
// short-circuit, so this stays in lockstep.
const PHASES_BY_MACRO = {
  "pre-submit": ["triage", "ready_to_submit"],
  "in-flight": ["submitted"],
  "response-pending": ["response_received", "reviewed"],
  "closed": ["closed"],
} as const;

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
  if (phase === "on-hold") {
    return eq(invoiceGroupsTable.status, "On Hold");
  }
  if (phase in PHASES_BY_MACRO) {
    const phases = PHASES_BY_MACRO[phase as keyof typeof PHASES_BY_MACRO];
    const phaseCondition = inArray(invoiceGroupsTable.phase, [...phases]);
    if (phase === "response-pending") {
      return and(
        phaseCondition,
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
    return phaseCondition;
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
    // Task #541: gate per-row badge flags on operator-done. A group
    // that's been pushed off the operator's active queue (post-submit
    // phase or outcome-driven closure) no longer surfaces the
    // pulsing "Today" / "Stuck" row badge — the dashboard's separate
    // group-level stuck-after-submission tier remains the chase
    // surface. The status-set check is preserved as a defense-in-depth
    // mirror so the row flags can never lead the operator-done
    // predicate (which is the source of truth).
    const operatorDone = isGroupOperatorDone({ phase: row.phase, outcome: row.outcome });
    const urgent =
      !operatorDone &&
      GROUP_ON_CLOCK_STATUSES.has(row.status) &&
      isUrgentDeadline(earliestDate, today);
    return {
      ...row,
      earliestDate,
      effectiveDaysLeft: effectiveDaysRemaining(earliestDate, today),
      isUrgent: urgent,
      // Task #352 + #541. Same date math as `isUrgent`, narrowed to
      // the post-submit "stuck" status set AND additionally gated on
      // the operator-done predicate. At the GROUP level the operator-
      // done set is a superset of the stuck status set (Portal
      // Queued → phase=submitted → operator-done), so this row flag
      // collapses to `false` everywhere — the chase tier is the
      // dashboard's separate group-level stuck list, not a per-row
      // pulse. Kept on the wire so existing clients that branch on
      // `submittedStuck` simply get a uniform `false`.
      submittedStuck:
        !operatorDone &&
        GROUP_STUCK_STATUSES.has(row.status) &&
        isAtOrPastEffectiveDeadline(earliestDate, today),
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

// Manual invoice-group creation. Mirrors the importer's per-group
// construction (group + N child legs in one transaction, then
// `recomputeGroupServiceDate` to refresh the denormalized
// earliest-service-date cache). Gated behind `denyClerk` to match the
// other write paths admins/users have but clerks do not. On invoice-
// number collisions the endpoint returns 409 with a summary of the
// existing group so the UI can prompt the operator to attach instead;
// re-submitting with `attachToExistingId` skips the create step and
// inserts the legs into the named group. The unique index on
// `invoice_groups.invoice_number` (migration 0031) is the durable
// guard — the upfront SELECT is just so the API can return a friendly
// 409 payload before the insert blows up.
router.post("/invoice-groups", denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const body = req.body as {
    invoiceNumber?: unknown;
    clientNumber?: unknown;
    payorEmail?: unknown;
    legs?: unknown;
    attachToExistingId?: unknown;
  };

  const invoiceNumber = typeof body.invoiceNumber === "string" ? body.invoiceNumber.trim() : "";
  if (!invoiceNumber) {
    res.status(400).json({ error: "invoiceNumber is required" });
    return;
  }

  if (!Array.isArray(body.legs) || body.legs.length === 0) {
    res.status(400).json({ error: "At least one leg is required" });
    return;
  }

  type LegInput = {
    confNumber: string;
    date: string | null;
    refNumber: string | null;
    clientNumber: string | null;
    carNumber: string | null;
    errorDetails: string | null;
    claimAmount: string | null;
  };

  const legs: LegInput[] = [];
  for (let i = 0; i < body.legs.length; i++) {
    const raw = body.legs[i] as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") {
      res.status(400).json({ error: `Leg #${i + 1} is malformed` });
      return;
    }
    const conf = typeof raw.confNumber === "string" ? raw.confNumber.trim() : "";
    if (!conf) {
      res.status(400).json({ error: `Leg #${i + 1}: confNumber is required` });
      return;
    }
    const dateRaw = typeof raw.date === "string" ? raw.date.trim() : "";
    // Tight ISO contract — same as the importer's normalized shape.
    if (dateRaw && !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      res.status(400).json({ error: `Leg #${i + 1}: date must be ISO YYYY-MM-DD` });
      return;
    }
    const amtRaw = raw.claimAmount;
    let claimAmount: string | null = null;
    if (amtRaw != null && amtRaw !== "") {
      const n = typeof amtRaw === "number" ? amtRaw : parseFloat(String(amtRaw));
      if (!Number.isFinite(n)) {
        res.status(400).json({ error: `Leg #${i + 1}: claimAmount must be numeric` });
        return;
      }
      claimAmount = String(n);
    }
    legs.push({
      confNumber: conf,
      date: dateRaw || null,
      refNumber: typeof raw.refNumber === "string" && raw.refNumber.trim() ? raw.refNumber.trim() : null,
      clientNumber: typeof raw.clientNumber === "string" && raw.clientNumber.trim() ? raw.clientNumber.trim() : null,
      carNumber: typeof raw.carNumber === "string" && raw.carNumber.trim() ? raw.carNumber.trim() : null,
      errorDetails: typeof raw.errorDetails === "string" && raw.errorDetails.trim() ? raw.errorDetails.trim() : null,
      claimAmount,
    });
  }

  const groupClientNumber = typeof body.clientNumber === "string" && body.clientNumber.trim()
    ? body.clientNumber.trim()
    : (legs.find(l => l.clientNumber)?.clientNumber ?? null);
  const payorEmail = typeof body.payorEmail === "string" && body.payorEmail.trim()
    ? body.payorEmail.trim()
    : null;

  const totalAmount = legs.reduce((sum, l) => sum + (l.claimAmount ? parseFloat(l.claimAmount) || 0 : 0), 0);

  // Reject duplicate confirmation numbers (DB has no unique index on
  // claims.conf_number, but creating two legs with the same conf in
  // a single submission is always a typo).
  const confSeen = new Set<string>();
  for (const l of legs) {
    if (confSeen.has(l.confNumber)) {
      res.status(400).json({ error: `Duplicate confirmation number in submission: ${l.confNumber}` });
      return;
    }
    confSeen.add(l.confNumber);
  }

  const attachToExistingId = typeof body.attachToExistingId === "number" ? body.attachToExistingId : null;
  const actor = actorFromReq(req);

  const result = await db.transaction(async (tx) => {
    let group: typeof invoiceGroupsTable.$inferSelect | null = null;
    let attachedToExisting = false;

    if (attachToExistingId != null) {
      const [existing] = await tx.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, attachToExistingId));
      if (!existing) {
        return { kind: "error" as const, status: 400, body: { error: "attachToExistingId does not match any invoice group" } };
      }
      if (existing.invoiceNumber !== invoiceNumber) {
        return { kind: "error" as const, status: 400, body: { error: "attachToExistingId belongs to a different invoiceNumber" } };
      }
      group = existing;
      attachedToExisting = true;
    } else {
      const [collision] = await tx.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.invoiceNumber, invoiceNumber));
      if (collision) {
        return {
          kind: "conflict" as const,
          existingGroup: {
            id: collision.id,
            invoiceNumber: collision.invoiceNumber,
            rideCount: collision.rideCount,
            totalAmount: collision.totalAmount,
            status: collision.status,
          },
        };
      }
      const [created] = await tx.insert(invoiceGroupsTable).values({
        invoiceNumber,
        clientNumber: groupClientNumber,
        // Group-level errorDetails is left null on manual create — the
        // operator picks an error type during triage on the detail
        // page, which is also where group-level errorDetails gets set.
        // Status starts at "Needs Review" so the row lands on the
        // operator's classification queue immediately, exactly like an
        // imported row that lacks an error type.
        status: "Needs Review",
        outcome: "Pending",
        rideCount: legs.length,
        totalAmount: String(totalAmount),
        payorEmail,
      }).returning();
      group = created;
    }

    if (!group) {
      return { kind: "error" as const, status: 500, body: { error: "Failed to resolve invoice group" } };
    }

    const insertedLegs = await tx.insert(claimsTable).values(legs.map(l => ({
      invoiceGroupId: group!.id,
      confNumber: l.confNumber,
      date: l.date,
      refNumber: l.refNumber,
      clientNumber: l.clientNumber ?? groupClientNumber ?? null,
      carNumber: l.carNumber,
      errorDetails: l.errorDetails,
      claimAmount: l.claimAmount,
      payorEmail,
      status: "New" as const,
      outcome: "Pending" as const,
      invoiceNumbers: invoiceNumber,
      // No errorType yet — operator assigns during triage on the
      // detail page. Match the importer's `includedInDispute = false`
      // when there's no error type set.
      includedInDispute: false,
    }))).returning({ id: claimsTable.id });

    // Refresh group totals + ride count when attaching to an existing
    // group so the denormalized columns stay accurate.
    if (attachedToExisting) {
      const [{ count: c }] = await tx.select({ count: count() }).from(claimsTable).where(eq(claimsTable.invoiceGroupId, group.id));
      const allLegs = await tx.select({ amt: claimsTable.claimAmount }).from(claimsTable).where(eq(claimsTable.invoiceGroupId, group.id));
      const newTotal = allLegs.reduce((s, r) => s + (r.amt ? parseFloat(r.amt) || 0 : 0), 0);
      await tx.update(invoiceGroupsTable).set({
        rideCount: c,
        totalAmount: String(newTotal),
      }).where(eq(invoiceGroupsTable.id, group.id));
    }

    await tx.insert(auditLogsTable).values({
      invoiceGroupId: group.id,
      action: attachedToExisting ? "invoice_group_legs_added" : "invoice_group_created",
      details: attachedToExisting
        ? `Attached ${insertedLegs.length} leg${insertedLegs.length === 1 ? "" : "s"} to invoice ${invoiceNumber} via manual entry`
        : `Invoice ${invoiceNumber} created manually with ${insertedLegs.length} leg${insertedLegs.length === 1 ? "" : "s"}`,
      metadata: { source: "manual", legIds: insertedLegs.map(l => l.id) },
      userEmail: actor.userEmail,
      userName: actor.userName,
    });

    return {
      kind: "ok" as const,
      groupId: group.id,
      createdLegIds: insertedLegs.map(l => l.id),
      attachedToExisting,
    };
  });

  if (result.kind === "error") {
    res.status(result.status).json(result.body);
    return;
  }
  if (result.kind === "conflict") {
    res.status(409).json({
      error: `Invoice ${invoiceNumber} already exists`,
      existingGroup: result.existingGroup,
    });
    return;
  }

  // Refresh denormalized service-date cache outside the tx (helper
  // opens its own connection).
  await recomputeGroupServiceDate(result.groupId);

  const [refreshed] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, result.groupId));

  emitGroupEvent(result.groupId, result.attachedToExisting ? "invoice_group_legs_added" : "invoice_group_created", req);

  res.status(201).json({
    group: scrubMoneyFields(refreshed, req.user),
    createdLegIds: result.createdLegIds,
    attachedToExisting: result.attachedToExisting,
  });
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
  // Task #419 — per-status group count for the inbox header. Lets
  // operators see at a glance why an unfamiliar group (one whose
  // parent is no longer "Needs Review", e.g. "Generating Email" or
  // "Awaiting Response") is appearing now that Task #412 broadened the
  // cohort beyond Needs Review only. Keys are the parent group's
  // status string; values are the count of inbox rows in that status.
  // Sorted by descending count, then by status name asc, so the JSON
  // order is stable and the UI can render the entries directly.
  byStatus: Record<string, number>;
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
    .where(eq(invoiceGroupsTable.isTourSample, false))
    // Task #412: broaden the inbox so any active leg with no Error Type
    // surfaces, regardless of parent group status. Previously the
    // predicate was scoped to `Needs Review` only, which hid legs whose
    // parent group had already advanced to `Generating Email`,
    // `Awaiting Response`, etc. — those legs were unreachable from the
    // inbox even though they still needed an Error Type. Active-leg
    // filtering still happens via `deriveLegSubStatus` below.
    .orderBy(asc(invoiceGroupsTable.id), asc(claimsTable.id));

  const groupIds = Array.from(new Set(candidateLegs.map((l) => l.invoiceGroupId).filter((x): x is number => x != null)));
  if (groupIds.length === 0) {
    return { total: 0, byStatus: {}, groups: [] };
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

  // Sort (Task #412): `Needs Review` first (the original cohort —
  // pre-pipeline groups that operators expect to triage in batches),
  // then everything else by parent-group service date asc so urgent
  // already-in-flight groups float to the top of the rest. Within each
  // status bucket, all-blank groups fall to the bottom (they need
  // manual triage with no qualifying-sibling shortcut).
  inboxGroups.sort((a, b) => {
    const aNR = a.status === "Needs Review" ? 0 : 1;
    const bNR = b.status === "Needs Review" ? 0 : 1;
    if (aNR !== bNR) return aNR - bNR;
    if (a.allBlank !== b.allBlank) return a.allBlank ? 1 : -1;
    return a.id - b.id;
  });

  // Per-status group count (Task #419). Tally over the surfaced inbox
  // rows so the header totals match the visible list exactly. Sorted
  // by descending count, then by status name asc, so the JSON order
  // is stable across requests and the UI can render entries in array
  // order without re-sorting.
  const statusCounts = new Map<string, number>();
  for (const g of inboxGroups) {
    statusCounts.set(g.status, (statusCounts.get(g.status) ?? 0) + 1);
  }
  const byStatus: Record<string, number> = {};
  Array.from(statusCounts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .forEach(([status, n]) => {
      byStatus[status] = n;
    });

  return {
    total: inboxGroups.reduce((acc, g) => acc + g.needsClassificationCount, 0),
    byStatus,
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

// GET /invoice-groups/attestation-history — feeds the "Completed
// re-attestations" tab on the Attestation Queue page. Returns groups
// whose `reattest_completed_at` falls within the requested trailing
// window (7d / 30d / all), sorted most-recent-first, with each group's
// per-leg attestation outcomes pre-classified into one of four buckets
// (`attested`, `mas_cancelled`, `queued`, `not_required`).
//
// Capped at 200 groups; `truncated=true` flags an over-cap window so
// the UI can hint the operator to narrow the range. We sort + cap at
// the SQL layer so the leg fan-out only runs against the row set the
// UI will actually render.
const ATTESTATION_HISTORY_CAP = 200;
router.get("/invoice-groups/attestation-history", asyncHandler(async (req, res): Promise<void> => {
  // Auth gate. The shared `requireAuth` middleware runs at the app
  // level in production, but mounting this router in isolation (tests)
  // must still 401 unauthenticated callers. `req.isAuthenticated` is
  // injected by passport in production and by the test harness in
  // tests; the literal `false` check is intentional so a missing fn
  // doesn't accidentally lock callers out.
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated() === false) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const rawRange = (req.query.range ?? "7d") as string;
  const range = rawRange === "30d" || rawRange === "all" ? rawRange : "7d";

  const conditions: SQL[] = [
    isNotNull(invoiceGroupsTable.reattestCompletedAt),
    eq(invoiceGroupsTable.isTourSample, false),
  ];
  if (range !== "all") {
    const days = range === "30d" ? 30 : 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    conditions.push(gte(invoiceGroupsTable.reattestCompletedAt, cutoff));
  }
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  // Pull cap+1 so we can detect "more rows than the cap" without a
  // separate COUNT(*) query.
  const groupRows = await db
    .select()
    .from(invoiceGroupsTable)
    .where(where)
    .orderBy(desc(invoiceGroupsTable.reattestCompletedAt))
    .limit(ATTESTATION_HISTORY_CAP + 1);

  const truncated = groupRows.length > ATTESTATION_HISTORY_CAP;
  const visibleGroups = truncated ? groupRows.slice(0, ATTESTATION_HISTORY_CAP) : groupRows;

  if (visibleGroups.length === 0) {
    res.json({ groups: [], truncated: false });
    return;
  }

  // One leg-fetch covering every visible group so we don't N+1 over
  // the queried groups.
  const groupIds = visibleGroups.map((g) => g.id);
  const legRows = await db
    .select()
    .from(claimsTable)
    .where(inArray(claimsTable.invoiceGroupId, groupIds));

  // Group legs by parent invoice group id once, then assemble the
  // ordered response in a single pass over `visibleGroups` so the
  // server preserves the SQL-imposed sort order.
  const legsByGroup = new Map<number, typeof claimsTable.$inferSelect[]>();
  for (const leg of legRows) {
    if (leg.invoiceGroupId == null) continue;
    const bucket = legsByGroup.get(leg.invoiceGroupId);
    if (bucket) bucket.push(leg);
    else legsByGroup.set(leg.invoiceGroupId, [leg]);
  }

  const entries = visibleGroups.map((rawGroup) => {
    const group = scrubMoneyFields(rawGroup, req.user);
    const legs = (legsByGroup.get(rawGroup.id) ?? []).map((rawLeg) => {
      const claim = scrubMoneyFields(rawLeg, req.user);
      // Classify per-leg outcome. Order matters: `attested` is the
      // strongest signal (operator confirmed the re-attestation in the
      // payor portal), then `mas_cancelled` for legs that resolved via
      // a MAS cancel instead of an attestation, then `queued` for legs
      // still parked for a portal user, falling back to `not_required`
      // for everything else (e.g. non-Approved siblings that rode
      // along with the disputed legs).
      let attestationOutcome: "attested" | "mas_cancelled" | "queued" | "not_required";
      let outcomeAt: Date | null = null;
      let outcomeBy: string | null = null;
      let outcomeNote: string | null = null;
      if (rawLeg.attestedAt) {
        attestationOutcome = "attested";
        outcomeAt = rawLeg.attestedAt;
        outcomeBy = rawLeg.attestedBy ?? null;
        outcomeNote = rawLeg.attestationNote ?? null;
      } else if (rawLeg.masActionRequired === "cancel" && rawLeg.masActionCompletedAt) {
        attestationOutcome = "mas_cancelled";
        outcomeAt = rawLeg.masActionCompletedAt;
        outcomeBy = rawLeg.masActionCompletedBy ?? null;
        outcomeNote = rawLeg.masActionNote ?? null;
      } else if (rawLeg.attestationState === "queued") {
        attestationOutcome = "queued";
        outcomeAt = rawLeg.attestationQueuedAt ?? null;
        outcomeBy = rawLeg.attestationQueuedBy ?? null;
        outcomeNote = rawLeg.attestationNote ?? null;
      } else {
        attestationOutcome = "not_required";
      }
      return {
        claim,
        attestationOutcome,
        outcomeAt: outcomeAt ? outcomeAt.toISOString() : null,
        outcomeBy,
        outcomeNote,
      };
    });
    return { group, legs };
  });

  res.json({ groups: entries, truncated });
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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

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

// Pivot B2 (Task #471): this is the **only** sanctioned bulk
// error-type write path. Per the invoice-first model, an invoice's
// dispute reason **is** its error type, so per-leg divergence within
// one invoice has no real-world meaning. The sibling leg endpoint
// (`POST /claims/bulk-assign-error-type`) returns
// `409 { code: "use_group_endpoint" }` for any leg that belongs to a
// group; UI callers must map selected leg ids → distinct group ids and
// call this endpoint instead.
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
    errorTypeId: invoiceGroupsTable.errorTypeId,
  })
    .from(invoiceGroupsTable)
    .where(inArray(invoiceGroupsTable.id, requestedIds));

  const matchedIds = new Set(existing.map((g) => g.id));
  const skipped: Array<{ id: number; refNumber: string | null; reason: string }> = requestedIds
    .filter((id) => !matchedIds.has(id))
    .map((id) => ({ id, refNumber: null, reason: "not_found" }));

  // Pivot B2 (Task #471): groups already carrying the target error
  // type are excluded from the write and surfaced in the toast with
  // the stable reason `already_assigned` so operators can see "no-op"
  // rows. Stable reason strings keep the toast / log analysis
  // grep-able.
  const targetErrorTypeId = String(errorTypeId);
  const toUpdate = existing.filter((g) => String(g.errorTypeId ?? "") !== targetErrorTypeId);
  for (const g of existing) {
    if (String(g.errorTypeId ?? "") === targetErrorTypeId) {
      skipped.push({ id: g.id, refNumber: g.invoiceNumber, reason: "already_assigned" });
    }
  }

  if (existing.length === 0) {
    res.status(404).json({
      success: false,
      updated: 0,
      updatedItems: [],
      skipped,
    });
    return;
  }

  if (toUpdate.length > 0) {
    await db.update(invoiceGroupsTable)
      .set({ errorTypeId, errorTypeName: errorTypeName || null })
      .where(inArray(invoiceGroupsTable.id, toUpdate.map((g) => g.id)));

    const actor = actorFromReq(req);
    for (const g of toUpdate) {
      await db.insert(auditLogsTable).values({
        invoiceGroupId: g.id,
        action: "group_error_type_assigned",
        details: `Error type assigned: ${errorTypeName || errorTypeId}`,
        metadata: { errorTypeId, errorTypeName },
        ...actor,
      });
    }
  }

  res.json({
    success: true,
    updated: toUpdate.length,
    updatedItems: toUpdate.map((g) => ({ id: g.id, refNumber: g.invoiceNumber })),
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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

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

// Live counter for the "Responses Awaiting Review" sidebar badge. Must
// count exactly the rows the /responses-awaiting-review page renders so
// the rail and the page can never disagree. The page queries
// `macroPhase=response-pending&errorTypeAssigned=true`, which means:
//   - status ∈ {Ready to Review, Needs Review} (the response-pending
//     macro phase — anything where a payor reply is in but no one has
//     moved the group on to Reattest or Closed yet)
//   - classified (errorTypeId set)
//   - NOT in MAS-action-required state — those rows have moved to the
//     Attestation Queue / inline checklist and are hidden from this page
// We layer on the same reviewable-response EXISTS guard the list uses
// (Task #299) so blank Needs-Review rows the inbox already hides can't
// bump the badge.
//
// Task #541 parity contract: the SQL below reuses
// `buildMacroPhaseCondition("response-pending")` so the badge cohort
// is, by construction, the SAME predicate the list endpoint applies
// when the page calls `useListInvoiceGroups({ macroPhase:
// "response-pending", errorTypeAssigned: true })`. The
// `errorTypeAssigned` clause and the reviewable-response EXISTS guard
// are likewise mirrored. Result: the badge can only ever go to zero
// when the page's empty state renders, and vice versa — celebrating
// the empty state without a count of zero (or vice versa) is now
// impossible without changing both sides of this contract together.
router.get("/responses/awaiting-review/count", asyncHandler(async (_req, res): Promise<void> => {
  const responsePendingPredicate = buildMacroPhaseCondition("response-pending");
  const [row] = await db
    .select({ value: count() })
    .from(invoiceGroupsTable)
    .where(and(
      responsePendingPredicate!,
      isNotNull(invoiceGroupsTable.errorTypeId),
      ne(invoiceGroupsTable.errorTypeId, ""),
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

// Task #546 — counts for the "what's hidden from this view" summary
// strip on /responses-awaiting-review. Surfaces groups that satisfy the
// base response-pending criteria but are excluded from the inbox by
// exactly one of three reasons. Buckets are mutually exclusive in the
// declared order ("missing error type wins" tie-breaker) so a group
// hidden for two reasons is counted once, never twice.
//
// Base predicate mirrors `buildMacroPhaseCondition("response-pending")`
// MINUS the awaiting-payor-again suppression and the reviewable-
// response EXISTS guard — those two filters become bucket discriminants
// here rather than gates.
type InboxHiddenBucket = "unclassified" | "awaitingPayorAgain" | "acknowledgmentOnly";

function buildInboxHiddenBucketCondition(bucket: InboxHiddenBucket): SQL {
  // Audit 2026-05-08 / Fix #4: mirror canonical macro-phase boundary.
  const responsePendingPhases = PHASES_BY_MACRO["response-pending"];
  const baseCondition = and(
    inArray(invoiceGroupsTable.phase, [...responsePendingPhases]),
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
  )!;
  const isClassified = and(
    isNotNull(invoiceGroupsTable.errorTypeId),
    ne(invoiceGroupsTable.errorTypeId, ""),
  )!;
  const isUnclassified = or(
    isNull(invoiceGroupsTable.errorTypeId),
    eq(invoiceGroupsTable.errorTypeId, ""),
  )!;
  const hasAnyResponse = sql`exists (
    select 1 from portal_responses pr
    where pr.invoice_group_id = ${invoiceGroupsTable.id}
  )`;
  const hasReviewableResponse = sql`exists (
    select 1 from portal_responses pr
    where pr.invoice_group_id = ${invoiceGroupsTable.id}
      and pr."responseType" in (
        'approval', 'denial', 'partial_approval', 'info_request', 'other'
      )
  )`;
  const suppressedByAwaitingPayor = and(
    isNotNull(invoiceGroupsTable.awaitingPayorAgainAt),
    sql`not exists (
      select 1 from portal_responses pr
      where pr.invoice_group_id = ${invoiceGroupsTable.id}
        and pr.received_at > ${invoiceGroupsTable.awaitingPayorAgainAt}
    )`,
  )!;

  if (bucket === "unclassified") {
    return and(baseCondition, isUnclassified, hasAnyResponse)!;
  }
  if (bucket === "awaitingPayorAgain") {
    return and(baseCondition, isClassified, suppressedByAwaitingPayor)!;
  }
  return and(
    baseCondition,
    isClassified,
    or(
      isNull(invoiceGroupsTable.awaitingPayorAgainAt),
      sql`exists (
        select 1 from portal_responses pr
        where pr.invoice_group_id = ${invoiceGroupsTable.id}
          and pr.received_at > ${invoiceGroupsTable.awaitingPayorAgainAt}
      )`,
    )!,
    hasAnyResponse,
    sql`not (${hasReviewableResponse})`,
  )!;
}

router.get("/responses/awaiting-review/hidden-counts", asyncHandler(async (_req, res): Promise<void> => {
  const [unclassifiedRow, awaitingRow, ackRow] = await Promise.all([
    db.select({ value: count() }).from(invoiceGroupsTable).where(buildInboxHiddenBucketCondition("unclassified")),
    db.select({ value: count() }).from(invoiceGroupsTable).where(buildInboxHiddenBucketCondition("awaitingPayorAgain")),
    db.select({ value: count() }).from(invoiceGroupsTable).where(buildInboxHiddenBucketCondition("acknowledgmentOnly")),
  ]);

  res.json({
    unclassified: unclassifiedRow[0]?.value ?? 0,
    awaitingPayorAgain: awaitingRow[0]?.value ?? 0,
    acknowledgmentOnly: ackRow[0]?.value ?? 0,
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

// Task #455 — outcome of `parseAndValidateRename` so callers can branch
// without re-throwing.
type RenameValidation =
  | { kind: "absent" }
  | { kind: "noop" }
  | { kind: "ok"; from: string; to: string; sourceResponseId: number | null }
  | { kind: "error"; status: 400 | 409; code: string; error: string };

/**
 * Task #455 — validate the optional `renameInvoiceNumberTo` payload off
 * the Re-attest endpoints. Pure (no DB hit besides the uniqueness probe
 * the caller runs INSIDE its transaction); returns a tagged union so the
 * caller can either ignore it ("absent"/"noop"), respond with a stable
 * 4xx code, or proceed with the rename inside its transaction.
 *
 * Validation rules:
 *   * If `renameInvoiceNumberTo` is missing/null/empty after trim, treat
 *     as absent — no rename intent.
 *   * If the trimmed value equals the current invoiceNumber, treat as a
 *     no-op (don't error — the operator may have just confirmed the
 *     suggestion that already matches).
 *   * `renameSourceResponseId`, when present, must be a positive integer.
 */
function parseAndValidateRename(
  body: unknown,
  currentInvoiceNumber: string,
): RenameValidation {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = b.renameInvoiceNumberTo;
  if (raw == null) return { kind: "absent" };
  if (typeof raw !== "string") {
    return {
      kind: "error",
      status: 400,
      code: "invalid_rename_invoice_number",
      error: "renameInvoiceNumberTo must be a string",
    };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: "absent" };
  if (trimmed === currentInvoiceNumber) return { kind: "noop" };

  // Same intake-style format rules: invoice numbers in this product
  // are short, single-token identifiers — no internal whitespace, no
  // control characters, ASCII printable only, capped at 64 chars to
  // match what the import path tolerates without truncation. Reject
  // anything else with a stable code so the UI can surface the
  // problem before the request opens a transaction.
  if (trimmed.length > 64) {
    return {
      kind: "error",
      status: 400,
      code: "invalid_rename_invoice_number",
      error: "renameInvoiceNumberTo must be 64 characters or fewer.",
    };
  }
  if (/\s/.test(trimmed)) {
    return {
      kind: "error",
      status: 400,
      code: "invalid_rename_invoice_number",
      error: "renameInvoiceNumberTo must not contain whitespace.",
    };
  }
  // Disallow control characters and non-ASCII bytes — the intake
  // pipeline trims and stores plain ASCII identifiers, and a stray
  // smart-quote / NBSP would silently 404 every downstream lookup.
  // eslint-disable-next-line no-control-regex
  if (/[^\x21-\x7E]/.test(trimmed)) {
    return {
      kind: "error",
      status: 400,
      code: "invalid_rename_invoice_number",
      error: "renameInvoiceNumberTo must contain only printable ASCII characters.",
    };
  }

  let sourceResponseId: number | null = null;
  if (b.renameSourceResponseId != null) {
    const n = Number(b.renameSourceResponseId);
    if (!Number.isInteger(n) || n <= 0) {
      return {
        kind: "error",
        status: 400,
        code: "invalid_rename_source_response_id",
        error: "renameSourceResponseId must be a positive integer",
      };
    }
    sourceResponseId = n;
  }

  return { kind: "ok", from: currentInvoiceNumber, to: trimmed, sourceResponseId };
}

/**
 * Task #455 — apply an in-transaction invoice-number rename for a group.
 * Throws a tagged error if another group already uses the new number so
 * the surrounding `db.transaction` rolls back the entire write set
 * (re-attest stamp, draft promotion, queue flips). The audit row records
 * `{from, to, sourceResponseId?}` per spec.
 *
 * Caller is responsible for invoking this only when
 * `parseAndValidateRename` returned `kind === "ok"`.
 */
class InvoiceNumberConflictError extends Error {
  // `conflictingGroupId` is best-effort: 0 when the conflict was
  // detected via a Postgres 23505 inside an aborted transaction
  // (Task #457) where we cannot safely re-query for the winning
  // row's id. Callers should treat it as informational and key on
  // the `code:invoice_number_conflict` response field instead.
  constructor(public readonly conflictingGroupId: number, public readonly invoiceNumber: string) {
    super(`Invoice number ${invoiceNumber} is already in use by group ${conflictingGroupId}`);
    this.name = "InvoiceNumberConflictError";
  }
}

async function applyGroupInvoiceRename(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  groupId: number,
  rename: { from: string; to: string; sourceResponseId: number | null },
  actor: { userEmail: string | null; userName: string | null },
): Promise<void> {
  // Uniqueness probe inside the same tx so any concurrent rename racing
  // us either commits before we read (we see it and 409) or commits
  // after we write (the DB unique index — Task #457, migration 0031 —
  // raises 23505 which we re-shape into the same conflict error
  // below). The app-level probe is kept because it lets us return the
  // *conflicting group's id* in the 409 body, which the unique-
  // violation error doesn't carry.
  const collision = await tx
    .select({ id: invoiceGroupsTable.id })
    .from(invoiceGroupsTable)
    .where(and(
      eq(invoiceGroupsTable.invoiceNumber, rename.to),
      ne(invoiceGroupsTable.id, groupId),
    ))
    .limit(1);
  if (collision.length > 0) {
    throw new InvoiceNumberConflictError(collision[0].id, rename.to);
  }

  try {
    await tx
      .update(invoiceGroupsTable)
      .set({ invoiceNumber: rename.to })
      .where(eq(invoiceGroupsTable.id, groupId));
  } catch (err: unknown) {
    // Concurrent committer beat us between the probe above and this
    // UPDATE. The DB unique index (Task #457, migration 0031) raises
    // Postgres 23505 (unique_violation); re-shape into the same 409
    // contract. We CANNOT re-query inside this tx — Postgres aborts
    // the transaction on the first failed statement, so any further
    // query would itself fail with 25P02 (in_failed_sql_transaction).
    // Throw with conflictingGroupId=0; the outer catch rolls back
    // the tx and turns this into the same `code:invoice_number_conflict`
    // 409 response. The id-of-other-group field is best-effort
    // metadata only (the message + code are what the UI keys on),
    // and the probe path above still populates it for the
    // overwhelmingly common non-racing case.
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      throw new InvoiceNumberConflictError(0, rename.to);
    }
    throw err;
  }

  await tx.insert(auditLogsTable).values({
    invoiceGroupId: groupId,
    action: "group_invoice_number_renamed",
    details: `Invoice number renamed from #${rename.from} to #${rename.to}`,
    metadata: {
      from: rename.from,
      to: rename.to,
      sourceResponseId: rename.sourceResponseId,
    },
    userEmail: actor.userEmail,
    userName: actor.userName,
  });
}


// POST /invoice-groups/:id/group-context — operator records the group-level
// "what's going on with this invoice" narrative used by the dispute write-
// up. Pre-submit only.
router.post("/invoice-groups/:id/group-context", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await blockMutationOnTourSampleGroup(id, res)) return;
  const context = (req.body?.context ?? "") as string;
  if (typeof context !== "string") { res.status(400).json({ error: "context must be a string" }); return; }

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  const phase = getGroupMacroPhase(group);
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
  if (await blockMutationOnTourSampleGroup(id, res)) return;
  const readback = (req.body?.readback ?? "") as string;
  if (!readback || typeof readback !== "string") {
    res.status(400).json({ error: "readback is required" });
    return;
  }

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  const phase = getGroupMacroPhase(group);
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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  const phase = getGroupMacroPhase(group);
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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

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

  const phase = getGroupMacroPhase(group);
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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  const phase = getGroupMacroPhase(group);
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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  const phase = getGroupMacroPhase(group);
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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

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

// Task #470 — Pivot B1 — Group-level SOP advance for matching legs.
//
// POST /invoice-groups/:id/sop-advance
//
// Body: { nodeId: string, answer: string,
//         terminalSopOutcome?: "portal_dispute"|"dispute"|"hold"|
//                              "cannot_dispute"|"non_issue" }
//
// Bulk-applies one SOP step to every "matching" leg in the group.
//
// PRE-CHECK (defence-in-depth, three-layer opt-in):
//   1. Author flagged the node `appliesPerInvoice = true`.
//   2. Operator opted in via the UI.
//   3. THIS server-side check verifies the flag at runtime AND that the
//      chosen option's child step doesn't itself open evidence /
//      per-leg context. If either fails, the call HARD-FAILS with
//      `409 { code: "node_not_bulk_eligible" }`. We never silently
//      downgrade to a per-leg path.
//
// MATCHING legs (advanced inside one db.transaction):
//   - includedInDispute = true
//   - sopOutcome IS NULL
//   - sopNodeId = req.body.nodeId
//   - duplicateOfClaimId IS NULL (sibling-duplicates follow their
//     primary; reported in `skipped` with reason "sibling_duplicate")
//
// SKIPPED reasons (per-leg):
//   - wrong_node               leg's sopNodeId no longer matches
//   - already_terminal         sopOutcome already stamped
//   - excluded_from_dispute    includedInDispute=false
//   - sibling_duplicate        leg follows another leg as a duplicate
//
// All DB writes — leg updates, per-leg `leg_sop_advanced` audits,
// per-leg `leg.sop_advanced` state events, and the umbrella
// `group_sop_advanced_bulk` audit — run inside the SAME txn. If any
// per-leg write fails the entire call rolls back and 500s. Cache
// refresh + MAS derivations + SSE broadcasts are post-commit (they're
// not transactional state we'd want to roll back).
type BulkSkipReason =
  | "wrong_node"
  | "already_terminal"
  | "excluded_from_dispute"
  | "sibling_duplicate";

type SopBulkTreeOption = {
  label: string;
  childId?: string;
  outcomeType?: string;
};
type SopBulkTreeNode = {
  id: string;
  question: string;
  options: SopBulkTreeOption[];
  appliesPerInvoice?: boolean;
  requiresPerLegContext?: boolean;
  evidenceRequirements?: Array<unknown>;
};
type SopBulkTree = {
  rootId: string;
  nodes: SopBulkTreeNode[];
};

const SOP_BULK_DROP_REASONS = new Set(["cannot_dispute", "non_issue"]);
const SOP_BULK_READY_REASONS = new Set(["portal_dispute", "dispute"]);
const SOP_BULK_TERMINAL_OUTCOMES = new Set([
  "portal_dispute", "dispute", "hold", "cannot_dispute", "non_issue",
]);

function mapBulkOutcome(o: string | undefined | null): string | null {
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

function legRef(leg: typeof claimsTable.$inferSelect): string {
  return leg.confNumber || `CLM-${leg.id}`;
}

// Test seam — set `failUmbrellaAuditOnce = true` from a test to force
// the next umbrella-audit insert in the bulk endpoint to throw, then
// the flag auto-resets. Production code never sets this.
export const BULK_SOP_TEST_HOOKS = { failUmbrellaAuditOnce: false };

router.post("/invoice-groups/:id/sop-advance", requireAuth, denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await blockMutationOnTourSampleGroup(id, res)) return;

  const group = await loadGroupOr404(id, res);
  if (!group) return;

  const nodeId = (req.body?.nodeId ?? "") as string;
  const answer = (req.body?.answer ?? "") as string;
  const terminalSopOutcomeRaw = req.body?.terminalSopOutcome;
  if (!nodeId || !answer) {
    res.status(400).json({ error: "nodeId and answer are required" });
    return;
  }
  let terminalSopOutcome: string | null = null;
  if (terminalSopOutcomeRaw !== undefined && terminalSopOutcomeRaw !== null) {
    if (typeof terminalSopOutcomeRaw !== "string" || !SOP_BULK_TERMINAL_OUTCOMES.has(terminalSopOutcomeRaw)) {
      res.status(400).json({ error: "terminalSopOutcome must be one of portal_dispute|dispute|hold|cannot_dispute|non_issue" });
      return;
    }
    terminalSopOutcome = terminalSopOutcomeRaw;
  }

  // Pull every leg in the group in one shot. We classify locally so
  // each non-matching leg can be reported back with a stable skip reason
  // alongside its confNumber ref.
  const legs = await db.select().from(claimsTable).where(eq(claimsTable.invoiceGroupId, id));

  // Cache decision-tree lookups across the whole route so a 200-leg
  // group with five distinct trees only loads each one once.
  const treeCache = new Map<string, SopBulkTree | null>();
  async function loadTreeFor(errorTypeId: string): Promise<SopBulkTree | null> {
    if (treeCache.has(errorTypeId)) return treeCache.get(errorTypeId)!;
    const [row] = await db
      .select({ decisionTree: errorTypesTable.decisionTree })
      .from(errorTypesTable)
      .where(eq(errorTypesTable.id, Number(errorTypeId)));
    const tree = (row?.decisionTree as unknown as SopBulkTree | null) ?? null;
    treeCache.set(errorTypeId, tree);
    return tree;
  }

  // ---- Pre-check (independent of candidate count). --------------------
  // The defence-in-depth contract says: if the requested node is NOT
  // bulk-eligible (missing appliesPerInvoice, or chosen branch's child
  // step opens evidence/per-leg context) the endpoint MUST hard-fail
  // 409 `node_not_bulk_eligible`. We evaluate this against every
  // distinct tree referenced by any leg in the group BEFORE we even
  // look at candidate legs, so an empty candidate set never masks an
  // ineligible node from the operator.
  const distinctErrorTypeIds = Array.from(new Set(
    legs.map((l) => l.errorTypeId).filter((v): v is string => !!v),
  ));
  let nodeFoundInAnyTree = false;
  for (const etId of distinctErrorTypeIds) {
    const tree = await loadTreeFor(etId);
    if (!tree) continue;
    const node = tree.nodes?.find((n) => n.id === nodeId);
    if (!node) continue;
    nodeFoundInAnyTree = true;
    if (node.appliesPerInvoice !== true) {
      res.status(409).json({
        code: "node_not_bulk_eligible",
        reason: "This SOP step needs a per-leg answer or per-leg evidence.",
      });
      return;
    }
    const option = node.options?.find((o) => o.label === answer);
    if (!option) {
      res.status(400).json({
        error: `Answer "${answer}" is not a valid option for node "${nodeId}".`,
      });
      return;
    }
    if (option.childId) {
      const child = tree.nodes.find((n) => n.id === option.childId);
      const childHasPerLegWork = !!child &&
        ((Array.isArray(child.evidenceRequirements) && child.evidenceRequirements.length > 0) ||
          child.requiresPerLegContext === true);
      if (childHasPerLegWork) {
        res.status(409).json({
          code: "node_not_bulk_eligible",
          reason: "The next step in this branch requires per-leg evidence or context.",
        });
        return;
      }
    }
  }
  if (!nodeFoundInAnyTree) {
    // No tree in the group references this node — there is nothing to
    // bulk-advance. Surface as `node_not_bulk_eligible` rather than a
    // generic 400 so the UI can render a consistent "not available"
    // message and the operator can fall back to the per-leg path.
    res.status(409).json({
      code: "node_not_bulk_eligible",
      reason: "No legs in this group are using a decision tree that contains this step.",
    });
    return;
  }

  // ---- Candidate matching (root-null aware). ---------------------------
  // A leg matches when it's at the same node as the request OR it has
  // never advanced (sopNodeId IS NULL) AND the requested node is the
  // root of that leg's tree — operators kicking off the SOP for an
  // entire group at the root step shouldn't be blocked by the leg
  // never having had its sopNodeId stamped.
  type CandidateLeg = typeof claimsTable.$inferSelect;
  async function legMatchesNode(leg: CandidateLeg): Promise<boolean> {
    if (leg.errorTypeId == null) return false;
    if (leg.sopNodeId === nodeId) return true;
    if (leg.sopNodeId == null) {
      const tree = await loadTreeFor(leg.errorTypeId);
      return tree?.rootId === nodeId;
    }
    return false;
  }

  type Eligible = { leg: CandidateLeg; tree: SopBulkTree; node: SopBulkTreeNode; option: SopBulkTreeOption };
  const eligible: Eligible[] = [];
  const skipped: Array<{ id: number; ref: string; reason: BulkSkipReason }> = [];

  for (const leg of legs) {
    if (leg.duplicateOfClaimId != null) {
      skipped.push({ id: leg.id, ref: legRef(leg), reason: "sibling_duplicate" }); continue;
    }
    if (!leg.includedInDispute) {
      skipped.push({ id: leg.id, ref: legRef(leg), reason: "excluded_from_dispute" }); continue;
    }
    if (leg.sopOutcome != null) {
      skipped.push({ id: leg.id, ref: legRef(leg), reason: "already_terminal" }); continue;
    }
    if (!(await legMatchesNode(leg))) {
      // Includes sopNodeId mismatch and legs without an errorTypeId.
      skipped.push({ id: leg.id, ref: legRef(leg), reason: "wrong_node" }); continue;
    }
    // Per-leg tree/option resolution. If two error-types in the group
    // share the same nodeId + answer label but their options point at
    // different childIds / outcomeTypes, each leg follows its OWN
    // tree's transition — never a "canonical" tree's. The pre-check
    // above already guaranteed the node + answer exist and are
    // bulk-eligible for every distinct tree.
    const legTree = await loadTreeFor(leg.errorTypeId!);
    const legNode = legTree?.nodes?.find((n) => n.id === nodeId);
    const legOption = legNode?.options?.find((o) => o.label === answer);
    if (!legTree || !legNode || !legOption) {
      // Should be unreachable given the pre-check, but be defensive:
      // skip rather than throw inside the txn.
      skipped.push({ id: leg.id, ref: legRef(leg), reason: "wrong_node" });
      continue;
    }
    eligible.push({ leg, tree: legTree, node: legNode, option: legOption });
  }

  if (eligible.length === 0) {
    res.status(409).json({ code: "no_eligible_legs", succeeded: [], skipped });
    return;
  }

  // Single transaction: leg updates + per-leg audits + per-leg state
  // events + umbrella audit. Any throw rolls the whole thing back.
  type SopAnswerRow = { nodeId: string; answer: string; ts: string };
  const succeededIds: number[] = [];
  const updatedRows: Array<typeof claimsTable.$inferSelect> = [];
  const succeededRefs = eligible.map((e) => ({ id: e.leg.id, ref: legRef(e.leg) }));
  const succeededSummary: Array<{ claimId: number; isTerminal: boolean; sopOutcome: string | null }> = [];

  await db.transaction(async (tx) => {
    for (const { leg, option } of eligible) {
      const existingAnswers: SopAnswerRow[] = Array.isArray(leg.sopAnswers)
        ? (leg.sopAnswers as SopAnswerRow[])
        : [];
      const nextAnswers: SopAnswerRow[] = [
        ...existingAnswers,
        { nodeId, answer, ts: new Date().toISOString() },
      ];
      const updateData: Partial<typeof claimsTable.$inferInsert> = { sopAnswers: nextAnswers };
      let isTerminal = false;
      let nextSopOutcome: string | null = null;

      if (option.childId) {
        updateData.sopNodeId = option.childId;
      } else {
        isTerminal = true;
        // terminalSopOutcome from the body wins when supplied AND the
        // option is itself terminal — lets the operator force a
        // specific outcome (e.g. "Hold" instead of "Dispute") across
        // every eligible leg uniformly. Otherwise use the option's
        // authored outcomeType.
        nextSopOutcome = terminalSopOutcome ?? mapBulkOutcome(option.outcomeType);
        if (!nextSopOutcome) {
          throw new Error(`Terminal node has unknown outcomeType: ${option.outcomeType}`);
        }
        updateData.sopNodeId = nodeId;
      }

      // Wave D-PR2b: terminal-outcome legs flow through
      // `setClaimDisposition` (passing `tx` as the executor so the
      // disposition stamp + legacy mirror UPDATE participates in the
      // bulk loop's outer transaction). Mid-walk legs keep the inline
      // `sopAnswers/sopNodeId` UPDATE — no disposition change yet.
      let updated: typeof claimsTable.$inferSelect;
      if (isTerminal && nextSopOutcome) {
        const result = await setClaimDisposition(
          leg.id,
          sopOutcomeToDisposition(nextSopOutcome),
          { isTerminal: true, extraFields: updateData, ex: tx },
        );
        if (!result) throw new Error(`Leg ${leg.id} disappeared mid-bulk-advance`);
        updated = result;
      } else {
        const [u] = await tx.update(claimsTable)
          .set(updateData)
          .where(eq(claimsTable.id, leg.id))
          .returning();
        updated = u;
      }
      updatedRows.push(updated);
      await tx.insert(auditLogsTable).values({
        claimId: leg.id,
        action: "leg_sop_advanced",
        details: isTerminal
          ? `SOP terminal reached: ${nextSopOutcome} (bulk via group #${id})`
          : `SOP step: ${nodeId} → ${answer} (bulk via group #${id})`,
        metadata: {
          nodeId, answer, isTerminal, sopOutcome: nextSopOutcome,
          bulk: true, invoiceGroupId: id,
          source: "group_sop_advance",
        },
        userEmail: req.user?.email ?? null,
        userName: req.user?.displayName ?? null,
      });
      // State event also persisted in-txn so failure rolls it back
      // alongside the leg row + audit.
      await tx.insert(stateEventsTable).values({
        eventKey: isTerminal ? "leg.sop_terminal" : "leg.sop_advanced",
        claimId: leg.id,
        invoiceGroupId: id,
        actorUserId: req.user?.email ?? null,
        metadata: { nodeId, answer, sopOutcome: nextSopOutcome, bulk: true, source: "group_sop_advance" },
      });
      succeededIds.push(leg.id);
      succeededSummary.push({ claimId: leg.id, isTerminal, sopOutcome: nextSopOutcome });
    }

    if (BULK_SOP_TEST_HOOKS.failUmbrellaAuditOnce) {
      // Test seam: forces the umbrella audit insert to throw exactly
      // once so the tx rollback path can be exercised in isolation.
      // Production never sets this flag.
      BULK_SOP_TEST_HOOKS.failUmbrellaAuditOnce = false;
      throw new Error("test-injected: umbrella audit insert failed");
    }
    await tx.insert(auditLogsTable).values({
      invoiceGroupId: id,
      action: "group_sop_advanced_bulk",
      details: `Bulk SOP advance: ${nodeId} → ${answer} on ${eligible.length} leg${eligible.length === 1 ? "" : "s"}` +
        (skipped.length > 0 ? ` (skipped ${skipped.length})` : ""),
      metadata: {
        nodeId,
        answer,
        terminalSopOutcome,
        succeeded: succeededIds.length,
        succeededRefs,
        skipped,
        bulk: true,
        source: "group_sop_advance",
      },
      userEmail: req.user?.email ?? null,
      userName: req.user?.displayName ?? null,
    });
  });

  // Post-commit side effects (cache refresh, MAS derivations, SSE).
  // Not transactional state — matches per-leg /sop-advance pattern.
  for (const s of succeededSummary) {
    if (s.isTerminal) {
      await applyMasDerivationsForLeg(s.claimId, null);
    }
    await refreshClaimDenormalizedCache(s.claimId);
    broadcastClaimEvent({
      type: s.isTerminal ? "sop_terminal" : "sop_advanced",
      claimId: s.claimId,
      userName: req.user?.displayName ?? null,
      userEmail: req.user?.email ?? null,
      timestamp: new Date().toISOString(),
    });
  }
  await refreshGroupDerivedFields(id);
  emitGroupEvent(id, "sop_advanced_bulk", req);

  // Re-fetch the persisted rows so derived fields reflect post-cache
  // values consumed by the queue + leg page.
  const finalRows = await db.select().from(claimsTable)
    .where(inArray(claimsTable.id, succeededIds));
  res.json({ succeeded: finalRows, skipped });
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
  if (await blockMutationOnTourSampleGroup(id, res)) return;
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

  // Task #455 — optional invoice-number rename payload. Validate up
  // front so a 400 short-circuits before we open the transaction.
  const renameValidation = parseAndValidateRename(req.body, group.invoiceNumber);
  if (renameValidation.kind === "error") {
    res.status(renameValidation.status).json({
      error: renameValidation.error,
      code: renameValidation.code,
    });
    return;
  }

  const now = new Date();
  const fullNote = recordedOffline
    ? offlineNote
    : (masReference ? `${note ? note + " " : ""}(MAS ref: ${masReference})` : note);
  const actor = actorFromReq(req);

  // Wrap the entire write set in a single transaction so the optional
  // Task #455 rename either commits alongside the re-attest stamp +
  // attestation-gate flips or rolls everything back. Even when no
  // rename is requested, the transaction keeps the gate writes from
  // observers seeing a half-graduated group on a partial failure.
  let updated: typeof invoiceGroupsTable.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
      if (renameValidation.kind === "ok") {
        await applyGroupInvoiceRename(tx, id, renameValidation, actor);
      }

      // Task #543 — route the reattest-complete write through the
      // canonical status+outcome writer so legacy `status` / `outcome`
      // land on `Resolved` / `Approved` alongside the reattest stamps.
      // Before this change the route only stamped
      // `reattest_completed_at` (+ `_by` / `_note`) and left the
      // legacy status wherever the operator clicked from — almost
      // always `Needs Review` post-email-match — which leaked closed
      // groups onto the operator's Classification Inbox indefinitely
      // (prod scan 2026-05-08 found 9 such rows). The closure_reason
      // is pinned to `'reattested'` (the canonical value any row
      // carrying `reattest_completed_at` must hold per
      // `derivePhaseFromLegacy`) — `applyClosureApprovedFields` knows
      // not to overwrite a preset value. `systemOverride: true`
      // because the route already enforces its own preconditions
      // (macro-phase=mas-action-required + all MAS cancels complete,
      // or admin offline override); the writer's transition-map and
      // active-submission checks would be redundant duplicates.
      const transition = await transitionGroupStatusAndOutcome({
        groupId: id,
        newStatus: "Resolved",
        newOutcome: "Approved",
        source: recordedOffline ? "mas_reattest_recorded_offline" : "mas_reattest_completed",
        reason: recordedOffline
          ? "MAS re-attest recorded (offline)"
          : "MAS re-attest completed",
        actor,
        systemOverride: true,
        extraFields: {
          reattestCompletedAt: now,
          reattestCompletedBy: req.user?.email ?? null,
          reattestNote: fullNote,
          closureReason: "reattested",
        },
        executor: tx,
      });
      const u = transition.group;

      if (recordedOffline) {
        await tx.insert(auditLogsTable).values({
          invoiceGroupId: id,
          action: "mas_reattest_recorded_offline",
          details: "MAS re-attest recorded (offline)",
          metadata: { offlineNote, recordedOffline: true },
          userEmail: actor.userEmail,
          userName: actor.userName,
        });
      } else {
        await tx.insert(auditLogsTable).values({
          invoiceGroupId: id,
          action: "mas_reattest_completed",
          details: "MAS re-attest completed",
          metadata: { note, masReference },
          userEmail: actor.userEmail,
          userName: actor.userName,
        });
      }

      // Trigger gate: graduate any leg with an operator-confirmed
      // Approved/Partial verdict from not_required → pending. Same
      // gate behavior as before, just inside the surrounding tx.
      const legs = await tx.select().from(claimsTable).where(eq(claimsTable.invoiceGroupId, id));
      for (const leg of legs) {
        const [latestVerdict] = await tx
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
            await tx.update(claimsTable).set(delta).where(eq(claimsTable.id, leg.id));
          }
        }
      }

      return u;
    });
  } catch (err) {
    if (err instanceof InvoiceNumberConflictError) {
      res.status(409).json({
        error: `Invoice number #${err.invoiceNumber} is already in use by another group.`,
        code: "invoice_number_conflict",
        conflictingGroupId: err.conflictingGroupId,
      });
      return;
    }
    throw err;
  }

  // Post-commit fan-out: SSE/state events live outside the tx so
  // listeners only react to a committed write set.
  await emitStateEvent({
    eventKey: "group.reattest_completed",
    invoiceGroupId: id,
    actorUserId: req.user?.email ?? null,
    metadata: recordedOffline
      ? { recordedOffline: true, offlineNote }
      : { note, masReference },
  });

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
  if (await blockMutationOnTourSampleGroup(id, res)) return;

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

  // Task #455 — optional invoice-number rename payload, validated up
  // front so a bad shape short-circuits before we open the transaction.
  const renameValidation = parseAndValidateRename(req.body, group.invoiceNumber);
  if (renameValidation.kind === "error") {
    res.status(renameValidation.status).json({
      error: renameValidation.error,
      code: renameValidation.code,
    });
    return;
  }

  // Source-state contract. Three valid entry conditions:
  //
  //   * `response-pending` (status=Needs Review) — the original
  //     "park the response review for the portal user" path. Requires
  //     an inbound payor response on file (otherwise there's nothing
  //     to be reviewing) and stamps `awaitingPayorAgainAt` so the
  //     group drops off Responses Awaiting Review.
  //
  //   * `mas-action-required` (status=MAS Eligible / phase=
  //     awaiting_reattestation) — the standard MAS-Eligible path:
  //     MAS has acknowledged and the operator is re-attesting
  //     survivors in the portal. No payor-response review to drop
  //     off, so no `awaitingPayorAgainAt` stamp.
  //
  //   * `outlook = reattest_only` from any non-terminal/non-on-hold
  //     phase — the Early Re-attest path (Task #476). An invoice has
  //     zero disputable legs but ≥1 survivor leg that still needs
  //     re-attestation. The operator should not be forced through a
  //     phantom MAS-submission step just to unlock the queue. This
  //     was the May-8 incident class the audit script
  //     `reattest_cta_would_409` was built to detect — see
  //     scripts/audit-state-divergence.ts. The mirror in
  //     artifacts/claimclear/src/lib/whats-next-derivation.ts
  //     (`canQueueOrCompleteReattest`) and in the audit script's
  //     `reattestGateAccepts` MUST stay in lock-step with this gate.
  //
  // Terminal phases (closed, on-hold) are still rejected — closing a
  // closed invoice or an on-hold one would be incoherent regardless
  // of leg state.
  const sourcePhase = getGroupMacroPhase(group);
  const isResponsePending = sourcePhase === "response-pending"
    && group.status === "Needs Review";
  const isMasActionRequired = sourcePhase === "mas-action-required";
  // Compute reattest_only outlook by inspecting the group's legs.
  // Mirrors `deriveInvoiceDisputeOutlook` (frontend) and
  // `isReattestOnlyOutlook` (audit script). Single source of truth:
  // these three implementations must move together.
  const outlookLegs = await db
    .select({
      includedInDispute: claimsTable.includedInDispute,
      duplicateOfClaimId: claimsTable.duplicateOfClaimId,
      sopOutcome: claimsTable.sopOutcome,
      disposition: claimsTable.disposition,
      outcome: claimsTable.outcome,
    })
    .from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, id));
  const isReattestOnlyOutlook = (() => {
    let hasDisputable = false;
    let hasSurvivor = false;
    for (const leg of outlookLegs) {
      const isDuplicate = leg.duplicateOfClaimId != null;
      const isNonIssue = leg.disposition === "disposed_nonissue"
        || leg.disposition === "final_nonissue"
        || leg.sopOutcome === "non_issue";
      const isCannotDispute = leg.disposition === "disposed_withdraw"
        || leg.disposition === "final_withdrawn"
        || leg.sopOutcome === "cannot_dispute";
      const isApproved = leg.outcome === "Approved" || leg.outcome === "Partially Approved";
      const isDenied = leg.outcome === "Denied";
      if (isNonIssue || isApproved) hasSurvivor = true;
      if (
        leg.includedInDispute === true
        && !isDuplicate
        && !isCannotDispute
        && !isNonIssue
        && !isDenied
      ) {
        hasDisputable = true;
      }
    }
    return !hasDisputable && hasSurvivor;
  })();
  const isEarlyReattest = isReattestOnlyOutlook
    && !isResponsePending
    && !isMasActionRequired
    && sourcePhase !== "closed"
    && sourcePhase !== "on-hold";
  if (!isResponsePending && !isMasActionRequired && !isEarlyReattest) {
    res.status(409).json({
      error: "Group can only be bulk-queued for re-attestation while it is in Needs Review, MAS Eligible, or has zero disputable legs with at least one survivor (Early Re-attest).",
      expectedState: "phase in (response-pending with status=Needs Review, mas-action-required) OR outlook=reattest_only",
      actualState: `phase=${sourcePhase}, status=${group.status}, reattestOnlyOutlook=${isReattestOnlyOutlook}`,
    });
    return;
  }
  if (isResponsePending) {
    const hasResponse = await groupHasResponse(id);
    if (!hasResponse) {
      res.status(409).json({
        error: "Group cannot be bulk-queued for re-attestation before any payor response has arrived.",
        expectedState: "at least one inbound portal_responses row for the group",
        actualState: "no inbound responses on file",
      });
      return;
    }
  }

  const actor = actorFromReq(req);
  const actorIdentity = actor.userEmail || actor.userName || "unknown";
  const now = new Date();

  // Find every leg in the group that's eligible for the bulk queue.
  //
  // Two eligibility regimes — must stay aligned with the survivor
  // definition in `deriveInvoiceDisputeOutlook` (frontend) so the
  // operator never sees a CTA that the server then refuses:
  //
  //   STANDARD path (response-pending / mas-action-required):
  //     * errorTypeId IS NOT NULL (the leg is in the dispute set);
  //     * outcome is Approved or Partially Approved;
  //     * latest claim_verdict is `source = 'operator_confirmed'`
  //       with outcome Approved/Partial.
  //
  //   EARLY RE-ATTEST path (`isEarlyReattest`):
  //     The whole point of this entry is that re-attestation is
  //     DECOUPLED from the dispute-submission flow. The dispute-set
  //     filter (errorTypeId NOT NULL + operator_confirmed verdict)
  //     would exclude the very legs that need re-attestation here:
  //     a Non-issue survivor (sopOutcome='non_issue' /
  //     disposition='disposed_nonissue') has no errorTypeId and no
  //     verdict row — it was closed via SOP, not via the dispute
  //     ladder — yet it still needs a portal re-attestation.
  //     So accept any leg matching the frontend's survivor predicate:
  //       * Non-issue (sopOutcome='non_issue' OR disposition in
  //         disposed_nonissue / final_nonissue), OR
  //       * Approved-verdict survivor (outcome Approved/Partially
  //         Approved AND latest claim_verdict operator_confirmed).
  //     Sibling duplicates and cannot_dispute legs are still excluded
  //     (they're "dropped", not survivors).
  //
  // Both regimes skip legs whose attestation_state is already
  // `completed` (one-way street; applyAttestationAction enforces the
  // same rule) or `queued` (no point re-stamping with a stale
  // queued_at/by).
  const candidateLegs = isEarlyReattest
    ? await db
        .select()
        .from(claimsTable)
        .where(eq(claimsTable.invoiceGroupId, id))
    : await db
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
    if (leg.duplicateOfClaimId != null) continue;

    if (isEarlyReattest) {
      const isNonIssue = leg.disposition === "disposed_nonissue"
        || leg.disposition === "final_nonissue"
        || leg.sopOutcome === "non_issue";
      if (isNonIssue) {
        eligibleLegs.push(leg);
        continue;
      }
      // Fall through to the verdict check for Approved-survivor legs.
    }

    if (leg.outcome !== "Approved" && leg.outcome !== "Partially Approved") continue;
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
      error: isEarlyReattest
        ? "No eligible survivor legs to queue — the group has no Non-issue or Approved survivor legs still owing a portal re-attestation."
        : "No eligible legs to queue — the group has no Approved/Partial operator-confirmed legs still owing an attestation.",
      expectedState: isEarlyReattest
        ? "at least one survivor leg (Non-issue OR operator_confirmed Approved/Partial) with attestation_state in (not_required, pending)"
        : "at least one disputed leg with operator_confirmed Approved/Partial verdict and attestation_state in (not_required, pending)",
      actualState: `${candidateLegs.length}-candidate legs, 0 eligible`,
    });
    return;
  }

  // All-or-nothing: a partial failure mid-loop would leave half the
  // group queued and the other half not, plus stamp awaiting_payor_again
  // on a group whose legs only partly moved. Wrap every write in a
  // single drizzle transaction so a failure rolls all of them back.
  let updatedGroup: typeof invoiceGroupsTable.$inferSelect;
  try {
    updatedGroup = await db.transaction(async (tx) => {
    // Task #455 — apply rename FIRST inside the same tx so the
    // attestation queue + awaiting_payor_again_at flips and the
    // umbrella audit row all reference the new invoice number, and
    // a uniqueness conflict rolls back the entire write set.
    if (renameValidation.kind === "ok") {
      await applyGroupInvoiceRename(tx, id, renameValidation, actor);
    }
    // Task #455 — when an invoice rename happens during the queue
    // action, persist the canonical "Update the invoice # from #X to
    // #Y." line on each leg's attestationNote so the Attestation
    // Queue UI can derive a "Renamed → #{new}" chip from the per-leg
    // note without needing a separate rename column.
    const renameLine =
      renameValidation.kind === "ok"
        ? `Update the invoice # from #${renameValidation.from} to #${renameValidation.to}.`
        : null;
    // Avoid duplicating the rename line: the frontend already
    // prepends it via the rendered checklist text it sends in `note`.
    // Only inject from the backend when the operator note doesn't
    // already contain it (e.g. a non-modal caller of the API).
    const perLegAttestationNote = (() => {
      if (!renameLine) return noteForDb;
      if (noteForDb && noteForDb.includes(renameLine)) return noteForDb;
      if (noteForDb) return `${renameLine}\n${noteForDb}`;
      return renameLine;
    })();
    for (const leg of eligibleLegs) {
      await tx.update(claimsTable)
        .set({
          attestationState: "queued",
          attestationQueuedAt: now,
          attestationQueuedBy: actorIdentity,
          attestationNote: perLegAttestationNote,
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

    // Group-level write per entry path:
    //
    //   * `response-pending`: stamp `awaitingPayorAgainAt` to drop the
    //     group off Responses Awaiting Review.
    //   * `mas-action-required`: nothing to stamp — the group is
    //     already in the right phase/status.
    //   * Early Re-attest (`isEarlyReattest`): promote the group to
    //     {phase=awaiting_reattestation, status=MAS Eligible,
    //     reattestRequired=true} as part of the same transaction. This
    //     keeps downstream invariants honest — `/reattest/complete`,
    //     leg-status projections, and the audit script all expect a
    //     queued early-reattest group to read as MAS Eligible.
    let g: typeof invoiceGroupsTable.$inferSelect;
    if (isResponsePending) {
      [g] = await tx.update(invoiceGroupsTable)
        .set({ awaitingPayorAgainAt: now })
        .where(eq(invoiceGroupsTable.id, id))
        .returning();
    } else if (isEarlyReattest) {
      [g] = await tx.update(invoiceGroupsTable)
        .set({
          phase: "awaiting_reattestation",
          status: "MAS Eligible",
          reattestRequired: true,
        })
        .where(eq(invoiceGroupsTable.id, id))
        .returning();
    } else {
      [g] = await tx.select().from(invoiceGroupsTable)
        .where(eq(invoiceGroupsTable.id, id));
    }

    const queuedLegIds = eligibleLegs.map((l) => l.id);
    const detailTail = isResponsePending
      ? "and flipped the group back to awaiting payor"
      : "from the MAS Eligible phase (early re-attest)";
    await tx.insert(auditLogsTable).values({
      invoiceGroupId: id,
      action: "group_reattest_queued_bulk",
      details: noteForDb
        ? `${actorIdentity} queued ${queuedLegIds.length} leg${queuedLegIds.length === 1 ? "" : "s"} for re-attestation ${detailTail} — Note: ${noteForDb}`
        : `${actorIdentity} queued ${queuedLegIds.length} leg${queuedLegIds.length === 1 ? "" : "s"} for re-attestation ${detailTail}.`,
      metadata: {
        queuedLegIds,
        legCount: queuedLegIds.length,
        sourcePhase,
        previousAwaitingPayorAgainAt: group.awaitingPayorAgainAt
          ? group.awaitingPayorAgainAt.toISOString()
          : null,
        newAwaitingPayorAgainAt: isResponsePending ? now.toISOString() : null,
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
        sourcePhase,
        note: noteForDb,
      },
    }, tx);

    return g;
    });
  } catch (err) {
    if (err instanceof InvoiceNumberConflictError) {
      res.status(409).json({
        error: `Invoice number #${err.invoiceNumber} is already in use by another group.`,
        code: "invoice_number_conflict",
        conflictingGroupId: err.conflictingGroupId,
      });
      return;
    }
    throw err;
  }

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
  if (isResponsePending) {
    // Only fire the "awaiting payor again" event when we actually
    // stamped that timestamp. The Early Re-attest path doesn't move
    // the group on/off Responses Awaiting Review, so listeners that
    // refresh that surface have nothing to react to.
    emitGroupEvent(id, "group_awaiting_payor_again", req);
  }
  await refreshGroupDerivedFields(id);

  res.json({ group: updatedGroup, queuedLegIds: eligibleLegs.map((l) => l.id) });
}));

export default router;

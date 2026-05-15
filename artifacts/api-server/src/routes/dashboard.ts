import { Router, type IRouter } from "express";
import { eq, ne, sql, and, or, count, sum, desc, isNull, lte, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, invoiceGroupsTable, portalSubmissionsTable, portalResponsesTable, auditLogsTable, stateEventsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { addDaysToYMD, daysRemaining, effectiveDaysRemaining, isUrgentDeadline, serverTodayKey } from "../lib/dates";
import { SOON_DAYS, VENDOR_PREPAY_RATE } from "../lib/risk-config";
import { getLastWorkerRun, isWorkerRunInProgress } from "../lib/batch-processor";
import { humanizeAuditRow } from "../lib/activity-humanizer";
import { getOverdueCount } from "../lib/overdue-submissions";
import { qualifyingActivityPredicate } from "../lib/qualifying-activity";
import { getMacroPhase, type MacroPhase } from "../lib/macro-phase";

// Always exclude the global "tour sample" rows from every aggregate
// query — that pair exists only so the in-app guided tour can navigate
// to a real detail page (steps 18 & 20). See migration 0029 +
// routes/tour.ts.
const HIDE_TOUR_SAMPLE_GROUP = eq(invoiceGroupsTable.isTourSample, false);
const HIDE_TOUR_SAMPLE_CLAIM = eq(claimsTable.isTourSample, false);
import { computeUrgentSnapshot } from "../lib/urgent-snapshot";
import { scrubDashboardAmounts, scrubMoneyFieldsArray, canSeeAmounts } from "../lib/role";
import {
  groupUnclassifiedSql,
  needsOperatorAttentionSql,
} from "../lib/operator-attention";

const router: IRouter = Router();

// Operating rule for both sets below:
//   A row is "urgent today" iff its filing deadline is `<=` today AND its
//   status is neither already-submitted nor concluded.
//
// The two sets diverge because that rule lands on different statuses at
// the claim level vs. the invoice-group level (Task #290):
//
// • Group level — `GROUP_EXPIRING_ACTIONABLE_STATUSES`. A group's status
//   represents the operator's progress toward submission. Once the group
//   is `Portal Queued` the operator has submitted via the portal and the
//   filing clock is satisfied from the office's POV; its post-submit
//   timeline (response-by, review-by) lives on the Responses Awaiting
//   Review surface, not the filing-deadline hero. `Awaiting Response`,
//   `Needs Review`, and `Ready to Review` are likewise post-submit.
//   `Resolved` and `Denied` are concluded. `Processed` is a CLAIM-only
//   transition state and never lands on `invoice_groups.status`, so
//   listing it here is dead weight that only mislead readers. The
//   actual pre-submit, on-clock statuses are exactly:
//     { New, Needs Evidence, On Hold, Generating Email }
//   `Generating Email` is the state set by `POST /invoice-groups/:id/
//   package` when the operator clicks "Ready to package" — it satisfies
//   the urgency rule (not yet submitted, not concluded) and must be
//   spelled out so the Dashboard hero count and the Queue
//   `?expiring=urgent` view can never disagree.
//
// • Claim level — `CLAIM_EXPIRING_ACTIONABLE_STATUSES`. The 30-day clock
//   keeps running on individual CLAIMS in `Portal Queued` and `Processed`
//   even after their parent group has moved on (a stuck Portal Queued
//   claim, or a Processed leg whose worktree is done but whose invoice
//   hasn't been packaged yet, must still escalate before the deadline
//   slips). Those leg-level escalations are surfaced via the daily brief
//   and the claim list, not the Queue, so this set retains them.
//
// Both sets exclude `Awaiting Response` (once we've filed, the 30-day
// rule is satisfied), the queue-managed review statuses
// (`Needs Review`, `Ready to Review` — those are post-submit response
// triage, not filing-clock urgency), and the concluded statuses
// (`Resolved`, `Denied`). Both sets include `On Hold` (pausing
// internally does not pause the deadline — if we don't unpause and file
// in time, we lose the window).
export const GROUP_EXPIRING_ACTIONABLE_STATUSES = [
  "New",
  "Needs Evidence",
  "On Hold",
  "Generating Email",
] as const;

export const CLAIM_EXPIRING_ACTIONABLE_STATUSES = [
  "New",
  "Needs Evidence",
  "Processed",
  "Portal Queued",
  "Generating Email",
  "On Hold",
] as const;

// "Submitted but unconfirmed" — Task #352. The pre-submit ACTIONABLE
// sets above answer "what must we file today?". The sets below answer
// the parallel question: "what did we already file but never got an
// acknowledgement back on, and is now past the 30-day window?". The
// two tiers are reconciled side-by-side on the Dashboard, Queue, and
// per-row badges so the operator can never read "0 to file today" and
// still see TODAY-style badges scattered across the list — those rows
// are now the explicit `submittedStuck` tier with their own variant.
//
// Why these statuses:
// - `Portal Queued` (group + claim level): the operator submitted via
//   the portal but the payor hasn't confirmed receipt. The filing
//   clock was satisfied at submission, but if the deadline passes
//   without a confirmation we still want to surface the row — it
//   means the submission may have failed silently and needs a chase.
// - `Processed` (claim-only — never lands on `invoice_groups.status`):
//   the worktree on the leg is done but the parent invoice hasn't
//   been packaged yet. Same shape as Portal Queued for our purposes.
//
// Both sets are strict subsets of the parent ACTIONABLE set above;
// the per-row `submittedStuck` flag is computed exactly as
//   `<set>.has(row.status) && effectiveDaysRemaining(date, today) <= 0`
// so the same date math drives both tiers — only the status filter
// differs.
export const GROUP_SUBMITTED_STUCK_STATUSES = ["Portal Queued"] as const;

export const CLAIM_SUBMITTED_STUCK_STATUSES = [
  "Portal Queued",
  "Processed",
] as const;

export function parseDays(raw: unknown, fallback: number, max = 365): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function startOfWindow(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d;
}

function buildDateBuckets(days: number): string[] {
  const start = startOfWindow(days);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

router.get("/dashboard/summary", asyncHandler(async (req, res): Promise<void> => {
  const statusCountsRaw = await db
    .select({ status: invoiceGroupsTable.status, count: count() })
    .from(invoiceGroupsTable)
    .where(HIDE_TOUR_SAMPLE_GROUP)
    .groupBy(invoiceGroupsTable.status);

  const statusCounts = Object.fromEntries(statusCountsRaw.map(r => [r.status, r.count]));

  const withdrawnByReasonRaw = await db
    .select({ closureReason: invoiceGroupsTable.closureReason, count: count() })
    .from(invoiceGroupsTable)
    .where(and(eq(invoiceGroupsTable.outcome, "Withdrawn"), HIDE_TOUR_SAMPLE_GROUP))
    .groupBy(invoiceGroupsTable.closureReason);
  const withdrawnByReason = {
    cannot_dispute: 0,
    other: 0,
  };
  for (const row of withdrawnByReasonRaw) {
    if (row.closureReason === "cannot_dispute") withdrawnByReason.cannot_dispute = row.count;
    else withdrawnByReason.other += row.count;
  }
  const withdrawn = withdrawnByReason.cannot_dispute + withdrawnByReason.other;

  const deniedByReasonRaw = await db
    .select({ closureReason: invoiceGroupsTable.closureReason, count: count() })
    .from(invoiceGroupsTable)
    .where(and(eq(invoiceGroupsTable.outcome, "Denied"), HIDE_TOUR_SAMPLE_GROUP))
    .groupBy(invoiceGroupsTable.closureReason);
  const deniedByReason = { denied_by_payor: 0, other: 0 };
  for (const row of deniedByReasonRaw) {
    if (row.closureReason === "denied_by_payor") deniedByReason.denied_by_payor = row.count;
    else deniedByReason.other += row.count;
  }

  const needsEvidence = (statusCounts["New"] || 0) + (statusCounts["Needs Evidence"] || 0);
  // Display axis — keep on `status`. The "portal pipeline" tile sums
  // three statuses that intentionally span two canonical phases:
  //   • Portal Queued     → phase = submitted        (post D-PR5 `submitted_via` rewire)
  //   • Generating Email  → phase = ready_to_submit  (draft being composed)
  //   • Ready to Review   → phase = ready_to_submit  (draft awaiting human review)
  // The bucket is the UI's "things in the email/portal pipeline"
  // workload counter, not a state-machine predicate, so flipping to
  // a single `phase ∈ {…}` aggregate would either silently fold in
  // unrelated `ready_to_submit` rows (e.g. New that's been advanced)
  // or split the tile in half. Wave D-PR6 §3.E: keep on status.
  const portalQueued = (statusCounts["Portal Queued"] || 0) + (statusCounts["Generating Email"] || 0) + (statusCounts["Ready to Review"] || 0);
  const awaitingResponse = statusCounts["Awaiting Response"] || 0;
  // `expired` is reported separately so the dashboard tile/sparkline
  // can surface "N rows retired this week" without inflating any of
  // the workload counters above. Excluded from `total` for the same
  // reason — the headline number represents live work in flight, not
  // the deadbook.
  const expired = statusCounts["Expired"] || 0;
  const total = statusCountsRaw.reduce((s, r) => (r.status === "Expired" ? s : s + r.count), 0);
  const newCount = statusCounts["New"] || 0;
  const resolvedAll = statusCounts["Resolved"] || 0;
  const denied = statusCounts["Denied"] || 0;
  const onHold = statusCounts["On Hold"] || 0;

  // "Awaiting attestation" = CLAIMS whose off-system re-attestation step
  // in the payor portal is still owed (state=pending) or parked for
  // someone with portal access (state=queued). Counted at the CLAIM
  // level so multi-claim groups don't undercount the workload — each
  // outstanding attestation step is its own unit of work for the team.
  //
  // Two admit branches (mirrors /claims/attestation-pending):
  //   (1) Approved/Partially-Approved verdict — historical case.
  //   (2) status="MAS Eligible" — post-upload triage bridge case;
  //       outcome stays Pending here, so the OR is required to
  //       prevent silent under-count.
  const [{ value: awaitingAttestation } = { value: 0 }] = await db
    .select({ value: count() })
    .from(claimsTable)
    .where(and(
      HIDE_TOUR_SAMPLE_CLAIM,
      or(
        inArray(claimsTable.outcome, ["Approved", "Partially Approved"]),
        eq(claimsTable.status, "MAS Eligible"),
      ),
      inArray(claimsTable.attestationState, ["pending", "queued"]),
    ));

  // Resolved tile excludes groups that still have outstanding attestation
  // claims, so an Approved group only counts as fully resolved once every
  // claim has been attested. Groups (not claims) are the unit here so the
  // math lines up with the rest of the dashboard, which is group-keyed.
  const resolvedAttestationGroupRows = await db
    .select({ id: invoiceGroupsTable.id })
    .from(invoiceGroupsTable)
    .innerJoin(claimsTable, eq(claimsTable.invoiceGroupId, invoiceGroupsTable.id))
    .where(and(
      HIDE_TOUR_SAMPLE_GROUP,
      eq(invoiceGroupsTable.status, "Resolved"),
      inArray(invoiceGroupsTable.outcome, ["Approved", "Partially Approved"]),
      inArray(claimsTable.attestationState, ["pending", "queued"]),
    ))
    .groupBy(invoiceGroupsTable.id);
  const resolved = Math.max(0, resolvedAll - withdrawn - resolvedAttestationGroupRows.length);

  const [amountsResult] = await db
    .select({
      totalClaimed: sum(invoiceGroupsTable.totalAmount),
      totalApproved: sum(invoiceGroupsTable.approvedAmount),
    })
    .from(invoiceGroupsTable)
    .where(HIDE_TOUR_SAMPLE_GROUP);

  const totalClaimed = parseFloat(amountsResult.totalClaimed || "0");
  const totalApproved = parseFloat(amountsResult.totalApproved || "0");
  const totalExposure = totalClaimed * (1 + VENDOR_PREPAY_RATE);

  const [lostResult] = await db
    .select({ totalLost: sum(invoiceGroupsTable.totalAmount) })
    .from(invoiceGroupsTable)
    .where(and(eq(invoiceGroupsTable.outcome, "Denied"), HIDE_TOUR_SAMPLE_GROUP));
  const totalLost = parseFloat(lostResult?.totalLost || "0");

  // ────────────────────────────────────────────────────────────────────
  // At-risk / Already-lost / Reclaimed money model. The legacy fields
  // above (`totalExposure`, `totalLost`) lump everything-ever into a
  // single number and don't reflect the "70% prepay only counts as a
  // negative when we don't get paid" rule. The fields below replace
  // that model with three clean buckets, with each invoice group
  // assigned to exactly one bucket so the sums never double-count:
  //
  //   At risk         = open dollars × 1.70 (claim + driver prepay
  //                     both still on the line). Includes every group
  //                     whose outcome isn't yet locked in: still in
  //                     workflow, OR final-state but with re-attest
  //                     still pending. Already-approved portions are
  //                     subtracted out and flow to Reclaimed.
  //   Already lost
  //     - Expired     = totalAmount × 1.70 over rows whose filing
  //                     deadline slipped: literal status='Expired'
  //                     OR status='On Hold' past the (Friday-shifted)
  //                     30-day filing deadline. Prepay counts because
  //                     the payor will never reimburse this row.
  //                     NOTE: Re-attestation does NOT have a known
  //                     hard deadline. The MAS 30-day clock is the
  //                     filing window — if we filed in time, the re-
  //                     attest portal step gets additional time we
  //                     don't have a precise number for. Per operator
  //                     decision, pending-attest rows are NEVER auto-
  //                     expired into this bucket; they stay in
  //                     At-risk until the verdict + re-attest both
  //                     settle. Revisit if/when the real attest
  //                     deadline rule is documented.
  //     - Denied      = (totalAmount − approvedAmount) × 1.70 over
  //                     rows with outcome IN ('Denied','Partially
  //                     Approved') AND re-attestation already settled
  //                     (no pending/queued steps left). Until re-
  //                     attest settles, the dollars stay in At-risk
  //                     — re-attestation can still flip the outcome.
  //                     Operator-friendly: "denied portion only counts
  //                     as lost once the re-attest part is finished."
  //   Reclaimed       = Σ approvedAmount over rows that have reached
  //                     their TRUE END: outcome is a positive verdict
  //                     (Approved / Partially Approved) AND no leg is
  //                     still in pending/queued attestation. Until
  //                     re-attest settles the verdict can still flip,
  //                     so those dollars stay in At-risk. Denials
  //                     contribute $0 (by construction — their
  //                     approvedAmount is null/0 on the denied
  //                     portion). No multiplier — per spec the driver
  //                     prepay only counts against the company when we
  //                     DON'T get paid, so an attested-approved row's
  //                     prepay is implicitly washed out by the payor
  //                     remit and shouldn't inflate exposure.
  //
  // Withdrawn, Non-Issue, and No Action Needed outcomes are intentionally
  // excluded from every bucket — they're self-cancellations / triage
  // no-ops, not money in flight. (Task #714 added No Action Needed as
  // the system-asserted Non-Issue variant.)
  //
  // The on-hold-past-deadline predicate mirrors the one in the list
  // routes (`/claims`, `/invoice-groups`) so the dashboard "expired"
  // dollars line up with the rows that the list filter hides. The
  // CASE expressions inside SUM are mutually exclusive by design —
  // each row contributes to at most one of {at-risk, expired,
  // denied-lost} so the buckets always reconcile.
  // ────────────────────────────────────────────────────────────────────
  // Status-agnostic "service date is past the Friday-shifted 30-day
  // deadline" predicate. Same Friday-shift rule used by the list
  // routes' on-hold-past-deadline guard, hoisted out so we can apply
  // it to two different bucket conditions: the on-hold-aged case AND
  // the pending-attest-aged case. NULL service date returns FALSE
  // (we can't age out something we don't have a clock for).
  const pastDeadlineExpr = sql`(${invoiceGroupsTable.serviceDate} IS NOT NULL AND (
    CASE EXTRACT(DOW FROM (${invoiceGroupsTable.serviceDate} + INTERVAL '30 days'))
      WHEN 6 THEN ((${invoiceGroupsTable.serviceDate} + INTERVAL '30 days')::date - INTERVAL '1 day')::date
      WHEN 0 THEN ((${invoiceGroupsTable.serviceDate} + INTERVAL '30 days')::date - INTERVAL '2 days')::date
      ELSE (${invoiceGroupsTable.serviceDate} + INTERVAL '30 days')::date
    END
  ) < CURRENT_DATE)`;

  const hasPendingAttestExpr = sql`EXISTS (
    SELECT 1 FROM ${claimsTable}
    WHERE ${claimsTable.invoiceGroupId} = ${invoiceGroupsTable.id}
      AND ${claimsTable.attestationState} IN ('pending','queued')
  )`;

  // The "deadline-missed → already lost" predicate. Two cases — both
  // are filing-deadline failures (the only deadline we know with
  // certainty). Pending-attest is intentionally NOT included: the
  // re-attest portal step has additional time after a successful
  // filing, and we don't have a documented number for it yet, so we
  // keep those rows in At-risk indefinitely until the verdict and
  // re-attest both settle.
  //   1. Operator already marked the row Expired.
  //   2. Row is parked On Hold and the filing deadline slipped.
  const deadlineMissedExpr = sql`(
    ${invoiceGroupsTable.status} = 'Expired'
    OR (${invoiceGroupsTable.status} = 'On Hold' AND ${pastDeadlineExpr})
  )`;

  const [bucketRow] = await db
    .select({
      atRiskClaim: sql<string>`COALESCE(SUM(CASE
        WHEN ${invoiceGroupsTable.outcome} IN ('Withdrawn','Non-Issue','No Action Needed') THEN 0
        WHEN ${deadlineMissedExpr} THEN 0
        WHEN ${invoiceGroupsTable.outcome} IN ('Approved','Denied','Partially Approved') AND NOT ${hasPendingAttestExpr} THEN 0
        ELSE GREATEST(COALESCE(${invoiceGroupsTable.totalAmount}, 0) - COALESCE(${invoiceGroupsTable.approvedAmount}, 0), 0)
      END), 0)`,
      atRiskGroups: sql<string>`COALESCE(SUM(CASE
        WHEN ${invoiceGroupsTable.outcome} IN ('Withdrawn','Non-Issue','No Action Needed') THEN 0
        WHEN ${deadlineMissedExpr} THEN 0
        WHEN ${invoiceGroupsTable.outcome} IN ('Approved','Denied','Partially Approved') AND NOT ${hasPendingAttestExpr} THEN 0
        ELSE 1
      END), 0)`,
      expiredClaim: sql<string>`COALESCE(SUM(CASE
        WHEN ${invoiceGroupsTable.outcome} IN ('Withdrawn','Non-Issue','No Action Needed') THEN 0
        WHEN ${deadlineMissedExpr} THEN COALESCE(${invoiceGroupsTable.totalAmount}, 0)
        ELSE 0
      END), 0)`,
      expiredGroups: sql<string>`COALESCE(SUM(CASE
        WHEN ${invoiceGroupsTable.outcome} IN ('Withdrawn','Non-Issue','No Action Needed') THEN 0
        WHEN ${deadlineMissedExpr} THEN 1
        ELSE 0
      END), 0)`,
      deniedLostClaim: sql<string>`COALESCE(SUM(CASE
        WHEN ${invoiceGroupsTable.outcome} IN ('Withdrawn','Non-Issue','No Action Needed') THEN 0
        WHEN ${deadlineMissedExpr} THEN 0
        WHEN ${invoiceGroupsTable.outcome} IN ('Denied','Partially Approved') AND NOT ${hasPendingAttestExpr}
          THEN GREATEST(COALESCE(${invoiceGroupsTable.totalAmount}, 0) - COALESCE(${invoiceGroupsTable.approvedAmount}, 0), 0)
        ELSE 0
      END), 0)`,
      deniedLostGroups: sql<string>`COALESCE(SUM(CASE
        WHEN ${invoiceGroupsTable.outcome} IN ('Withdrawn','Non-Issue','No Action Needed') THEN 0
        WHEN ${deadlineMissedExpr} THEN 0
        WHEN ${invoiceGroupsTable.outcome} IN ('Denied','Partially Approved') AND NOT ${hasPendingAttestExpr} THEN 1
        ELSE 0
      END), 0)`,
      // Reclaimed = Σ approvedAmount on rows that have reached their
      // "true end" — outcome is a positive verdict (Approved /
      // Partially Approved) AND no leg is still in pending/queued
      // attestation. A row whose re-attest is still in flight could
      // still flip back to Denied, so its approved dollars are not
      // yet money-in-the-bank and stay in atRisk above. Denials
      // contribute $0 by construction (their approvedAmount is 0 or
      // null on the denied portion). No multiplier — once a claim is
      // approved AND attested, the payor remit washes the prepay
      // through.
      reclaimedApproved: sql<string>`COALESCE(SUM(CASE
        WHEN ${invoiceGroupsTable.outcome} IN ('Approved','Partially Approved') AND NOT ${hasPendingAttestExpr}
          THEN COALESCE(${invoiceGroupsTable.approvedAmount}, 0)
        ELSE 0
      END), 0)`,
    })
    .from(invoiceGroupsTable)
    .where(HIDE_TOUR_SAMPLE_GROUP);

  const PREPAY_MULT = 1 + VENDOR_PREPAY_RATE;
  const atRiskClaim = parseFloat(bucketRow?.atRiskClaim || "0");
  const expiredClaim = parseFloat(bucketRow?.expiredClaim || "0");
  const deniedLostClaim = parseFloat(bucketRow?.deniedLostClaim || "0");
  const reclaimedApproved = parseFloat(bucketRow?.reclaimedApproved || "0");
  const atRiskExposure = atRiskClaim * PREPAY_MULT;
  const lostExpiredExposure = expiredClaim * PREPAY_MULT;
  const lostDeniedExposure = deniedLostClaim * PREPAY_MULT;
  const lostExposureTotal = lostExpiredExposure + lostDeniedExposure;
  const atRiskGroups = parseInt(bucketRow?.atRiskGroups || "0", 10);
  const expiredGroups = parseInt(bucketRow?.expiredGroups || "0", 10);
  const deniedLostGroups = parseInt(bucketRow?.deniedLostGroups || "0", 10);

  // ────────────────────────────────────────────────────────────────────
  // Money model — Task #788 ("celebrations realignment" follow-up).
  //
  // Decision history: the prior shape gated every money number on
  // `phase = 'closed' AND phaseEnteredAt IN [last 7d]`. That hid all
  // wins still sitting in awaiting_reattestation/response_received and
  // produced $0 dashboards for teams who'd just won 50 disputes that
  // week. The user's verdict: separate "what the team did" (approved
  // dollars are credited the moment the payor rules) from "what the
  // payor did" (confirmed recovery requires the reattest landing too),
  // and stop windowing the headline figures.
  //
  // Cohort definitions (current contract):
  //   recoveredAmount       — Σ approvedAmount over ALL groups with
  //                           outcome ∈ Approved/Partially Approved.
  //                           ALL-TIME, no phase gate. Renders as
  //                           "Recovered $" on the dashboard.
  //   confirmedRecoveredAmount — same + reattestCompletedAt IS NOT
  //                              NULL. ALL-TIME. Sub-line under
  //                              Recovered $; counts only the dollars
  //                              the payor has actually re-attested in
  //                              their portal.
  //   disputedAmount        — Σ totalAmount over ALL groups with a
  //                           real outcome (excludes Pending / Non-
  //                           Issue / No Action Needed). ALL-TIME.
  //                           Drives the recovery-rate denominator.
  //   recoveryRate          — recoveredAmount / disputedAmount × 100,
  //                           rounded server-side. ALL-TIME. NULL
  //                           when nothing has been disputed.
  //   netChangeRecovered    — Δ approved $ in last 7d vs prior 7d.
  //                           Anchored on `portal_responses.received_at`
  //                           (the day the payor's positive verdict
  //                           landed) so a win counts the moment it's
  //                           recorded — not the day the dispute later
  //                           closes. The 7d window is intentional
  //                           ("what changed this week" momentum).
  //   priorRecoveredAmount  — recoveredAmount for the prior 7d slot
  //                           (used to compute netChangeRecovered).
  //   windowDays            — 7. Only meaningful for netChange now;
  //                           kept on the response so the client can
  //                           keep rendering "vs prior 7d" copy.
  //   closedOutcomes        — count of ALL groups by terminal outcome
  //                           (no window). Status=Expired pre-empts
  //                           outcome to keep the buckets disjoint.
  //                           Backs the Dashboard "Outcomes" panel.
  //
  // Insights (`/dashboard/insights`) honors the page's days selector
  // for the same metrics by anchoring on
  // `portal_responses.received_at IN window` — see that handler.
  // ────────────────────────────────────────────────────────────────────
  const CANONICAL_WINDOW_DAYS = 7;
  const recentStart = new Date();
  recentStart.setUTCHours(0, 0, 0, 0);
  recentStart.setUTCDate(recentStart.getUTCDate() - (CANONICAL_WINDOW_DAYS - 1));
  const priorWindowStart = new Date(recentStart);
  priorWindowStart.setUTCDate(priorWindowStart.getUTCDate() - CANONICAL_WINDOW_DAYS);

  // Outcomes that count as "real disputes" (have a denominator-
  // worthy claim/loss). Excludes Pending (not yet decided),
  // Non-Issue (was never a dispute), and No Action Needed (closed
  // without effort). Approved+Partially Approved feed the recovered
  // numerator; Denied/Withdrawn/Expired feed losses.
  const RECOVERY_RATE_OUTCOMES = sql`${invoiceGroupsTable.outcome} NOT IN ('Pending','Non-Issue','No Action Needed')`;
  const POSITIVE_OUTCOMES = sql`${invoiceGroupsTable.outcome} IN ('Approved','Partially Approved')`;
  const POSITIVE_RESPONSE_TYPES = sql`('approval','partial_approval')`;

  // All-time money block. No phase gate — Approved counts the moment
  // the payor rules; Confirmed adds the reattest. Hide tour samples.
  const [recentMoneyRow] = await db
    .select({
      disputed: sql<string>`COALESCE(SUM(CASE WHEN ${RECOVERY_RATE_OUTCOMES}
        THEN COALESCE(${invoiceGroupsTable.totalAmount}, 0) ELSE 0 END), 0)`,
      recovered: sql<string>`COALESCE(SUM(CASE WHEN ${POSITIVE_OUTCOMES}
        THEN COALESCE(${invoiceGroupsTable.approvedAmount}, 0) ELSE 0 END), 0)`,
      confirmed: sql<string>`COALESCE(SUM(CASE WHEN ${POSITIVE_OUTCOMES}
        AND ${invoiceGroupsTable.reattestCompletedAt} IS NOT NULL
        THEN COALESCE(${invoiceGroupsTable.approvedAmount}, 0) ELSE 0 END), 0)`,
    })
    .from(invoiceGroupsTable)
    .where(HIDE_TOUR_SAMPLE_GROUP);

  // Net change: Σ approvedAmount over groups whose latest positive
  // portal_response landed in the window. Computed in one round-trip
  // by SUM(CASE) over EXISTS subqueries against portal_responses.
  // EXISTS keeps each group counted once even if it received
  // multiple positive responses (e.g., partial then full).
  const recentResponseExists = sql`EXISTS (
    SELECT 1 FROM ${portalResponsesTable}
    WHERE ${portalResponsesTable.invoiceGroupId} = ${invoiceGroupsTable.id}
      AND ${portalResponsesTable.responseType}::text IN ${POSITIVE_RESPONSE_TYPES}
      AND ${portalResponsesTable.receivedAt} >= ${recentStart}
  )`;
  const priorResponseExists = sql`EXISTS (
    SELECT 1 FROM ${portalResponsesTable}
    WHERE ${portalResponsesTable.invoiceGroupId} = ${invoiceGroupsTable.id}
      AND ${portalResponsesTable.responseType}::text IN ${POSITIVE_RESPONSE_TYPES}
      AND ${portalResponsesTable.receivedAt} >= ${priorWindowStart}
      AND ${portalResponsesTable.receivedAt} < ${recentStart}
  )`;
  const [netChangeRow] = await db
    .select({
      recent: sql<string>`COALESCE(SUM(CASE WHEN ${POSITIVE_OUTCOMES} AND ${recentResponseExists}
        THEN COALESCE(${invoiceGroupsTable.approvedAmount}, 0) ELSE 0 END), 0)`,
      prior: sql<string>`COALESCE(SUM(CASE WHEN ${POSITIVE_OUTCOMES} AND ${priorResponseExists}
        THEN COALESCE(${invoiceGroupsTable.approvedAmount}, 0) ELSE 0 END), 0)`,
    })
    .from(invoiceGroupsTable)
    .where(HIDE_TOUR_SAMPLE_GROUP);
  const priorRecoveredRow = { recovered: netChangeRow?.prior ?? "0" };
  // Used downstream for `recentMoneyRow.recovered`-equivalent override
  // when computing netChangeRecovered: we want the "current 7d wins"
  // delta against prior 7d, not (all-time) − (prior 7d).
  const recentWinsThisWeek = parseFloat(netChangeRow?.recent ?? "0") || 0;

  // Closed-out outcomes panel: counts of resolved-in-window groups by
  // outcome. Drives the Dashboard "Closed-out outcomes (last 7d)" panel
  // so the recovery-rate denominator is broken out for the operator
  // (i.e. "of the 14 disputes we closed this week, 9 were approved,
  // 3 denied, 2 withdrawn"). Returns the same seven-bucket shape as
  // the Insights `groupOutcomeBreakdown` so the two panels reconcile.
  // Buckets are MUTUALLY EXCLUSIVE: an Expired-status row counts in
  // `expired` only, even if its stored `outcome` is still e.g. Denied
  // from before the deadline sweep — `status='Expired'` is a closure
  // path of its own and we don't want to double-count those rows in
  // both `denied` AND `expired`. Partition is `CASE WHEN status =
  // 'Expired' THEN '__expired__' ELSE outcome END` so a single GROUP
  // BY pass yields disjoint counts and `total = Σ buckets` is honest.
  // Cast both branches to text so the CASE result type is `text`, not
  // `claim_outcome`. Without the cast, Postgres types the whole CASE
  // by the ELSE branch (`outcome`, an enum) and rejects the
  // `'__expired__'` sentinel literal as `invalid input value for enum
  // claim_outcome` at runtime — production-only because dev DBs
  // historically had a permissive outcome enum. Casting keeps the
  // partition disjoint and the enum check honest.
  const bucketSql = sql<string>`CASE WHEN ${invoiceGroupsTable.status} = 'Expired' THEN '__expired__' ELSE ${invoiceGroupsTable.outcome}::text END`;
  // ALL-TIME outcome buckets — no phase/date gate. We count any group
  // that has reached a terminal verdict: a real outcome (not Pending)
  // OR an Expired status (closure path that doesn't always set
  // outcome). A group sitting in awaiting_reattestation with
  // outcome=Approved counts as a win the moment the payor rules,
  // matching the Recovered $ tile semantics.
  const closedOutcomeRows = await db
    .select({
      bucket: bucketSql,
      count: count(),
    })
    .from(invoiceGroupsTable)
    .where(and(
      HIDE_TOUR_SAMPLE_GROUP,
      or(
        ne(invoiceGroupsTable.outcome, "Pending"),
        eq(invoiceGroupsTable.status, "Expired"),
      ),
    ))
    .groupBy(bucketSql);
  const closedOutcomes = {
    approved: 0,
    partiallyApproved: 0,
    denied: 0,
    withdrawn: 0,
    expired: 0,
    nonIssue: 0,
    noActionNeeded: 0,
  };
  let closedInWindowTotal = 0;
  for (const r of closedOutcomeRows) {
    closedInWindowTotal += r.count;
    switch (r.bucket) {
      case "__expired__": closedOutcomes.expired = r.count; break;
      case "Approved": closedOutcomes.approved = r.count; break;
      case "Partially Approved": closedOutcomes.partiallyApproved = r.count; break;
      case "Denied": closedOutcomes.denied = r.count; break;
      case "Withdrawn": closedOutcomes.withdrawn = r.count; break;
      case "Non-Issue": closedOutcomes.nonIssue = r.count; break;
      case "No Action Needed": closedOutcomes.noActionNeeded = r.count; break;
      // "Pending" never lands on a phase=closed/non-Expired row in
      // practice; if it does (data quirk), we fold it into nothing
      // rather than inventing a bucket — `total` will then exceed
      // the sum of the named buckets, which is the honest signal.
    }
  }

  const disputedAmount = parseFloat(recentMoneyRow?.disputed || "0");
  const recoveredAmount = parseFloat(recentMoneyRow?.recovered || "0");
  const confirmedRecoveredAmount = parseFloat(recentMoneyRow?.confirmed || "0");
  const priorRecoveredAmount = parseFloat(priorRecoveredRow?.recovered || "0");
  const recoveryRate = disputedAmount > 0
    ? Math.round((recoveredAmount / disputedAmount) * 100)
    : null;
  // Net change is "this week's wins − last week's wins", anchored on
  // portal_responses.received_at. NOT (all-time recovered − prior 7d),
  // which would balloon to a giant positive number forever.
  const netChangeRecovered = recentWinsThisWeek - priorRecoveredAmount;
  // "Open invoices" count for the Dashboard — same predicate as the
  // at-risk bucket above so the count and the at-risk dollars line up.
  const openInvoices = atRiskGroups;

  // Wave D-PR3: collapsed onto the `invoice_groups.is_open` GENERATED
  // column (migration 0036). Lockstep with `OPEN_STATUSES` in
  // `lib/leg-state/src/openness.ts`; conformance audit pins it.
  const openStatusFilter = eq(invoiceGroupsTable.isOpen, true);

  // Wave D-PR5 collapse: the §3.B `status != "Portal Queued"` residual
  // carve-out is gone now that the writer-rewire stamps
  // `claims.submitted_via` and the deriver promotes any stamped group
  // out of `ready_to_submit`. The pre-submit actionable set is exactly
  // `phase IN (triage, ready_to_submit)` — pure phase membership.
  // Locked against drift by the must-file-today-parity contract
  // (Task #352, must-file-today-parity.test.ts). See
  // docs/architecture/state-wave-d-pr5-handoff-prompt.md.
  //
  // Task #541: also include unclassified Classification Inbox groups
  // (errorTypeId NULL/'') regardless of phase, gated on the operator
  // still owing action (`needs_operator_attention`). Mirror change in
  // `lib/urgent-snapshot.ts` and `lib/expiring-filter.ts` keeps the
  // must-file-today-parity contract honest. See operator-attention.ts.
  const expiringStatusFilter = or(
    eq(invoiceGroupsTable.phase, "triage"),
    eq(invoiceGroupsTable.phase, "ready_to_submit"),
    and(groupUnclassifiedSql(), needsOperatorAttentionSql()),
  );

  const openGroupsWithDates = await db
    .select({
      id: invoiceGroupsTable.id,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      totalAmount: invoiceGroupsTable.totalAmount,
      status: invoiceGroupsTable.status,
      rideCount: invoiceGroupsTable.rideCount,
      // Read the typed, indexed `invoice_groups.service_date` column
      // (Task #350) so this query agrees with the Queue / Groups list /
      // urgent-snapshot — all of which now read the same canonical
      // value maintained by `recomputeGroupServiceDate` on every write
      // path. `to_char` keeps the wire shape stable as ISO YYYY-MM-DD
      // for the JS deadline helpers, regardless of how the `pg` driver
      // serializes `date` columns. See Task #356.
      earliestDate: sql<string | null>`to_char(${invoiceGroupsTable.serviceDate}, 'YYYY-MM-DD')`,
    })
    .from(invoiceGroupsTable)
    .where(and(HIDE_TOUR_SAMPLE_GROUP, expiringStatusFilter, isNotNull(invoiceGroupsTable.serviceDate)));

  const expiringNow = new Date();
  const expiringGroups = openGroupsWithDates
    .map(g => {
      const dl = daysRemaining(g.earliestDate);
      const eff = effectiveDaysRemaining(g.earliestDate, expiringNow);
      const urgent = isUrgentDeadline(g.earliestDate, expiringNow);
      return {
        id: g.id,
        invoiceNumber: g.invoiceNumber,
        earliestDate: g.earliestDate!,
        totalAmount: g.totalAmount,
        status: g.status,
        rideCount: g.rideCount,
        daysLeft: dl!,
        effectiveDaysLeft: eff!,
        isUrgent: urgent,
      };
    })
    .filter(g => g.effectiveDaysLeft !== null && g.effectiveDaysLeft <= SOON_DAYS)
    .sort((a, b) => a.effectiveDaysLeft - b.effectiveDaysLeft);

  const urgentCount = expiringGroups.filter(g => g.isUrgent).length;

  // "Stuck after submission" tier (Task #352). Same date math as the
  // expiring/urgent computation above; the only difference is the
  // status filter (Portal Queued at the group level — Processed is
  // claim-only and can't appear here). A group lands in this list
  // when the operator already submitted via the portal but the
  // deadline has slipped without an acknowledgement, so the row
  // needs a chase rather than a fresh filing. Surfaced alongside
  // `urgentCount` so the dashboard never reads "0 to file today"
  // while the same data renders TODAY-style badges in lower tiers.
  // Wave D-PR5: stuck-after-submission tier — Portal-Queued groups
  // are now promoted to phase='submitted' the moment the writer
  // stamps `claims.submitted_via`, so the stuck filter pairs the
  // canonical post-submit phase with the residual `status` hint that
  // pins it to the portal-queued slice (the writer never moves
  // these rows out of `Portal Queued` until the bot acks). Membership
  // matches GROUP_SUBMITTED_STUCK_STATUSES exactly.
  const stuckStatusFilter = and(
    eq(invoiceGroupsTable.phase, "submitted"),
    or(...GROUP_SUBMITTED_STUCK_STATUSES.map(s => eq(invoiceGroupsTable.status, s))),
  );
  const stuckGroupsWithDates = await db
    .select({
      id: invoiceGroupsTable.id,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      totalAmount: invoiceGroupsTable.totalAmount,
      status: invoiceGroupsTable.status,
      rideCount: invoiceGroupsTable.rideCount,
      // Same canonical read as the open-groups query above (Task #356):
      // the indexed `invoice_groups.service_date` column, written by
      // `recomputeGroupServiceDate` on every write path. Stuck rows are
      // by definition past the effective deadline, so the deadline math
      // downstream uses the exact same input the dashboard hero / queue
      // / groups list use — no chance of a "stuck here, not stuck
      // there" disagreement.
      earliestDate: sql<string | null>`to_char(${invoiceGroupsTable.serviceDate}, 'YYYY-MM-DD')`,
    })
    .from(invoiceGroupsTable)
    .where(and(HIDE_TOUR_SAMPLE_GROUP, stuckStatusFilter, isNotNull(invoiceGroupsTable.serviceDate)));

  const submittedStuckGroups = stuckGroupsWithDates
    .map(g => {
      const dl = daysRemaining(g.earliestDate);
      const eff = effectiveDaysRemaining(g.earliestDate, expiringNow);
      return {
        id: g.id,
        invoiceNumber: g.invoiceNumber,
        earliestDate: g.earliestDate!,
        totalAmount: g.totalAmount,
        status: g.status,
        rideCount: g.rideCount,
        daysLeft: dl!,
        effectiveDaysLeft: eff!,
        // Stuck rows are by definition past the effective deadline —
        // we still emit the flag so list consumers can short-circuit
        // if they want to render the deadline pill identically.
        isUrgent: eff != null && eff <= 0,
      };
    })
    // The defining cut: the row is "stuck" only when the effective
    // deadline has actually slipped. A Portal Queued group with a
    // healthy deadline is still working as designed — no escalation.
    .filter(g => g.effectiveDaysLeft !== null && g.effectiveDaysLeft <= 0)
    .sort((a, b) => a.effectiveDaysLeft - b.effectiveDaysLeft);

  const submittedStuckCount = submittedStuckGroups.length;

  const recentGroups = await db.select().from(invoiceGroupsTable)
    .orderBy(desc(invoiceGroupsTable.updatedAt))
    .limit(10);

  const submissionCountsRaw = await db
    .select({ status: portalSubmissionsTable.status, count: count() })
    .from(portalSubmissionsTable)
    .groupBy(portalSubmissionsTable.status);

  const subCounts = Object.fromEntries(submissionCountsRaw.map(r => [r.status, r.count]));
  const pending = subCounts["pending"] || 0;
  const submitted = subCounts["submitted"] || 0;
  const failed = subCounts["failed"] || 0;
  const totalSubs = submitted + failed;
  const successRate = totalSubs > 0 ? ((submitted / totalSubs) * 100).toFixed(1) : "0";

  const now = new Date();

  const [{ value: pendingDueCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.status, "pending"),
      or(
        isNull(portalSubmissionsTable.nextRetryAt),
        lte(portalSubmissionsTable.nextRetryAt, now),
      ),
    ));

  // Cycle-aware overdue count: shared with the worker-activity endpoint
  // and the system-health rollup so the dashboard tile, the System Health
  // page, and the worker banner can never disagree.
  const overdueCount = await getOverdueCount(now);

  const scrubbedAmounts = scrubDashboardAmounts({
      // ── Legacy fields (kept for backward compat; daily-brief and a
      // couple of dashboard tiles still read them). DO NOT remove
      // without sweeping the consumers — see grep for `totalExposure`
      // and `totalLost`. New surfaces should prefer the explicit
      // at-risk / lost / reclaimed fields below.
      totalClaimed: totalClaimed.toFixed(2),
      totalApproved: totalApproved.toFixed(2),
      totalExposure: totalExposure.toFixed(2),
      totalLost: totalLost.toFixed(2),
      vendorPrepayRate: VENDOR_PREPAY_RATE,
      // ── At-risk / Already-lost / Reclaimed money model. See the
      // long comment above the bucketRow query for definitions.
      // All `*Exposure` fields apply the (1 + prepay) multiplier;
      // `*Claim` fields are raw claim dollars (pre-multiplier).
      // `reclaimedApproved` is intentionally NOT multiplied — once
      // a claim is approved the prepay washes through the payor
      // remit, so showing it inflated would overstate recovery.
      atRiskClaim: atRiskClaim.toFixed(2),
      atRiskExposure: atRiskExposure.toFixed(2),
      atRiskGroups,
      lostExpiredClaim: expiredClaim.toFixed(2),
      lostExpiredExposure: lostExpiredExposure.toFixed(2),
      lostExpiredGroups: expiredGroups,
      lostDeniedClaim: deniedLostClaim.toFixed(2),
      lostDeniedExposure: lostDeniedExposure.toFixed(2),
      lostDeniedGroups: deniedLostGroups,
      lostExposureTotal: lostExposureTotal.toFixed(2),
      reclaimedApproved: reclaimedApproved.toFixed(2),
      // ── Task #720 canonical 7d block. See block comment above for
      // definitions; mirrors /dashboard/insights for the same window so
      // the Dashboard top strip, Insights money scorecard, and the
      // daily brief KPI tiles render identical numbers.
      windowDays: CANONICAL_WINDOW_DAYS,
      openInvoices,
      disputedAmount: disputedAmount.toFixed(2),
      recoveredAmount: recoveredAmount.toFixed(2),
      confirmedRecoveredAmount: confirmedRecoveredAmount.toFixed(2),
      priorRecoveredAmount: priorRecoveredAmount.toFixed(2),
      recoveryRate,
      netChangeRecovered: netChangeRecovered.toFixed(2),
  }, req.user);

  res.json({
    pipeline: { needsEvidence, portalQueued, awaitingResponse },
    stats: { total, new: newCount, resolved, denied, withdrawn, onHold, awaitingAttestation, expired, withdrawnByReason, deniedByReason },
    amounts: scrubbedAmounts,
    // Closed-out outcomes panel — counts of disputes the team
    // closed inside the canonical window, broken out by outcome.
    // Drives the Dashboard "Closed-out outcomes (last 7d)" panel
    // so the operator sees the recovery-rate denominator broken
    // out in the same place the rate is shown.
    closedOutcomes: {
      ...closedOutcomes,
      total: closedInWindowTotal,
      windowDays: CANONICAL_WINDOW_DAYS,
    },
    expiringGroups: scrubMoneyFieldsArray(expiringGroups, req.user),
    urgentCount,
    submittedStuckGroups: scrubMoneyFieldsArray(submittedStuckGroups, req.user),
    submittedStuckCount,
    recentGroups: scrubMoneyFieldsArray(recentGroups, req.user),
    portalStats: { pending, submitted, failed, successRate },
    portalWorker: {
      lastRun: getLastWorkerRun(),
      isRunning: isWorkerRunInProgress(),
      pendingDueCount,
      overdueCount,
    },
    // Server-clock "today" stamp (Task #294). The deadline math above
    // (`isUrgentDeadline` / `effectiveDaysRemaining`) was computed
    // against `expiringNow`; embedding the matching `today` key lets the
    // client detect day rollover via a server signal — when a future
    // response carries a different `today`, the client invalidates
    // sister deadline-driven queries so the cache can never stay pinned
    // to yesterday's "must file today" math. See
    // `artifacts/claimclear/src/lib/server-day-rollover.ts`.
    today: serverTodayKey(expiringNow),
  });
}));

router.get("/dashboard/timeseries", asyncHandler(async (req, res): Promise<void> => {
  const days = parseDays(req.query.days, 30);
  const start = startOfWindow(days);
  const buckets = buildDateBuckets(days);
  // Prior-window for the Insights "Outcomes" recovered-$ trend overlay.
  // We pull recovered-$ per day for the equivalent calendar slot one
  // window back (e.g. for a 30d window: days [now-60..now-30]) and emit
  // it as `priorDollarsRecovered` aligned to each current point's index.
  const priorStart = new Date(start.getTime() - days * 86400000);
  const priorEnd = start;

  const createdRows = await db
    .select({
      bucket: sql<string>`to_char((${claimsTable.createdAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      count: count(),
    })
    .from(claimsTable)
    .where(gte(claimsTable.createdAt, start))
    .groupBy(sql`1`);

  const resolvedRows = await db
    .select({
      bucket: sql<string>`to_char((${auditLogsTable.timestamp}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      count: count(),
    })
    .from(auditLogsTable)
    .where(and(
      gte(auditLogsTable.timestamp, start),
      inArray(auditLogsTable.action, ["group_resolved", "group_denied"]),
    ))
    .groupBy(sql`1`);

  // Invoice-grain (group) created/resolved/submitted per day. Powers the
  // CFO/COO Insights Daily Flow chart, where the unit-of-work is the
  // invoice, not the leg. `claimsCreated` / `claimsResolved` above are
  // kept for backward compatibility with the dashboard's own series.
  const invoicesCreatedRows = await db
    .select({
      bucket: sql<string>`to_char((${invoiceGroupsTable.createdAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      count: count(),
    })
    .from(invoiceGroupsTable)
    .where(and(gte(invoiceGroupsTable.createdAt, start), HIDE_TOUR_SAMPLE_GROUP))
    .groupBy(sql`1`);

  // Invoice-resolved counts a distinct invoice group per day — multiple
  // resolve/deny audit rows for the same group on the same day collapse.
  const invoicesResolvedRows = await db
    .select({
      bucket: sql<string>`to_char((${auditLogsTable.timestamp}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      count: sql<number>`COUNT(DISTINCT ${auditLogsTable.invoiceGroupId})::int`,
    })
    .from(auditLogsTable)
    .where(and(
      gte(auditLogsTable.timestamp, start),
      inArray(auditLogsTable.action, ["group_resolved", "group_denied"]),
      isNotNull(auditLogsTable.invoiceGroupId),
    ))
    .groupBy(sql`1`);

  // Invoice-submitted: distinct invoice groups whose first portal
  // submission was created on a given day. Sourced from the canonical
  // portal_submissions.createdAt timestamp (the audit-log path was
  // brittle — `group_status_changed` rows aren't always written for
  // bulk submits and undercount by ~30%). One row per (invoice, day).
  const invoicesSubmittedRows = await db
    .select({
      bucket: sql<string>`to_char((${portalSubmissionsTable.createdAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      count: sql<number>`COUNT(DISTINCT ${portalSubmissionsTable.invoiceGroupId})::int`,
    })
    .from(portalSubmissionsTable)
    .where(and(
      gte(portalSubmissionsTable.createdAt, start),
      isNotNull(portalSubmissionsTable.invoiceGroupId),
    ))
    .groupBy(sql`1`);

  // Re-attest completions per day — distinct invoice groups whose
  // reattest_completed_at falls in the bucket. "Our work" series on
  // the Insights data-flow chart (the moment we close the loop with
  // the payor after the win).
  const invoicesReattestedRows = await db
    .select({
      bucket: sql<string>`to_char((${invoiceGroupsTable.reattestCompletedAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      count: count(),
    })
    .from(invoiceGroupsTable)
    .where(and(
      HIDE_TOUR_SAMPLE_GROUP,
      isNotNull(invoiceGroupsTable.reattestCompletedAt),
      gte(invoiceGroupsTable.reattestCompletedAt, start),
    ))
    .groupBy(sql`1`);

  // Portal responses received per day — "payor work". One row per
  // distinct invoice group per day (a group with multiple responses
  // on the same day — e.g. partial then full — counts once).
  const responsesReceivedRows = await db
    .select({
      bucket: sql<string>`to_char((${portalResponsesTable.receivedAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      count: sql<number>`COUNT(DISTINCT ${portalResponsesTable.invoiceGroupId})::int`,
    })
    .from(portalResponsesTable)
    .where(gte(portalResponsesTable.receivedAt, start))
    .groupBy(sql`1`);

  // Recovered $ per day — bucketed on portal_responses.received_at
  // (the day the payor's positive verdict landed) joined to the
  // group's approvedAmount. Switched off invoice_groups.updatedAt
  // because that timestamp moves on every unrelated row touch and
  // smeared the trend.
  //
  // Dedup happens in the inner SELECT DISTINCT (bucket, group_id) so a
  // group with multiple positive response rows on the same day still
  // contributes its approvedAmount exactly once. NEVER use
  // `SUM(DISTINCT approved_amount)` — that collapses two different
  // groups with identical amounts (e.g. $100 + $100) into one.
  const recoveredRows = await db.execute<{ bucket: string; total: string }>(sql`
    SELECT bucket, COALESCE(SUM(approved_amount), 0)::text AS total
    FROM (
      SELECT DISTINCT
        to_char((${portalResponsesTable.receivedAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS bucket,
        ${invoiceGroupsTable.id} AS group_id,
        COALESCE(${invoiceGroupsTable.approvedAmount}, 0) AS approved_amount
      FROM ${portalResponsesTable}
      INNER JOIN ${invoiceGroupsTable}
        ON ${portalResponsesTable.invoiceGroupId} = ${invoiceGroupsTable.id}
      WHERE ${portalResponsesTable.receivedAt} >= ${start}
        AND ${portalResponsesTable.responseType}::text IN ('approval','partial_approval')
        AND ${invoiceGroupsTable.outcome} IN ('Approved','Partially Approved')
        AND ${HIDE_TOUR_SAMPLE_GROUP}
    ) t
    GROUP BY bucket
  `).then(r => (r as unknown as { rows: Array<{ bucket: string; total: string }> }).rows ?? []);

  // Prior-window recovered-$ per day, same anchor + dedup as current.
  const priorRecoveredRows = await db.execute<{ bucket: string; total: string }>(sql`
    SELECT bucket, COALESCE(SUM(approved_amount), 0)::text AS total
    FROM (
      SELECT DISTINCT
        to_char((${portalResponsesTable.receivedAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS bucket,
        ${invoiceGroupsTable.id} AS group_id,
        COALESCE(${invoiceGroupsTable.approvedAmount}, 0) AS approved_amount
      FROM ${portalResponsesTable}
      INNER JOIN ${invoiceGroupsTable}
        ON ${portalResponsesTable.invoiceGroupId} = ${invoiceGroupsTable.id}
      WHERE ${portalResponsesTable.receivedAt} >= ${priorStart}
        AND ${portalResponsesTable.receivedAt} < ${priorEnd}
        AND ${portalResponsesTable.responseType}::text IN ('approval','partial_approval')
        AND ${invoiceGroupsTable.outcome} IN ('Approved','Partially Approved')
        AND ${HIDE_TOUR_SAMPLE_GROUP}
    ) t
    GROUP BY bucket
  `).then(r => (r as unknown as { rows: Array<{ bucket: string; total: string }> }).rows ?? []);

  const createdMap = new Map(createdRows.map(r => [r.bucket, r.count]));
  const resolvedMap = new Map(resolvedRows.map(r => [r.bucket, r.count]));
  const recoveredMap = new Map(recoveredRows.map(r => [r.bucket, parseFloat(r.total || "0")]));
  const invoicesCreatedMap = new Map(invoicesCreatedRows.map(r => [r.bucket, Number(r.count)]));
  const invoicesResolvedMap = new Map(invoicesResolvedRows.map(r => [r.bucket, Number(r.count)]));
  const invoicesSubmittedMap = new Map(invoicesSubmittedRows.map(r => [r.bucket, Number(r.count)]));
  const invoicesReattestedMap = new Map(invoicesReattestedRows.map(r => [r.bucket, Number(r.count)]));
  const responsesReceivedMap = new Map(responsesReceivedRows.map(r => [r.bucket, Number(r.count)]));
  const priorRecoveredMap = new Map(priorRecoveredRows.map(r => [r.bucket, parseFloat(r.total || "0")]));

  // Clerks don't see money — null out the dollarsRecovered series so the
  // Insights page renders "—" via formatCurrency rather than $0.00.
  const showAmounts = canSeeAmounts(req.user);
  const priorBuckets: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(priorStart);
    d.setUTCDate(d.getUTCDate() + i);
    priorBuckets.push(d.toISOString().slice(0, 10));
  }
  const points = buckets.map((date, idx) => {
    const priorDate = priorBuckets[idx];
    return {
      date,
      claimsCreated: createdMap.get(date) ?? 0,
      claimsResolved: resolvedMap.get(date) ?? 0,
      invoicesCreated: invoicesCreatedMap.get(date) ?? 0,
      invoicesSubmitted: invoicesSubmittedMap.get(date) ?? 0,
      invoicesResolved: invoicesResolvedMap.get(date) ?? 0,
      invoicesReattested: invoicesReattestedMap.get(date) ?? 0,
      responsesReceived: responsesReceivedMap.get(date) ?? 0,
      dollarsRecovered: showAmounts
        ? Number((recoveredMap.get(date) ?? 0).toFixed(2))
        : null,
      priorDollarsRecovered: showAmounts && priorDate
        ? Number((priorRecoveredMap.get(priorDate) ?? 0).toFixed(2))
        : null,
    };
  });

  res.json({ days, points });
}));

// ─────────────────────────────────────────────────────────────────────
// /dashboard/insights
//
// Server-side aggregations for the Insights page topline tiles and
// breakdown lists. Replaces the prior client-side reductions that
// summed the first 500 rows returned by /claims and silently
// understated everything once a window held more than that.
//
// All windows are filtered on `claims.created_at >= start_of_window`,
// matching the page's `createdFrom` query, and exclude the global
// tour sample. Money sums use the same Reclaimed semantics as
// /dashboard/summary: a positive verdict only counts toward
// `recoveredAmount` once re-attestation has settled
// (`attestation_state IN ('completed','not_required')`), so the
// Insights "Recovered" tile and the dashboard "Reclaimed" KPI can
// never disagree.
//
// Money fields are nulled out for clerks via `canSeeAmounts`.
// ─────────────────────────────────────────────────────────────────────
router.get("/dashboard/insights", asyncHandler(async (req, res): Promise<void> => {
  const days = parseDays(req.query.days, 30);
  const start = startOfWindow(days);
  const showAmounts = canSeeAmounts(req.user);

  // Settled-positive predicate. Used inside resolved-in-window money
  // sums so a positive verdict only counts toward `recoveredAmount`
  // once re-attestation has settled. A pending/queued re-attestation
  // can still flip the verdict back, so its approved dollars stay out
  // of the recovered total.
  const isSettledApprovedExpr = sql`${claimsTable.outcome} IN ('Approved','Partially Approved')
    AND ${claimsTable.attestationState} IN ('completed','not_required')`;
  // Workload-context window — kept on `created_at` because the page's
  // "How much work arrived this period?" read is what these breakdowns
  // (statusBreakdown, outcomeBreakdown, totalClaims counts,
  // payorBreakdown counts) answer.
  const inWindow = and(gte(claimsTable.createdAt, start), HIDE_TOUR_SAMPLE_CLAIM);
  // Resolution-anchored claim window. A leg lands here iff its parent
  // group is `phase='closed' AND phaseEnteredAt IN window` — i.e. the
  // dispute on this leg actually got CLOSED in the window. Used for
  // every dollar aggregate the operator reads as "what landed this
  // period" (totalDeniedAmount on the per-leg totals, errorTypeRows
  // recovered/denied $) so the denial-reason ranking and the money
  // scorecard both speak the same lifecycle language. Without this
  // anchor the denial-$ rows on the "Top denial reasons" panel would
  // still be a 30d ARRIVAL cohort while the scorecard above is a 30d
  // RESOLUTION cohort, and the two would never reconcile.
  const claimResolvedInWindow = and(
    HIDE_TOUR_SAMPLE_CLAIM,
    sql`EXISTS (
      SELECT 1 FROM ${invoiceGroupsTable}
      WHERE ${invoiceGroupsTable.id} = ${claimsTable.invoiceGroupId}
        AND ${invoiceGroupsTable.phase} = 'closed'
        AND ${invoiceGroupsTable.phaseEnteredAt} >= ${start}
    )`,
  );
  // Prior window of equal length, used for the "Net change vs prior
  // window" tile on the CFO scorecard. Bracketed [priorStart, start)
  // so a row never lands in both windows.
  const priorStart = new Date(start.getTime() - days * 86400000);

  // Per-leg totals. `totalClaims` stays workload-anchored (claims that
  // ARRIVED this period) because the surrounding page reads it as the
  // intake count. `totalDeniedAmount`, however, is the denial-$ figure
  // operators reconcile against the resolved-window money scorecard
  // and the per-error denial bars below — so it switches to the
  // RESOLVED-in-window cohort to stop the "$3,400 denied this 30d
  // arrival" vs "$8,900 denied this 30d resolution" mismatch the
  // architect flagged.
  const [totalsRow] = await db
    .select({ totalClaims: count() })
    .from(claimsTable)
    .where(inWindow);
  const [deniedRow] = await db
    .select({
      totalDeniedAmount: sql<string>`COALESCE(SUM(CASE
        WHEN ${claimsTable.outcome} = 'Denied'
          THEN COALESCE(${claimsTable.claimAmount}, 0)
        ELSE 0
      END), 0)`,
    })
    .from(claimsTable)
    .where(claimResolvedInWindow);

  // Breakdown queries. Run in parallel — none depend on each other.
  // `statusRows` is the per-status histogram for the analytics page
  // chart — display axis, NOT a state-machine predicate (Wave D-PR6
  // §3.E). Keep on `status`: the chart legend renders status names
  // verbatim, and collapsing onto `phase` would lose the breakdown
  // the operator is reading the chart for.
  // `groupOutcomeBreakdown` is invoice-level, not claim-level — it counts
  // distinct invoice groups by their stored `invoice_groups.outcome` so
  // the page's "By outcome" card sums to total invoice groups in the
  // window, not total claims (Task #583, finishing the per-invoice
  // re-grounding from #563). Windowed on `invoice_groups.created_at` to
  // mirror the claim-level breakdowns above. The five display buckets
  // are Approved / Partially Approved / Denied / Withdrawn / Mixed; the
  // stored enum's "Pending" and "Non-Issue" values both fold into Mixed
  // since they're not clean terminal states for the operator.
  // Workload-context window for "what arrived this period" reads
  // (kept on createdAt). NOT used for money or outcome aggregations —
  // those use the resolved-in-window predicate below so the numbers
  // reflect the dispute lifecycle, not the inbox.
  const groupCreatedInWindow = and(gte(invoiceGroupsTable.createdAt, start), HIDE_TOUR_SAMPLE_GROUP);
  // Resolution-anchored window. A group lands here once it transitions
  // to phase=closed (group-transitions.ts stamps phaseEnteredAt=NOW()
  // at that moment). Anchors every windowed money/outcome aggregate
  // (Recovered, Disputed, Confirmed, Net change, Outcome mix, Top
  // denial reasons, Payor win-rate). See the same justification block
  // on the Dashboard summary handler above.
  const groupResolvedInWindow = and(
    HIDE_TOUR_SAMPLE_GROUP,
    eq(invoiceGroupsTable.phase, "closed"),
    gte(invoiceGroupsTable.phaseEnteredAt, start),
  );
  const groupResolvedInPrior = and(
    HIDE_TOUR_SAMPLE_GROUP,
    eq(invoiceGroupsTable.phase, "closed"),
    gte(invoiceGroupsTable.phaseEnteredAt, priorStart),
    sql`${invoiceGroupsTable.phaseEnteredAt} < ${start}`,
  );
  const POSITIVE_OUTCOMES_INSIGHTS = sql`${invoiceGroupsTable.outcome} IN ('Approved','Partially Approved')`;
  const RECOVERY_RATE_OUTCOMES_INSIGHTS = sql`${invoiceGroupsTable.outcome} NOT IN ('Pending','Non-Issue','No Action Needed')`;
  const POSITIVE_RESPONSE_TYPES_INSIGHTS = sql`('approval','partial_approval')`;
  const FINAL_RESPONSE_TYPES_INSIGHTS = sql`('approval','partial_approval','denial')`;

  // Win-date predicates — anchor money on when the payor's verdict
  // landed (portal_responses.received_at), not on when the dispute
  // later closed. Without this, a 7d window that catches 50 freshly-
  // approved invoices reads $0 because none have hit phase=closed
  // yet. See the same rationale in /dashboard/summary above.
  const wonInWindowSql = sql`EXISTS (
    SELECT 1 FROM ${portalResponsesTable}
    WHERE ${portalResponsesTable.invoiceGroupId} = ${invoiceGroupsTable.id}
      AND ${portalResponsesTable.responseType}::text IN ${POSITIVE_RESPONSE_TYPES_INSIGHTS}
      AND ${portalResponsesTable.receivedAt} >= ${start}
  )`;
  const wonInPriorSql = sql`EXISTS (
    SELECT 1 FROM ${portalResponsesTable}
    WHERE ${portalResponsesTable.invoiceGroupId} = ${invoiceGroupsTable.id}
      AND ${portalResponsesTable.responseType}::text IN ${POSITIVE_RESPONSE_TYPES_INSIGHTS}
      AND ${portalResponsesTable.receivedAt} >= ${priorStart}
      AND ${portalResponsesTable.receivedAt} < ${start}
  )`;
  const respondedInWindowSql = sql`EXISTS (
    SELECT 1 FROM ${portalResponsesTable}
    WHERE ${portalResponsesTable.invoiceGroupId} = ${invoiceGroupsTable.id}
      AND ${portalResponsesTable.responseType}::text IN ${FINAL_RESPONSE_TYPES_INSIGHTS}
      AND ${portalResponsesTable.receivedAt} >= ${start}
  )`;

  // Money totals — invoice-grain, anchored on the payor's verdict
  // date. `closedInWindowCount` switches to "groups with any final
  // response in window" so the sample-size sub-label below the tiles
  // matches the cohort the dollars describe.
  const [invoiceMoneyRow] = await db
    .select({
      totalClaimedAmount: sql<string>`COALESCE(SUM(CASE WHEN ${RECOVERY_RATE_OUTCOMES_INSIGHTS} AND ${respondedInWindowSql}
        THEN COALESCE(${invoiceGroupsTable.totalAmount}, 0) ELSE 0 END), 0)`,
      totalRecoveredAmount: sql<string>`COALESCE(SUM(CASE WHEN ${POSITIVE_OUTCOMES_INSIGHTS} AND ${wonInWindowSql}
        THEN COALESCE(${invoiceGroupsTable.approvedAmount}, 0) ELSE 0 END), 0)`,
      confirmedRecoveredAmount: sql<string>`COALESCE(SUM(CASE WHEN ${POSITIVE_OUTCOMES_INSIGHTS} AND ${wonInWindowSql}
        AND ${invoiceGroupsTable.reattestCompletedAt} IS NOT NULL
        THEN COALESCE(${invoiceGroupsTable.approvedAmount}, 0) ELSE 0 END), 0)`,
      closedInWindowCount: sql<number>`SUM(CASE WHEN ${respondedInWindowSql} THEN 1 ELSE 0 END)::int`,
      closedInWindowAmount: sql<string>`COALESCE(SUM(CASE WHEN ${respondedInWindowSql}
        THEN COALESCE(${invoiceGroupsTable.totalAmount}, 0) ELSE 0 END), 0)`,
    })
    .from(invoiceGroupsTable)
    .where(HIDE_TOUR_SAMPLE_GROUP);

  const openExposurePredicate = and(
    HIDE_TOUR_SAMPLE_GROUP,
    sql`${invoiceGroupsTable.outcome} NOT IN ('Withdrawn','Non-Issue')`,
    sql`NOT (${invoiceGroupsTable.status} = 'Expired'
        OR (${invoiceGroupsTable.status} = 'On Hold'
            AND ${invoiceGroupsTable.serviceDate} IS NOT NULL
            AND (
              CASE EXTRACT(DOW FROM (${invoiceGroupsTable.serviceDate} + INTERVAL '30 days'))
                WHEN 6 THEN ((${invoiceGroupsTable.serviceDate} + INTERVAL '30 days')::date - INTERVAL '1 day')::date
                WHEN 0 THEN ((${invoiceGroupsTable.serviceDate} + INTERVAL '30 days')::date - INTERVAL '2 days')::date
                ELSE (${invoiceGroupsTable.serviceDate} + INTERVAL '30 days')::date
              END
            ) < CURRENT_DATE))`,
    or(
      ne(invoiceGroupsTable.phase, "closed"),
      sql`EXISTS (
        SELECT 1 FROM ${claimsTable}
        WHERE ${claimsTable.invoiceGroupId} = ${invoiceGroupsTable.id}
          AND ${claimsTable.attestationState} IN ('pending','queued')
      )`,
    ),
  );
  const [
    statusRows,
    outcomeRows,
    errorTypeRows,
    payorRows,
    groupOutcomeRows,
    [priorRecoveredRow],
    pipelineRows,
    [atRiskRow],
    payorConcentrationRows,
    [closedInWindowRow],
  ] = await Promise.all([
    db
      .select({ key: claimsTable.status, count: count() })
      .from(claimsTable)
      .where(inWindow)
      .groupBy(claimsTable.status),
    db
      .select({ key: claimsTable.outcome, count: count() })
      .from(claimsTable)
      .where(inWindow)
      .groupBy(claimsTable.outcome),
    // errorTypeRows drives "Top denial reasons" — counts AND dollars.
    // Switched from arrival-window (`inWindow`) to RESOLVED-in-window
    // (`claimResolvedInWindow`) so a denial cause's count and its
    // denied-$ both refer to "denials we landed in the last Nd",
    // matching the money scorecard's resolved-window cohort. The
    // ranking + the share-of-denied-$ percentage on the panel are
    // both honest about which cohort they describe.
    db
      .select({
        key: claimsTable.errorTypeName,
        count: count(),
        recovered: sql<string>`COALESCE(SUM(CASE
          WHEN ${isSettledApprovedExpr}
            THEN COALESCE(${claimsTable.approvedAmount}, 0)
          ELSE 0
        END), 0)`,
        denied: sql<string>`COALESCE(SUM(CASE
          WHEN ${claimsTable.outcome} = 'Denied'
            THEN COALESCE(${claimsTable.claimAmount}, 0)
          ELSE 0
        END), 0)`,
      })
      .from(claimsTable)
      .where(claimResolvedInWindow)
      .groupBy(claimsTable.errorTypeName),
    db
      .select({
        key: claimsTable.payorEmail,
        count: count(),
        atRisk: sql<string>`COALESCE(SUM(CASE
          WHEN ${claimsTable.outcome} = 'Denied'
            THEN COALESCE(${claimsTable.claimAmount}, 0)
          ELSE 0
        END), 0)`,
      })
      .from(claimsTable)
      .where(inWindow)
      .groupBy(claimsTable.payorEmail),
    // Outcome mix — counts of groups resolved in the selected window
    // by their stored outcome. Anchored on `phaseEnteredAt` (resolution
    // moment) so the "By outcome" panel actually answers "how did the
    // disputes we closed this period break down" — the question the
    // panel label promises. Created-in-window would only count what
    // arrived this period, of which most are still Pending and the
    // panel would read 90% Pending / 10% other forever.
    db
      .select({ key: invoiceGroupsTable.outcome, count: count() })
      .from(invoiceGroupsTable)
      .where(groupResolvedInWindow)
      .groupBy(invoiceGroupsTable.outcome),
    // Prior-period recovered (invoice-grain) for "Net change vs prior".
    // Same resolution-window anchor as the current period so the two
    // bars are apples-to-apples.
    db
      .select({
        priorRecovered: sql<string>`COALESCE(SUM(CASE WHEN ${POSITIVE_OUTCOMES_INSIGHTS} AND ${wonInPriorSql}
          THEN COALESCE(${invoiceGroupsTable.approvedAmount}, 0) ELSE 0 END), 0)`,
      })
      .from(invoiceGroupsTable)
      .where(HIDE_TOUR_SAMPLE_GROUP),
    // Pipeline snapshot — currently open invoices grouped by macro
    // phase (pre-submit, in-flight, response-pending). `phase` collapses
    // MAS-required and awaiting-payout into response-pending so the
    // funnel reads as the operator-facing stages. On-hold is folded
    // into pre-submit since holds are pre-submission blockers from the
    // CFO's POV. The `closed` bucket is computed separately below from
    // window-scoped resolutions, NOT from this snapshot, so the funnel
    // reads "open now → closed in window" instead of "open + ancient
    // closed forever".
    db
      .select({
        phase: sql<string>`CASE
          WHEN ${invoiceGroupsTable.status} = 'On Hold' THEN 'pre-submit'
          WHEN ${invoiceGroupsTable.phase} IN ('triage','ready_to_submit') THEN 'pre-submit'
          WHEN ${invoiceGroupsTable.phase} = 'submitted' THEN 'in-flight'
          WHEN ${invoiceGroupsTable.phase} IN ('response_received','reviewed','awaiting_reattestation') THEN 'response-pending'
          WHEN ${invoiceGroupsTable.reattestCompletedAt} IS NOT NULL AND ${invoiceGroupsTable.phase} <> 'closed' THEN 'response-pending'
          ELSE 'pre-submit'
        END`,
        count: count(),
        totalAmount: sql<string>`COALESCE(SUM(COALESCE(${invoiceGroupsTable.totalAmount}, 0)), 0)`,
      })
      .from(invoiceGroupsTable)
      .where(and(HIDE_TOUR_SAMPLE_GROUP, openExposurePredicate!))
      .groupBy(sql`1`),
    // At-risk snapshot — invoice-grain Σ totalAmount for groups still
    // on the books with money in flight.
    db
      .select({
        atRisk: sql<string>`COALESCE(SUM(COALESCE(${invoiceGroupsTable.totalAmount}, 0)
          - COALESCE(${invoiceGroupsTable.approvedAmount}, 0)), 0)`,
        groupCount: count(),
      })
      .from(invoiceGroupsTable)
      .where(openExposurePredicate!),
    // Payor concentration at INVOICE grain. Pull one row per (invoice,
    // payor) and aggregate in JS so we get a clean win-rate alongside
    // the open at-risk $ — Drizzle's conditional sum syntax is friendlier
    // when split into per-row data we can roll up.
    db
      .select({
        payorEmail: invoiceGroupsTable.payorEmail,
        outcome: invoiceGroupsTable.outcome,
        totalAmount: invoiceGroupsTable.totalAmount,
        approvedAmount: invoiceGroupsTable.approvedAmount,
        status: invoiceGroupsTable.status,
        phase: invoiceGroupsTable.phase,
        phaseEnteredAt: invoiceGroupsTable.phaseEnteredAt,
        reattestCompletedAt: invoiceGroupsTable.reattestCompletedAt,
        serviceDate: invoiceGroupsTable.serviceDate,
        createdAt: invoiceGroupsTable.createdAt,
        hasPendingAttest: sql<boolean>`EXISTS (
          SELECT 1 FROM ${claimsTable}
          WHERE ${claimsTable.invoiceGroupId} = ${invoiceGroupsTable.id}
            AND ${claimsTable.attestationState} IN ('pending','queued')
        )`,
      })
      .from(invoiceGroupsTable)
      .where(HIDE_TOUR_SAMPLE_GROUP),
    // Closed-in-window: count + Σ totalAmount of invoice groups that
    // entered phase=closed inside the selected window. Anchored on
    // `phaseEnteredAt` so it includes EVERY closure path (resolved,
    // denied, withdrawn, expired, non-issue, no-action-needed) — the
    // earlier audit-log filter only captured `group_resolved` /
    // `group_denied`, which silently dropped withdrawn/expired
    // closures. Backs the "Closed in window" stat surfaced beside
    // the pipeline snapshot.
    db
      .select({
        count: sql<number>`COUNT(*)::int`,
        amount: sql<string>`COALESCE(SUM(COALESCE(${invoiceGroupsTable.totalAmount}, 0)), 0)`,
      })
      .from(invoiceGroupsTable)
      .where(groupResolvedInWindow),
  ]);

  // Roll the claim_outcome enum into display buckets. Task #712 split
  // the legacy "Mixed" pseudo-bucket: Pending and Non-Issue are first-
  // class (Pending = in flight; Non-Issue = closed without dispute).
  // Task #714 added "No Action Needed" as its own terminal bucket.
  const GROUP_OUTCOME_BUCKETS = ["Approved", "Partially Approved", "Denied", "Withdrawn", "Pending", "Non-Issue", "No Action Needed"] as const;
  const groupOutcomeCounts: Record<typeof GROUP_OUTCOME_BUCKETS[number], number> = {
    "Approved": 0,
    "Partially Approved": 0,
    "Denied": 0,
    "Withdrawn": 0,
    "Pending": 0,
    "Non-Issue": 0,
    "No Action Needed": 0,
  };
  for (const r of groupOutcomeRows) {
    const key = r.key;
    if (
      key === "Approved" || key === "Partially Approved" || key === "Denied"
      || key === "Withdrawn" || key === "Pending" || key === "Non-Issue"
      || key === "No Action Needed"
    ) {
      groupOutcomeCounts[key] += r.count;
    }
  }

  const moneyOrNull = (raw: string) =>
    showAmounts ? parseFloat(raw || "0").toFixed(2) : null;

  // Roll the pipeline rows into the four display phases. The DB query
  // already collapses statuses, but we materialise the full set here so
  // the API contract always emits exactly four entries in a known order.
  const PIPELINE_PHASES = ["pre-submit", "in-flight", "response-pending", "closed"] as const;
  const pipelineCounts: Record<typeof PIPELINE_PHASES[number], { count: number; openAmount: number }> = {
    "pre-submit": { count: 0, openAmount: 0 },
    "in-flight": { count: 0, openAmount: 0 },
    "response-pending": { count: 0, openAmount: 0 },
    "closed": { count: 0, openAmount: 0 },
  };
  for (const r of pipelineRows) {
    const k = r.phase as typeof PIPELINE_PHASES[number];
    if (k in pipelineCounts && k !== "closed") {
      pipelineCounts[k].count += Number(r.count);
      pipelineCounts[k].openAmount += parseFloat(r.totalAmount || "0");
    }
  }
  // Closed bucket is window-scoped (resolutions inside the selected
  // range), not a snapshot — see closedInWindowRow query above.
  pipelineCounts["closed"].count = Number(closedInWindowRow?.count ?? 0);
  pipelineCounts["closed"].openAmount = parseFloat(closedInWindowRow?.amount ?? "0");

  // Payor concentration — at INVOICE grain. We compute open at-risk $
  // per payor (currently open, exposure predicate matches the snapshot
  // tile) plus a window-scoped win-rate over invoices created in the
  // window.
  const todayDate = new Date();
  const concentrationByPayor = new Map<string, {
    payorEmail: string;
    openCount: number;
    openAtRiskAmount: number;
    wonInWindow: number;
    lostInWindow: number;
    invoiceCountInWindow: number;
  }>();
  for (const row of payorConcentrationRows) {
    const email = row.payorEmail ?? "Unassigned";
    let bucket = concentrationByPayor.get(email);
    if (!bucket) {
      bucket = { payorEmail: email, openCount: 0, openAtRiskAmount: 0, wonInWindow: 0, lostInWindow: 0, invoiceCountInWindow: 0 };
      concentrationByPayor.set(email, bucket);
    }
    // Open / at-risk: matches openExposurePredicate. Replicated in JS
    // because we needed full per-row data for the win-rate calc and
    // re-querying just for sums would double the round-trips.
    const isOutcomeOpen = row.outcome !== "Withdrawn" && row.outcome !== "Non-Issue";
    let isDeadlineMissed = false;
    if (row.serviceDate && row.status === "On Hold") {
      const sd = new Date(row.serviceDate as unknown as string);
      const deadline = new Date(sd.getTime() + 30 * 86400000);
      const dow = deadline.getUTCDay();
      if (dow === 6) deadline.setUTCDate(deadline.getUTCDate() - 1);
      else if (dow === 0) deadline.setUTCDate(deadline.getUTCDate() - 2);
      isDeadlineMissed = deadline < todayDate;
    }
    if (row.status === "Expired") isDeadlineMissed = true;
    const isOpenPhase = row.phase !== "closed" || row.hasPendingAttest === true;
    if (isOutcomeOpen && !isDeadlineMissed && isOpenPhase) {
      bucket.openCount += 1;
      const total = parseFloat((row.totalAmount as unknown as string) || "0");
      const approved = parseFloat((row.approvedAmount as unknown as string) || "0");
      bucket.openAtRiskAmount += Math.max(0, total - approved);
    }
    // Win-rate: scoped to invoices RESOLVED in the window (phase=closed
    // AND phaseEnteredAt in window). Created-in-window would only count
    // freshly-arrived invoices — most are still Pending so the rate
    // would be near zero by construction. Resolved-in-window counts
    // the actual decisions the payor handed back this period, which
    // is what "win rate this period" means.
    if (
      row.phase === "closed"
      && row.phaseEnteredAt != null
      && new Date(row.phaseEnteredAt as unknown as string) >= start
    ) {
      bucket.invoiceCountInWindow += 1;
      if (row.outcome === "Approved" || row.outcome === "Partially Approved") bucket.wonInWindow += 1;
      else if (row.outcome === "Denied") bucket.lostInWindow += 1;
    }
  }
  const payorConcentrationByGroup = Array.from(concentrationByPayor.values())
    .filter(b => b.openCount > 0 || b.invoiceCountInWindow > 0)
    .sort((a, b) => b.openAtRiskAmount - a.openAtRiskAmount)
    .slice(0, 5)
    .map(b => {
      const decided = b.wonInWindow + b.lostInWindow;
      return {
        payorEmail: b.payorEmail,
        openCount: b.openCount,
        invoiceCountInWindow: b.invoiceCountInWindow,
        openAtRiskAmount: showAmounts ? b.openAtRiskAmount.toFixed(2) : null,
        winRate: decided > 0 ? Number((b.wonInWindow / decided).toFixed(4)) : null,
      };
    });

  res.json({
    days,
    totalClaims: Number(totalsRow?.totalClaims ?? 0),
    totalClaimedAmount: moneyOrNull(invoiceMoneyRow?.totalClaimedAmount ?? "0"),
    totalRecoveredAmount: moneyOrNull(invoiceMoneyRow?.totalRecoveredAmount ?? "0"),
    confirmedRecoveredAmount: moneyOrNull(invoiceMoneyRow?.confirmedRecoveredAmount ?? "0"),
    totalDeniedAmount: moneyOrNull(deniedRow?.totalDeniedAmount ?? "0"),
    priorPeriodRecoveredAmount: moneyOrNull(priorRecoveredRow?.priorRecovered ?? "0"),
    closedInWindowCount: Number(invoiceMoneyRow?.closedInWindowCount ?? 0),
    closedInWindowAmount: moneyOrNull(invoiceMoneyRow?.closedInWindowAmount ?? "0"),
    atRiskAmount: moneyOrNull(atRiskRow?.atRisk ?? "0"),
    atRiskGroupCount: Number(atRiskRow?.groupCount ?? 0),
    pipelineByPhase: PIPELINE_PHASES.map(p => ({
      phase: p,
      count: pipelineCounts[p].count,
      openAmount: showAmounts ? pipelineCounts[p].openAmount.toFixed(2) : null,
    })),
    payorConcentrationByGroup,
    statusBreakdown: statusRows.map(r => ({ status: r.key, count: r.count })),
    outcomeBreakdown: outcomeRows.map(r => ({ outcome: r.key, count: r.count })),
    groupOutcomeBreakdown: GROUP_OUTCOME_BUCKETS.map(b => ({ outcome: b, count: groupOutcomeCounts[b] })),
    errorTypeBreakdown: errorTypeRows.map(r => ({
      // Match the page's "Unclassified" label so the frontend can
      // render this verbatim instead of normalizing each row again.
      name: r.key ?? "Unclassified",
      count: r.count,
      recoveredAmount: moneyOrNull(r.recovered),
      deniedAmount: moneyOrNull(r.denied),
    })),
    payorBreakdown: payorRows.map(r => ({
      payorEmail: r.key ?? "Unassigned",
      count: r.count,
      atRiskAmount: moneyOrNull(r.atRisk),
    })),
  });
}));

// ─────────────────────────────────────────────────────────────────────
// /dashboard/time-in-phase  (Task #563)
//
// Time-in-phase histogram for the Insights page. Sourced from the
// `audit_logs` `group_status_changed` history rather than an
// in-memory snapshot of `phase_entered_at` so the rollup includes
// finished transitions across the whole window — every status change
// inside the window contributes one duration sample equal to the time
// spent in the *previous* status, computed via `LAG()` over the
// per-group transition stream.
//
// Each (group, transition) sample is mapped to a `MacroPhase` via the
// canonical `getMacroPhase()` table. For each macro phase we return:
//   • count   — number of completed transitions out of that phase
//   • medianMs / p90Ms — distribution of durations spent in the phase
//   • overdueCount — for `mas-action-required` only, how many of those
//                    sat in the phase longer than the 7-day SLA.
//
// The top-p90 macro phase (count >= 3, ignoring `closed` and
// `on-hold`) is also returned as `bottleneck` so the page can render
// the "biggest hold-up last 30d" row card without a follow-up call.
// ─────────────────────────────────────────────────────────────────────
const MAS_ACTION_OVERDUE_MS = 7 * 24 * 60 * 60 * 1000;

interface TimeInPhaseRow {
  phase: MacroPhase;
  count: number;
  medianMs: number;
  p90Ms: number;
  overdueCount?: number;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

router.get("/dashboard/time-in-phase", asyncHandler(async (req, res): Promise<void> => {
  const days = parseDays(req.query.days, 30);
  const start = startOfWindow(days);

  // Compute per-group transition durations via a window LAG over the
  // *full* per-group history — the prior transition can predate `start`
  // by an arbitrary amount, and a fixed back-history window would
  // silently drop those long-tail samples (exactly the ones a "biggest
  // hold-up" report needs to surface). The CTE filter restricts the
  // expensive scan to the set of groups that actually moved in the
  // window AND aren't tour-sample noise — same exclusion every other
  // aggregate in this file uses (`HIDE_TOUR_SAMPLE_GROUP`).
  const rows = await db.execute<{
    invoice_group_id: number;
    timestamp: Date;
    prev_ts: Date | null;
    prev_to: string | null;
  }>(sql`
    WITH in_window_groups AS (
      SELECT DISTINCT al.invoice_group_id
      FROM audit_logs al
      JOIN invoice_groups ig ON ig.id = al.invoice_group_id
      WHERE al.action = 'group_status_changed'
        AND al.timestamp >= ${start}
        AND ig.is_tour_sample = false
        AND al.invoice_group_id IS NOT NULL
    ),
    ordered AS (
      SELECT
        al.invoice_group_id,
        al.timestamp,
        LAG(al.timestamp) OVER w AS prev_ts,
        LAG(al.metadata ->> 'to') OVER w AS prev_to
      FROM audit_logs al
      WHERE al.action = 'group_status_changed'
        AND al.invoice_group_id IN (SELECT invoice_group_id FROM in_window_groups)
      WINDOW w AS (PARTITION BY al.invoice_group_id ORDER BY al.timestamp)
    )
    SELECT invoice_group_id, timestamp, prev_ts, prev_to
    FROM ordered
    WHERE timestamp >= ${start}
      AND prev_ts IS NOT NULL
      AND prev_to IS NOT NULL
    ORDER BY invoice_group_id, timestamp
  `);

  // Each in-window row carries its own baseline (`prev_ts` / `prev_to`)
  // computed over the full per-group history — no JS-side LAG needed.
  // The duration we attribute is the time the group spent in
  // `prev_to` before this row's transition moved it out.
  const samplesByPhase = new Map<MacroPhase, number[]>();
  // drizzle's db.execute returns `{ rows: [...] }` for raw SQL.
  const rowList: ReadonlyArray<{
    invoice_group_id: number;
    timestamp: Date | string;
    prev_ts: Date | string | null;
    prev_to: string | null;
  }> = (rows as unknown as { rows: typeof rowList }).rows ?? (rows as unknown as typeof rowList);

  for (const row of rowList) {
    const prevTo = row.prev_to;
    const prevTs = row.prev_ts;
    if (prevTo == null || prevTs == null) continue;
    const tsMs = (row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp)).getTime();
    const prevMs = (prevTs instanceof Date ? prevTs : new Date(prevTs)).getTime();
    const durMs = tsMs - prevMs;
    if (!Number.isFinite(durMs) || durMs <= 0) continue;
    const phase = getMacroPhase(prevTo);
    let arr = samplesByPhase.get(phase);
    if (!arr) {
      arr = [];
      samplesByPhase.set(phase, arr);
    }
    arr.push(durMs);
  }

  const phases: TimeInPhaseRow[] = [];
  for (const [phase, samples] of samplesByPhase.entries()) {
    samples.sort((a, b) => a - b);
    const row: TimeInPhaseRow = {
      phase,
      count: samples.length,
      medianMs: Math.round(quantile(samples, 0.5)),
      p90Ms: Math.round(quantile(samples, 0.9)),
    };
    if (phase === "mas-action-required") {
      row.overdueCount = samples.filter(ms => ms > MAS_ACTION_OVERDUE_MS).length;
    }
    phases.push(row);
  }

  // Stable phase ordering matches the lifecycle the operator reads top
  // to bottom on the Group Detail header.
  const ORDER: MacroPhase[] = [
    "pre-submit",
    "in-flight",
    "response-pending",
    "mas-action-required",
    "awaiting-payout",
    "on-hold",
    "closed",
  ];
  phases.sort((a, b) => ORDER.indexOf(a.phase) - ORDER.indexOf(b.phase));

  // Bottleneck = top non-terminal phase by p90, requiring >= 3 samples
  // so a single freak value can't crown a winner. `closed`/`on-hold`
  // aren't actionable bottlenecks.
  const bottleneckCandidates = phases.filter(
    p => p.count >= 3 && p.phase !== "closed" && p.phase !== "on-hold",
  );
  bottleneckCandidates.sort((a, b) => b.p90Ms - a.p90Ms);
  const bottleneck = bottleneckCandidates[0] ?? null;

  res.json({
    days,
    phases,
    bottleneck,
  });
}));

// Office wall-clock fallback. The streak pip is anchored to the user's
// local timezone (taken from the client query param), but if the client
// sends nothing — or sends garbage we can't validate — we fall back to
// the operations team's office tz so the count is never empty by accident.
const PIP_DEFAULT_TZ = "America/New_York";

function isValidIanaTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function dayKeyInTz(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// Streak pip on the user avatar (Task #317; broadened in Task #522).
// Returns the count of qualifying personal-activity beats the calling
// user has logged since the start of "today" in their local timezone.
//
// The qualifying-activity set is the shared
// `qualifyingActivityPredicate()` defined in `lib/qualifying-activity.ts`
// — same predicate used by `/dashboard/my-activity-summary`, so the
// pip's "today" count and the avatar hover-card stats always agree.
// The set was originally just "queued for portal" (Task #317) but is
// now broader: claim/group closures, manual leg exclusions, attest
// queue+confirm, manual portal submits, closure-review acks, MAS
// re-attest (including offline), and invoice imports all count. See
// the predicate module for the canonical list.
//
// Never exposes anything about other users — the actor filter is
// pinned to `req.user.email`.
router.get("/dashboard/my-processed-today", asyncHandler(async (req, res): Promise<void> => {
  const userEmail = req.user?.email;
  if (!userEmail) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const rawTz = typeof req.query.tz === "string" ? req.query.tz : "";
  const tz = rawTz && isValidIanaTz(rawTz) ? rawTz : PIP_DEFAULT_TZ;
  const now = new Date();
  const dayKey = dayKeyInTz(now, tz);

  // Compare the audit-log timestamp's calendar date *in the user's tz*
  // against the resolved dayKey. Postgres's `timestamptz AT TIME ZONE`
  // returns a wall-clock timestamp in that zone; casting to `date`
  // strips the time, giving us the local YYYY-MM-DD. This avoids any
  // off-by-one from doing the math in JS and round-tripping bounds.
  const [{ value } = { value: 0 }] = await db
    .select({ value: count() })
    .from(auditLogsTable)
    .where(and(
      eq(auditLogsTable.userEmail, userEmail),
      qualifyingActivityPredicate(),
      sql`(${auditLogsTable.timestamp} AT TIME ZONE ${tz})::date = ${dayKey}::date`,
    ));

  res.json({ count: Number(value) || 0, timezone: tz, dayKey });
}));

// ────────────────────────────────────────────────────────────────────
// Avatar hover-card activity summary (Task #522).
//
// Single endpoint backing the hover card on the sidebar avatar and
// the header session-pace badge. Returns four headline stats (today,
// this week Mon→today, this month, working-day streak) plus a
// per-day count series for the trailing 12 weeks (84 days) so the
// front-end can render a GitHub-style heatmap. Auth-pinned to the
// caller; mirrors `/dashboard/my-processed-today`'s timezone +
// `dayKey` handling so the "today" stat and the pip ring can never
// disagree.
//
// Streak rule: working days only (Mon–Fri). Weekend days are
// skipped — neither continue nor break the streak. We walk backwards
// from today (or, if today is a weekend, from the most recent
// Friday); a working day with ≥1 qualifying action continues the
// streak, a working day with 0 actions ends it. Today itself counts
// only if it has activity (zero-today does not break the prior run,
// it just doesn't add to it).
// ────────────────────────────────────────────────────────────────────
const ACTIVITY_HEATMAP_DAYS = 84;

function ymdMinusDays(dayKey: string, daysBack: number): string {
  // dayKey is `YYYY-MM-DD` — anchor at noon UTC so the subtraction
  // never crosses a DST boundary on the wrong side.
  const [y, m, d] = dayKey.split("-").map(s => parseInt(s, 10));
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() - daysBack);
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(base.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// 0 = Sun, 1 = Mon, … 6 = Sat. Computed on the YMD itself (no
// timezone math needed — a calendar date has a fixed weekday).
function dowOfYmd(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(s => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isWorkingDayYmd(dayKey: string): boolean {
  const dow = dowOfYmd(dayKey);
  return dow >= 1 && dow <= 5;
}

function computeStreak(activeDays: Set<string>, todayKey: string): number {
  // Walk backwards over working days only. If today is a weekend,
  // start at the most recent Friday. Today counts only if it has
  // activity; otherwise the walk skips it without breaking the run.
  // `activeDays` is the set of YYYY-MM-DD keys (in user-tz) that
  // have at least one qualifying audit row — populated from a
  // dedicated wide-window query so the streak is correct beyond the
  // 84-day heatmap window.
  let cursor = todayKey;
  while (!isWorkingDayYmd(cursor)) cursor = ymdMinusDays(cursor, 1);

  let streak = 0;
  // Special-case the first working-day cell (today, if today is a
  // weekday): an empty cell does NOT break — it just doesn't extend
  // the prior run. Skip past it to the previous working day and
  // continue the strict rule from there.
  if (activeDays.has(cursor)) {
    streak += 1;
    cursor = ymdMinusDays(cursor, 1);
    while (!isWorkingDayYmd(cursor)) cursor = ymdMinusDays(cursor, 1);
  } else if (cursor === todayKey) {
    cursor = ymdMinusDays(cursor, 1);
    while (!isWorkingDayYmd(cursor)) cursor = ymdMinusDays(cursor, 1);
  }

  // Bound the back-scan at the size of the active-day set: the
  // streak cannot extend further back than the oldest qualifying
  // day on file, and the dedicated query already caps the lookback
  // at `STREAK_LOOKBACK_DAYS` so this loop is finite by construction.
  // The 1.5x safety multiplier accounts for weekend skips inside the
  // walk without ever degrading to an unbounded loop.
  const maxIters = Math.max(activeDays.size, 1) * 3;
  for (let i = 0; i < maxIters; i++) {
    if (!isWorkingDayYmd(cursor)) {
      cursor = ymdMinusDays(cursor, 1);
      continue;
    }
    if (activeDays.has(cursor)) {
      streak += 1;
      cursor = ymdMinusDays(cursor, 1);
    } else {
      break;
    }
  }
  return streak;
}

// Wider lookback window for the streak query specifically — the
// 84-day heatmap window is for visual rendering, but a streak of
// "I worked every weekday this year" must be representable. One
// year of working days (~261) comfortably exceeds any realistic
// uninterrupted streak; the query is index-backed by
// `(user_email, timestamp)` so the wider scan is cheap.
const STREAK_LOOKBACK_DAYS = 366;

// Returns `YYYY-MM-DD` for the most recent Monday on or before
// `dayKey`. Used for the "this week" stat (Mon→today inclusive).
function startOfWeekMon(dayKey: string): string {
  const dow = dowOfYmd(dayKey);
  // dow: 0=Sun, 1=Mon, …; backstep to Mon. Sunday → 6 days back.
  const back = dow === 0 ? 6 : dow - 1;
  return ymdMinusDays(dayKey, back);
}

function startOfMonth(dayKey: string): string {
  const [y, m] = dayKey.split("-");
  return `${y}-${m}-01`;
}

router.get("/dashboard/my-activity-summary", asyncHandler(async (req, res): Promise<void> => {
  const userEmail = req.user?.email;
  if (!userEmail) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const rawTz = typeof req.query.tz === "string" ? req.query.tz : "";
  const tz = rawTz && isValidIanaTz(rawTz) ? rawTz : PIP_DEFAULT_TZ;
  const now = new Date();
  const todayKey = dayKeyInTz(now, tz);
  const startKey = ymdMinusDays(todayKey, ACTIVITY_HEATMAP_DAYS - 1);

  // Inline the (already-validated) tz as a SQL string literal so the
  // bucket expression is *byte-identical* across SELECT, WHERE, and
  // GROUP BY. Postgres compares SELECT/GROUP BY expressions by
  // structural identity — interpolating `tz` via four separate
  // `sql\`...${tz}...\`` templates binds it as four distinct
  // parameters (`$1`, `$3`, ...) and the planner then sees them as
  // *different* expressions, raising "must appear in the GROUP BY
  // clause". `isValidIanaTz` guarantees no quote characters, so this
  // is not an injection surface.
  const tzLiteral = sql.raw(`'${tz}'`);
  const dayBucket = sql`(${auditLogsTable.timestamp} AT TIME ZONE ${tzLiteral})::date`;

  // One grouped scan returns the per-day counts. Bucketing by the
  // user-tz date stays consistent with `/my-processed-today`. The
  // range bound is inclusive on both ends and clamps the scan so the
  // composite `(user_email, timestamp)` index can be used.
  const rows = await db
    .select({
      day: sql<string>`to_char(${dayBucket}, 'YYYY-MM-DD')`,
      value: count(),
    })
    .from(auditLogsTable)
    .where(and(
      eq(auditLogsTable.userEmail, userEmail),
      qualifyingActivityPredicate(),
      sql`${dayBucket} >= ${startKey}::date`,
      sql`${dayBucket} <= ${todayKey}::date`,
    ))
    .groupBy(dayBucket);

  const countsByDay = new Map<string, number>();
  for (const r of rows) countsByDay.set(r.day, Number(r.value) || 0);

  // Densify — every day in the window is present with `count: 0` so
  // the heatmap renders all cells without front-end gap-filling.
  const dailyCounts: Array<{ date: string; count: number }> = [];
  for (let i = ACTIVITY_HEATMAP_DAYS - 1; i >= 0; i--) {
    const d = ymdMinusDays(todayKey, i);
    dailyCounts.push({ date: d, count: countsByDay.get(d) ?? 0 });
  }

  // Aggregate stats over the same source.
  const today = countsByDay.get(todayKey) ?? 0;
  const weekStart = startOfWeekMon(todayKey);
  const monthStart = startOfMonth(todayKey);
  let thisWeek = 0;
  let thisMonth = 0;
  for (const { date, count: c } of dailyCounts) {
    if (date >= weekStart && date <= todayKey) thisWeek += c;
    if (date >= monthStart && date <= todayKey) thisMonth += c;
  }

  // Note: `thisMonth` is bounded by the 84-day window — when the
  // current month started more than 84 days ago (impossible in
  // practice; max month length is 31), the count would under-report.
  // That's fine for our window. If we ever shrink the window we'd
  // need a separate query for `thisMonth`.

  // Dedicated wider-window scan for the streak. Returns just the
  // distinct YYYY-MM-DD keys (in user-tz) that have at least one
  // qualifying audit row, so a year-long streak isn't truncated by
  // the 84-day heatmap window. Index-backed by
  // `(user_email, timestamp)`; the projection is a single scalar
  // expression so the planner can stream straight into a sort+unique.
  const streakStartKey = ymdMinusDays(todayKey, STREAK_LOOKBACK_DAYS - 1);
  const streakRows = await db
    .selectDistinct({
      day: sql<string>`to_char((${auditLogsTable.timestamp} AT TIME ZONE ${tz})::date, 'YYYY-MM-DD')`,
    })
    .from(auditLogsTable)
    .where(and(
      eq(auditLogsTable.userEmail, userEmail),
      qualifyingActivityPredicate(),
      sql`(${auditLogsTable.timestamp} AT TIME ZONE ${tz})::date >= ${streakStartKey}::date`,
      sql`(${auditLogsTable.timestamp} AT TIME ZONE ${tz})::date <= ${todayKey}::date`,
    ));
  const activeDays = new Set<string>();
  for (const r of streakRows) activeDays.add(r.day);
  const streak = computeStreak(activeDays, todayKey);

  res.json({
    timezone: tz,
    dayKey: todayKey,
    today,
    thisWeek,
    thisMonth,
    streak,
    dailyCounts,
  });
}));

export function parseLimit(raw: unknown, fallback: number, max = 50): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export type RepeatOffenderTrend = "up" | "down" | "flat";

export function trendFromCounts(current: number, previous: number): RepeatOffenderTrend {
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

export type RepeatOffenderAggRow = {
  key: string;
  // Raw count of rejected claims for this driver/member in the window. EVERY
  // imported claim represents a payor rejection (this is a claims-DISPUTE
  // tool — claims only land here because the payor rejected them); we count
  // them all except outcome=Non-Issue (which means "actually wasn't a
  // rejection" and should not appear in repeat-offender stats). This means
  // freshly-imported Pending claims show up here, not just downstream
  // Denied resolutions.
  rejectionCount: number;
  atRiskAmount: number;         // Sum of claimAmount across all rejection rows.
  approvedCount: number;        // For winRate — counts Approved + Partially Approved.
  deniedCount: number;          // For winRate — counts outcome=Denied only.
  lastRejectionDate: string | null;     // Max date across all rejection rows.
  errorTypeCounts: Map<string, number>; // Tally across all rejection rows.
  mostRecentInvoice: { date: string | null; invoiceNumber: string | null };
};

export type RepeatOffenderGroupingKey = "carNumber" | "clientNumber";

export type RepeatOffenderInputRow = {
  key: string | null;
  claimAmount: string | null;
  outcome: string;
  date: string | null;
  errorTypeName: string | null;
  invoiceNumber: string | null;
};

export function aggregateRepeatOffenders(rows: RepeatOffenderInputRow[]): Map<string, RepeatOffenderAggRow> {
  const map = new Map<string, RepeatOffenderAggRow>();
  for (const row of rows) {
    if (!row.key) continue;
    let agg = map.get(row.key);
    if (!agg) {
      agg = {
        key: row.key,
        rejectionCount: 0,
        atRiskAmount: 0,
        approvedCount: 0,
        deniedCount: 0,
        lastRejectionDate: null,
        errorTypeCounts: new Map(),
        mostRecentInvoice: { date: null, invoiceNumber: null },
      };
      map.set(row.key, agg);
    }
    const isDenied = row.outcome === "Denied";
    const isApproved = row.outcome === "Approved" || row.outcome === "Partially Approved";
    // Task #714 — "No Action Needed" is the system-asserted Non-Issue
    // variant (auto-cascade on all-legs-non_issue groups). Both values
    // are the "actually wasn't a rejection" escape hatch and must
    // suppress the row from repeat-offender rollups together.
    const isNonIssue = row.outcome === "Non-Issue" || row.outcome === "No Action Needed";
    if (isApproved) agg.approvedCount += 1;
    if (isDenied) agg.deniedCount += 1;
    // Repeat-offender stats roll up EVERY claim a driver/member appears on
    // (except outcome=Non-Issue, which is the explicit "actually wasn't a
    // rejection" escape hatch). Counting only outcome=Denied would ignore
    // freshly-imported (Pending) claims and Withdrawn losses — but the
    // operator needs the full picture of how often this driver/member
    // generates rejected claims, not just resolved denials.
    if (!isNonIssue) {
      agg.rejectionCount += 1;
      const amt = parseFloat(row.claimAmount || "0");
      if (Number.isFinite(amt)) agg.atRiskAmount += amt;
      if (row.date && (!agg.lastRejectionDate || row.date > agg.lastRejectionDate)) {
        agg.lastRejectionDate = row.date;
      }
      if (row.errorTypeName) {
        agg.errorTypeCounts.set(row.errorTypeName, (agg.errorTypeCounts.get(row.errorTypeName) ?? 0) + 1);
      }
    }
    // Track most-recent invoice across ALL claims for this key (used as
    // "last invoice / driver descriptor"), not just Denied ones.
    if (
      row.date &&
      row.invoiceNumber &&
      (!agg.mostRecentInvoice.date || row.date >= agg.mostRecentInvoice.date)
    ) {
      agg.mostRecentInvoice = { date: row.date, invoiceNumber: row.invoiceNumber };
    }
  }
  return map;
}

export function topErrorType(counts: Map<string, number>): string | null {
  let best: { name: string; count: number } | null = null;
  for (const [name, count] of counts) {
    if (!best || count > best.count) best = { name, count };
  }
  return best?.name ?? null;
}

export type RepeatOffenderShapedRow = {
  rejectionCount: number;
  previousRejectionCount: number;
  atRiskAmount: string;
  topErrorTypeName: string | null;
  winRate: number | null;
  trend: RepeatOffenderTrend;
  lastRejectionDate: string | null;
  carNumber?: string;
  lastInvoiceNumber?: string | null;
  clientNumber?: string;
};

export function shapeRepeatOffenders(
  map: Map<string, RepeatOffenderAggRow>,
  priorMap: Map<string, RepeatOffenderAggRow>,
  keyName: RepeatOffenderGroupingKey,
  limit: number,
): RepeatOffenderShapedRow[] {
  const list = Array.from(map.values())
    .sort((a, b) => b.rejectionCount - a.rejectionCount || b.atRiskAmount - a.atRiskAmount)
    .slice(0, limit);
  return list.map(agg => {
    const priorCount = priorMap.get(agg.key)?.rejectionCount ?? 0;
    const resolved = agg.approvedCount + agg.deniedCount;
    const winRate = resolved > 0 ? Number((agg.approvedCount / resolved).toFixed(4)) : null;
    const base = {
      rejectionCount: agg.rejectionCount,
      previousRejectionCount: priorCount,
      atRiskAmount: agg.atRiskAmount.toFixed(2),
      topErrorTypeName: topErrorType(agg.errorTypeCounts),
      winRate,
      trend: trendFromCounts(agg.rejectionCount, priorCount),
      lastRejectionDate: agg.lastRejectionDate,
    };
    if (keyName === "carNumber") {
      return {
        ...base,
        carNumber: agg.key,
        lastInvoiceNumber: agg.mostRecentInvoice.invoiceNumber,
      };
    }
    return {
      ...base,
      clientNumber: agg.key,
    };
  });
}

router.get("/dashboard/repeat-offenders", asyncHandler(async (req, res): Promise<void> => {
  const days = parseDays(req.query.days, 30);
  const limit = parseLimit(req.query.limit, 10);
  const start = startOfWindow(days);
  const priorStart = new Date(start);
  priorStart.setUTCDate(priorStart.getUTCDate() - days);

  // Pull both periods in one query, partition by key.
  const allRows = await db
    .select({
      carNumber: claimsTable.carNumber,
      clientNumber: claimsTable.clientNumber,
      claimAmount: claimsTable.claimAmount,
      outcome: claimsTable.outcome,
      date: claimsTable.date,
      errorTypeName: claimsTable.errorTypeName,
      createdAt: claimsTable.createdAt,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
    })
    .from(claimsTable)
    .leftJoin(invoiceGroupsTable, eq(claimsTable.invoiceGroupId, invoiceGroupsTable.id))
    .where(gte(claimsTable.createdAt, priorStart));

  const currentDriverRows: RepeatOffenderInputRow[] = [];
  const priorDriverRows: RepeatOffenderInputRow[] = [];
  const currentMemberRows: RepeatOffenderInputRow[] = [];
  const priorMemberRows: RepeatOffenderInputRow[] = [];

  for (const r of allRows) {
    const inCurrent = r.createdAt && r.createdAt >= start;
    const driverPayload: RepeatOffenderInputRow = {
      key: r.carNumber,
      claimAmount: r.claimAmount,
      outcome: r.outcome,
      date: r.date,
      errorTypeName: r.errorTypeName,
      invoiceNumber: r.invoiceNumber,
    };
    const memberPayload: RepeatOffenderInputRow = { ...driverPayload, key: r.clientNumber };
    if (inCurrent) {
      currentDriverRows.push(driverPayload);
      currentMemberRows.push(memberPayload);
    } else {
      priorDriverRows.push(driverPayload);
      priorMemberRows.push(memberPayload);
    }
  }

  const currentDrivers = aggregateRepeatOffenders(currentDriverRows);
  const priorDrivers = aggregateRepeatOffenders(priorDriverRows);
  const currentMembers = aggregateRepeatOffenders(currentMemberRows);
  const priorMembers = aggregateRepeatOffenders(priorMemberRows);

  // Money scrub: clerks never see atRiskAmount on driver/member rows.
  // The repeat-offender stats remain visible (rejection count, win rate,
  // trend) — only the dollar exposure is hidden.
  const drivers = shapeRepeatOffenders(currentDrivers, priorDrivers, "carNumber", limit);
  const members = shapeRepeatOffenders(currentMembers, priorMembers, "clientNumber", limit);
  const moneyHidden = !canSeeAmounts(req.user);
  const stripAtRisk = <T extends { atRiskAmount: string }>(row: T) =>
    moneyHidden ? { ...row, atRiskAmount: null as unknown as string } : row;

  res.json({
    days,
    previousPeriodDays: days,
    drivers: drivers.map(stripAtRisk),
    members: members.map(stripAtRisk),
    driverGroupsTotal: currentDrivers.size,
    memberGroupsTotal: currentMembers.size,
  });
}));

// Actions we never want to surface in the dashboard activity feed because
// they're either too noisy or duplicate something else we already show.
const ACTIVITY_FEED_EXCLUDED_ACTIONS = [
  // Status sync rows are auto-generated alongside group_status_changed and
  // would otherwise drown out everything else.
  "status_changed",
  "outcome_changed",
  "status_and_outcome_changed",
  // Per-batch bot rows are extremely chatty and only meaningful in aggregate
  // (which is already on the System Health and Batches pages).
  "batch_claimed",
  "submission_complete",
  "dry_run_complete",
] as const;

router.get("/dashboard/activity", asyncHandler(async (req, res): Promise<void> => {
  const limit = parseLimit(req.query.limit, 15, 50);

  // Pull recent rows. We intentionally fetch a wider window than `limit` so
  // that filtering out child-claim sync rows still leaves us with a full feed.
  const fetchLimit = Math.max(limit * 4, 50);

  const rows = await db
    .select({
      id: auditLogsTable.id,
      action: auditLogsTable.action,
      details: auditLogsTable.details,
      metadata: auditLogsTable.metadata,
      userEmail: auditLogsTable.userEmail,
      userName: auditLogsTable.userName,
      timestamp: auditLogsTable.timestamp,
      claimId: auditLogsTable.claimId,
      invoiceGroupId: auditLogsTable.invoiceGroupId,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      claimConfNumber: claimsTable.confNumber,
    })
    .from(auditLogsTable)
    .leftJoin(invoiceGroupsTable, eq(auditLogsTable.invoiceGroupId, invoiceGroupsTable.id))
    .leftJoin(claimsTable, eq(auditLogsTable.claimId, claimsTable.id))
    .orderBy(desc(auditLogsTable.timestamp), desc(auditLogsTable.id))
    .limit(fetchLimit);

  const events = rows
    .filter((r) => !(ACTIVITY_FEED_EXCLUDED_ACTIONS as readonly string[]).includes(r.action))
    .slice(0, limit)
    .map((r) => humanizeAuditRow(r));

  res.json({ events });
}));

router.get("/dashboard/user-productivity", asyncHandler(async (req, res): Promise<void> => {
  const days = parseDays(req.query.days, 30);
  const start = startOfWindow(days);

  const ACTION_BUCKETS: Record<string, "triaged" | "resolved" | "denied" | "drafts" | "submissions"> = {
    group_triaged: "triaged",
    group_resolved: "resolved",
    group_denied: "denied",
    portal_draft_edited: "drafts",
    portal_draft_regenerated: "drafts",
    portal_submission_submitted: "submissions",
  };

  const rows = await db
    .select({
      userEmail: auditLogsTable.userEmail,
      userName: auditLogsTable.userName,
      action: auditLogsTable.action,
      count: count(),
    })
    .from(auditLogsTable)
    .where(and(
      gte(auditLogsTable.timestamp, start),
      isNotNull(auditLogsTable.userEmail),
      inArray(auditLogsTable.action, Object.keys(ACTION_BUCKETS)),
    ))
    .groupBy(auditLogsTable.userEmail, auditLogsTable.userName, auditLogsTable.action);

  const byUser = new Map<string, {
    userEmail: string;
    userName: string;
    triaged: number;
    resolved: number;
    denied: number;
    drafts: number;
    submissions: number;
    total: number;
  }>();

  for (const r of rows) {
    if (!r.userEmail) continue;
    const bucket = ACTION_BUCKETS[r.action];
    if (!bucket) continue;
    const key = r.userEmail;
    let agg = byUser.get(key);
    if (!agg) {
      agg = {
        userEmail: r.userEmail,
        userName: r.userName ?? "",
        triaged: 0, resolved: 0, denied: 0, drafts: 0, submissions: 0, total: 0,
      };
      byUser.set(key, agg);
    }
    agg[bucket] += r.count;
    agg.total += r.count;
    if (!agg.userName && r.userName) agg.userName = r.userName;
  }

  const users = Array.from(byUser.values()).sort((a, b) => b.total - a.total);

  res.json({ days, users });
}));

// ─────────────────────────────────────────────────────────────────────
// /dashboard/urgent-today/transitions
//
// Powers the "Why?" line and activity panel rendered next to the
// File-today hero on the Dashboard and the urgency hero on the Queue.
// Returns:
//   • currentlyUrgent: groups with an urgent (today-or-earlier) ET
//     deadline AND a status in the actionable set.
//   • clearedToday: rows in audit_logs from this ET day where a
//     `group_status_changed` moved a group OUT of the actionable set
//     (e.g. an operator filed it / packaged it). The point is to show
//     the team what already cleared today, so a low "File today" count
//     reads as "we did the work" rather than "we forgot".
//   • snapshots: the last 24 `dashboard_urgent_snapshot` rows from
//     state_events for the inline sparkline.
//   • todayKey: the ET day this response is anchored to (mirrors
//     `today` on /dashboard/summary; lets the rollover signal flip the
//     activity panel atomically too).
//
// See Task #298 for the design doc.
// ─────────────────────────────────────────────────────────────────────
router.get("/dashboard/urgent-today/transitions", asyncHandler(async (_req, res): Promise<void> => {
  const now = new Date();
  const todayKey = serverTodayKey(now);

  const snap = await computeUrgentSnapshot(now);

  // Hydrate the urgent-group rows with the columns the UI needs.
  // (computeUrgentSnapshot only returns IDs to keep the snapshot record
  // small.)
  const currentlyUrgentRows = snap.urgentGroupIds.length === 0
    ? []
    : await db
        .select({
          id: invoiceGroupsTable.id,
          invoiceNumber: invoiceGroupsTable.invoiceNumber,
          clientNumber: invoiceGroupsTable.clientNumber,
          status: invoiceGroupsTable.status,
          totalAmount: invoiceGroupsTable.totalAmount,
          // Direct read of the canonical service_date column (Task
          // #356). The IDs come from `computeUrgentSnapshot()` which
          // already filters on `isNotNull(serviceDate)`, so every row
          // here is guaranteed to have a non-null value — no JOIN, no
          // GROUP BY, no MIN().
          earliestDate: sql<string | null>`to_char(${invoiceGroupsTable.serviceDate}, 'YYYY-MM-DD')`,
        })
        .from(invoiceGroupsTable)
        .where(inArray(invoiceGroupsTable.id, snap.urgentGroupIds));

  // ET-anchored today window for audit_logs. We can't use a SQL
  // expression keyed on the host process's TZ (the db is UTC); convert
  // the ET day boundaries to UTC instants here and filter by them.
  // DST safety: dayEnd is the *next* ET midnight, NOT dayStart + 24h.
  // On spring-forward Sundays the ET day is 23h long; on fall-back it
  // is 25h. Computing both endpoints from `etMidnightUtcInstant`
  // delegates the offset math to Intl and keeps the window correct
  // across the boundary.
  const dayStartET = etMidnightUtcInstant(todayKey);
  const dayEndET = etMidnightUtcInstant(addDaysToYMD(todayKey, 1));

  // Pull every group_status_changed for the day, then filter in JS to
  // keep the SQL boring. Also include the parent group's earliest
  // claim date so the panel can render "(was urgent)" badges.
  const auditRows = await db
    .select({
      id: auditLogsTable.id,
      invoiceGroupId: auditLogsTable.invoiceGroupId,
      metadata: auditLogsTable.metadata,
      userName: auditLogsTable.userName,
      userEmail: auditLogsTable.userEmail,
      timestamp: auditLogsTable.timestamp,
    })
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.action, "group_status_changed"),
        gte(auditLogsTable.timestamp, dayStartET),
        lte(auditLogsTable.timestamp, dayEndET),
      ),
    )
    .orderBy(desc(auditLogsTable.timestamp));

  type ClearedRow = {
    id: number;
    invoiceGroupId: number | null;
    invoiceNumber: string | null;
    /** Payor identifier (invoice_groups.client_number). */
    clientNumber: string | null;
    actor: string | null;
    /** Where did the change come from: operator UI / bot / classifier? */
    source: string | null;
    /** Free-text reason recorded on the audit row (operator note, etc.). */
    reason: string | null;
    fromStatus: string | null;
    toStatus: string | null;
    timestamp: string;
    /** ET wall-clock formatting for the panel ("3:14 PM ET"). */
    timestampET: string;
  };

  const ACTIONABLE = new Set<string>(GROUP_EXPIRING_ACTIONABLE_STATUSES);
  const candidateRows: ClearedRow[] = [];
  for (const row of auditRows) {
    const meta = (row.metadata ?? {}) as {
      from?: string;
      to?: string;
      source?: string;
      reason?: string;
    };
    const fromStatus = meta.from ?? null;
    const toStatus = meta.to ?? null;
    // Only count transitions that LEFT the actionable set — those
    // genuinely cleared filing-clock work. (A New → Needs Evidence
    // move is a re-categorisation; the row is still on the clock.)
    if (!fromStatus || !toStatus) continue;
    if (!ACTIONABLE.has(fromStatus)) continue;
    if (ACTIONABLE.has(toStatus)) continue;
    candidateRows.push({
      id: row.id,
      invoiceGroupId: row.invoiceGroupId,
      invoiceNumber: null, // joined below
      clientNumber: null, // joined below
      actor: row.userName ?? row.userEmail ?? null,
      source: meta.source ?? null,
      reason: meta.reason ?? null,
      fromStatus,
      toStatus,
      timestamp: row.timestamp.toISOString(),
      timestampET: formatEtTimeOfDay(row.timestamp),
    });
  }

  // Join invoice_number, client_number (payor), and the earliest
  // service date for each parent group. The earliest service date
  // determines whether the group was actually urgent today (deadline
  // ≤ today ET) — without this guard, the panel would surface an
  // unrelated New→Closed transition as "cleared today" even though
  // the row was nowhere near the file-today clock.
  const groupMeta = new Map<number, { invoiceNumber: string | null; clientNumber: string | null; earliestDate: string | null }>();
  if (candidateRows.length > 0) {
    const ids = Array.from(new Set(candidateRows.map(r => r.invoiceGroupId).filter((x): x is number => x != null)));
    if (ids.length > 0) {
      const groups = await db
        .select({
          id: invoiceGroupsTable.id,
          invoiceNumber: invoiceGroupsTable.invoiceNumber,
          clientNumber: invoiceGroupsTable.clientNumber,
          // Same canonical service_date read as everywhere else
          // (Task #356) — `effectiveDaysRemaining` below decides
          // whether the parent group was urgent today, and it must
          // reach the same verdict the dashboard hero / queue did.
          earliestDate: sql<string | null>`to_char(${invoiceGroupsTable.serviceDate}, 'YYYY-MM-DD')`,
        })
        .from(invoiceGroupsTable)
        .where(inArray(invoiceGroupsTable.id, ids));
      for (const g of groups) {
        groupMeta.set(g.id, {
          invoiceNumber: g.invoiceNumber,
          clientNumber: g.clientNumber,
          earliestDate: g.earliestDate,
        });
      }
    }
  }

  // Final filter: only include rows whose group was urgent (by
  // deadline math) at some point today. We use the earliest service
  // date as the proxy — if `effectiveDaysRemaining(earliestDate, now) <= 0`
  // the group was on the file-today clock immediately before this row
  // moved it out of the actionable set.
  const clearedRowsRaw: ClearedRow[] = [];
  for (const c of candidateRows) {
    const meta = c.invoiceGroupId != null ? groupMeta.get(c.invoiceGroupId) : undefined;
    const earliestDate = meta?.earliestDate ?? null;
    const eff = effectiveDaysRemaining(earliestDate, now);
    if (eff == null || eff > 0) continue; // group wasn't urgent today, skip
    clearedRowsRaw.push({
      ...c,
      invoiceNumber: meta?.invoiceNumber ?? null,
      clientNumber: meta?.clientNumber ?? null,
    });
  }

  const byToStatus: Record<string, number> = {};
  const actorSet = new Set<string>();
  for (const r of clearedRowsRaw) {
    byToStatus[r.toStatus ?? "?"] = (byToStatus[r.toStatus ?? "?"] ?? 0) + 1;
    if (r.actor) actorSet.add(r.actor);
  }

  // Inline sparkline data — last 24 snapshots for the current ET day.
  // The cron records hourly during business hours; on a fresh deploy
  // the series may be empty and the UI will degrade gracefully.
  const snapshotRows = await db
    .select({
      createdAt: stateEventsTable.createdAt,
      metadata: stateEventsTable.metadata,
    })
    .from(stateEventsTable)
    .where(
      and(
        eq(stateEventsTable.eventKey, "dashboard_urgent_snapshot"),
        gte(stateEventsTable.createdAt, dayStartET),
        lte(stateEventsTable.createdAt, dayEndET),
      ),
    )
    .orderBy(stateEventsTable.createdAt);

  type SnapPoint = { at: string; urgentCount: number; totalActionable: number };
  const snapshots: SnapPoint[] = snapshotRows.map(r => {
    const meta = (r.metadata ?? {}) as { urgentCount?: number; totalActionable?: number };
    return {
      at: r.createdAt.toISOString(),
      urgentCount: typeof meta.urgentCount === "number" ? meta.urgentCount : 0,
      totalActionable: typeof meta.totalActionable === "number" ? meta.totalActionable : 0,
    };
  });

  // Today-was-urgent guard for the UI: the "Why?" line should
  // suppress itself entirely on calm days where nothing was ever
  // urgent. Compute the max urgentCount we saw today across the
  // snapshot series so the frontend can render nothing when both
  // urgentCount AND cleared AND maxUrgentToday are zero.
  const maxUrgentToday = Math.max(
    snap.urgentCount,
    clearedRowsRaw.length,
    ...snapshots.map(s => s.urgentCount),
  );
  const wasUrgentToday = maxUrgentToday > 0;

  res.json({
    today: todayKey,
    urgentCount: snap.urgentCount,
    totalActionable: snap.totalActionable,
    byStatus: snap.byStatus,
    /** True when the file-today queue was ≥1 at any point today (snapshot series, current count, or cleared rows). */
    wasUrgentToday,
    /** Highest urgent count we saw today, used for the "peaked at N" sentence in the panel. */
    maxUrgentToday,
    currentlyUrgent: currentlyUrgentRows.map(r => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      clientNumber: r.clientNumber,
      status: r.status,
      totalAmount: r.totalAmount,
      earliestDate: r.earliestDate,
    })),
    clearedToday: clearedRowsRaw.slice(0, 50),
    clearedSummary: {
      total: clearedRowsRaw.length,
      byToStatus,
      actors: Array.from(actorSet).sort(),
    },
    snapshots,
  });
}));

// "3:14 PM ET" — the wall-clock the operators read off the clock on
// the wall. Used in the cleared-today rows so the panel doesn't have
// to do its own client-side TZ math.
function formatEtTimeOfDay(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${fmt.format(d)} ET`;
}

// Convert a YYYY-MM-DD ET calendar key to the UTC `Date` representing
// midnight at the start of that ET day. Handles DST automatically by
// asking Intl what the UTC offset is at the requested instant.
export function etMidnightUtcInstant(ymd: string): Date {
  // Build the candidate UTC midnight for the date, then ask what the
  // ET offset is at that instant. Subtract that offset to land on the
  // true ET midnight. This is correct on both sides of DST because
  // `Intl.DateTimeFormat` reports the offset at the queried instant.
  const utcGuess = new Date(`${ymd}T00:00:00Z`);
  // Compute ET offset (in minutes) at the guess instant.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
    hour: "numeric",
  });
  const parts = fmt.formatToParts(utcGuess);
  const tzPart = parts.find(p => p.type === "timeZoneName")?.value ?? "GMT-5";
  // tzPart is like "GMT-5" or "GMT-4". Parse the hour offset.
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tzPart);
  const sign = m && m[1] === "-" ? -1 : 1;
  const hours = m ? parseInt(m[2], 10) : 5;
  const mins = m && m[3] ? parseInt(m[3], 10) : 0;
  const offsetMin = sign * (hours * 60 + mins);
  // ET midnight = UTC midnight - offset. (When ET is UTC-5, ET midnight
  // == UTC 05:00, so we add 5h.)
  return new Date(utcGuess.getTime() - offsetMin * 60 * 1000);
}

export default router;

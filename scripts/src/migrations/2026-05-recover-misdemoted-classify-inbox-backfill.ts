// One-shot recovery for Task #346: undo the wave of mis-demotions
// caused by an over-eager run of the Task #299 stuck-Needs-Review heal
// script on 2026-05-02 08:08 UTC. That run swept ~95 invoice groups
// out of `Needs Review` into `Awaiting Response` (87 of them) and into
// `Resolved` / Non-Issue (8 of them) even though none of their legs
// had ever been classified — every active leg still had
// `error_type_id IS NULL` and a blank `error_details`. Because the
// Classify section of the Queue page filters strictly by
// `status = 'Needs Review'`, those groups silently vanished from the
// dropdown and from operator visibility.
//
// The forward fix lives in
// `2026-05-heal-stuck-needs-review-inbox-backfill.ts`: a new guard
// teaches the heal script to skip any pre-classification group ahead
// of its existing reviewable-response check. This recovery script
// reverses the past damage so the affected groups show up in the
// Classify inbox again.
//
// What this script does
// ---------------------
//   1. Selects every invoice group currently in one of the
//      "mis-demoted-into" statuses:
//        - `Awaiting Response` (any outcome), OR
//        - `Resolved` with outcome `Non-Issue`.
//   2. For each candidate, confirms ALL of:
//        a) at least one active leg exists (`included_in_dispute=true`,
//           `duplicate_of_claim_id IS NULL`),
//        b) every active leg has `error_type_id IS NULL`,
//        c) every active leg has a null/blank `error_details`,
//        d) no reviewable portal_response is on file (`approval`,
//           `denial`, `partial_approval`, `info_request`, `other`)
//           linked directly via `invoice_group_id`.
//      All four together are the bug fingerprint.
//   3. Calls `transitionGroupStatus({ systemOverride: true })` to flip
//      the status back to `Needs Review`. When the group is currently
//      `Resolved` / Non-Issue, the same transition also resets
//      `outcome` to `Pending` via `extraFields` so the recovery is a
//      clean reopen, not a status-only flip that leaves a stale
//      Non-Issue outcome behind.
//   4. Writes a SEPARATE `audit_logs` row tagged
//      `action='inbox_heal_reverted'` with rich metadata for
//      traceability: the prior status, prior outcome, the active /
//      blank leg counts that confirmed the fingerprint, the source
//      string, and the registered `backfillId`. This row appears on
//      the group's audit timeline so reviewers see exactly why the
//      group was reopened.
//   5. Inserts a short group note pointing at the audit so reviewers
//      can see "Classify Inbox Recovery: reopened to Needs Review —
//      see audit entry".
//
// Idempotency
// -----------
//   The candidate filter is on the CURRENT status. Once a group has
//   been recovered (status moved back to `Needs Review`), it no longer
//   matches and a re-run reports 0 candidates.
//
// Flags
// -----
//   --apply               actually write changes (default = dry-run)
//   --limit N             cap to the first N candidates after sorting
//   --group-id N          only recover the named group id
//                         (overrides --limit)
//
// Run
// ---
//   pnpm --filter @workspace/scripts run backfill:recover-misdemoted-classify-inbox
//   pnpm --filter @workspace/scripts run backfill:recover-misdemoted-classify-inbox -- --apply
//   pnpm --filter @workspace/scripts run backfill:recover-misdemoted-classify-inbox -- --apply --limit 10
//   pnpm --filter @workspace/scripts run backfill:recover-misdemoted-classify-inbox -- --apply --group-id 4711

import {
  db,
  pool,
  invoiceGroupsTable,
  portalResponsesTable,
  auditLogsTable,
  notesTable,
  claimsTable,
} from "@workspace/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  transitionGroupStatus,
  type GroupStatus,
} from "@workspace/api-server/src/lib/group-transitions";
import { BACKFILL_IDS } from "./_backfill-audit";

export const BACKFILL_ID = BACKFILL_IDS.recoverMisdemotedClassifyInbox;
const SOURCE = "recover_misdemoted_classify_inbox_backfill";

const SYSTEM_ACTOR = {
  userEmail: "system@recover-misdemoted-classify-inbox-backfill",
  userName: "Classify Inbox Recovery",
};

// Same set as the heal script; staying in lockstep so a leg with a
// reviewable response is never reopened by the recovery.
const REVIEWABLE_RESPONSE_TYPES = [
  "approval",
  "denial",
  "partial_approval",
  "info_request",
  "other",
] as const;

const MAX_AUDIT_LEG_IDS = 200;

interface CliFlags {
  apply: boolean;
  limit: number | null;
  groupId: number | null;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { apply: false, limit: null, groupId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    else if (a === "--apply") flags.apply = true;
    else if (a === "--limit") flags.limit = Number.parseInt(argv[++i], 10);
    else if (a.startsWith("--limit=")) flags.limit = Number.parseInt(a.slice("--limit=".length), 10);
    else if (a === "--group-id") flags.groupId = Number.parseInt(argv[++i], 10);
    else if (a.startsWith("--group-id=")) flags.groupId = Number.parseInt(a.slice("--group-id=".length), 10);
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: backfill:recover-misdemoted-classify-inbox [--apply] [--limit N] [--group-id ID]",
          "",
          "Default: dry-run plan, no writes.",
          "",
          "Flags:",
          "  --apply         Commit the status reverts + per-group audit/note rows.",
          "  --limit N       Cap to the first N recovery candidates (staged rollout).",
          "  --group-id N    Only consider the named group id (overrides --limit).",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (flags.limit !== null && Number.isNaN(flags.limit)) throw new Error("--limit must be a number");
  if (flags.groupId !== null && Number.isNaN(flags.groupId)) throw new Error("--group-id must be a number");
  return flags;
}

interface CandidateGroup {
  id: number;
  invoiceNumber: string | null;
  status: string;
  outcome: string;
}

async function fetchCandidates(flags: CliFlags): Promise<CandidateGroup[]> {
  // Mis-demoted-into statuses: `Awaiting Response` for any outcome,
  // and `Resolved` only when paired with `Non-Issue`. The original
  // bug never landed groups in `Resolved` with any other outcome
  // because the heal helper only revert-targets the status (outcome
  // came along incidentally when an operator had previously closed
  // the leg as Non-Issue).
  const conditions = [
    or(
      eq(invoiceGroupsTable.status, "Awaiting Response"),
      and(
        eq(invoiceGroupsTable.status, "Resolved"),
        eq(invoiceGroupsTable.outcome, "Non-Issue"),
      ),
    )!,
  ];
  if (flags.groupId !== null) conditions.push(eq(invoiceGroupsTable.id, flags.groupId));

  let q = db
    .select({
      id: invoiceGroupsTable.id,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      status: invoiceGroupsTable.status,
      outcome: invoiceGroupsTable.outcome,
    })
    .from(invoiceGroupsTable)
    .where(and(...conditions))
    .orderBy(invoiceGroupsTable.id)
    .$dynamic();
  if (flags.groupId === null && flags.limit !== null) q = q.limit(flags.limit);

  const rows = await q;
  return rows as CandidateGroup[];
}

interface ActiveLegSnapshot {
  totalActive: number;
  unclassifiedActiveIds: number[];
  blankUnclassifiedActiveIds: number[];
}

async function fetchActiveLegSnapshot(groupId: number): Promise<ActiveLegSnapshot> {
  const rows = await db
    .select({
      id: claimsTable.id,
      errorTypeId: claimsTable.errorTypeId,
      errorDetails: claimsTable.errorDetails,
    })
    .from(claimsTable)
    .where(and(
      eq(claimsTable.invoiceGroupId, groupId),
      eq(claimsTable.includedInDispute, true),
      isNull(claimsTable.duplicateOfClaimId),
    ));

  const unclassifiedActiveIds: number[] = [];
  const blankUnclassifiedActiveIds: number[] = [];
  for (const r of rows) {
    if (r.errorTypeId == null) {
      unclassifiedActiveIds.push(r.id);
      const blank = !(typeof r.errorDetails === "string" && r.errorDetails.trim().length > 0);
      if (blank) blankUnclassifiedActiveIds.push(r.id);
    }
  }
  return {
    totalActive: rows.length,
    unclassifiedActiveIds,
    blankUnclassifiedActiveIds,
  };
}

async function hasReviewableResponse(groupId: number): Promise<boolean> {
  // Mirror the heal script: fetch all responses then filter in JS so
  // we don't have to wrestle with drizzle's strict literal-union typing
  // on the response_type enum column.
  const rows = await db
    .select({ responseType: portalResponsesTable.responseType })
    .from(portalResponsesTable)
    .where(eq(portalResponsesTable.invoiceGroupId, groupId));
  return rows.some((r) =>
    (REVIEWABLE_RESPONSE_TYPES as readonly string[]).includes(r.responseType),
  );
}

interface PerGroupSummary {
  groupId: number;
  invoiceNumber: string | null;
  priorStatus: string;
  priorOutcome: string;
  totalActiveLegs: number;
  unclassifiedActiveLegIds: number[];
  blankUnclassifiedActiveLegIds: number[];
}

interface SkippedSummary {
  groupId: number;
  invoiceNumber: string | null;
  status: string;
  reason:
    | "no_active_legs"
    | "has_classified_active_leg"
    | "has_nonblank_unclassified_leg"
    | "has_reviewable_response";
}

interface ReportTotals {
  scanned: number;
  recovered: number;
  skippedNoActiveLegs: number;
  skippedHasClassifiedActiveLeg: number;
  skippedHasNonblankUnclassifiedLeg: number;
  skippedHasReviewableResponse: number;
}

export interface RecoveryReport {
  perGroup: PerGroupSummary[];
  skipped: SkippedSummary[];
  totals: ReportTotals;
  applied: boolean;
}

function newReport(): RecoveryReport {
  return {
    perGroup: [],
    skipped: [],
    totals: {
      scanned: 0,
      recovered: 0,
      skippedNoActiveLegs: 0,
      skippedHasClassifiedActiveLeg: 0,
      skippedHasNonblankUnclassifiedLeg: 0,
      skippedHasReviewableResponse: 0,
    },
    applied: false,
  };
}

export interface RecoveryOptions {
  apply: boolean;
  limit?: number;
  groupId?: number;
  /** Suppress per-row console output (used by tests). */
  silent?: boolean;
}

const RECOVERY_TARGET: GroupStatus = "Needs Review";

export async function runBackfill(opts: RecoveryOptions): Promise<RecoveryReport> {
  const flags: CliFlags = {
    apply: opts.apply,
    limit: opts.limit ?? null,
    groupId: opts.groupId ?? null,
  };
  const log = opts.silent ? () => undefined : (msg: string) => console.log(msg);
  const report = newReport();

  const candidates = await fetchCandidates(flags);
  report.totals.scanned = candidates.length;
  log(
    `[scan] ${candidates.length} group(s) currently in {Awaiting Response, Resolved/Non-Issue} — checking for the Task #346 mis-demote fingerprint`,
  );

  for (const g of candidates) {
    const snapshot = await fetchActiveLegSnapshot(g.id);

    if (snapshot.totalActive === 0) {
      report.totals.skippedNoActiveLegs++;
      report.skipped.push({ groupId: g.id, invoiceNumber: g.invoiceNumber, status: g.status, reason: "no_active_legs" });
      continue;
    }

    // Fingerprint requires EVERY active leg to be unclassified. If
    // even one active leg already has an error_type_id, this group
    // got into Awaiting Response legitimately — leave it alone.
    if (snapshot.unclassifiedActiveIds.length !== snapshot.totalActive) {
      report.totals.skippedHasClassifiedActiveLeg++;
      report.skipped.push({ groupId: g.id, invoiceNumber: g.invoiceNumber, status: g.status, reason: "has_classified_active_leg" });
      continue;
    }

    // Fingerprint requires every active leg's error_details to be
    // blank/null. A non-blank description means the importer would
    // have stamped status="New" (not "Needs Review"), so this group
    // wasn't part of the mis-demote cohort.
    if (snapshot.blankUnclassifiedActiveIds.length !== snapshot.unclassifiedActiveIds.length) {
      report.totals.skippedHasNonblankUnclassifiedLeg++;
      report.skipped.push({ groupId: g.id, invoiceNumber: g.invoiceNumber, status: g.status, reason: "has_nonblank_unclassified_leg" });
      continue;
    }

    // Stays in lockstep with the heal script: if there's a reviewable
    // response on file the group belongs in the Stage 2 inbox, not in
    // the Classify inbox.
    if (await hasReviewableResponse(g.id)) {
      report.totals.skippedHasReviewableResponse++;
      report.skipped.push({ groupId: g.id, invoiceNumber: g.invoiceNumber, status: g.status, reason: "has_reviewable_response" });
      continue;
    }

    const summary: PerGroupSummary = {
      groupId: g.id,
      invoiceNumber: g.invoiceNumber,
      priorStatus: g.status,
      priorOutcome: g.outcome,
      totalActiveLegs: snapshot.totalActive,
      unclassifiedActiveLegIds: snapshot.unclassifiedActiveIds,
      blankUnclassifiedActiveLegIds: snapshot.blankUnclassifiedActiveIds,
    };
    report.perGroup.push(summary);
    report.totals.recovered++;

    log(
      `  ↺ group#${g.id} (#${g.invoiceNumber ?? "(no-invoice)"}): ${g.status}/${g.outcome} → ${RECOVERY_TARGET}/Pending; ` +
      `active legs=${snapshot.totalActive}, all unclassified, all blank — fingerprint matched`,
    );

    if (!flags.apply) continue;
    await applyRecovery(summary);
  }

  report.applied = flags.apply;
  return report;
}

async function applyRecovery(s: PerGroupSummary): Promise<void> {
  const reason =
    `Classify Inbox Recovery (${BACKFILL_ID}): reopening from ${s.priorStatus}/${s.priorOutcome} ` +
    `to ${RECOVERY_TARGET}/Pending. ` +
    `Group has ${s.totalActiveLegs} active leg(s), every one unclassified ` +
    `(error_type_id IS NULL) with blank error_details, and no reviewable ` +
    `portal_response on file — matches the Task #346 mis-demote fingerprint.`;

  // Reset outcome to Pending whenever the group is being pulled out
  // of a closed-out state, so the recovered group is in a clean
  // pre-classification shape (matches what the importer would have
  // written for a brand-new Needs Review group).
  const needsOutcomeReset = s.priorOutcome !== "Pending";

  await transitionGroupStatus({
    groupId: s.groupId,
    newStatus: RECOVERY_TARGET,
    source: SOURCE,
    reason,
    actor: SYSTEM_ACTOR,
    systemOverride: true,
    extraFields: needsOutcomeReset ? { outcome: "Pending" } : undefined,
  });

  const truncatedUnclassified = s.unclassifiedActiveLegIds.slice(0, MAX_AUDIT_LEG_IDS);
  const truncatedBlank = s.blankUnclassifiedActiveLegIds.slice(0, MAX_AUDIT_LEG_IDS);

  const auditRow = await db
    .insert(auditLogsTable)
    .values({
      claimId: null,
      invoiceGroupId: s.groupId,
      action: "inbox_heal_reverted",
      details:
        `Classify Inbox Recovery: status ${s.priorStatus} → ${RECOVERY_TARGET}` +
        (needsOutcomeReset ? ` (and outcome ${s.priorOutcome} → Pending)` : "") +
        `. Pre-classification group mis-demoted by an earlier stuck-inbox heal — restored.`,
      metadata: {
        backfillId: BACKFILL_ID,
        source: SOURCE,
        priorStatus: s.priorStatus,
        priorOutcome: s.priorOutcome,
        targetStatus: RECOVERY_TARGET,
        outcomeResetToPending: needsOutcomeReset,
        totalActiveLegs: s.totalActiveLegs,
        unclassifiedActiveLegCount: s.unclassifiedActiveLegIds.length,
        blankUnclassifiedActiveLegCount: s.blankUnclassifiedActiveLegIds.length,
        unclassifiedActiveLegIds: truncatedUnclassified,
        blankUnclassifiedActiveLegIds: truncatedBlank,
        unclassifiedActiveLegIdsTruncated:
          s.unclassifiedActiveLegIds.length > MAX_AUDIT_LEG_IDS,
      },
      userEmail: SYSTEM_ACTOR.userEmail,
      userName: SYSTEM_ACTOR.userName,
    })
    .returning({ id: auditLogsTable.id });

  await db.insert(notesTable).values({
    claimId: null,
    invoiceGroupId: s.groupId,
    type: "system",
    content:
      `Classify Inbox Recovery applied: status reopened from ${s.priorStatus} to ${RECOVERY_TARGET}` +
      (needsOutcomeReset ? ` and outcome reset from ${s.priorOutcome} to Pending` : "") +
      ` because every active leg was still unclassified with no payor response. ` +
      `See audit entry #${auditRow[0]?.id ?? "?"} (action=inbox_heal_reverted).`,
    author: SYSTEM_ACTOR.userName,
  });
}

function printReport(report: RecoveryReport, mode: "dry-run" | "apply"): void {
  console.log("\n===== CLASSIFY INBOX RECOVERY — VERIFICATION REPORT =====");
  console.log(`mode:                                       ${mode}`);
  console.log(`groups scanned (in candidate statuses):     ${report.totals.scanned}`);
  console.log(`  skipped — no active legs:                 ${report.totals.skippedNoActiveLegs}`);
  console.log(`  skipped — has classified active leg:      ${report.totals.skippedHasClassifiedActiveLeg}`);
  console.log(`  skipped — has non-blank unclassified leg: ${report.totals.skippedHasNonblankUnclassifiedLeg}`);
  console.log(`  skipped — has reviewable response:        ${report.totals.skippedHasReviewableResponse}`);
  console.log(`  recovered total:                          ${report.totals.recovered}`);

  if (mode === "dry-run") {
    console.log("\nNo writes performed. Re-run with --apply to commit.");
  } else if (report.totals.recovered === 0) {
    console.log("\nNothing to do — no mis-demoted groups found.");
  } else {
    console.log(
      `\n✓ Recovered ${report.totals.recovered} group(s); each has a `
      + `group_status_changed audit row, an inbox_heal_reverted audit row, and a system note.`,
    );
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const mode = flags.apply ? "apply" : "dry-run";
  console.log(
    `[backfill] mode=${mode}` +
    (flags.limit !== null ? ` limit=${flags.limit}` : "") +
    (flags.groupId !== null ? ` groupId=${flags.groupId}` : ""),
  );
  const report = await runBackfill({
    apply: flags.apply,
    limit: flags.limit ?? undefined,
    groupId: flags.groupId ?? undefined,
  });
  printReport(report, mode);
}

const isMain = (() => {
  return (
    !!process.argv[1] &&
    process.argv[1].endsWith("2026-05-recover-misdemoted-classify-inbox-backfill.ts")
  );
})();

if (isMain) {
  main()
    .then(() => pool.end().then(() => process.exit(0)))
    .catch((err) => {
      console.error("[backfill] FAILED", err);
      pool.end().finally(() => process.exit(1));
    });
}

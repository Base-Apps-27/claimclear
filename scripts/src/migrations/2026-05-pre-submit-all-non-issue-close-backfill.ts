// One-shot retroactive backfill for Task #714's auto-close cascade.
//
// What & why
// ----------
//   Task #714 shipped `autoCloseGroupIfAllNonIssue`, a per-write
//   cascade that lands a pre-submit invoice group at
//   (Resolved, No Action Needed, closure_reason='non_issue') as soon
//   as every disputed leg of the group has reached
//   `sop_outcome='non_issue'`. The cascade fires from
//   `set-claim-disposition`, `excludeLegCore`, the per-leg
//   `/sop-advance` terminal, and `/conclude-leg`.
//
//   Pre-existing groups that crossed the threshold BEFORE the
//   cascade shipped — or via a path that doesn't invoke it — stay
//   stuck at (status varies, outcome=Pending) even though the
//   business rule says they should be closed. This script sweeps
//   them up so the queue, counters, and day-complete celebration
//   stay consistent with the new rule.
//
// Predicate (broader than autoCloseGroupIfAllNonIssue — see note)
// ----------------------------------------------------------------
//   1. Group is pre-submit: not in (Resolved/Denied/Expired) AND has
//      no `portal_submissions` row.
//   2. At least one non-duplicate leg (`duplicate_of_claim_id IS NULL`).
//   3. EVERY non-duplicate leg has `sop_outcome = 'non_issue'`.
//
// Why broader than the runtime helper
// -----------------------------------
//   The runtime cascade `autoCloseGroupIfAllNonIssue` only counts
//   "disputed legs" (`error_type_id IS NOT NULL`) and short-circuits
//   with `no_disputed_legs` when none exist. That misses an entire
//   class of legacy groups produced by the Task #260 auto-non-issue-
//   siblings backfill: when EVERY leg in the group was a blank
//   sibling, the rule excluded them all and stamped each one
//   `sop_outcome='non_issue'` BEFORE any leg got classified with an
//   error type. Those groups have zero "disputed legs" by the
//   helper's definition, so the helper never closes them — they
//   stay stuck at (Needs Evidence, Pending) forever despite every
//   leg having a terminal non_issue verdict.
//
//   This backfill catches both cases:
//     - Helper-eligible (all disputed legs non_issue).
//     - Orphan groups (all legs excluded-as-non_issue, no error type).
//   Either way the business rule is the same: nothing to dispute,
//   close at (Resolved, No Action Needed, non_issue).
//
//   We deliberately exclude duplicate legs (`duplicate_of_claim_id
//   IS NOT NULL`) from the rollup — duplicates are passengers of
//   another claim, not independent disputes.
//
// Action
// ------
//   For each qualifying group, calls `transitionGroupStatusAndOutcome`
//   directly (not the helper, so we can stamp our own
//   actor/source/closureReason and add a separate backfill audit
//   row) with:
//     newStatus       = "Resolved"
//     newOutcome      = "No Action Needed"
//     closureReason   = "non_issue"
//     systemOverride  = true   (matches the helper)
//     source          = "retro_pre_submit_all_non_issue_close_backfill"
//     actor           = system@retro-pre-submit-all-non-issue-close-backfill
//   Then writes a SEPARATE per-group audit row
//   `action='group_auto_close_backfilled'` carrying the registered
//   `backfillId`, the prior status/outcome, the rollup-leg
//   fingerprint, and the legs whose non_issue verdict drove the
//   close. The split mirrors `recover-misdemoted-classify-inbox` so
//   the backfill row is sliceable from history while the transition
//   row stays canonical.
//
// Idempotency
// -----------
//   The candidate filter rejects terminal-status groups, so a group
//   closed by an earlier run no longer matches. Re-running reports
//   0 candidates.
//
// Flags
// -----
//   --apply               actually write changes (default = dry-run)
//   --limit N             cap to the first N candidates after sorting
//   --group-id N          only process the named group id (overrides --limit)
//
// Run
// ---
//   pnpm --filter @workspace/scripts run backfill:pre-submit-all-non-issue-close
//   pnpm --filter @workspace/scripts run backfill:pre-submit-all-non-issue-close -- --apply
//   pnpm --filter @workspace/scripts run backfill:pre-submit-all-non-issue-close -- --apply --limit 10
//   pnpm --filter @workspace/scripts run backfill:pre-submit-all-non-issue-close -- --apply --group-id 4711

import {
  db,
  pool,
  invoiceGroupsTable,
  claimsTable,
  auditLogsTable,
  portalSubmissionsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  transitionGroupStatusAndOutcome,
  type GroupTransitionActor,
} from "@workspace/api-server/src/lib/group-transitions";
import { BACKFILL_IDS } from "./_backfill-audit";

export const BACKFILL_ID = BACKFILL_IDS.preSubmitAllNonIssueClose;
const SOURCE = "retro_pre_submit_all_non_issue_close_backfill";

const SYSTEM_ACTOR: GroupTransitionActor = {
  userEmail: "system@retro-pre-submit-all-non-issue-close-backfill",
  userName: "Retro auto-close (pre-submit all-non-issue)",
};

const TERMINAL_STATUSES = ["Resolved", "Denied", "Expired"] as const;

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
    else if (a === "--limit") flags.limit = Number.parseInt(argv[++i] ?? "", 10);
    else if (a.startsWith("--limit=")) flags.limit = Number.parseInt(a.slice("--limit=".length), 10);
    else if (a === "--group-id") flags.groupId = Number.parseInt(argv[++i] ?? "", 10);
    else if (a.startsWith("--group-id=")) flags.groupId = Number.parseInt(a.slice("--group-id=".length), 10);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: backfill:pre-submit-all-non-issue-close [--apply] [--limit N] [--group-id N]",
      );
      process.exit(0);
    }
  }
  if (flags.limit !== null && (!Number.isFinite(flags.limit) || flags.limit <= 0)) {
    throw new Error(`--limit must be a positive integer (got: ${flags.limit})`);
  }
  if (flags.groupId !== null && (!Number.isFinite(flags.groupId) || flags.groupId <= 0)) {
    throw new Error(`--group-id must be a positive integer (got: ${flags.groupId})`);
  }
  return flags;
}

interface CandidateLeg {
  legId: number;
  sopOutcome: string | null;
  errorTypeId: number | null;
  includedInDispute: boolean | null;
}

interface Candidate {
  groupId: number;
  status: string;
  outcome: string;
  invoiceNumber: string | null;
  rollupLegs: CandidateLeg[];
  /** True iff every rollup leg has `error_type_id IS NULL` (the
   *  orphan shape produced by the auto-non-issue-siblings backfill).
   *  False iff at least one rollup leg has an error type
   *  (the helper-eligible shape). */
  isOrphanShape: boolean;
}

async function findCandidates(flags: CliFlags): Promise<Candidate[]> {
  // Pre-submit groups: status NOT terminal AND no portal_submissions row.
  const groupRows = await db
    .select({
      id: invoiceGroupsTable.id,
      status: invoiceGroupsTable.status,
      outcome: invoiceGroupsTable.outcome,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
    })
    .from(invoiceGroupsTable)
    .where(
      and(
        sql`${invoiceGroupsTable.status} NOT IN ('Resolved','Denied','Expired')`,
        sql`NOT EXISTS (
          SELECT 1 FROM ${portalSubmissionsTable}
          WHERE ${portalSubmissionsTable.invoiceGroupId} = ${invoiceGroupsTable.id}
        )`,
        ...(flags.groupId !== null ? [eq(invoiceGroupsTable.id, flags.groupId)] : []),
      ),
    );

  const candidates: Candidate[] = [];
  for (const g of groupRows) {
    // Pull every NON-DUPLICATE leg in the group. Duplicates are
    // passengers of another claim and shouldn't drive the rollup.
    const legs = await db
      .select({
        legId: claimsTable.id,
        sopOutcome: claimsTable.sopOutcome,
        errorTypeId: claimsTable.errorTypeId,
        includedInDispute: claimsTable.includedInDispute,
      })
      .from(claimsTable)
      .where(
        and(
          eq(claimsTable.invoiceGroupId, g.id),
          sql`${claimsTable.duplicateOfClaimId} IS NULL`,
        ),
      );

    if (legs.length === 0) continue;

    // Predicate: EVERY non-duplicate leg sits at sop_outcome='non_issue'.
    const allNonIssue = legs.every((l) => l.sopOutcome === "non_issue");
    if (!allNonIssue) continue;

    const isOrphanShape = legs.every((l) => l.errorTypeId === null);

    candidates.push({
      groupId: g.id,
      status: g.status,
      outcome: g.outcome,
      invoiceNumber: g.invoiceNumber as string | null,
      rollupLegs: legs as CandidateLeg[],
      isOrphanShape,
    });
  }

  candidates.sort((a, b) => a.groupId - b.groupId);
  if (flags.limit !== null && flags.groupId === null) {
    return candidates.slice(0, flags.limit);
  }
  return candidates;
}

async function processCandidate(c: Candidate): Promise<void> {
  await db.transaction(async (tx) => {
    await transitionGroupStatusAndOutcome({
      groupId: c.groupId,
      newStatus: "Resolved",
      newOutcome: "No Action Needed",
      source: SOURCE,
      reason:
        "Retro auto-close: every disputed leg already at sop_outcome='non_issue' before Task #714 cascade.",
      actor: SYSTEM_ACTOR,
      closureReason: "non_issue",
      systemOverride: true,
      executor: tx,
    });

    // Separate per-group audit row carrying the backfillId so the
    // closure is sliceable from history. The transition above already
    // wrote the canonical `group_status_changed` /
    // `group_outcome_changed` rows; this row documents that the
    // change came from this one-shot.
    await tx.insert(auditLogsTable).values({
      invoiceGroupId: c.groupId,
      action: "group_auto_close_backfilled",
      details:
        "Backfilled auto-close: every disputed leg already at non_issue before Task #714 cascade shipped.",
      metadata: {
        backfillId: BACKFILL_ID,
        source: SOURCE,
        priorStatus: c.status,
        priorOutcome: c.outcome,
        rollupLegCount: c.rollupLegs.length,
        rollupLegIds: c.rollupLegs.map((l) => l.legId),
        // `orphan` = every leg had error_type_id IS NULL (legacy
        // auto-non-issue-siblings shape; the runtime cascade can't
        // reach these). `helper_eligible` = at least one leg had
        // an error type (the runtime cascade would have caught it
        // had it been touched after Task #714 shipped).
        shape: c.isOrphanShape ? "orphan" : "helper_eligible",
      },
      userEmail: SYSTEM_ACTOR.userEmail,
      userName: SYSTEM_ACTOR.userName,
    });
  });
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const mode = flags.apply ? "APPLY" : "DRY-RUN";

  console.log("=".repeat(72));
  console.log(`Backfill: ${BACKFILL_ID}`);
  console.log(`Mode:     ${mode}`);
  if (flags.groupId !== null) console.log(`Scope:    --group-id ${flags.groupId}`);
  else if (flags.limit !== null) console.log(`Scope:    --limit ${flags.limit}`);
  else console.log(`Scope:    (full sweep)`);
  console.log("=".repeat(72));

  const candidates = await findCandidates(flags);

  console.log(`Candidates found: ${candidates.length}`);
  if (candidates.length === 0) {
    console.log("Nothing to do — exiting.");
    return;
  }

  // Per-status summary so the operator can sanity-check the cohort
  // before flipping --apply.
  const byStatus = new Map<string, number>();
  for (const c of candidates) {
    byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
  }
  console.log("By prior status:");
  for (const [status, count] of [...byStatus.entries()].sort()) {
    console.log(`  ${status.padEnd(20)} ${count}`);
  }

  const orphanCount = candidates.filter((c) => c.isOrphanShape).length;
  const helperEligibleCount = candidates.length - orphanCount;
  console.log(`By shape:`);
  console.log(`  orphan (no error_type on any leg)          ${orphanCount}`);
  console.log(`  helper_eligible (at least one error_type)  ${helperEligibleCount}`);

  console.log("");
  console.log("First 25 candidates:");
  console.log("  group_id   invoice_number   status               outcome     legs  shape");
  for (const c of candidates.slice(0, 25)) {
    console.log(
      `  ${String(c.groupId).padEnd(10)} ${(c.invoiceNumber ?? "—").padEnd(16)} ${c.status.padEnd(20)} ${c.outcome.padEnd(11)} ${String(c.rollupLegs.length).padEnd(5)} ${c.isOrphanShape ? "orphan" : "helper"}`,
    );
  }
  console.log("");

  if (!flags.apply) {
    console.log("DRY-RUN — no changes written. Re-run with --apply to commit.");
    return;
  }

  let closed = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      await processCandidate(c);
      closed++;
      if (closed % 25 === 0) {
        console.log(`  …closed ${closed}/${candidates.length}`);
      }
    } catch (err) {
      failed++;
      console.error(`  group ${c.groupId}: FAILED — ${(err as Error).message}`);
    }
  }
  console.log("");
  console.log(`Done. Closed: ${closed}  Failed: ${failed}`);
}

main()
  .catch((err) => {
    console.error("Backfill crashed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

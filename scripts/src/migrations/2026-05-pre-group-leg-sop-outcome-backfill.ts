// One-shot retroactive backfill for Task #301: heal legs that pre-date the
// invoice-group flow so their verdicts can be recorded.
//
// --- Context -------------------------------------------------------------
// Before the invoice-group flow shipped, every claim leg was filed
// individually. The 2026-05 cutover migrations
// (`2026-05-portal-submissions-group-link-backfill.ts`,
// `2026-05-per-leg-state-backfill.ts`) swept those legs into invoice groups
// but did NOT backfill the new per-leg `sop_outcome` column for legs that
// were filed back when there was no SOP walk. Today, when a payor response
// lands on one of those legs, the modern verdict gate at
// `POST /claims/:id/verdict` rejects the operator's verdict because
// `sop_outcome` is NULL — the operator is stuck with no in-app way to
// record the outcome.
//
// --- Rule restated -------------------------------------------------------
//   Candidate predicate: leg.sop_outcome IS NULL
//                        AND leg.included_in_dispute = true
//                        AND leg.error_type_id IS NOT NULL
//                        AND leg.invoice_group_id IS NOT NULL
//   Evidence (in order, first-match wins):
//     1. Email submission:
//          claims.dispute_email_sent = true
//          OR a row in `outbound_emails` with claim_id = leg.id and
//             kind = 'dispute'
//          → stamp sop_outcome = 'dispute'
//     2. Portal submission:
//          a row in `portal_submissions` with invoice_group_id =
//          leg.invoice_group_id AND status = 'submitted'
//          → stamp sop_outcome = 'portal_dispute'
//     3. Otherwise: skip and report under "no evidence" so the user can
//        triage by hand. Never invents a sop_outcome out of thin air —
//        the reconcile UI path is the per-leg manual recovery for these.
//   Side effect per healed leg: one audit_logs row with
//     action = 'leg_sop_outcome_backfilled'
//     metadata = { from: null, to: '<chosen>', evidence: '<channel>',
//                  backfillId: '2026-05-pre-group-leg-sop-outcome',
//                  source: 'pre_group_leg_sop_outcome_backfill' }
//   Idempotency: re-running with --apply finds zero candidates because the
//   predicate filters to legs that are still sop_outcome IS NULL. Once
//   stamped, they stop matching.
//
// --- To run --------------------------------------------------------------
//   Dry-run plan (no writes):
//     pnpm --filter @workspace/scripts run backfill:pre-group-leg-sop-outcome
//   Apply (writes the sop_outcome stamps + audit rows):
//     pnpm --filter @workspace/scripts run backfill:pre-group-leg-sop-outcome -- --apply
//   Spot-check a single leg:
//     pnpm --filter @workspace/scripts run backfill:pre-group-leg-sop-outcome -- \
//       --leg-id 14885393
//   Cap the number of legs walked (useful with --apply for staged rollout):
//     pnpm --filter @workspace/scripts run backfill:pre-group-leg-sop-outcome -- \
//       --apply --limit 50
//
// Audit rows are tagged two ways:
//   1. metadata.source = 'pre_group_leg_sop_outcome_backfill'
//      (script-specific source string, mirrors the convention used by
//       `2026-05-auto-non-issue-siblings-backfill.ts`).
//   2. metadata.backfillId = '2026-05-pre-group-leg-sop-outcome'
//      (uniform Task #268 backfill registry id stamped by every one-shot
//       backfill — see `_backfill-audit.ts` and the saved query in
//       `_backfill-audit-rows.sql`).

import {
  db,
  pool,
  claimsTable,
  auditLogsTable,
  portalSubmissionsTable,
  outboundEmailsTable,
  type Claim,
} from "@workspace/db";
import { and, asc, eq, gt, inArray, isNull, isNotNull } from "drizzle-orm";
import type { DbExecutor } from "@workspace/api-server/src/lib/claim-transitions";
import { BACKFILL_IDS, withBackfillId } from "./_backfill-audit";

export const BACKFILL_SOURCE = "pre_group_leg_sop_outcome_backfill";
export const BACKFILL_ID = BACKFILL_IDS.preGroupLegSopOutcome;

const SYSTEM_ACTOR = {
  userEmail: "system@pre-group-leg-sop-outcome-backfill",
  userName: "Pre-Group Leg SOP Outcome Backfill",};

export type EvidenceChannel = "email" | "portal";
export type StampedSopOutcome = "dispute" | "portal_dispute";

export interface CandidateDecision {
  legId: number;
  invoiceGroupId: number;
  channel: EvidenceChannel | null;
  to: StampedSopOutcome | null;
}

export interface SkippedLeg {
  legId: number;
  invoiceGroupId: number | null;
  reason: "no_evidence";
}

export interface BackfillReport {
  legsScanned: number;
  candidates: number;
  legsStamped: number;
  legsSkippedNoEvidence: number;
  perChannel: Record<EvidenceChannel, number>;
  preview: Array<CandidateDecision>;
  skippedLegs: SkippedLeg[];
}

function newReport(): BackfillReport {
  return {
    legsScanned: 0,
    candidates: 0,
    legsStamped: 0,
    legsSkippedNoEvidence: 0,
    perChannel: { email: 0, portal: 0 },
    preview: [],
    skippedLegs: [],
  };
}

export interface BackfillOptions {
  apply: boolean;
  /** Cap on how many candidate legs to walk total. */
  limit?: number;
  /** Single-leg spot check. Overrides limit. */
  legId?: number;
  /** Optional executor (used by tests to plug in a transaction). */
  executor?: DbExecutor;
  /** When true, suppress per-row console output. */
  silent?: boolean;
}

const LEG_BATCH_SIZE = 200;

/** Returns true if the leg matches the candidate predicate. */
export function isCandidateLeg(l: Claim): boolean {
  return (
    l.sopOutcome == null &&
    l.includedInDispute === true &&
    typeof l.errorTypeId === "string" &&
    l.errorTypeId.length > 0 &&
    l.invoiceGroupId != null
  );
}

/**
 * Decide which sop_outcome (if any) the leg should be stamped with based on
 * hard evidence of a prior submission. Pure function — exposed for testing.
 */
export async function decideEvidence(
  ex: DbExecutor,
  leg: Claim,
): Promise<{ channel: EvidenceChannel; to: StampedSopOutcome } | null> {
  // 1. Email submission. Either the denormalized flag on the leg row or
  //    a hard outbound_emails row keyed to this claim.
  if (leg.disputeEmailSent === true) {
    return { channel: "email", to: "dispute" };
  }
  const outbound = await ex
    .select({ id: outboundEmailsTable.id })
    .from(outboundEmailsTable)
    .where(
      and(
        eq(outboundEmailsTable.claimId, leg.id),
        eq(outboundEmailsTable.kind, "dispute"),
      ),
    )
    .limit(1);
  if (outbound.length > 0) {
    return { channel: "email", to: "dispute" };
  }

  // 2. Portal submission. The leg's invoice group must have at least one
  //    portal_submissions row that actually reached `submitted` status —
  //    a draft / pending / failed row is not evidence the payor saw it.
  if (leg.invoiceGroupId != null) {
    const portal = await ex
      .select({ id: portalSubmissionsTable.id })
      .from(portalSubmissionsTable)
      .where(
        and(
          eq(portalSubmissionsTable.invoiceGroupId, leg.invoiceGroupId),
          eq(portalSubmissionsTable.status, "submitted"),
        ),
      )
      .limit(1);
    if (portal.length > 0) {
      return { channel: "portal", to: "portal_dispute" };
    }
  }

  return null;
}

async function* streamCandidateBatches(
  ex: DbExecutor,
  opts: Pick<BackfillOptions, "legId">,
): AsyncGenerator<Claim[], void, void> {
  if (opts.legId !== undefined) {
    const rows = await ex
      .select()
      .from(claimsTable)
      .where(eq(claimsTable.id, opts.legId));
    if (rows.length > 0) yield rows;
    return;
  }
  let lastId = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await ex
      .select()
      .from(claimsTable)
      .where(
        and(
          gt(claimsTable.id, lastId),
          isNull(claimsTable.sopOutcome),
          eq(claimsTable.includedInDispute, true),
          isNotNull(claimsTable.errorTypeId),
          isNotNull(claimsTable.invoiceGroupId),
        ),
      )
      .orderBy(asc(claimsTable.id))
      .limit(LEG_BATCH_SIZE);
    if (rows.length === 0) return;
    yield rows;
    lastId = rows[rows.length - 1]!.id;
    if (rows.length < LEG_BATCH_SIZE) return;
  }
}

export async function runBackfill(opts: BackfillOptions): Promise<BackfillReport> {
  const report = newReport();
  const ex: DbExecutor = opts.executor ?? db;
  const log = opts.silent ? () => undefined : (msg: string) => console.log(msg);
  const limit = opts.legId === undefined ? opts.limit : undefined;

  for await (const rawBatch of streamCandidateBatches(ex, opts)) {
    let batch = rawBatch;
    if (limit !== undefined) {
      const remaining = limit - report.legsScanned;
      if (remaining <= 0) break;
      if (batch.length > remaining) batch = batch.slice(0, remaining);
    }
    if (batch.length === 0) continue;

    report.legsScanned += batch.length;

    for (const leg of batch) {
      // The single-leg path bypasses the SQL-level predicate, so re-check
      // here defensively.
      if (!isCandidateLeg(leg)) continue;
      report.candidates += 1;

      const decision = await decideEvidence(ex, leg);
      if (!decision) {
        report.legsSkippedNoEvidence += 1;
        report.skippedLegs.push({
          legId: leg.id,
          invoiceGroupId: leg.invoiceGroupId,
          reason: "no_evidence",
        });
        continue;
      }

      if (report.preview.length < 25) {
        report.preview.push({
          legId: leg.id,
          invoiceGroupId: leg.invoiceGroupId!,
          channel: decision.channel,
          to: decision.to,
        });
      }

      if (!opts.apply) {
        report.legsStamped += 1;
        report.perChannel[decision.channel] += 1;
        continue;
      }

      // Per-leg transaction: stamp + audit row land atomically. Mirrors
      // the live SOP-advance writer's pattern (one tx per leg) so a
      // partial application never leaves the audit row dangling without
      // the column update or vice versa.
      await db.transaction(async (tx) => {
        const [fresh] = await tx
          .select()
          .from(claimsTable)
          .where(eq(claimsTable.id, leg.id));
        if (!fresh || !isCandidateLeg(fresh)) {
          // Race or already healed by another writer — quietly skip.
          return;
        }
        await tx
          .update(claimsTable)
          .set({ sopOutcome: decision.to })
          .where(eq(claimsTable.id, leg.id));
        await tx.insert(auditLogsTable).values({
          claimId: leg.id,
          action: "leg_sop_outcome_backfilled",
          details: `Stamped sop_outcome=${decision.to} (evidence: ${decision.channel})`,
          metadata: withBackfillId(
            {
              from: null,
              to: decision.to,
              evidence: decision.channel,
              source: BACKFILL_SOURCE,
            },
            BACKFILL_ID,
          ),
          userEmail: SYSTEM_ACTOR.userEmail,
          userName: SYSTEM_ACTOR.userName,
        });
      });

      report.legsStamped += 1;
      report.perChannel[decision.channel] += 1;
      log(
        `  stamp: leg#${leg.id} (group#${leg.invoiceGroupId}) → sop_outcome=${decision.to} [${decision.channel}]`,
      );
    }
  }

  return report;
}

function printReport(report: BackfillReport, mode: "dry-run" | "apply"): void {
  console.log("\n===== BACKFILL VERIFICATION REPORT =====");
  console.log(`mode:                          ${mode}`);
  console.log(`legs scanned (candidates):     ${report.legsScanned}`);
  console.log(`legs ${mode === "apply" ? "stamped" : "to stamp"}:                ${report.legsStamped}`);
  console.log(`  via email evidence:          ${report.perChannel.email}`);
  console.log(`  via portal evidence:         ${report.perChannel.portal}`);
  console.log(`legs skipped (no evidence):    ${report.legsSkippedNoEvidence}`);

  if (report.preview.length > 0) {
    console.log("\nfirst stamps (preview, capped at 25):");
    for (const p of report.preview) {
      console.log(
        `  leg#${p.legId} (group#${p.invoiceGroupId}) → sop_outcome=${p.to} [${p.channel}]`,
      );
    }
  }

  if (report.skippedLegs.length > 0) {
    console.log(
      `\n${report.skippedLegs.length} legs skipped without evidence (review by hand or use the in-app reconcile path):`,
    );
    for (const s of report.skippedLegs.slice(0, 25)) {
      console.log(`  leg#${s.legId} (group#${s.invoiceGroupId ?? "?"}): ${s.reason}`);
    }
    if (report.skippedLegs.length > 25) {
      console.log(`  ... and ${report.skippedLegs.length - 25} more`);
    }
  }

  if (mode === "dry-run") {
    console.log("\nNo writes performed. Re-run with --apply to commit.");
  } else if (report.legsStamped === 0) {
    console.log("\nNothing to do — dataset already clean.");
  } else {
    console.log(`\n✓ Stamped ${report.legsStamped} legs.`);
  }
}

interface ParsedArgs extends BackfillOptions {}

function parseArgs(argv: string[]): ParsedArgs {
  const opts: ParsedArgs = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      continue;
    } else if (a === "--apply") {
      opts.apply = true;
    } else if (a === "--limit") {
      const v = argv[++i];
      if (!v) throw new Error("--limit requires a value");
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--limit must be a positive integer, got "${v}"`);
      }
      opts.limit = n;
    } else if (a.startsWith("--limit=")) {
      const n = Number(a.slice("--limit=".length));
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--limit must be a positive integer`);
      }
      opts.limit = n;
    } else if (a === "--leg-id") {
      const v = argv[++i];
      if (!v) throw new Error("--leg-id requires a value");
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--leg-id must be a positive integer, got "${v}"`);
      }
      opts.legId = n;
    } else if (a.startsWith("--leg-id=")) {
      const n = Number(a.slice("--leg-id=".length));
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--leg-id must be a positive integer`);
      }
      opts.legId = n;
    } else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: backfill:pre-group-leg-sop-outcome [--apply]",
          "                                          [--limit N]",
          "                                          [--leg-id ID]",
          "",
          "Default: dry-run plan, no writes.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const mode = opts.apply ? "apply" : "dry-run";
  console.log(
    `[backfill] starting pre-group-leg-sop-outcome backfill (${mode})`,
  );
  if (opts.limit !== undefined) {
    console.log(`  limit: ${opts.limit}`);
  }
  if (opts.legId !== undefined) {
    console.log(`  leg-id: ${opts.legId}`);
  }

  const report = await runBackfill(opts);
  printReport(report, mode);

  // Suppress unused-import warnings on the no-op path.
  void inArray;
}

const isMain = (() => {
  return (
    process.argv[1] &&
    process.argv[1].endsWith("2026-05-pre-group-leg-sop-outcome-backfill.ts")
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

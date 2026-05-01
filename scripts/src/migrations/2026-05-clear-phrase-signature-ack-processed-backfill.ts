// One-shot backfill for Task #283: clear the lingering yellow "Unprocessed"
// badge from phrase-signature acknowledgment receipts that landed in
// portal_responses BEFORE `shouldAutoMarkProcessed` shipped.
//
// --- Rule restated (must stay in sync with shouldAutoMarkProcessed in
//     artifacts/api-server/src/lib/response-matcher.ts) ----------------
//   The live rule auto-marks a freshly-stored portal_response as
//   `processed = true` iff:
//     responseType       === 'acknowledgment'
//     classifierSource   === 'phrase_signature'
//   That's the only combination where the operator has nothing to do
//   on the row: the deterministic phrase classifier matched a known
//   "we got your dispute" template with high confidence. Abstain rows
//   still need human review (no signature match + AI unavailable), and
//   AI-classified rows — even AI-classified acknowledgments — are kept
//   unprocessed so a human can confirm the model's call.
//
// What this script does
// ---------------------
//   Selects every portal_responses row matching the live rule
//   (responseType='acknowledgment' AND classifierSource='phrase_signature')
//   that is still `processed = false`, and flips them to
//   `processed = true`. Abstain rows and AI-classified rows are NEVER
//   touched. Acknowledgment rows produced by the older retro
//   classifier (`classifier_source = 'retro_phrase_signature'` from the
//   reclassify-confirmation-emails backfill) are also NOT touched —
//   the live rule explicitly only matches the fresh
//   'phrase_signature' source, so the backfill matches it 1:1.
//
// Idempotent
// ----------
//   The WHERE clause filters to `processed = false`, so re-running is a
//   no-op once the qualifying rows have been flipped. The summary
//   audit row is only written when at least one row is updated, so
//   re-runs do not pile up empty audit entries either.
//
// Audit / migration record
// ------------------------
//   On --apply, when at least one row is updated, this script writes a
//   single summary row to audit_logs:
//     action       = 'backfill_completed'
//     claimId      = null
//     invoiceGroupId = null
//     userEmail    = 'system@clear-phrase-signature-ack-processed-backfill'
//     metadata.backfillId = '2026-05-clear-phrase-signature-ack-processed'
//     metadata.rowsUpdated = <count>
//     metadata.responseIds = <ids, capped at 1000 for size safety>
//   The single-row form is intentional: this backfill only flips a
//   `processed` boolean; per-row audit noise on every silent receipt
//   would dilute the timeline for no gain.
//
// To run
// ------
//   Dry-run plan (no writes):
//     pnpm --filter @workspace/scripts run \
//       backfill:clear-phrase-signature-ack-processed
//   Apply (commits the flips + summary audit row):
//     pnpm --filter @workspace/scripts run \
//       backfill:clear-phrase-signature-ack-processed -- --apply
//   Cap to N rows for staged rollout:
//     pnpm --filter @workspace/scripts run \
//       backfill:clear-phrase-signature-ack-processed -- --apply --limit 100

import {
  db,
  pool,
  portalResponsesTable,
  auditLogsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { BACKFILL_IDS } from "./_backfill-audit";

export const BACKFILL_ID = BACKFILL_IDS.clearPhraseSignatureAckProcessed;

const SYSTEM_ACTOR = {
  userEmail: "system@clear-phrase-signature-ack-processed-backfill",
  userName: "Clear Phrase-Signature Ack Processed Backfill",};

// Cap on how many response ids we stash in the summary audit row's
// metadata. Plenty of headroom for real-world counts (the new rule has
// only been live briefly so the backlog is small) without risking an
// oversized JSONB write if some pathological dataset shows up.
const MAX_AUDIT_ID_LIST = 1000;

export interface BackfillReport {
  candidateCount: number;
  rowsUpdated: number;
  responseIds: number[];
  applied: boolean;
}

export interface BackfillOptions {
  apply: boolean;
  /** Cap on how many response rows to update. */
  limit?: number;
  /** When true, suppress per-row console output (used by tests). */
  silent?: boolean;
}

function newReport(): BackfillReport {
  return {
    candidateCount: 0,
    rowsUpdated: 0,
    responseIds: [],
    applied: false,
  };
}

export async function runBackfill(opts: BackfillOptions): Promise<BackfillReport> {
  const report = newReport();
  const log = opts.silent ? () => undefined : (msg: string) => console.log(msg);

  // Single predicate, applied identically to the dry-run scan and the
  // UPDATE. Mirrors `shouldAutoMarkProcessed` 1:1.
  const where = and(
    eq(portalResponsesTable.responseType, "acknowledgment"),
    eq(portalResponsesTable.classifierSource, "phrase_signature"),
    eq(portalResponsesTable.processed, false),
  );

  // Always do the dry-run scan first — even on --apply — so the report
  // can list the exact ids that were flipped (the UPDATE's RETURNING
  // also gives us this, but the scan keeps the dry-run code path and
  // the apply path observable in the same shape).
  let scanQuery = db
    .select({ id: portalResponsesTable.id })
    .from(portalResponsesTable)
    .where(where)
    .orderBy(portalResponsesTable.id)
    .$dynamic();
  if (opts.limit !== undefined) scanQuery = scanQuery.limit(opts.limit);
  const candidates = await scanQuery;
  report.candidateCount = candidates.length;
  report.responseIds = candidates.map((r) => r.id);

  log(
    `[scan] ${report.candidateCount} portal_responses row(s) match (acknowledgment + phrase_signature + processed=false)`,
  );

  if (!opts.apply) {
    return report;
  }

  if (report.candidateCount === 0) {
    log("[apply] nothing to update; dataset already clean");
    report.applied = true;
    return report;
  }

  // UPDATE in a transaction so the flip and the summary audit row land
  // together. The UPDATE filters by id list (not the original predicate)
  // so a concurrent writer that flips a row between the scan and the
  // UPDATE doesn't get double-counted — `RETURNING id` reports only
  // rows that actually transitioned.
  const updatedIds = await db.transaction(async (tx) => {
    const updated = await tx
      .update(portalResponsesTable)
      .set({ processed: true, updatedAt: new Date() })
      .where(
        and(
          eq(portalResponsesTable.processed, false),
          inArray(portalResponsesTable.id, report.responseIds),
        ),
      )
      .returning({ id: portalResponsesTable.id });

    if (updated.length > 0) {
      await tx.insert(auditLogsTable).values({
        claimId: null,
        invoiceGroupId: null,
        action: "backfill_completed",
        details: `Cleared "Unprocessed" badge on ${updated.length} historical phrase-signature acknowledgment receipt(s)`,
        metadata: {
          backfillId: BACKFILL_ID,
          rowsUpdated: updated.length,
          responseIds: updated
            .slice(0, MAX_AUDIT_ID_LIST)
            .map((r) => r.id),
          responseIdsTruncated: updated.length > MAX_AUDIT_ID_LIST,
          rule: "responseType=acknowledgment AND classifierSource=phrase_signature",
        },
        userEmail: SYSTEM_ACTOR.userEmail,
        userName: SYSTEM_ACTOR.userName,
      });
    }

    return updated.map((r) => r.id);
  });

  report.rowsUpdated = updatedIds.length;
  report.applied = true;
  // Report the IDs that actually transitioned, not the original scan
  // list — under a concurrent writer race the two can drift, and
  // callers (including the test) are entitled to a race-accurate view.
  report.responseIds = updatedIds;

  log(`[apply] flipped ${report.rowsUpdated} row(s) to processed=true`);
  if (report.rowsUpdated !== report.candidateCount) {
    log(
      `[apply] note: ${report.candidateCount - report.rowsUpdated} candidate row(s) were already flipped by a concurrent writer between scan and update`,
    );
  }

  return report;
}

function printReport(report: BackfillReport, mode: "dry-run" | "apply"): void {
  console.log("\n===== BACKFILL VERIFICATION REPORT =====");
  console.log(`mode:                          ${mode}`);
  console.log(`candidate rows:                ${report.candidateCount}`);
  if (mode === "apply") {
    console.log(`rows actually updated:         ${report.rowsUpdated}`);
  }

  if (report.responseIds.length > 0) {
    const preview = report.responseIds.slice(0, 25);
    console.log(
      `\nfirst response ids (capped at 25): ${preview.join(", ")}${report.responseIds.length > preview.length ? ` … (+${report.responseIds.length - preview.length} more)` : ""}`,
    );
  }

  if (mode === "dry-run") {
    console.log("\nNo writes performed. Re-run with --apply to commit.");
  } else if (report.rowsUpdated === 0) {
    console.log("\nNothing to do — dataset already clean.");
  } else {
    console.log(
      `\n✓ Flipped ${report.rowsUpdated} portal_responses row(s) to processed=true and wrote one summary audit row.`,
    );
  }
}

interface ParsedArgs extends BackfillOptions {}

function parseArgs(argv: string[]): ParsedArgs {
  const opts: ParsedArgs = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      // pnpm forwards the literal `--` separator; treat it as a no-op.
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
        throw new Error("--limit must be a positive integer");
      }
      opts.limit = n;
    } else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: backfill:clear-phrase-signature-ack-processed [--apply] [--limit N]",
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
    `[backfill] starting clear-phrase-signature-ack-processed backfill (${mode})`,
  );
  if (opts.limit !== undefined) {
    console.log(`  limit: ${opts.limit}`);
  }

  const report = await runBackfill(opts);
  printReport(report, mode);
}

const isMain = (() => {
  return (
    !!process.argv[1] &&
    process.argv[1].endsWith(
      "2026-05-clear-phrase-signature-ack-processed-backfill.ts",
    )
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

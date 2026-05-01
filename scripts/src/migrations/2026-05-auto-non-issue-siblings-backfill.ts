// One-shot retroactive backfill for Task #260: apply the "auto non-issue
// blank sibling" rule (Task #232) to invoice groups that pre-date the
// rule or that haven't been touched by an operator since.
//
// --- Rule restated (must stay in sync with autoExcludeBlankSiblingsOnPromote in
//     artifacts/api-server/src/lib/group-transitions.ts) -----------------
//   Trigger (live path):    group transition Needs Review → Needs Evidence
//                           with source = auto_after_classify.
//   Qualifying predicate:   the group has at least one leg whose
//                           `errorDetails` is a non-empty trimmed string.
//   Target predicate:       sibling legs that are still
//                           `included_in_dispute = true`, have no
//                           `error_type_id`, and whose `errorDetails` is
//                           NULL or empty after trim.
//   Action:                 mark each target leg excluded with
//                           reason = "non_issue", routed through the
//                           shared `excludeLegCore` helper so the row
//                           update + audit_log write match the live path
//                           1:1.
//   All-blank case:         when *no* leg in the group has errorDetails,
//                           the rule explicitly does nothing — the
//                           operator has to triage by hand. The backfill
//                           respects this and skips those groups.
//   Idempotency:            re-running is a no-op because the target
//                           predicate filters to legs that are still in
//                           dispute. Once flipped, they stop matching.
//
// --- Schema note ---------------------------------------------------------
// Production is on the older exclusion shape (`included_in_dispute` bool
// + drop_reason / drop_note / dropped_at columns); some dev branches use
// `excluded_at` / `exclusion_reason` instead. This script never writes
// the exclusion fields directly — every flip funnels through
// `excludeLegCore`, which only sets `included_in_dispute = false` and
// inserts the audit row. Whatever extra columns exist on either schema
// are left untouched, exactly as the live auto-exclude path leaves them.
//
// --- To run --------------------------------------------------------------
//   Dry-run plan (no writes):
//     pnpm --filter @workspace/scripts run backfill:auto-non-issue-siblings
//   Apply (writes the flips + audit rows):
//     pnpm --filter @workspace/scripts run backfill:auto-non-issue-siblings -- --apply
//   Scope to the strict-retro slice (groups already past the trigger point):
//     pnpm --filter @workspace/scripts run backfill:auto-non-issue-siblings -- \
//       --apply --group-status "Awaiting Response" --group-status "On Hold" \
//       --group-status "Resolved"
//   Spot-check a single group:
//     pnpm --filter @workspace/scripts run backfill:auto-non-issue-siblings -- \
//       --group-id 1234
//   Cap the number of groups walked (useful with --apply for staged rollout):
//     pnpm --filter @workspace/scripts run backfill:auto-non-issue-siblings -- \
//       --apply --limit 50
//
// Rows produced by this script are tagged with
//   audit_logs.metadata->>'source' = 'retro_auto_non_issue_backfill'
// so they can be told apart from live auto-exclusion rows whose source is
// 'auto_after_classify_sibling_clear', and from manual exclusions whose
// source is 'manual'.

import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
  type Claim,
  type InvoiceGroup,
} from "@workspace/db";
import { eq, gt, inArray, asc } from "drizzle-orm";
import {
  excludeLegCore,
  type DbExecutor,
} from "@workspace/api-server/src/lib/claim-transitions";

// Source string written into `audit_logs.metadata.source` for every row
// this script flips. Distinct from the live auto-exclusion source so
// operators can SQL-filter to find rows produced by this run versus the
// live trigger.
export const RETRO_BACKFILL_SOURCE = "retro_auto_non_issue_backfill";

// System actor stamped on the audit row when nobody is watching. The
// userEmail string makes these rows easy to find post-run.
const SYSTEM_ACTOR = {
  userEmail: "system@retro-auto-non-issue-backfill",
  userName: "Retro Auto Non-Issue Backfill",
};

interface SkippedLeg {
  groupId: number;
  legId: number;
  reason: string;
}

export interface BackfillReport {
  groupsScanned: number;
  qualifyingGroups: number;
  allBlankGroupsSkipped: number;
  noTargetLegsSkipped: number;
  legsFlipped: number;
  legsAlreadyExcluded: number;
  perStatusFlips: Record<string, number>;
  perStatusQualifying: Record<string, number>;
  skippedLegs: SkippedLeg[];
  preview: Array<{ groupId: number; status: string; targetLegIds: number[] }>;
}

function newReport(): BackfillReport {
  return {
    groupsScanned: 0,
    qualifyingGroups: 0,
    allBlankGroupsSkipped: 0,
    noTargetLegsSkipped: 0,
    legsFlipped: 0,
    legsAlreadyExcluded: 0,
    perStatusFlips: {},
    perStatusQualifying: {},
    skippedLegs: [],
    preview: [],
  };
}

export interface BackfillOptions {
  apply: boolean;
  /** Restrict to invoice_groups.status ∈ this set. Empty = no restriction. */
  statuses: string[];
  /** Cap on how many invoice groups to walk total. */
  limit?: number;
  /** Single-group spot check. Overrides statuses + limit. */
  groupId?: number;
  /** Optional executor (used by tests to plug in a transaction). */
  executor?: DbExecutor;
  /** When true, suppress per-row console output (used by the test). */
  silent?: boolean;
}

function isQualifyingLeg(l: Claim): boolean {
  return typeof l.errorDetails === "string" && l.errorDetails.trim().length > 0;
}

function isTargetLeg(l: Claim): boolean {
  return (
    l.includedInDispute === true &&
    (l.errorTypeId === null || l.errorTypeId === "") &&
    (l.errorDetails === null ||
      (typeof l.errorDetails === "string" && l.errorDetails.trim() === ""))
  );
}

// Keyset page size for the group scan. Picked to keep each leg lookup's
// IN (...) list comfortably under Postgres' parameter ceiling and to bound
// peak memory at ~one batch of legs at a time.
const GROUP_BATCH_SIZE = 200;

async function* streamGroupBatches(
  ex: DbExecutor,
  opts: Pick<BackfillOptions, "groupId">,
): AsyncGenerator<InvoiceGroup[], void, void> {
  if (opts.groupId !== undefined) {
    const rows = await ex
      .select()
      .from(invoiceGroupsTable)
      .where(eq(invoiceGroupsTable.id, opts.groupId));
    if (rows.length > 0) yield rows;
    return;
  }
  // Keyset pagination by id so memory stays bounded even on large
  // datasets. Status filtering is done in JS in the caller — the dataset
  // is small enough that the extra rows we drop per page are negligible,
  // and it avoids constructing a typed enum-array filter here.
  let lastId = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await ex
      .select()
      .from(invoiceGroupsTable)
      .where(gt(invoiceGroupsTable.id, lastId))
      .orderBy(asc(invoiceGroupsTable.id))
      .limit(GROUP_BATCH_SIZE);
    if (rows.length === 0) return;
    yield rows;
    lastId = rows[rows.length - 1]!.id;
    if (rows.length < GROUP_BATCH_SIZE) return;
  }
}

async function loadLegsForGroups(
  ex: DbExecutor,
  groupIds: number[],
): Promise<Map<number, Claim[]>> {
  const byGroup = new Map<number, Claim[]>();
  if (groupIds.length === 0) return byGroup;
  const rows = await ex
    .select()
    .from(claimsTable)
    .where(inArray(claimsTable.invoiceGroupId, groupIds));
  for (const r of rows) {
    if (r.invoiceGroupId == null) continue;
    const arr = byGroup.get(r.invoiceGroupId);
    if (arr) arr.push(r);
    else byGroup.set(r.invoiceGroupId, [r]);
  }
  return byGroup;
}

export async function runBackfill(opts: BackfillOptions): Promise<BackfillReport> {
  const report = newReport();
  const ex: DbExecutor = opts.executor ?? db;
  const log = opts.silent ? () => undefined : (msg: string) => console.log(msg);
  const allow =
    opts.statuses.length > 0 && opts.groupId === undefined
      ? new Set(opts.statuses)
      : null;
  const limit = opts.groupId === undefined ? opts.limit : undefined;

  for await (const rawBatch of streamGroupBatches(ex, opts)) {
    let batch = allow ? rawBatch.filter((g) => allow.has(g.status)) : rawBatch;
    if (limit !== undefined) {
      const remaining = limit - report.groupsScanned;
      if (remaining <= 0) break;
      if (batch.length > remaining) batch = batch.slice(0, remaining);
    }
    if (batch.length === 0) continue;

    report.groupsScanned += batch.length;

    const legsByGroup = await loadLegsForGroups(
      ex,
      batch.map((g) => g.id),
    );

    for (const g of batch) {
      const legs = legsByGroup.get(g.id) ?? [];
      if (legs.length === 0) continue;

      const hasQualifying = legs.some(isQualifyingLeg);
      if (!hasQualifying) {
        // All-blank group — the live rule explicitly leaves these for
        // manual triage. The backfill must do the same. Note the skip
        // separately from "qualifying group with no target legs".
        report.allBlankGroupsSkipped += 1;
        continue;
      }

      report.qualifyingGroups += 1;
      report.perStatusQualifying[g.status] =
        (report.perStatusQualifying[g.status] ?? 0) + 1;

      const targets = legs.filter(isTargetLeg);
      if (targets.length === 0) {
        // Qualifying group, but no in-dispute blank siblings remain — the
        // live rule already ran (or there was nothing to do). Skip.
        report.noTargetLegsSkipped += 1;
        continue;
      }

      if (report.preview.length < 25) {
        report.preview.push({
          groupId: g.id,
          status: g.status,
          targetLegIds: targets.map((t) => t.id),
        });
      }

      if (!opts.apply) {
        report.legsFlipped += targets.length;
        report.perStatusFlips[g.status] =
          (report.perStatusFlips[g.status] ?? 0) + targets.length;
        continue;
      }

      // Wrap each group's flips in one transaction so a partial group never
      // lands. Mirrors the live transition code's per-group atomicity.
      await db.transaction(async (tx) => {
        for (const leg of targets) {
          // Re-read the leg row inside the tx — defensive against a race
          // where another writer already flipped it between the dry-run
          // load and now. This is also what the live auto-exclude path
          // achieves implicitly because it loads everything fresh inside
          // the group-transition tx.
          const [fresh] = await tx
            .select()
            .from(claimsTable)
            .where(eq(claimsTable.id, leg.id));
          if (!fresh) {
            report.skippedLegs.push({
              groupId: g.id,
              legId: leg.id,
              reason: "leg_vanished",
            });
            continue;
          }
          if (!isTargetLeg(fresh)) {
            // Either already excluded, or the operator just classified it.
            // Either way, no-op without inserting a redundant audit row.
            report.legsAlreadyExcluded += 1;
            continue;
          }
          await excludeLegCore({
            claimId: fresh.id,
            reason: "non_issue",
            note: null,
            source: RETRO_BACKFILL_SOURCE,
            actor: SYSTEM_ACTOR,
            leg: fresh,
            trustCallerStateGuard: true,
            ex: tx,
          });
          report.legsFlipped += 1;
          report.perStatusFlips[g.status] =
            (report.perStatusFlips[g.status] ?? 0) + 1;
          log(
            `  flip: group#${g.id} (${g.status}) leg#${fresh.id} → excluded (non_issue)`,
          );
        }
      });
    }
  }

  return report;
}

function printReport(report: BackfillReport, mode: "dry-run" | "apply"): void {
  console.log("\n===== BACKFILL VERIFICATION REPORT =====");
  console.log(`mode:                          ${mode}`);
  console.log(`groups scanned:                ${report.groupsScanned}`);
  console.log(`qualifying groups:             ${report.qualifyingGroups}`);
  console.log(`all-blank groups skipped:      ${report.allBlankGroupsSkipped}`);
  console.log(`no-target groups skipped:      ${report.noTargetLegsSkipped}`);
  console.log(`legs ${mode === "apply" ? "flipped" : "to flip"}:                ${report.legsFlipped}`);
  if (mode === "apply" && report.legsAlreadyExcluded > 0) {
    console.log(`legs already excluded (no-op): ${report.legsAlreadyExcluded}`);
  }

  const statuses = Array.from(
    new Set([
      ...Object.keys(report.perStatusFlips),
      ...Object.keys(report.perStatusQualifying),
    ]),
  ).sort();
  if (statuses.length > 0) {
    console.log("\nbreakdown by invoice_groups.status:");
    for (const s of statuses) {
      const q = report.perStatusQualifying[s] ?? 0;
      const f = report.perStatusFlips[s] ?? 0;
      console.log(`  ${s.padEnd(20)} qualifying=${q.toString().padStart(4)}  legs=${f}`);
    }
  }

  if (report.preview.length > 0) {
    console.log("\nfirst groups (preview, capped at 25):");
    for (const p of report.preview) {
      console.log(
        `  group#${p.groupId} (${p.status}) → legs: [${p.targetLegIds.join(", ")}]`,
      );
    }
  }

  if (report.skippedLegs.length > 0) {
    console.log(`\n${report.skippedLegs.length} legs the helper refused to flip:`);
    for (const s of report.skippedLegs.slice(0, 25)) {
      console.log(`  group#${s.groupId} leg#${s.legId}: ${s.reason}`);
    }
  }

  if (mode === "dry-run") {
    console.log("\nNo writes performed. Re-run with --apply to commit.");
  } else if (report.legsFlipped === 0) {
    console.log("\nNothing to do — dataset already clean.");
  } else {
    console.log(`\n✓ Applied ${report.legsFlipped} leg flips.`);
  }
}

interface ParsedArgs extends BackfillOptions {}

function parseArgs(argv: string[]): ParsedArgs {
  const opts: ParsedArgs = { apply: false, statuses: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      // pnpm forwards the literal `--` separator; treat it as a no-op so
      // `pnpm run … -- --apply` works out of the box.
      continue;
    } else if (a === "--apply") {
      opts.apply = true;
    } else if (a === "--group-status") {
      const v = argv[++i];
      if (!v) throw new Error("--group-status requires a value");
      opts.statuses.push(v);
    } else if (a.startsWith("--group-status=")) {
      opts.statuses.push(a.slice("--group-status=".length));
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
    } else if (a === "--group-id") {
      const v = argv[++i];
      if (!v) throw new Error("--group-id requires a value");
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--group-id must be a positive integer, got "${v}"`);
      }
      opts.groupId = n;
    } else if (a.startsWith("--group-id=")) {
      const n = Number(a.slice("--group-id=".length));
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--group-id must be a positive integer`);
      }
      opts.groupId = n;
    } else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: backfill:auto-non-issue-siblings [--apply]",
          "                                       [--group-status STATUS]...",
          "                                       [--limit N]",
          "                                       [--group-id ID]",
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
  console.log(`[backfill] starting auto-non-issue-siblings retro backfill (${mode})`);
  if (opts.statuses.length > 0) {
    console.log(`  group-status filter: ${opts.statuses.join(", ")}`);
  }
  if (opts.limit !== undefined) {
    console.log(`  limit: ${opts.limit}`);
  }
  if (opts.groupId !== undefined) {
    console.log(`  group-id: ${opts.groupId}`);
  }

  const report = await runBackfill(opts);
  printReport(report, mode);

  // Suppress unused-import warnings on the no-op path.
  void auditLogsTable;
}

const isMain = (() => {
  // tsx invokes the file as the entrypoint; the per-leg-state-backfill
  // uses the same `main()`-then-pool.end pattern. Match it.
  return process.argv[1] && process.argv[1].endsWith("2026-05-auto-non-issue-siblings-backfill.ts");
})();

if (isMain) {
  main()
    .then(() => pool.end().then(() => process.exit(0)))
    .catch((err) => {
      console.error("[backfill] FAILED", err);
      pool.end().finally(() => process.exit(1));
    });
}

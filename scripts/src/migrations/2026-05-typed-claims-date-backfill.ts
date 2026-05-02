// One-shot pre-migration normalizer for Task #351: prepare
// `claims.date` (TEXT) for the column-type swap to native DATE in
// migration 0022.
//
// --- Context -------------------------------------------------------------
// Migration 0021 backfilled most rows to ISO `YYYY-MM-DD`, but operators
// may have re-imported legacy `M/D/YYYY` / `M/D/YY` rows in the
// intervening window. The new `claims.date` column type rewrite uses a
// defensive USING clause that mirrors `normalizeServiceDate`, but a
// row whose value doesn't match ANY of the supported shapes (e.g.
// `"unknown"`, partial like `"2026"`, or a stray timestamp) will be
// silently nulled by that USING clause. This script is the supported
// audit/cleanup path: in dry-run mode it lists every row that would
// either get normalized OR silently lose data, so operators can fix
// the source records before the schema swap.
//
// --- Rule restated -------------------------------------------------------
//   Candidate predicate: claim.date IS NOT NULL AND claim.date <> ''
//                        AND claim.date !~ '^\\d{4}-\\d{2}-\\d{2}$'
//   For each candidate:
//     1. Run `normalizeServiceDate(date)`.
//        - Returns ISO string → stamp date = normalized,
//          insert one `claim_date_normalized` audit row carrying
//          { from, to, source, backfillId }.
//        - Returns null → record under "unparseable" so the operator
//          can review by hand. NEVER auto-nulls the column under
//          `--apply` — silent data loss is exactly what migration 0022
//          wants this script to surface, not repeat.
//   Idempotency: re-running picks up only rows whose `date` still
//   doesn't match ISO. Once stamped, they pass the SQL filter and
//   stop matching.
//
// --- To run --------------------------------------------------------------
//   Dry-run plan (no writes):
//     pnpm --filter @workspace/scripts run backfill:typed-claims-date
//   Apply (writes the normalized date stamps + audit rows):
//     pnpm --filter @workspace/scripts run backfill:typed-claims-date -- --apply
//   Spot-check a single claim:
//     pnpm --filter @workspace/scripts run backfill:typed-claims-date -- \
//       --claim-id 14885393
//   Cap the number of claims walked (useful with --apply for staged rollout):
//     pnpm --filter @workspace/scripts run backfill:typed-claims-date -- \
//       --apply --limit 50
//
// Audit rows are tagged two ways:
//   1. metadata.source = 'typed_claims_date_backfill'
//      (script-specific source string, mirrors the convention used by
//       `2026-05-pre-group-leg-sop-outcome-backfill.ts`).
//   2. metadata.backfillId = '2026-05-typed-claims-date'
//      (uniform Task #268 backfill registry id stamped by every one-shot
//       backfill — see `_backfill-audit.ts` and the saved query in
//       `_backfill-audit-rows.sql`).

import {
  db,
  pool,
  claimsTable,
  auditLogsTable,
  type Claim,
} from "@workspace/db";
import { and, asc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { normalizeServiceDate } from "@workspace/api-server/src/lib/dates";
import type { DbExecutor } from "@workspace/api-server/src/lib/claim-transitions";
import { BACKFILL_IDS, withBackfillId } from "./_backfill-audit";

export const BACKFILL_SOURCE = "typed_claims_date_backfill";
export const BACKFILL_ID = BACKFILL_IDS.typedClaimsDate;

const SYSTEM_ACTOR = {
  userEmail: "system@typed-claims-date-backfill",
  userName: "Typed Claims Date Backfill",
};

export interface NormalizedClaim {
  claimId: number;
  confNumber: string;
  from: string;
  to: string;
}

export interface UnparseableClaim {
  claimId: number;
  confNumber: string;
  rawDate: string;
}

export interface BackfillReport {
  /** Total rows in `claims` (regardless of date shape). */
  claimsTotal: number;
  /** Rows whose `date` is NULL or empty (unchanged by the script). */
  claimsEmpty: number;
  /** Rows already in canonical `YYYY-MM-DD` shape (unchanged). */
  claimsAlreadyIso: number;
  /** Non-ISO candidate rows the script actually walked. */
  claimsScanned: number;
  /**
   * Of `claimsScanned`, the rows the script normalized to ISO.
   * In dry-run, this is the rows that would be normalized.
   */
  claimsNormalized: number;
  /**
   * Of `claimsScanned`, rows whose date couldn't be normalized at all.
   * Surfaced in the report so an operator can fix the source CSV
   * before migration 0022 runs (the typed-DATE USING clause would
   * silently null these).
   */
  claimsUnparseable: number;
  preview: NormalizedClaim[];
  unparseable: UnparseableClaim[];
}

function newReport(): BackfillReport {
  return {
    claimsTotal: 0,
    claimsEmpty: 0,
    claimsAlreadyIso: 0,
    claimsScanned: 0,
    claimsNormalized: 0,
    claimsUnparseable: 0,
    preview: [],
    unparseable: [],
  };
}

/**
 * Three-way head count of `claims.date` as it stands right now:
 * already-ISO, empty/null, and non-ISO candidate. Computed in a
 * single round-trip so the report can show the operator exactly
 * how much of the table is migration-ready vs. still pending.
 *
 * Runs only against the TEXT-shaped column (the post-cutover
 * short-circuit handles the DATE case before this is invoked).
 */
async function countClaimsDateShape(ex: DbExecutor): Promise<{
  total: number;
  alreadyIso: number;
  empty: number;
  nonIso: number;
}> {
  const result = await withExecute(ex).execute(sql`
    SELECT
      COUNT(*)::bigint                                     AS total,
      COUNT(*) FILTER (
        WHERE "date" IS NOT NULL AND "date" <> ''
          AND "date" ~ '^\\d{4}-\\d{2}-\\d{2}$'
      )::bigint                                            AS already_iso,
      COUNT(*) FILTER (WHERE "date" IS NULL OR "date" = '')::bigint AS empty,
      COUNT(*) FILTER (
        WHERE "date" IS NOT NULL AND "date" <> ''
          AND "date" !~ '^\\d{4}-\\d{2}-\\d{2}$'
      )::bigint                                            AS non_iso
    FROM claims
  `);
  const row = (result.rows ?? [])[0] as
    | { total?: string | number; already_iso?: string | number; empty?: string | number; non_iso?: string | number }
    | undefined;
  return {
    total: Number(row?.total ?? 0),
    alreadyIso: Number(row?.already_iso ?? 0),
    empty: Number(row?.empty ?? 0),
    nonIso: Number(row?.non_iso ?? 0),
  };
}

export interface BackfillOptions {
  apply: boolean;
  /** Cap on how many candidate claims to walk total. */
  limit?: number;
  /** Single-claim spot check. Overrides limit. */
  claimId?: number;
  /** Optional executor (used by tests to plug in a transaction). */
  executor?: DbExecutor;
  /** When true, suppress per-row console output. */
  silent?: boolean;
}

const CLAIM_BATCH_SIZE = 200;

/** Returns true if the claim still needs normalization. */
export function isCandidateClaim(c: Claim): boolean {
  if (c.date == null) return false;
  const trimmed = c.date.trim();
  if (trimmed.length === 0) return false;
  // ISO already → not a candidate.
  return !/^\d{4}-\d{2}-\d{2}$/.test(trimmed);
}

async function* streamCandidateBatches(
  ex: DbExecutor,
  opts: Pick<BackfillOptions, "claimId">,
): AsyncGenerator<Claim[], void, void> {
  if (opts.claimId !== undefined) {
    const rows = await ex
      .select()
      .from(claimsTable)
      .where(eq(claimsTable.id, opts.claimId));
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
          isNotNull(claimsTable.date),
          // Filter out empty strings + already-ISO at the SQL layer so
          // the JS loop only walks rows that actually need work. The
          // text-typed column tolerates the regex predicate (the date
          // column type swap to DATE happens in migration 0022, AFTER
          // this script runs).
          sql`${claimsTable.date} <> ''`,
          sql`${claimsTable.date} !~ '^\\d{4}-\\d{2}-\\d{2}$'`,
        ),
      )
      .orderBy(asc(claimsTable.id))
      .limit(CLAIM_BATCH_SIZE);
    if (rows.length === 0) return;
    yield rows;
    lastId = rows[rows.length - 1]!.id;
    if (rows.length < CLAIM_BATCH_SIZE) return;
  }
}

/**
 * Returns true iff the live `claims.date` column is still TEXT — i.e.
 * the script can safely run its TEXT-only candidate query (`<> ''`
 * and `!~` regex predicates would 500 against a typed DATE column).
 * After migration 0022 has applied the column is `date`, every value
 * is canonical ISO (or NULL), and there is by definition nothing for
 * this script to normalize — we short-circuit with a no-op report.
 */
async function claimsDateColumnIsText(ex: DbExecutor): Promise<boolean> {
  const result = await withExecute(ex).execute(sql`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'claims'
      AND column_name = 'date'
  `);
  const row = (result.rows ?? [])[0] as { data_type?: string } | undefined;
  if (!row?.data_type) {
    throw new Error("could not introspect claims.date column type");
  }
  return row.data_type === "text";
}

function withExecute(ex: DbExecutor) {
  // Both `db` and a transaction handle expose `.execute` — typed via
  // an inline cast so we don't drag in DbExecutor changes.
  return ex as unknown as { execute(query: ReturnType<typeof sql>): Promise<{ rows?: unknown[] }> };
}

export async function runBackfill(opts: BackfillOptions): Promise<BackfillReport> {
  const report = newReport();
  const ex: DbExecutor = opts.executor ?? db;
  const log = opts.silent ? () => undefined : (msg: string) => console.log(msg);
  const limit = opts.claimId === undefined ? opts.limit : undefined;

  // Post-cutover short-circuit: once migration 0022 has run, the
  // column is DATE and there is nothing to normalize. Re-running the
  // script in that state must be a clean no-op so it can stay wired
  // into ops runbooks without surprising operators. We can't read the
  // shape head-count under a typed-date column (the script's regex
  // predicates are TEXT-only) so we just emit a marker report.
  if (!(await claimsDateColumnIsText(ex))) {
    log(
      "[backfill] claims.date is already DATE (migration 0022 applied) — nothing to do",
    );
    return report;
  }

  // Head-count snapshot of the column shape so the report can show
  // "X already ISO / Y empty / Z non-ISO candidates" — operators need
  // the full picture to decide whether the table is migration-ready.
  const counts = await countClaimsDateShape(ex);
  report.claimsTotal = counts.total;
  report.claimsAlreadyIso = counts.alreadyIso;
  report.claimsEmpty = counts.empty;

  for await (const rawBatch of streamCandidateBatches(ex, opts)) {
    let batch = rawBatch;
    if (limit !== undefined) {
      const remaining = limit - report.claimsScanned;
      if (remaining <= 0) break;
      if (batch.length > remaining) batch = batch.slice(0, remaining);
    }
    if (batch.length === 0) continue;

    report.claimsScanned += batch.length;

    for (const claim of batch) {
      // The single-claim path bypasses the SQL-level predicate, so re-check
      // here defensively.
      if (!isCandidateClaim(claim)) continue;

      const rawDate = claim.date!.trim();
      const normalized = normalizeServiceDate(rawDate);

      if (!normalized) {
        report.claimsUnparseable += 1;
        report.unparseable.push({
          claimId: claim.id,
          confNumber: claim.confNumber,
          rawDate,
        });
        continue;
      }

      if (report.preview.length < 25) {
        report.preview.push({
          claimId: claim.id,
          confNumber: claim.confNumber,
          from: rawDate,
          to: normalized,
        });
      }

      if (!opts.apply) {
        report.claimsNormalized += 1;
        continue;
      }

      // Per-claim transaction: stamp + audit row land atomically. The
      // migration 0022 ALTER COLUMN runs in its own tx and does not
      // overlap with this loop.
      await db.transaction(async (tx) => {
        const [fresh] = await tx
          .select()
          .from(claimsTable)
          .where(eq(claimsTable.id, claim.id));
        if (!fresh || !isCandidateClaim(fresh)) {
          // Race or already healed by another writer — quietly skip.
          return;
        }
        await tx
          .update(claimsTable)
          .set({ date: normalized })
          .where(eq(claimsTable.id, claim.id));
        await tx.insert(auditLogsTable).values({
          claimId: claim.id,
          action: "claim_date_normalized",
          details: `Normalized claim.date "${rawDate}" → "${normalized}"`,
          metadata: withBackfillId(
            {
              from: rawDate,
              to: normalized,
              source: BACKFILL_SOURCE,
            },
            BACKFILL_ID,
          ),
          userEmail: SYSTEM_ACTOR.userEmail,
          userName: SYSTEM_ACTOR.userName,
        });
      });

      report.claimsNormalized += 1;
      log(
        `  stamp: claim#${claim.id} (${claim.confNumber}) "${rawDate}" → "${normalized}"`,
      );
    }
  }

  // Single summary audit row for the unparseable cohort, when --apply.
  // Lets a future operator find the cutover-time list of bad rows
  // without re-running the script.
  if (opts.apply && report.unparseable.length > 0) {
    await db.insert(auditLogsTable).values({
      claimId: null,
      invoiceGroupId: null,
      action: "claims_dates_unparseable",
      details: `Found ${report.unparseable.length} claim row(s) with unparseable date — review before migration 0022 runs`,
      metadata: withBackfillId(
        {
          source: BACKFILL_SOURCE,
          unparseableCount: report.unparseable.length,
          // Cap embedded sample so the audit row stays small even if the
          // dataset has thousands of unparseable rows.
          sample: report.unparseable.slice(0, 50),
        },
        BACKFILL_ID,
      ),
      userEmail: SYSTEM_ACTOR.userEmail,
      userName: SYSTEM_ACTOR.userName,
    });
  }

  return report;
}

function printReport(report: BackfillReport, mode: "dry-run" | "apply"): void {
  console.log("\n===== BACKFILL VERIFICATION REPORT =====");
  console.log(`mode:                          ${mode}`);
  console.log(`claims rows total:             ${report.claimsTotal}`);
  console.log(`claims already ISO:            ${report.claimsAlreadyIso}`);
  console.log(`claims with empty/NULL date:   ${report.claimsEmpty}`);
  console.log(`claims scanned (candidates):   ${report.claimsScanned}`);
  console.log(`claims ${mode === "apply" ? "normalized" : "to normalize"}:           ${report.claimsNormalized}`);
  console.log(`claims unparseable:            ${report.claimsUnparseable}`);

  if (report.preview.length > 0) {
    console.log("\nfirst normalizations (preview, capped at 25):");
    for (const p of report.preview) {
      console.log(
        `  claim#${p.claimId} (${p.confNumber}): "${p.from}" → "${p.to}"`,
      );
    }
  }

  if (report.unparseable.length > 0) {
    console.log(
      `\n${report.unparseable.length} claims have an unparseable date — review by hand BEFORE running migration 0022 (the typed column will silently null these):`,
    );
    for (const u of report.unparseable.slice(0, 25)) {
      console.log(`  claim#${u.claimId} (${u.confNumber}): "${u.rawDate}"`);
    }
    if (report.unparseable.length > 25) {
      console.log(`  ... and ${report.unparseable.length - 25} more`);
    }
  }

  if (mode === "dry-run") {
    console.log("\nNo writes performed. Re-run with --apply to commit.");
  } else if (report.claimsNormalized === 0) {
    console.log("\nNothing to do — every claim.date is already ISO.");
  } else {
    console.log(`\n✓ Normalized ${report.claimsNormalized} claim(s).`);
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
    } else if (a === "--claim-id") {
      const v = argv[++i];
      if (!v) throw new Error("--claim-id requires a value");
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--claim-id must be a positive integer, got "${v}"`);
      }
      opts.claimId = n;
    } else if (a.startsWith("--claim-id=")) {
      const n = Number(a.slice("--claim-id=".length));
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--claim-id must be a positive integer`);
      }
      opts.claimId = n;
    } else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: backfill:typed-claims-date [--apply]",
          "                                  [--limit N]",
          "                                  [--claim-id ID]",
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
    `[backfill] starting typed-claims-date backfill (${mode})`,
  );
  if (opts.limit !== undefined) {
    console.log(`  limit: ${opts.limit}`);
  }
  if (opts.claimId !== undefined) {
    console.log(`  claim-id: ${opts.claimId}`);
  }

  const report = await runBackfill(opts);
  printReport(report, mode);
}

const isMain = (() => {
  return (
    process.argv[1] &&
    process.argv[1].endsWith("2026-05-typed-claims-date-backfill.ts")
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

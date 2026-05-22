/**
 * Portal index scanner — read-only discovery sweep.
 * ----------------------------------------------------------------------
 * Walks a contiguous range of customer-portal "All Tickets" list pages
 * (tpissues.medanswering.com/support/tickets?page=N), scrapes every
 * ticket row it sees, and appends the results to a JSONL file. A second
 * pass (or a separate query) joins the JSONL against `portal_submissions`
 * to surface tickets that exist on the portal but NOT in our database.
 *
 * What it does
 *   1. Acquires `portalBrowserGate` (so it can't collide with the
 *      submit bot or the per-ticket reader).
 *   2. For each page in [--start, --end], navigates to
 *      `${PORTAL_URL}/support/tickets?page=N`, parses the rows,
 *      and appends one JSON object per row to the output file.
 *   3. Stops early if a page returns zero rows (end of list reached).
 *   4. Uses the same `bot-session/state.json` as the submit bot, so it
 *      reuses the existing portal login.
 *
 * What it does NOT do
 *   - No DB writes. Output is JSONL only; the reconciliation step is
 *     a separate, deliberate action.
 *   - No per-ticket scraping. This file only enumerates row summaries
 *     (ticket id, subject, status, last-updated raw). Use
 *     `bot/portal-reader.ts` for per-ticket conversation reads.
 *
 * Output schema (one JSON object per line)
 *   { observedAt, page, ticketId, subject, status, lastUpdatedRaw,
 *     totalPagesHint }
 *
 * Usage
 *   cd artifacts/api-server
 *   pnpm exec tsx src/scripts/scan-portal-index.ts \
 *     --start 1 --end 25 \
 *     --out exports/portal-index-2026-05-21-pages-001-025.jsonl
 *
 *   Flags:
 *     --start N      first page (inclusive, default 1)
 *     --end N        last page (inclusive, REQUIRED)
 *     --out PATH     output JSONL path (default exports/portal-index-<ts>.jsonl)
 *     --pace-min MS  minimum jittered delay between pages (default 750)
 *     --pace-max MS  maximum jittered delay between pages (default 3000)
 *     --no-stop-on-empty  keep going even if a page has zero rows
 *
 * Fanout
 *   Each invocation owns one contiguous page range and one output file.
 *   To parallelize, run multiple invocations with non-overlapping
 *   --start/--end ranges. See the comment block at the bottom of this
 *   file for the recommended fanout pattern.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPortalIndexPage } from "../bot/portal-index-reader";
import { portalBrowserGate } from "../lib/portal-browser-gate";
import { logger } from "../lib/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getNumFlag(name: string, fallback?: number): number | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i >= process.argv.length - 1) return fallback;
  const n = parseInt(process.argv[i + 1], 10);
  return Number.isFinite(n) ? n : fallback;
}
function getStrFlag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i >= process.argv.length - 1) return fallback;
  return process.argv[i + 1];
}
function getBoolFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<number> {
  const start = getNumFlag("start", 1)!;
  const end = getNumFlag("end");
  if (!Number.isInteger(start) || start < 1) {
    console.error(`scan-portal-index: --start must be a positive integer, got ${start}`);
    return 2;
  }
  if (!end || !Number.isInteger(end) || end < start) {
    console.error("scan-portal-index: --end is required and must be a positive integer >= --start");
    return 2;
  }
  const paceMin = getNumFlag("pace-min", 750)!;
  const paceMax = getNumFlag("pace-max", 3000)!;
  if (paceMin < 0 || paceMax < 0 || paceMin > paceMax) {
    console.error(
      `scan-portal-index: invalid pace bounds (paceMin=${paceMin}, paceMax=${paceMax}); both must be >=0 and min <= max`,
    );
    return 2;
  }
  const stopOnEmpty = !getBoolFlag("no-stop-on-empty");
  // Default to readOnlySession=true so parallel fanout runs cannot race
  // to overwrite bot-session/state.json. Operator pre-warms the session
  // once (e.g. by running the single-process variant or a one-page scan
  // without --read-only-session) and then fans out batches that all
  // stay strictly read-only. Pass --allow-relogin to opt back into the
  // portal-reader behavior of silently re-logging in on stale state.
  const readOnlySession = !getBoolFlag("allow-relogin");

  const defaultOut = path.resolve(
    __dirname,
    `../../exports/portal-index-${new Date().toISOString().replace(/[:.]/g, "-")}-pages-${String(start).padStart(3, "0")}-${String(end).padStart(3, "0")}.jsonl`,
  );
  const outPath = path.resolve(getStrFlag("out", defaultOut)!);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const append = fs.createWriteStream(outPath, { flags: "a" });

  console.log(
    `[scan-portal-index] pages=${start}..${end} out=${outPath} pace=${paceMin}-${paceMax}ms stopOnEmpty=${stopOnEmpty} readOnlySession=${readOnlySession}`,
  );
  console.log(`[scan-portal-index] acquiring portalBrowserGate…`);

  const t0 = Date.now();
  let pagesScanned = 0;
  let rowsScraped = 0;
  let lastTotalPagesHint: number | null = null;
  // Surface stream errors instead of letting them silently truncate output.
  append.on("error", (err) => {
    logger.error({ err: err.message, outPath }, "scan-portal-index: JSONL write stream error");
    console.error(`[scan-portal-index] FATAL output stream error: ${err.message}`);
  });

  const runWork = async () => {
    for (let p = start; p <= end; p += 1) {
      if (p > start) {
        const jitter = paceMin + Math.floor(Math.random() * Math.max(1, paceMax - paceMin));
        await sleep(jitter);
      }
      let result;
      try {
        result = await readPortalIndexPage(p, { readOnlySession });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ page: p, err: msg }, "scan-portal-index: page failed");
        console.log(`[scan-portal-index] page ${p} FAILED: ${msg.slice(0, 200)}`);
        append.write(JSON.stringify({ observedAt: new Date().toISOString(), page: p, error: msg }) + "\n");
        continue;
      }
      pagesScanned += 1;
      lastTotalPagesHint = result.totalPagesHint ?? lastTotalPagesHint;
      for (const row of result.rows) {
        append.write(
          JSON.stringify({
            observedAt: new Date().toISOString(),
            page: p,
            ticketId: row.ticketId,
            subject: row.subject,
            status: row.status,
            lastUpdatedRaw: row.lastUpdatedRaw,
            totalPagesHint: result.totalPagesHint,
          }) + "\n",
        );
        rowsScraped += 1;
      }
      console.log(
        `[scan-portal-index] page ${p}/${end}: ${result.rows.length} rows (totalPagesHint=${result.totalPagesHint ?? "?"})`,
      );
      if (stopOnEmpty && result.empty) {
        console.log(`[scan-portal-index] page ${p} was empty — stopping early`);
        break;
      }
    }
  };

  const outcome = await portalBrowserGate.run("script:scan-portal-index", runWork);
  try {
    if (outcome.kind === "skipped") {
      console.error(`[scan-portal-index] gate busy (${outcome.reason}); retry when the cron is idle`);
      return 3;
    }
    await outcome.result;
  } finally {
    // Always flush the JSONL stream, even on unexpected throw, so partial
    // output is preserved for the operator to inspect / resume from.
    await new Promise<void>((res) => append.end(res));
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[scan-portal-index] done. pages=${pagesScanned} rows=${rowsScraped} totalPagesHint=${lastTotalPagesHint ?? "?"} elapsed=${elapsed}s out=${outPath}`,
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

/*
 * ============================================================================
 * FANOUT PLAN — running multiple instances in parallel
 * ============================================================================
 *
 * Constraint: `portalBrowserGate` is a PROCESS-LOCAL boolean. Two scanner
 * invocations inside the SAME api-server process cannot run concurrently —
 * the second will get `skipped`. Real parallelism requires separate Node
 * processes, each with their own Chromium and their own (read-only) copy
 * of `bot-session/state.json`.
 *
 * Two viable patterns:
 *
 *   (A) Sequential pages, one shell, one process. Trivially safe.
 *         pnpm exec tsx src/scripts/scan-portal-index.ts --start 1 --end 100
 *       Estimated: 100 pages × ~3-5s = 5-8 min wall clock.
 *
 *   (B) Parallel page ranges across N separate task environments
 *       (recommended for "100 pages reviewed in batches"):
 *
 *         Task 1: --start 1   --end 25  --out exports/portal-index-batch-1.jsonl
 *         Task 2: --start 26  --end 50  --out exports/portal-index-batch-2.jsonl
 *         Task 3: --start 51  --end 75  --out exports/portal-index-batch-3.jsonl
 *         Task 4: --start 76  --end 100 --out exports/portal-index-batch-4.jsonl
 *
 *       Each task runs in its own isolated environment (separate
 *       container, separate process, separate Chromium), so the in-process
 *       gate does not serialize them against each other.
 *
 *       The only shared resource that matters is `bot-session/state.json`.
 *       Reading the same state file from N processes is safe; the danger
 *       is N processes simultaneously WRITING it after a re-login race.
 *       Mitigations:
 *         1. Pre-warm the session before fanout: run one tiny scan
 *            (--start 1 --end 1) from the main env to ensure
 *            state.json is fresh, then fan out the rest.
 *         2. Each task can be given the env var
 *            MAS_PORTAL_USERNAME / MAS_PORTAL_PASSWORD blanked out so the
 *            stale-session branch THROWS instead of silently re-logging
 *            in. The orchestrator retries that task after re-warming.
 *
 *       Reconciliation step (after all batches land):
 *         cat exports/portal-index-batch-*.jsonl > exports/portal-index-all.jsonl
 *         psql ... \
 *           -c "CREATE TEMP TABLE observed (ticket_id text PRIMARY KEY)" \
 *           -c "\\copy observed FROM PROGRAM 'jq -r .ticketId exports/portal-index-all.jsonl | sort -u'" \
 *           -c "SELECT o.ticket_id
 *                 FROM observed o
 *                 LEFT JOIN portal_submissions ps
 *                   ON ps.portal_ticket_id = o.ticket_id
 *                WHERE ps.id IS NULL"
 *         → tickets visible on the portal that we have no record of.
 *
 * Suggested batch size: 25 pages per task. That's roughly 2-3 minutes of
 * work per task and gives the operator a clean "1 of 4 / 2 of 4 / …"
 * progress story without any single task running long enough to hit
 * a stale-session expiry.
 */

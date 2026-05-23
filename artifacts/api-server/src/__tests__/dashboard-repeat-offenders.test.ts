// Coverage for the /api/dashboard/repeat-offenders aggregation:
// pure-function unit tests for parseDays/parseLimit/trendFromCounts/
// aggregateRepeatOffenders/topErrorType/shapeRepeatOffenders, plus HTTP
// integration tests that boot a real Express server, seed claims with
// controlled createdAt timestamps, and verify the days/limit query
// params are honored and clamped end-to-end.
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express } from "express";
import { inArray } from "drizzle-orm";

import dashboardRouter, {
  parseDays,
  parseLimit,
  trendFromCounts,
  aggregateRepeatOffenders,
  topErrorType,
  shapeRepeatOffenders,
  buildSparklineBuckets,
  SPARKLINE_WEEKS,
  type RepeatOffenderInputRow,
  type RepeatOffenderShapedRow,
  type SparklineRow,
} from "../routes/dashboard";
import { db, pool, claimsTable } from "@workspace/db";

// =========================================================================
// parseDays
// =========================================================================
test("parseDays returns the parsed value when in range", () => {
  assert.equal(parseDays("7", 30), 7);
  assert.equal(parseDays("30", 30), 30);
  assert.equal(parseDays(45, 30), 45);
});

test("parseDays falls back when the input is not a positive number", () => {
  assert.equal(parseDays(undefined, 30), 30);
  assert.equal(parseDays(null, 30), 30);
  assert.equal(parseDays("abc", 30), 30);
  assert.equal(parseDays("0", 30), 30);
  assert.equal(parseDays("-5", 30), 30);
  assert.equal(parseDays(0, 30), 30);
  assert.equal(parseDays(-1, 30), 30);
});

test("parseDays clamps to the max (default 365)", () => {
  assert.equal(parseDays("9999", 30), 365);
  assert.equal(parseDays(1000, 30), 365);
  assert.equal(parseDays("365", 30), 365);
});

test("parseDays honors a custom max", () => {
  assert.equal(parseDays("100", 30, 7), 7);
  assert.equal(parseDays("3", 30, 7), 3);
});

test("parseDays floors fractional inputs", () => {
  assert.equal(parseDays(7.9, 30), 7);
});

// =========================================================================
// parseLimit
// =========================================================================
test("parseLimit returns the parsed value when in range", () => {
  assert.equal(parseLimit("5", 10), 5);
  assert.equal(parseLimit(25, 10), 25);
  assert.equal(parseLimit("50", 10), 50);
});

test("parseLimit falls back when the input is not a positive number", () => {
  assert.equal(parseLimit(undefined, 10), 10);
  assert.equal(parseLimit(null, 10), 10);
  assert.equal(parseLimit("0", 10), 10);
  assert.equal(parseLimit("-3", 10), 10);
  assert.equal(parseLimit("notanumber", 10), 10);
});

test("parseLimit clamps to the max (default 50)", () => {
  assert.equal(parseLimit("9999", 10), 50);
  assert.equal(parseLimit(100, 10), 50);
});

// =========================================================================
// trendFromCounts
// =========================================================================
test("trendFromCounts: 'up' when current > previous", () => {
  assert.equal(trendFromCounts(5, 3), "up");
  assert.equal(trendFromCounts(1, 0), "up");
});

test("trendFromCounts: 'down' when current < previous", () => {
  assert.equal(trendFromCounts(2, 4), "down");
  assert.equal(trendFromCounts(0, 1), "down");
});

test("trendFromCounts: 'flat' when current === previous", () => {
  assert.equal(trendFromCounts(0, 0), "flat");
  assert.equal(trendFromCounts(7, 7), "flat");
});

// =========================================================================
// aggregateRepeatOffenders — grouping correctness
// =========================================================================
function row(partial: Partial<RepeatOffenderInputRow> & { key: string | null; outcome: string }): RepeatOffenderInputRow {
  return {
    claimAmount: partial.claimAmount ?? null,
    date: partial.date ?? null,
    errorTypeName: partial.errorTypeName ?? null,
    invoiceNumber: partial.invoiceNumber ?? null,
    key: partial.key,
    outcome: partial.outcome,
  };
}

test("aggregate groups multiple claims by their key (carNumber/clientNumber)", () => {
  // The handler partitions rows into driver vs member payloads with a
  // different key; aggregate is key-agnostic, so the same logic covers
  // both groupings. We assert two distinct keys roll up to two entries.
  //
  // Repeat-offender stats roll up EVERY claim a driver/member appears on
  // (except outcome=Non-Issue): in this dispute tool, every imported claim
  // represents a payor rejection, so Pending/Approved/Denied/Withdrawn
  // claims all count toward rejectionCount and atRiskAmount.
  const map = aggregateRepeatOffenders([
    row({ key: "CAR-A", outcome: "Denied", claimAmount: "100.00", date: "2026-01-01", errorTypeName: "Missing Auth", invoiceNumber: "INV-1" }),
    row({ key: "CAR-A", outcome: "Denied", claimAmount: "50.50", date: "2026-01-05", errorTypeName: "Missing Auth", invoiceNumber: "INV-2" }),
    row({ key: "CAR-A", outcome: "Approved", claimAmount: "200.00", date: "2026-01-10", errorTypeName: null, invoiceNumber: "INV-3" }),
    row({ key: "CAR-B", outcome: "Denied", claimAmount: "25.00", date: "2026-01-02", errorTypeName: "Wrong Code", invoiceNumber: "INV-4" }),
  ]);

  assert.equal(map.size, 2, "two distinct keys should produce two aggregate entries");

  const a = map.get("CAR-A")!;
  assert.equal(a.rejectionCount, 3, "CAR-A has 3 rejection rows total (2 Denied + 1 Approved); only Non-Issue is excluded");
  assert.equal(a.deniedCount, 2, "deniedCount counts outcome=Denied only — used for win rate");
  assert.equal(a.approvedCount, 1, "approvedCount counts Approved + Partially Approved — used for win rate");
  assert.equal(a.atRiskAmount, 350.5, "atRiskAmount sums every rejection row's claimAmount (100+50.50+200)");
  assert.equal(a.lastRejectionDate, "2026-01-10", "lastRejectionDate is the max date across all rejection rows");
  assert.equal(a.mostRecentInvoice.invoiceNumber, "INV-3", "mostRecentInvoice tracks the newest claim regardless of outcome");
  assert.equal(topErrorType(a.errorTypeCounts), "Missing Auth");

  const b = map.get("CAR-B")!;
  assert.equal(b.rejectionCount, 1);
  assert.equal(b.atRiskAmount, 25);
  assert.equal(topErrorType(b.errorTypeCounts), "Wrong Code");
});

test("aggregate ignores rows with a null key", () => {
  const map = aggregateRepeatOffenders([
    row({ key: null, outcome: "Denied", claimAmount: "100", date: "2026-01-01", errorTypeName: "X", invoiceNumber: "INV-1" }),
    row({ key: "CAR-X", outcome: "Denied", claimAmount: "100", date: "2026-01-01", errorTypeName: "X", invoiceNumber: "INV-2" }),
  ]);
  assert.equal(map.size, 1);
  assert.ok(map.has("CAR-X"));
});

test("aggregate: 'Partially Approved' counts as both an approval (for winRate) and a rejection (for offender stats)", () => {
  // The original payor rejection is what got the claim into the system; a
  // Partially Approved disposition is a partial WIN of the dispute, but
  // the claim itself was still a rejection that the driver/member is
  // responsible for. So it counts in both buckets.
  const a = aggregateRepeatOffenders([
    row({ key: "CAR-P", outcome: "Partially Approved", claimAmount: "100", date: "2026-01-01" }),
  ]).get("CAR-P")!;
  assert.equal(a.approvedCount, 1, "Partially Approved feeds the winRate numerator");
  assert.equal(a.deniedCount, 0);
  assert.equal(a.rejectionCount, 1, "Partially Approved is still a rejection in the offender stats");
  assert.equal(a.atRiskAmount, 100, "atRiskAmount includes the Partially Approved amount");
});

test("aggregate: only outcome=Non-Issue is excluded from rejection counts; Pending/Withdrawn count", () => {
  // Non-Issue is the explicit "actually wasn't a rejection" escape hatch
  // and is the ONLY outcome that drops out of rejection rollups. Pending
  // (freshly imported, not yet disputed) and Withdrawn (we accepted the
  // loss) both still represent payor rejections that the driver/member
  // generated.
  const a = aggregateRepeatOffenders([
    row({ key: "CAR-N", outcome: "Pending", claimAmount: "100", date: "2026-01-01" }),
    row({ key: "CAR-N", outcome: "Withdrawn", claimAmount: "100", date: "2026-01-02" }),
    row({ key: "CAR-N", outcome: "Non-Issue", claimAmount: "100", date: "2026-01-03" }),
  ]).get("CAR-N")!;
  assert.equal(a.approvedCount, 0, "none of the three are approvals");
  assert.equal(a.deniedCount, 0, "none of the three are explicit Denied resolutions");
  assert.equal(a.rejectionCount, 2, "Pending + Withdrawn count as rejections; Non-Issue is excluded");
  assert.equal(a.atRiskAmount, 200, "atRiskAmount sums Pending + Withdrawn amounts; Non-Issue is excluded");
  assert.equal(a.lastRejectionDate, "2026-01-02", "lastRejectionDate is the max date across rejection rows (excludes Non-Issue)");
});

test("aggregate's topErrorType is computed across all rejection rows (every outcome except Non-Issue)", () => {
  // The 'top error type' surfaces WHY a driver/member keeps generating
  // rejected claims. That diagnostic question is independent of whether
  // we successfully disputed the rejection — an Approved-after-dispute
  // claim was still rejected for a reason, and that reason should count.
  const a = aggregateRepeatOffenders([
    row({ key: "CAR-E", outcome: "Denied", errorTypeName: "AlphaErr" }),
    row({ key: "CAR-E", outcome: "Denied", errorTypeName: "BetaErr" }),
    row({ key: "CAR-E", outcome: "Denied", errorTypeName: "BetaErr" }),
    row({ key: "CAR-E", outcome: "Approved", errorTypeName: "AlphaErr" }),
    row({ key: "CAR-E", outcome: "Approved", errorTypeName: "AlphaErr" }),
    row({ key: "CAR-E", outcome: "Approved", errorTypeName: "AlphaErr" }),
    // Non-Issue rows do NOT contribute to errorTypeCounts.
    row({ key: "CAR-E", outcome: "Non-Issue", errorTypeName: "GammaErr" }),
    row({ key: "CAR-E", outcome: "Non-Issue", errorTypeName: "GammaErr" }),
    row({ key: "CAR-E", outcome: "Non-Issue", errorTypeName: "GammaErr" }),
    row({ key: "CAR-E", outcome: "Non-Issue", errorTypeName: "GammaErr" }),
    row({ key: "CAR-E", outcome: "Non-Issue", errorTypeName: "GammaErr" }),
  ]).get("CAR-E")!;
  // Counts: AlphaErr=4 (1 Denied + 3 Approved), BetaErr=2 (Denied), GammaErr=0 (Non-Issue excluded).
  assert.equal(topErrorType(a.errorTypeCounts), "AlphaErr", "AlphaErr wins (4) over BetaErr (2); Non-Issue rows excluded");
});

test("topErrorType returns null on an empty count map", () => {
  assert.equal(topErrorType(new Map()), null);
});

// =========================================================================
// shapeRepeatOffenders — trend (up/down/flat)
// =========================================================================
function singleDenied(key: string, n: number): RepeatOffenderInputRow[] {
  return Array.from({ length: n }, () =>
    row({ key, outcome: "Denied", claimAmount: "10" }),
  );
}

test("shape: trend='up' when current rejections exceed prior", () => {
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders(singleDenied("CAR-T", 3)),
    aggregateRepeatOffenders(singleDenied("CAR-T", 1)),
    "carNumber",
    10,
  );
  assert.equal(out[0].trend, "up");
  assert.equal(out[0].previousRejectionCount, 1);
  assert.equal(out[0].rejectionCount, 3);
});

test("shape: trend='down' when current rejections fall below prior", () => {
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders(singleDenied("CAR-T", 1)),
    aggregateRepeatOffenders(singleDenied("CAR-T", 4)),
    "carNumber",
    10,
  );
  assert.equal(out[0].trend, "down");
  assert.equal(out[0].previousRejectionCount, 4);
});

test("shape: trend='flat' when current matches prior", () => {
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders(singleDenied("CAR-T", 2)),
    aggregateRepeatOffenders(singleDenied("CAR-T", 2)),
    "carNumber",
    10,
  );
  assert.equal(out[0].trend, "flat");
});

test("shape: previousRejectionCount is 0 when the key is absent from the prior map", () => {
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders(singleDenied("CAR-NEW", 2)),
    new Map(),
    "carNumber",
    10,
  );
  assert.equal(out[0].previousRejectionCount, 0);
  assert.equal(out[0].trend, "up", "any current rejections vs zero prior is 'up'");
});

// =========================================================================
// shapeRepeatOffenders — winRate
// =========================================================================
test("shape: winRate is null when no claims are resolved (all Pending)", () => {
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders([
      row({ key: "CAR-PEND", outcome: "Pending" }),
      row({ key: "CAR-PEND", outcome: "Pending" }),
    ]),
    new Map(),
    "carNumber",
    10,
  );
  assert.equal(out[0].winRate, null);
});

test("shape: winRate is null when all outcomes are Withdrawn (resolved bucket excludes withdrawals)", () => {
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders([
      row({ key: "CAR-WITH", outcome: "Withdrawn" }),
      row({ key: "CAR-WITH", outcome: "Withdrawn" }),
    ]),
    new Map(),
    "carNumber",
    10,
  );
  assert.equal(out[0].winRate, null);
});

test("shape: winRate rounds to 4 decimal places (1 approved / 3 resolved → 0.3333)", () => {
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders([
      row({ key: "CAR-RND", outcome: "Approved" }),
      row({ key: "CAR-RND", outcome: "Denied" }),
      row({ key: "CAR-RND", outcome: "Denied" }),
    ]),
    new Map(),
    "carNumber",
    10,
  );
  assert.equal(out[0].winRate, 0.3333);
});

test("shape: winRate is 0.25 with 1 approved + 3 denied", () => {
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders([
      row({ key: "CAR-Q", outcome: "Approved" }),
      row({ key: "CAR-Q", outcome: "Denied" }),
      row({ key: "CAR-Q", outcome: "Denied" }),
      row({ key: "CAR-Q", outcome: "Denied" }),
    ]),
    new Map(),
    "carNumber",
    10,
  );
  assert.equal(out[0].winRate, 0.25);
});

test("shape: winRate is 1 when all resolved are Approved (or Partially Approved)", () => {
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders([
      row({ key: "CAR-ALL", outcome: "Approved" }),
      row({ key: "CAR-ALL", outcome: "Partially Approved" }),
    ]),
    new Map(),
    "carNumber",
    10,
  );
  assert.equal(out[0].winRate, 1);
});

test("shape: winRate is 0 when there are denials but no approvals", () => {
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders([
      row({ key: "CAR-LOSS", outcome: "Denied" }),
      row({ key: "CAR-LOSS", outcome: "Denied" }),
    ]),
    new Map(),
    "carNumber",
    10,
  );
  assert.equal(out[0].winRate, 0);
});

// =========================================================================
// shapeRepeatOffenders — limit and sort behavior
// =========================================================================
test("shape: limit caps the returned list size", () => {
  const rows = ["CAR-L0", "CAR-L1", "CAR-L2", "CAR-L3", "CAR-L4"].flatMap(k => singleDenied(k, 1));
  const out = shapeRepeatOffenders(aggregateRepeatOffenders(rows), new Map(), "carNumber", 2);
  assert.equal(out.length, 2);
});

test("shape: list is sorted by rejectionCount desc, ties broken by atRiskAmount desc", () => {
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders([
      // CAR-A: 1 rejection, $50
      row({ key: "CAR-A", outcome: "Denied", claimAmount: "50" }),
      // CAR-B: 2 rejections, $20 total — should rank first
      row({ key: "CAR-B", outcome: "Denied", claimAmount: "10" }),
      row({ key: "CAR-B", outcome: "Denied", claimAmount: "10" }),
      // CAR-C: 1 rejection, $999 — beats CAR-A on the tiebreaker
      row({ key: "CAR-C", outcome: "Denied", claimAmount: "999" }),
    ]),
    new Map(),
    "carNumber",
    10,
  );
  assert.deepEqual(out.map(r => r.carNumber), ["CAR-B", "CAR-C", "CAR-A"]);
});

test("shape: emits clientNumber field (not carNumber/lastInvoiceNumber) for member grouping", () => {
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders([row({ key: "CLI-1", outcome: "Denied" })]),
    new Map(),
    "clientNumber",
    10,
  );
  assert.equal(out[0].clientNumber, "CLI-1");
  assert.equal(out[0].carNumber, undefined);
  assert.equal(out[0].lastInvoiceNumber, undefined);
});

test("shape: emits carNumber AND lastInvoiceNumber for driver grouping", () => {
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders([
      row({ key: "CAR-1", outcome: "Denied", date: "2026-01-01", invoiceNumber: "INV-Z" }),
    ]),
    new Map(),
    "carNumber",
    10,
  );
  assert.equal(out[0].carNumber, "CAR-1");
  assert.equal(out[0].lastInvoiceNumber, "INV-Z");
  assert.equal(out[0].clientNumber, undefined);
});

test("shape: atRiskAmount is rendered as a fixed-2-decimal string", () => {
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders([
      row({ key: "CAR-FX", outcome: "Denied", claimAmount: "100.5" }),
      row({ key: "CAR-FX", outcome: "Denied", claimAmount: "0.25" }),
    ]),
    new Map(),
    "carNumber",
    10,
  );
  assert.equal(out[0].atRiskAmount, "100.75");
});

// =========================================================================
// buildSparklineBuckets
// =========================================================================
test("sparkline: builds an 8-element per-key bucket array", () => {
  const rows: SparklineRow[] = [
    { key: "CAR-S1", outcome: "Denied", weekIndex: 0 },
    { key: "CAR-S1", outcome: "Denied", weekIndex: 7 },
    { key: "CAR-S1", outcome: "Denied", weekIndex: 7 },
    { key: "CAR-S2", outcome: "Denied", weekIndex: 3 },
  ];
  const out = buildSparklineBuckets(rows);
  assert.equal(out.size, 2);
  assert.deepEqual(out.get("CAR-S1"), [1, 0, 0, 0, 0, 0, 0, 2]);
  assert.deepEqual(out.get("CAR-S2"), [0, 0, 0, 1, 0, 0, 0, 0]);
  assert.equal(out.get("CAR-S1")!.length, SPARKLINE_WEEKS);
});

test("sparkline: ignores null keys, null weekIndex, and out-of-range indices", () => {
  const rows: SparklineRow[] = [
    { key: null, outcome: "Denied", weekIndex: 3 },
    { key: "CAR-X", outcome: "Denied", weekIndex: null },
    { key: "CAR-X", outcome: "Denied", weekIndex: -1 },
    { key: "CAR-X", outcome: "Denied", weekIndex: 8 },
    { key: "CAR-X", outcome: "Denied", weekIndex: 2 },
  ];
  const out = buildSparklineBuckets(rows);
  assert.deepEqual(out.get("CAR-X"), [0, 0, 1, 0, 0, 0, 0, 0]);
});

test("sparkline: excludes Non-Issue / No Action Needed (matches rejection rule)", () => {
  const rows: SparklineRow[] = [
    { key: "CAR-N", outcome: "Non-Issue", weekIndex: 1 },
    { key: "CAR-N", outcome: "No Action Needed", weekIndex: 2 },
    { key: "CAR-N", outcome: "Denied", weekIndex: 3 },
    { key: "CAR-N", outcome: "Pending", weekIndex: 4 },
    { key: "CAR-N", outcome: "Approved", weekIndex: 5 },
  ];
  const out = buildSparklineBuckets(rows);
  assert.deepEqual(out.get("CAR-N"), [0, 0, 0, 1, 1, 1, 0, 0]);
});

test("shape: weeklyBuckets is wired through from the sparkline map; defaults to 8 zeros when key is absent", () => {
  const buckets = new Map<string, number[]>([
    ["CAR-SP", [0, 1, 0, 0, 2, 0, 0, 3]],
  ]);
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders([
      row({ key: "CAR-SP", outcome: "Denied" }),
      row({ key: "CAR-MISS", outcome: "Denied" }),
    ]),
    new Map(),
    "carNumber",
    10,
    buckets,
  );
  const sp = out.find(r => r.carNumber === "CAR-SP")!;
  const miss = out.find(r => r.carNumber === "CAR-MISS")!;
  assert.deepEqual(sp.weeklyBuckets, [0, 1, 0, 0, 2, 0, 0, 3]);
  assert.equal(miss.weeklyBuckets.length, SPARKLINE_WEEKS);
  assert.deepEqual(miss.weeklyBuckets, [0, 0, 0, 0, 0, 0, 0, 0]);
});

test("shape: omitting the sparklineBuckets arg yields all-zero 8-element arrays", () => {
  const out = shapeRepeatOffenders(
    aggregateRepeatOffenders([row({ key: "CAR-DEF", outcome: "Denied" })]),
    new Map(),
    "carNumber",
    10,
  );
  assert.deepEqual(out[0].weeklyBuckets, [0, 0, 0, 0, 0, 0, 0, 0]);
});

// =========================================================================
// HTTP integration: verify days/limit query params reach the route, are
// honored end-to-end, and are clamped at the upper bound. Boots a real
// Express server with the dashboard router mounted; seeds claims with
// controlled createdAt timestamps in both the current and prior windows.
// =========================================================================
let server: http.Server;
let baseUrl: string;
const seededClaimIds: number[] = [];

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/api", dashboardRouter);

  await new Promise<void>((resolveListen, rejectListen) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolveListen();
      } else {
        rejectListen(new Error("Failed to obtain test server port"));
      }
    });
  });
});

after(async () => {
  if (seededClaimIds.length) {
    await db.delete(claimsTable).where(inArray(claimsTable.id, seededClaimIds)).catch(() => undefined);
  }
  server.closeAllConnections?.();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await pool.end().catch(() => undefined);
});

interface SeedClaimOpts {
  carNumber: string;
  clientNumber: string;
  outcome: "Pending" | "Approved" | "Denied" | "Partially Approved" | "Non-Issue" | "Withdrawn";
  claimAmount?: string;
  daysAgo: number; // Sets createdAt to now - daysAgo days
  errorTypeName?: string;
}

async function seedClaim(opts: SeedClaimOpts): Promise<number> {
  const created = new Date();
  created.setUTCDate(created.getUTCDate() - opts.daysAgo);
  // Pull a few hours back into the day too, so it doesn't sit exactly at
  // midnight where window boundary semantics could matter.
  created.setUTCHours(12, 0, 0, 0);

  const [inserted] = await db
    .insert(claimsTable)
    .values({
      confNumber: `TEST_RO_${Math.random().toString(36).slice(2)}_${Date.now()}`,
      carNumber: opts.carNumber,
      clientNumber: opts.clientNumber,
      outcome: opts.outcome,
      claimAmount: opts.claimAmount ?? null,
      errorTypeName: opts.errorTypeName ?? null,
      createdAt: created,
    })
    .returning({ id: claimsTable.id });
  seededClaimIds.push(inserted.id);
  return inserted.id;
}

interface RepeatOffendersResponse {
  days: number;
  previousPeriodDays: number;
  drivers: RepeatOffenderShapedRow[];
  members: RepeatOffenderShapedRow[];
  driverGroupsTotal: number;
  memberGroupsTotal: number;
}

async function fetchRepeatOffenders(qs: string): Promise<{ status: number; json: RepeatOffendersResponse }> {
  const url = new URL(`${baseUrl}/api/dashboard/repeat-offenders${qs}`);
  return new Promise((resolveReq, rejectReq) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "GET" },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try {
            resolveReq({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : ({} as RepeatOffendersResponse) });
          } catch (e) {
            rejectReq(e);
          }
        });
      },
    );
    req.on("error", rejectReq);
    req.end();
  });
}

test("HTTP: ?days=N is honored — claims older than the prior-window cutoff are excluded entirely", async () => {
  // Use unique sentinel keys so the assertions don't depend on whatever
  // other claims live in the DB.
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const car = `TEST_RO_DAYS_CAR_${suffix}`;
  const client = `TEST_RO_DAYS_CLI_${suffix}`;

  // 1 denial 2 days ago → in current window for days=7 and days=30.
  await seedClaim({ carNumber: car, clientNumber: client, outcome: "Denied", claimAmount: "100", daysAgo: 2 });
  // 1 denial 20 days ago → in prior window for days=7 (priorStart = 14d
  // back, so 20d sits BEFORE priorStart and is filtered out by the SQL
  // gte(createdAt, priorStart)). For days=30, 20d ago is in current.
  await seedClaim({ carNumber: car, clientNumber: client, outcome: "Denied", claimAmount: "200", daysAgo: 20 });

  // days=7: only the 2-days-ago denial counts.
  const seven = await fetchRepeatOffenders("?days=7&limit=50");
  assert.equal(seven.status, 200);
  assert.equal(seven.json.days, 7, "days echoed back as 7");
  assert.equal(seven.json.previousPeriodDays, 7);
  const sevenDriver = seven.json.drivers.find(d => d.carNumber === car);
  assert.ok(sevenDriver, "seeded driver must appear in the days=7 response");
  assert.equal(sevenDriver!.rejectionCount, 1, "only the in-window denial should count");
  assert.equal(sevenDriver!.atRiskAmount, "100.00");
  assert.equal(sevenDriver!.previousRejectionCount, 0, "20-days-ago claim is past the prior window for days=7");
  assert.equal(sevenDriver!.trend, "up", "1 current vs 0 prior is 'up'");

  // days=30: the 20-days-ago claim is now in the current window too.
  const thirty = await fetchRepeatOffenders("?days=30&limit=50");
  assert.equal(thirty.status, 200);
  assert.equal(thirty.json.days, 30);
  const thirtyDriver = thirty.json.drivers.find(d => d.carNumber === car);
  assert.ok(thirtyDriver, "seeded driver must appear in the days=30 response");
  assert.equal(thirtyDriver!.rejectionCount, 2, "both denials are in the days=30 current window");
  assert.equal(thirtyDriver!.atRiskAmount, "300.00");

  // Member grouping should mirror the same numbers under clientNumber.
  const member = thirty.json.members.find(m => m.clientNumber === client);
  assert.ok(member, "seeded member must appear in the days=30 response");
  assert.equal(member!.rejectionCount, 2);
  assert.equal(member!.atRiskAmount, "300.00");
});

test("HTTP: ?days=99999 is clamped to 365", async () => {
  const res = await fetchRepeatOffenders("?days=99999");
  assert.equal(res.status, 200);
  assert.equal(res.json.days, 365, "days must be clamped to the 365 max");
  assert.equal(res.json.previousPeriodDays, 365);
});

test("HTTP: invalid ?days falls back to the 30-day default", async () => {
  const res = await fetchRepeatOffenders("?days=not-a-number");
  assert.equal(res.status, 200);
  assert.equal(res.json.days, 30);
});

test("HTTP: ?limit=N is honored (drivers list is capped at N)", async () => {
  // Seed 3 unique drivers each with very high rejection counts so they're
  // guaranteed to land at the very top of the sorted list, regardless of
  // any other data in the DB. Then verify limit=1 returns at most 1 of
  // our sentinels and limit=10 returns all 3.
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const cars = [`TEST_RO_LIMIT_A_${suffix}`, `TEST_RO_LIMIT_B_${suffix}`, `TEST_RO_LIMIT_C_${suffix}`];
  // 25 denials each = far above any realistic per-driver count in the
  // dev DB → these three sentinels will dominate the sort.
  for (const car of cars) {
    for (let i = 0; i < 25; i++) {
      // Vary atRiskAmount slightly so the tie-break sort is deterministic.
      await seedClaim({
        carNumber: car,
        clientNumber: `TEST_RO_LIMIT_CLI_${suffix}`,
        outcome: "Denied",
        claimAmount: (100 + cars.indexOf(car) * 10).toFixed(2),
        daysAgo: 1,
      });
    }
  }

  // Sanity: with limit=10, all 3 sentinels appear.
  const wide = await fetchRepeatOffenders("?days=30&limit=10");
  assert.equal(wide.status, 200);
  const sentinelsWide = wide.json.drivers.filter(d => d.carNumber && cars.includes(d.carNumber));
  assert.equal(sentinelsWide.length, 3, "all 3 sentinels should appear in a limit=10 response");

  // limit=1 must return at most 1 sentinel (and since they're the
  // top-rejection drivers, the single returned row should be a sentinel).
  const tight = await fetchRepeatOffenders("?days=30&limit=1");
  assert.equal(tight.status, 200);
  assert.equal(tight.json.drivers.length, 1, "limit=1 caps the returned list at 1 row");
  assert.ok(
    cars.includes(tight.json.drivers[0].carNumber!),
    "the single returned driver should be one of our high-rejection sentinels",
  );

  // limit=2 must return exactly 2 of our sentinels (they dominate the sort).
  const two = await fetchRepeatOffenders("?days=30&limit=2");
  assert.equal(two.status, 200);
  const sentinelsTwo = two.json.drivers.filter(d => d.carNumber && cars.includes(d.carNumber));
  assert.equal(sentinelsTwo.length, 2, "limit=2 should expose exactly 2 sentinels");

  // Even though limit caps the list, driverGroupsTotal reflects the FULL
  // current-window grouping count (i.e. the limit doesn't truncate the
  // total count metric). Ensure the 3 sentinels are reflected there too.
  assert.ok(
    two.json.driverGroupsTotal >= 3,
    `driverGroupsTotal should include all sentinels even when limit truncates the list (got ${two.json.driverGroupsTotal})`,
  );
});

test("HTTP: ?limit=99999 is clamped to 50", async () => {
  // Seed 3 unique high-rejection-count sentinels so a clamped response
  // still has a knowable upper bound for sentinel presence. The key
  // assertion: drivers.length must never exceed 50 even when the client
  // asks for 99999.
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const cars = [`TEST_RO_CLAMP_A_${suffix}`, `TEST_RO_CLAMP_B_${suffix}`, `TEST_RO_CLAMP_C_${suffix}`];
  for (const car of cars) {
    for (let i = 0; i < 5; i++) {
      await seedClaim({
        carNumber: car,
        clientNumber: `TEST_RO_CLAMP_CLI_${suffix}`,
        outcome: "Denied",
        claimAmount: "10.00",
        daysAgo: 1,
      });
    }
  }

  const res = await fetchRepeatOffenders("?days=30&limit=99999");
  assert.equal(res.status, 200);
  assert.ok(
    res.json.drivers.length <= 50,
    `drivers list should be clamped to <=50 even when ?limit=99999 (got ${res.json.drivers.length})`,
  );
  assert.ok(
    res.json.members.length <= 50,
    `members list should also be clamped to <=50 (got ${res.json.members.length})`,
  );
});

test("HTTP: invalid ?limit falls back to the default of 10", async () => {
  // Seed 12 unique high-rejection sentinels, then request with no limit
  // and with an invalid limit; both should return at most 10 of them.
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const cars = Array.from({ length: 12 }, (_, i) => `TEST_RO_DEF_${i}_${suffix}`);
  for (const car of cars) {
    // 50 denials per sentinel → guaranteed to dominate the top-10 sort.
    for (let i = 0; i < 50; i++) {
      await seedClaim({
        carNumber: car,
        clientNumber: `TEST_RO_DEF_CLI_${suffix}`,
        outcome: "Denied",
        claimAmount: "1.00",
        daysAgo: 1,
      });
    }
  }

  const res = await fetchRepeatOffenders("?days=30&limit=abc");
  assert.equal(res.status, 200);
  // The default fallback is 10; with 12 dominating sentinels, the
  // returned drivers list must be exactly 10 long.
  assert.equal(res.json.drivers.length, 10, "invalid limit must fall back to the default of 10");
});

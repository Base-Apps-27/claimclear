// Task #753 — Responses Awaiting Review filter bar + leg context.
//
// Locks the new server contract added under Task #753 against the
// `GET /api/invoice-groups` handler:
//
//   1. New filter params on `buildInvoiceGroupWhere`:
//      - `serviceDateFrom` / `serviceDateTo` (ISO YYYY-MM-DD range over
//        invoice_groups.service_date)
//      - `responseReceivedFrom` / `responseReceivedTo` (range over
//        portal_responses.received_at via EXISTS, scoped to the group)
//      - `responseType` (CSV; EXISTS portal_responses with matching type)
//      - `clientNumber` (CSV; eq/inArray over invoice_groups.client_number)
//      - `q` wins over the legacy `search` alias.
//
//   2. New per-row fields on each list item:
//      - `legCount` — total number of legs attached to the group
//      - `primaryLeg` — `{id, confNumber}` of the leg the latest
//        reviewable portal response references; falls back to the
//        earliest leg by id when no reviewable response is present.
//
// Fixtures are scoped to a per-run `clientNumber` tag so the dev DB
// can carry unrelated rows safely (the assertion set is over the
// seeded subset).

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { inArray } from "drizzle-orm";

import invoiceGroupsRouter from "../routes/invoice-groups";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
  portalResponsesTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;
const seededClaimIds: number[] = [];
const seededGroupIds: number[] = [];
const seededResponseIds: number[] = [];

const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TAG = `T753A-${RUN_ID}`;
// Distinct prefix so an ilike on TAG never matches TAG_OTHER (Task
// #753: q-vs-search precedence test relies on the two tags being
// disjoint substrings).
const TAG_OTHER = `T753B-${RUN_ID}`;

const TEST_USER = { email: "rar-filters@example.com", displayName: "RAR Filters Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", invoiceGroupsRouter);

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      } else {
        reject(new Error("Failed to obtain test server port"));
      }
    });
  });
});

after(async () => {
  if (seededResponseIds.length) {
    await db.delete(portalResponsesTable).where(inArray(portalResponsesTable.id, seededResponseIds)).catch(() => undefined);
  }
  if (seededClaimIds.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.claimId, seededClaimIds)).catch(() => undefined);
    await db.delete(claimsTable).where(inArray(claimsTable.id, seededClaimIds)).catch(() => undefined);
  }
  if (seededGroupIds.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.invoiceGroupId, seededGroupIds)).catch(() => undefined);
    await db.delete(invoiceGroupsTable).where(inArray(invoiceGroupsTable.id, seededGroupIds)).catch(() => undefined);
  }
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end().catch(() => undefined);
});

function getJson(path: string): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${path}`);
    const req = http.request(
      { hostname: url.hostname, port: Number(url.port), path: `${url.pathname}${url.search}`, method: "GET" },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : {} }); }
          catch (e) { reject(e); }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function ymd(daysAgo: number): string {
  const ms = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

async function seedGroup(opts: {
  label: string;
  clientNumber?: string;
  serviceDate: string;
  status?: string;
}): Promise<number> {
  const [group] = await db.insert(invoiceGroupsTable).values({
    // Build the invoice_number off the same tag as client_number so a
    // free-text search on one tag never matches a row tagged with the
    // other (the q-vs-search precedence assertion below depends on this).
    invoiceNumber: `${opts.clientNumber ?? TAG}-G-${opts.label}`,
    clientNumber: opts.clientNumber ?? TAG,
    status: (opts.status as any) ?? "New",
    // `triage` is the only phase whose claim_disposition validation set
    // accepts the default `unclassified` disposition; we don't exercise
    // phase-specific semantics in these tests.
    phase: "triage",
    outcome: "Pending",
    totalAmount: "100.00",
    serviceDate: opts.serviceDate,
    errorTypeId: null,
    errorTypeName: null,
  }).returning();
  seededGroupIds.push(group.id);
  return group.id;
}

async function seedClaim(opts: {
  label: string;
  invoiceGroupId: number;
  date: string;
}): Promise<number> {
  const [claim] = await db.insert(claimsTable).values({
    confNumber: `${TAG}-C-${opts.label}`,
    clientNumber: TAG,
    status: "New",
    outcome: "Pending",
    date: opts.date,
    invoiceGroupId: opts.invoiceGroupId,
  }).returning();
  seededClaimIds.push(claim.id);
  return claim.id;
}

async function seedResponse(opts: {
  invoiceGroupId: number;
  claimId: number | null;
  responseType: "approval" | "denial" | "partial_approval" | "info_request" | "other" | "acknowledgment";
  receivedAt: Date;
}): Promise<number> {
  const [row] = await db.insert(portalResponsesTable).values({
    invoiceGroupId: opts.invoiceGroupId,
    claimId: opts.claimId,
    source: "email",
    responseType: opts.responseType,
    receivedAt: opts.receivedAt,
    processed: true,
  }).returning();
  seededResponseIds.push(row.id);
  return row.id;
}

// --- tests ----------------------------------------------------------------

test("invoice-groups list: each row carries legCount + primaryLeg (latest payor reply, any responseType)", async () => {
  const groupId = await seedGroup({ label: "leg-pair", serviceDate: ymd(5) });
  // 3 legs — earliest by id is the first inserted, but the latest
  // payor reply references the second one, so primaryLeg must lock to
  // that leg-of-record (NOT the earliest).
  const legA = await seedClaim({ label: "leg-a", invoiceGroupId: groupId, date: ymd(5) });
  const legB = await seedClaim({ label: "leg-b", invoiceGroupId: groupId, date: ymd(5) });
  const legC = await seedClaim({ label: "leg-c", invoiceGroupId: groupId, date: ymd(5) });
  await seedResponse({
    invoiceGroupId: groupId,
    claimId: legA,
    responseType: "approval",
    receivedAt: new Date(Date.now() - 60_000),
  });
  await seedResponse({
    invoiceGroupId: groupId,
    claimId: legB,
    responseType: "denial",
    receivedAt: new Date(Date.now() - 1_000),
  });

  const { status, json } = await getJson(`/api/invoice-groups?clientNumber=${TAG}&limit=500&includeExpired=true`);
  assert.equal(status, 200, `HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`);
  const row = (json.groups as Array<any>).find(g => g.id === groupId);
  assert.ok(row, "seeded group missing from list");
  assert.equal(row.legCount, 3, `expected legCount=3, got ${row.legCount}`);
  assert.ok(row.primaryLeg, "primaryLeg missing");
  assert.equal(row.primaryLeg.id, legB, `primaryLeg should be the leg referenced by the latest payor reply (legB=${legB}), got id=${row.primaryLeg.id}`);
  assert.equal(row.primaryLeg.confNumber, `${TAG}-C-leg-b`);
  // legC unused — keeps the count assertion meaningful.
  void legC;
});

test("invoice-groups list: primaryLeg locks to the leg referenced by an ack-latest reply (acknowledgment is a real payor reply)", async () => {
  // Regression: previously the primaryLeg query restricted to the
  // reviewable subset (approval/denial/partial_approval/info_request/
  // other), so an acknowledgment-latest thread fell back to the
  // earliest leg by id even though the operator was clearly reading
  // an ack tied to a specific leg. Acknowledgment is a real payor
  // reply per task #753, so the latest-payor-reply pick must include
  // it — otherwise the row meta line and the middle column header
  // disagree with the actual thread on screen.
  const groupId = await seedGroup({ label: "leg-ack-latest", serviceDate: ymd(5) });
  const legA = await seedClaim({ label: "ack-a", invoiceGroupId: groupId, date: ymd(5) });
  const legB = await seedClaim({ label: "ack-b", invoiceGroupId: groupId, date: ymd(5) });
  await seedResponse({
    invoiceGroupId: groupId,
    claimId: legB,
    responseType: "acknowledgment",
    receivedAt: new Date(),
  });
  const { json } = await getJson(`/api/invoice-groups?clientNumber=${TAG}&limit=500&includeExpired=true`);
  const row = (json.groups as Array<any>).find(g => g.id === groupId);
  assert.ok(row);
  assert.equal(row.legCount, 2);
  assert.equal(
    row.primaryLeg.id,
    legB,
    `primaryLeg must lock to the leg referenced by the ack-latest reply (legB=${legB}, got ${row.primaryLeg.id}). Acknowledgment counts as a payor reply for primaryLeg.`,
  );
  void legA;
});

test("invoice-groups list: primaryLeg falls back to earliest leg when the LATEST payor reply has claim_id=NULL (does NOT walk back to an older claim-linked reply)", async () => {
  // Regression: the primaryLeg query previously filtered by
  // `pr.claim_id IS NOT NULL`, so when the newest reply had a null
  // claim_id, the DISTINCT ON would silently pick an OLDER reply
  // that happened to be claim-linked — labelling the row with a leg
  // the operator isn't actually reading. Correct behaviour: anchor
  // on the true latest reply; if its claim_id is null, fall back to
  // earliest leg by id.
  const groupId = await seedGroup({ label: "leg-null-claim-latest", serviceDate: ymd(5) });
  const legA = await seedClaim({ label: "nc-a", invoiceGroupId: groupId, date: ymd(5) });
  const legB = await seedClaim({ label: "nc-b", invoiceGroupId: groupId, date: ymd(5) });
  // OLDER reply links to legB; NEWER reply has claim_id=NULL.
  const older = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const newer = new Date(Date.now() - 1 * 60 * 60 * 1000);
  await seedResponse({ invoiceGroupId: groupId, claimId: legB, responseType: "denial", receivedAt: older });
  await seedResponse({ invoiceGroupId: groupId, claimId: null, responseType: "info_request", receivedAt: newer });

  const { json } = await getJson(`/api/invoice-groups?clientNumber=${TAG}&limit=500&includeExpired=true`);
  const row = (json.groups as Array<any>).find(g => g.id === groupId);
  assert.ok(row);
  assert.equal(row.legCount, 2);
  assert.equal(
    row.primaryLeg.id,
    legA,
    `primaryLeg must fall back to the earliest leg (${legA}) when the LATEST payor reply has claim_id=NULL — not walk back to the older claim-linked reply (legB=${legB}). Got id=${row.primaryLeg.id}.`,
  );
});

test("invoice-groups list: primaryLeg falls back to earliest leg when there is no payor reply on file", async () => {
  const groupId = await seedGroup({ label: "leg-fallback", serviceDate: ymd(5) });
  const legA = await seedClaim({ label: "fb-a", invoiceGroupId: groupId, date: ymd(5) });
  const legB = await seedClaim({ label: "fb-b", invoiceGroupId: groupId, date: ymd(5) });
  // No portal_responses seeded → primaryLeg falls back to the
  // earliest leg by id.
  const { json } = await getJson(`/api/invoice-groups?clientNumber=${TAG}&limit=500&includeExpired=true`);
  const row = (json.groups as Array<any>).find(g => g.id === groupId);
  assert.ok(row);
  assert.equal(row.legCount, 2);
  assert.equal(row.primaryLeg.id, legA, `expected fallback to earliest leg (${legA}), got ${row.primaryLeg.id}`);
  void legB;
});

test("invoice-groups list: serviceDateFrom/serviceDateTo restrict by group service date", async () => {
  const oldGroup = await seedGroup({ label: "sd-old", serviceDate: ymd(45) });
  const midGroup = await seedGroup({ label: "sd-mid", serviceDate: ymd(15) });
  const newGroup = await seedGroup({ label: "sd-new", serviceDate: ymd(2) });

  const { json } = await getJson(
    `/api/invoice-groups?clientNumber=${TAG}&limit=500&includeExpired=true&serviceDateFrom=${ymd(20)}&serviceDateTo=${ymd(5)}`,
  );
  const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
  assert.ok(ids.includes(midGroup), `mid (id=${midGroup}, serviceDate=${ymd(15)}) should be inside the [${ymd(20)}, ${ymd(5)}] window`);
  assert.ok(!ids.includes(oldGroup), `old (id=${oldGroup}, serviceDate=${ymd(45)}) should be excluded`);
  assert.ok(!ids.includes(newGroup), `new (id=${newGroup}, serviceDate=${ymd(2)}) should be excluded`);
});

test("invoice-groups list: responseReceived range anchors on the LATEST payor reply (not 'EXISTS any')", async () => {
  // Construct a group whose LATEST payor reply is AFTER the upper
  // bound but whose OLDER reply is INSIDE the window. With strict
  // "latest-only" semantics the group must be excluded. An "EXISTS
  // any" implementation would (incorrectly) keep it because the
  // older response is inside the window.
  const groupId = await seedGroup({ label: "rrlatest", serviceDate: ymd(5) });
  const leg = await seedClaim({ label: "rrlatest-leg", invoiceGroupId: groupId, date: ymd(5) });
  const today = new Date();           // latest, AFTER upper bound
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // older, INSIDE window
  await seedResponse({ invoiceGroupId: groupId, claimId: leg, responseType: "approval", receivedAt: tenDaysAgo });
  await seedResponse({ invoiceGroupId: groupId, claimId: leg, responseType: "denial", receivedAt: today });

  const windowFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const windowTo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { json } = await getJson(
    `/api/invoice-groups?clientNumber=${TAG}&limit=500&includeExpired=true`
    + `&responseReceivedFrom=${windowFrom}&responseReceivedTo=${windowTo}`,
  );
  const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
  assert.ok(
    !ids.includes(groupId),
    `group ${groupId} must be excluded — its LATEST payor reply is after the upper bound, even though an older one is inside the window. responseReceivedFrom/To must anchor on the latest payor reply (not "EXISTS any").`,
  );
});

test("invoice-groups list: responseReceived window includes a group whose LATEST payor reply is an acknowledgment inside the window", async () => {
  // Regression for code review #3 reject: previously the
  // responseReceived range subquery restricted to the reviewable
  // subset, so an ack-latest thread received yesterday would be
  // dropped from a "yesterday" window even though the operator
  // clearly received that ack yesterday. Acknowledgment is a real
  // payor reply per task #753 and must count for the latest-row pick.
  const groupId = await seedGroup({ label: "rr-ack-latest", serviceDate: ymd(5) });
  const leg = await seedClaim({ label: "rr-ack-leg", invoiceGroupId: groupId, date: ymd(5) });
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  await seedResponse({ invoiceGroupId: groupId, claimId: leg, responseType: "acknowledgment", receivedAt: oneHourAgo });

  const windowFrom = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { json } = await getJson(
    `/api/invoice-groups?clientNumber=${TAG}&limit=500&includeExpired=true`
    + `&responseReceivedFrom=${windowFrom}`,
  );
  const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
  assert.ok(
    ids.includes(groupId),
    `group ${groupId} (latest payor reply = acknowledgment 1h ago) must be INCLUDED in a "received in the last day" window. Acknowledgment must NOT be excluded from the latest-payor-reply pick.`,
  );
});

test("invoice-groups list: q matches leg confNumber + claim id via EXISTS on claims", async () => {
  const groupId = await seedGroup({ label: "qleg", serviceDate: ymd(5) });
  const legId = await seedClaim({ label: "qleg-l", invoiceGroupId: groupId, date: ymd(5) });
  // Search by exact confNumber
  {
    const conf = `${TAG}-C-qleg-l`;
    const { json } = await getJson(`/api/invoice-groups?q=${encodeURIComponent(conf)}&limit=500&includeExpired=true`);
    const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
    assert.ok(ids.includes(groupId), `q=${conf} (leg confNumber) must surface group ${groupId}`);
  }
  // Search by raw claim id
  {
    const { json } = await getJson(`/api/invoice-groups?q=${legId}&limit=500&includeExpired=true`);
    const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
    assert.ok(ids.includes(groupId), `q=${legId} (claim id) must surface group ${groupId}`);
  }
});

test("invoice-groups list: responseType + responseReceived range filter via portal_responses EXISTS", async () => {
  const denialGroup = await seedGroup({ label: "rt-denial", serviceDate: ymd(5) });
  const approvalGroup = await seedGroup({ label: "rt-approval", serviceDate: ymd(5) });
  const denialLeg = await seedClaim({ label: "rt-d-leg", invoiceGroupId: denialGroup, date: ymd(5) });
  const approvalLeg = await seedClaim({ label: "rt-a-leg", invoiceGroupId: approvalGroup, date: ymd(5) });
  const recent = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
  const ancient = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10d ago
  await seedResponse({ invoiceGroupId: denialGroup, claimId: denialLeg, responseType: "denial", receivedAt: recent });
  await seedResponse({ invoiceGroupId: approvalGroup, claimId: approvalLeg, responseType: "approval", receivedAt: ancient });

  // responseType=denial → only denialGroup
  {
    const { json } = await getJson(`/api/invoice-groups?clientNumber=${TAG}&limit=500&includeExpired=true&responseType=denial`);
    const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
    assert.ok(ids.includes(denialGroup), `denialGroup ${denialGroup} missing from responseType=denial`);
    assert.ok(!ids.includes(approvalGroup), `approvalGroup ${approvalGroup} unexpectedly present in responseType=denial`);
  }
  // responseReceivedFrom = today (UTC) → drops the ancient row, keeps the recent one
  {
    const todayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { json } = await getJson(
      `/api/invoice-groups?clientNumber=${TAG}&limit=500&includeExpired=true&responseReceivedFrom=${encodeURIComponent(todayIso)}`,
    );
    const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
    assert.ok(ids.includes(denialGroup), `recent denial (${denialGroup}) should pass the responseReceivedFrom window`);
    assert.ok(!ids.includes(approvalGroup), `ancient approval (${approvalGroup}) must be excluded by responseReceivedFrom`);
  }
});

test("invoice-groups list: responseType anchors on the LATEST payor reply (not EXISTS-any) and includes acknowledgment", async () => {
  // A group whose latest payor reply is a denial, but an OLDER reply
  // is an approval. With "latest-only" semantics the group must
  // surface for responseType=denial and be excluded for
  // responseType=approval — even though an approval row exists.
  const flipGroup = await seedGroup({ label: "rt-latest-flip", serviceDate: ymd(5) });
  const flipLeg = await seedClaim({ label: "rt-latest-flip-leg", invoiceGroupId: flipGroup, date: ymd(5) });
  const older = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5d ago
  const newer = new Date(Date.now() - 1 * 60 * 60 * 1000);     // 1h ago
  await seedResponse({ invoiceGroupId: flipGroup, claimId: flipLeg, responseType: "approval", receivedAt: older });
  await seedResponse({ invoiceGroupId: flipGroup, claimId: flipLeg, responseType: "denial",   receivedAt: newer });

  // A second group whose LATEST payor reply is an acknowledgment.
  // responseType=acknowledgment must include this group; selecting
  // anything else must exclude it.
  const ackGroup = await seedGroup({ label: "rt-ack-latest", serviceDate: ymd(5) });
  const ackLeg = await seedClaim({ label: "rt-ack-latest-leg", invoiceGroupId: ackGroup, date: ymd(5) });
  await seedResponse({ invoiceGroupId: ackGroup, claimId: ackLeg, responseType: "acknowledgment", receivedAt: newer });

  // responseType=denial → MUST include flipGroup, MUST exclude ackGroup.
  {
    const { json } = await getJson(`/api/invoice-groups?clientNumber=${TAG}&limit=500&includeExpired=true&responseType=denial`);
    const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
    assert.ok(ids.includes(flipGroup), `flipGroup ${flipGroup} must surface for responseType=denial — its LATEST payor reply is a denial`);
    assert.ok(!ids.includes(ackGroup), `ackGroup ${ackGroup} must NOT surface for responseType=denial — its latest payor reply is an acknowledgment`);
  }
  // responseType=approval → MUST exclude flipGroup (older approval
  // shadowed by the newer denial under latest-only semantics).
  {
    const { json } = await getJson(`/api/invoice-groups?clientNumber=${TAG}&limit=500&includeExpired=true&responseType=approval`);
    const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
    assert.ok(
      !ids.includes(flipGroup),
      `flipGroup ${flipGroup} must NOT surface for responseType=approval — the older approval is shadowed by the newer denial. responseType must anchor on the latest payor reply, not "EXISTS any".`,
    );
  }
  // responseType=acknowledgment → MUST include ackGroup; acknowledgment
  // is a real responseType the operator can pick from the facet.
  {
    const { json } = await getJson(`/api/invoice-groups?clientNumber=${TAG}&limit=500&includeExpired=true&responseType=acknowledgment`);
    const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
    assert.ok(
      ids.includes(ackGroup),
      `ackGroup ${ackGroup} must surface for responseType=acknowledgment — acknowledgment is a real payor reply per task #753 and must be included in the latest-row pick.`,
    );
  }
});

test("invoice-groups list: clientNumber CSV filters strictly + q wins over search", async () => {
  const mineId = await seedGroup({ label: "cn-mine", serviceDate: ymd(5), clientNumber: TAG });
  const otherId = await seedGroup({ label: "cn-other", serviceDate: ymd(5), clientNumber: TAG_OTHER });

  // clientNumber filter as CSV — TAG only.
  {
    const { json } = await getJson(`/api/invoice-groups?clientNumber=${TAG}&limit=500&includeExpired=true`);
    const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
    assert.ok(ids.includes(mineId), `TAG group ${mineId} missing from clientNumber=${TAG}`);
    assert.ok(!ids.includes(otherId), `TAG_OTHER group ${otherId} unexpectedly present in clientNumber=${TAG}`);
  }
  // CSV with both — both must appear.
  {
    const { json } = await getJson(`/api/invoice-groups?clientNumber=${encodeURIComponent(`${TAG},${TAG_OTHER}`)}&limit=500&includeExpired=true`);
    const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
    assert.ok(ids.includes(mineId));
    assert.ok(ids.includes(otherId));
  }
  // q wins over the legacy `search` alias when both are sent: passing a
  // q that matches TAG and a search that matches TAG_OTHER must
  // restrict to TAG (q is the canonical free-text param).
  {
    const { json } = await getJson(
      `/api/invoice-groups?q=${encodeURIComponent(TAG)}&search=${encodeURIComponent(TAG_OTHER)}&limit=500&includeExpired=true`,
    );
    const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
    assert.ok(ids.includes(mineId), `q=TAG must surface mineId (${mineId}) — q should win over search`);
    assert.ok(!ids.includes(otherId), `q=TAG must exclude otherId (${otherId}) — q should win over search=TAG_OTHER`);
  }
});

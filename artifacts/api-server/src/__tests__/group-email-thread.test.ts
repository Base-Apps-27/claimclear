import { phaseForStatus, dispositionForGroup } from "./fixtures/state";
// Tests for the group-level email thread endpoints (Task #240).
//
// Covers:
//  1. GET aggregates inbound + outbound rows attached EITHER directly to the
//     invoice group OR to any of its child claims.
//  2. GET pulls in sibling-claim rows that share an Outlook conversationId
//     with the group's scope (so a thread that started life on one leg
//     surfaces on the group view too).
//  3. Status pill flips to `resolved` when the group's outcome is no
//     longer Pending.
//  4. POST reply persists an outbound row tagged with the invoice group id,
//     audits the send on the group, and rejects conversations that don't
//     belong to the group.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, inArray } from "drizzle-orm";

import responseTrackerRouter, { __setReplyImplForTesting } from "../routes/response-tracker";
import {
  db,
  pool,
  claimsTable,
  auditLogsTable,
  notesTable,
  portalResponsesTable,
  outboundEmailsTable,
  invoiceGroupsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;
const TEST_USER = { email: "group-tester@example.com", displayName: "Group Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", responseTrackerRouter);
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
  __setReplyImplForTesting(null);
  server.closeAllConnections?.();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await pool.end().catch(() => undefined);
});

async function fetchJson<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; json: T }> {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolveReq, rejectReq) => {
    const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: init?.method ?? "GET",
        headers: body
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body).toString() }
          : {},
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try {
            resolveReq({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : ({} as T) });
          } catch (e) {
            rejectReq(e);
          }
        });
      },
    );
    req.on("error", rejectReq);
    if (body) req.write(body);
    req.end();
  });
}

let groupSeq = 0;
async function createSeedGroup(opts: {
  status?: "Awaiting Response" | "Needs Review" | "Resolved" | "Denied";
  outcome?: "Pending" | "Approved" | "Denied";
} = {}): Promise<typeof invoiceGroupsTable.$inferSelect> {
  groupSeq += 1;
  const invoiceNumber = `GRP-T240-${Date.now()}-${groupSeq}-${Math.floor(Math.random() * 1e6)}`;
  const status = opts.status ?? "Awaiting Response";
  const [row] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: status as any,
    outcome: (opts.outcome ?? "Pending") as any,
    phase: phaseForStatus(status),
  }).returning();
  return row;
}

let claimSeq = 0;
async function createSeedClaim(invoiceGroupId: number, refNumber?: string): Promise<typeof claimsTable.$inferSelect> {
  claimSeq += 1;
  const confNumber = `T240-${Date.now()}-${claimSeq}-${Math.floor(Math.random() * 1e6)}`;
  const disposition = await dispositionForGroup(invoiceGroupId);
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    refNumber: refNumber ?? null,
    invoiceGroupId,
    status: "Awaiting Response",
    outcome: "Pending",
    disposition,
  }).returning();
  return row;
}

async function cleanupGroup(groupId: number) {
  // Pull child claim ids first so we can clean their rows by id too.
  const claims = await db.select({ id: claimsTable.id }).from(claimsTable).where(eq(claimsTable.invoiceGroupId, groupId));
  const claimIds = claims.map((c) => c.id);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, groupId)).catch(() => undefined);
  await db.delete(notesTable).where(eq(notesTable.invoiceGroupId, groupId)).catch(() => undefined);
  await db.delete(outboundEmailsTable).where(eq(outboundEmailsTable.invoiceGroupId, groupId)).catch(() => undefined);
  await db.delete(portalResponsesTable).where(eq(portalResponsesTable.invoiceGroupId, groupId)).catch(() => undefined);
  if (claimIds.length > 0) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.claimId, claimIds)).catch(() => undefined);
    await db.delete(outboundEmailsTable).where(inArray(outboundEmailsTable.claimId, claimIds)).catch(() => undefined);
    await db.delete(portalResponsesTable).where(inArray(portalResponsesTable.claimId, claimIds)).catch(() => undefined);
    await db.delete(claimsTable).where(inArray(claimsTable.id, claimIds)).catch(() => undefined);
  }
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId)).catch(() => undefined);
}

interface ThreadResponse {
  messages: Array<{
    id: string;
    direction: "inbound" | "outbound";
    conversationId: string | null;
    claimId: number | null;
    siblingClaimRef: string | null;
    siblingClaimId: number | null;
    sender: string;
    bodyPreview: string | null;
    timestamp: string;
  }>;
  conversationIds: string[];
  conversations: Array<{
    conversationId: string;
    status: string;
    latestSubject: string | null;
    latestInboundSender: string | null;
    messages: Array<{ id: string; direction: string }>;
  }>;
}

// ---- 1. Aggregation across group + child claims ------------------------

test("GET /invoice-groups/:id/email-thread aggregates rows pinned to the group AND its child claims", async () => {
  const group = await createSeedGroup();
  const claimA = await createSeedClaim(group.id, "INV-A");
  const claimB = await createSeedClaim(group.id, "INV-B");
  const convId = `conv-grp-agg-${Date.now()}`;
  try {
    // Group-level inbound (no claim attached).
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: null,
      invoiceGroupId: group.id,
      conversationId: convId,
      externalMessageId: `msg-grp-${Date.now()}`,
      subject: "Group dispute",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "Group response",
      responseType: "other",
      processed: false,
      receivedAt: new Date(Date.now() - 120_000),
    });
    // Claim-level inbound on child A.
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claimA.id,
      conversationId: convId,
      externalMessageId: `msg-a-${Date.now()}`,
      subject: "Re: Group dispute",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "Per leg A",
      responseType: "other",
      processed: false,
      receivedAt: new Date(Date.now() - 60_000),
    });
    // Outbound on child B in the same conversation.
    await db.insert(outboundEmailsTable).values({
      claimId: claimB.id,
      conversationId: convId,
      messageId: `out-b-${Date.now()}`,
      kind: "manual",
      subject: "Re: Group dispute",
      recipients: ["p@example.com"],
      bodyPreview: "Reply on leg B",
      sentByUserEmail: TEST_USER.email,
      sentByUserName: TEST_USER.displayName,
    });

    const res = await fetchJson<ThreadResponse>(`/api/invoice-groups/${group.id}/email-thread`);
    assert.equal(res.status, 200);
    // All three rows must come back, and they all share the same conversation.
    assert.equal(res.json.messages.length, 3);
    assert.equal(res.json.conversations.length, 1);
    assert.equal(res.json.conversations[0].messages.length, 3);

    // None should be flagged as a sibling — every row is in-group.
    const sibTagged = res.json.messages.filter((m) => m.siblingClaimRef !== null);
    assert.equal(sibTagged.length, 0, "in-group rows must not be sibling-tagged on the group view");

    // claimId is preserved per-row so the UI can mention the originating leg.
    const claimIds = new Set(res.json.messages.map((m) => m.claimId));
    assert.ok(claimIds.has(claimA.id));
    assert.ok(claimIds.has(claimB.id));
    assert.ok(claimIds.has(null), "the group-only inbound must keep claimId=null");
  } finally {
    await cleanupGroup(group.id);
  }
});

// ---- 2. Sibling rows in the same conversation are pulled in -------------

test("GET pulls in sibling-claim rows that share a conversationId with the group's scope and tags them", async () => {
  const group = await createSeedGroup();
  const childClaim = await createSeedClaim(group.id, "INV-IN-GROUP");
  // A claim with no invoiceGroupId — outside the group entirely.
  const [outsideClaim] = await db.insert(claimsTable).values({
    confNumber: `T240-OUT-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    refNumber: "INV-OUTSIDE",
    status: "Awaiting Response",
    outcome: "Pending",
  }).returning();
  const convId = `conv-grp-sib-${Date.now()}`;

  try {
    // Anchor in-group on the child claim.
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: childClaim.id,
      conversationId: convId,
      externalMessageId: `msg-anchor-${Date.now()}`,
      subject: "Cross-claim thread",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "Anchor",
      responseType: "other",
      processed: true,
      receivedAt: new Date(Date.now() - 120_000),
    });
    // Sibling-claim message in the same conversation, NOT in this group.
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: outsideClaim.id,
      conversationId: convId,
      externalMessageId: `msg-sib-${Date.now()}`,
      subject: "Cross-claim thread",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "Sibling",
      responseType: "other",
      processed: true,
      receivedAt: new Date(Date.now() - 60_000),
    });

    const res = await fetchJson<ThreadResponse>(`/api/invoice-groups/${group.id}/email-thread`);
    assert.equal(res.status, 200);
    assert.equal(res.json.messages.length, 2);
    const sibTagged = res.json.messages.filter((m) => m.siblingClaimRef !== null);
    assert.equal(sibTagged.length, 1, "the out-of-group sibling row must be flagged");
    assert.equal(sibTagged[0].siblingClaimRef, "INV-OUTSIDE");
    assert.equal(sibTagged[0].siblingClaimId, outsideClaim.id);
  } finally {
    await db.delete(portalResponsesTable).where(eq(portalResponsesTable.claimId, outsideClaim.id)).catch(() => undefined);
    await db.delete(claimsTable).where(eq(claimsTable.id, outsideClaim.id)).catch(() => undefined);
    await cleanupGroup(group.id);
  }
});

// ---- 3. Status pill ----------------------------------------------------

test("GET status pill flips to 'resolved' when the group's outcome is no longer Pending", async () => {
  const group = await createSeedGroup({ status: "Resolved", outcome: "Approved" });
  const claim = await createSeedClaim(group.id);
  const convId = `conv-grp-resolved-${Date.now()}`;
  try {
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: convId,
      externalMessageId: `msg-${Date.now()}`,
      subject: "Resolved thread",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "x",
      responseType: "other",
      processed: false,
      receivedAt: new Date(),
    });
    const res = await fetchJson<ThreadResponse>(`/api/invoice-groups/${group.id}/email-thread`);
    assert.equal(res.json.conversations[0].status, "resolved");
  } finally {
    await cleanupGroup(group.id);
  }
});

// ---- 4. POST reply ------------------------------------------------------

test("POST reply persists an outbound row tagged with the invoice group id and audits on the group", async () => {
  const group = await createSeedGroup();
  const claim = await createSeedClaim(group.id);
  const convId = `conv-grp-reply-${Date.now()}`;
  try {
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: convId,
      externalMessageId: `msg-pivot-${Date.now()}`,
      subject: "Group dispute",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "Initial",
      responseType: "other",
      processed: false,
      receivedAt: new Date(),
    });

    __setReplyImplForTesting(async () => ({
      messageId: `graph-out-${Date.now()}`,
      conversationId: convId,
    }));

    const res = await fetchJson<{ id: string; direction: string }>(
      `/api/invoice-groups/${group.id}/email-thread/${convId}/reply`,
      {
        method: "POST",
        body: {
          subject: "Re: Group dispute",
          bodyText: "Thanks for the update — appealing on all legs.",
          to: ["p@example.com"],
          cc: ["mgr@example.com"],
        },
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.direction, "outbound");

    // Outbound row persisted with the group id (and the leg id from the
    // pivot inbound), so both group + claim views see it next refresh.
    const outbound = await db.select().from(outboundEmailsTable)
      .where(eq(outboundEmailsTable.invoiceGroupId, group.id));
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0].conversationId, convId);
    assert.equal(outbound[0].claimId, claim.id);
    assert.equal(outbound[0].kind, "manual");
    assert.deepEqual(outbound[0].recipients, ["p@example.com", "mgr@example.com"]);
    assert.equal(outbound[0].sentByUserEmail, TEST_USER.email);

    // Audit row attached to the group with scope=invoice_group.
    const audits = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.invoiceGroupId, group.id));
    const replyAudit = audits.find((a) => a.action === "email_reply_sent");
    assert.ok(replyAudit, "expected email_reply_sent audit on the group");
    const meta = replyAudit!.metadata as { scope?: string; conversationId?: string };
    assert.equal(meta?.scope, "invoice_group");
    assert.equal(meta?.conversationId, convId);
  } finally {
    __setReplyImplForTesting(null);
    await cleanupGroup(group.id);
  }
});

test("POST reply rejects a conversation that has no row attached to the group or its child claims", async () => {
  const group = await createSeedGroup();
  await createSeedClaim(group.id);
  // A separate claim with the same conversationId but unrelated to this group.
  const [outsideClaim] = await db.insert(claimsTable).values({
    confNumber: `T240-AUTH-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    refNumber: "INV-OUTSIDE",
    status: "Awaiting Response",
    outcome: "Pending",
  }).returning();
  const convId = `conv-grp-auth-${Date.now()}`;
  try {
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: outsideClaim.id,
      conversationId: convId,
      externalMessageId: `msg-out-${Date.now()}`,
      subject: "Other thread",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "x",
      responseType: "other",
      processed: false,
      receivedAt: new Date(),
    });

    // We DON'T set replyImpl — the route must reject before touching Graph.
    const res = await fetchJson<{ error: string }>(
      `/api/invoice-groups/${group.id}/email-thread/${convId}/reply`,
      {
        method: "POST",
        body: {
          subject: "Should fail",
          bodyText: "Should fail",
          to: ["p@example.com"],
        },
      },
    );
    assert.equal(res.status, 404);
    assert.match(res.json.error, /Conversation not found/);

    // Nothing was persisted.
    const outbound = await db.select().from(outboundEmailsTable)
      .where(eq(outboundEmailsTable.invoiceGroupId, group.id));
    assert.equal(outbound.length, 0);
  } finally {
    await db.delete(portalResponsesTable).where(eq(portalResponsesTable.claimId, outsideClaim.id)).catch(() => undefined);
    await db.delete(claimsTable).where(eq(claimsTable.id, outsideClaim.id)).catch(() => undefined);
    await cleanupGroup(group.id);
  }
});

test("POST reply 400s when bodyText is empty or recipients are missing", async () => {
  const group = await createSeedGroup();
  const claim = await createSeedClaim(group.id);
  const convId = `conv-grp-validate-${Date.now()}`;
  try {
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: convId,
      externalMessageId: `msg-val-${Date.now()}`,
      subject: "x",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "x",
      responseType: "other",
      processed: false,
      receivedAt: new Date(),
    });

    const noBody = await fetchJson<{ error: string }>(
      `/api/invoice-groups/${group.id}/email-thread/${convId}/reply`,
      { method: "POST", body: { subject: "x", bodyText: "  ", to: ["p@example.com"] } },
    );
    assert.equal(noBody.status, 400);
    assert.match(noBody.json.error, /bodyText/);

    const noTo = await fetchJson<{ error: string }>(
      `/api/invoice-groups/${group.id}/email-thread/${convId}/reply`,
      { method: "POST", body: { subject: "x", bodyText: "ok", to: [] } },
    );
    assert.equal(noTo.status, 400);
    assert.match(noTo.json.error, /recipient/);
  } finally {
    await cleanupGroup(group.id);
  }
});

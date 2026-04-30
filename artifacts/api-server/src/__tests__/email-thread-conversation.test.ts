// Tests for the consolidated /claims/:id/email-thread route + reply endpoint.
//
// Covers:
//  1. Conversation grouping: messages sharing a conversationId collapse into one
//     ThreadConversation; messages without a conversationId become singletons.
//  2. Sibling tagging: an inbound row tied to a different claim in the same
//     conversation surfaces with siblingClaimRef set on this claim's view.
//  3. Per-thread status pill — all four states (resolved / needs_review /
//     acknowledged_pending / awaiting_their_reply).
//  4. POST reply route persists an outbound row + audit log when Graph
//     succeeds (Graph caller is mocked via __setReplyImplForTesting).

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";

import responseTrackerRouter, { __setReplyImplForTesting } from "../routes/response-tracker";
import { groupAcknowledgmentBlocks, type ThreadMessage } from "../lib/email-thread";
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

const TEST_USER = { email: "tester@example.com", displayName: "Thread Tester" };

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

let claimSeq = 0;
async function createSeedClaim(opts: {
  refNumber?: string | null;
  status?: "New" | "Needs Review" | "Awaiting Response" | "Resolved" | "Denied";
  outcome?: "Pending" | "Approved" | "Denied" | "Withdrawn" | "Non-Issue";
} = {}): Promise<typeof claimsTable.$inferSelect> {
  claimSeq += 1;
  const confNumber = `T140-${Date.now()}-${claimSeq}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    refNumber: opts.refNumber ?? null,
    status: opts.status ?? "Awaiting Response",
    outcome: opts.outcome ?? "Pending",
  }).returning();
  return row;
}

async function cleanupClaim(id: number) {
  await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, id)).catch(() => undefined);
  await db.delete(notesTable).where(eq(notesTable.claimId, id)).catch(() => undefined);
  await db.delete(outboundEmailsTable).where(eq(outboundEmailsTable.claimId, id)).catch(() => undefined);
  await db.delete(portalResponsesTable).where(eq(portalResponsesTable.claimId, id)).catch(() => undefined);
  await db.delete(claimsTable).where(eq(claimsTable.id, id)).catch(() => undefined);
}

interface ThreadResponse {
  messages: Array<{
    id: string;
    direction: "inbound" | "outbound";
    conversationId: string | null;
    siblingClaimRef: string | null;
    siblingClaimId: number | null;
    aiSummary: string | null;
    responseType: string | null;
    processed: boolean | null;
  }>;
  conversationIds: string[];
  conversations: Array<{
    conversationId: string;
    status: string;
    latestUnprocessedInboundId: number | null;
    messages: Array<{ id: string; direction: string }>;
  }>;
}

// ---- 1. Grouping --------------------------------------------------------

test("conversation grouping: two messages sharing a conversationId collapse into one ThreadConversation", async () => {
  const claim = await createSeedClaim();
  const convId = `conv-group-${Date.now()}`;
  try {
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: convId,
      externalMessageId: `msg-a-${Date.now()}`,
      subject: "Re: claim",
      senderName: "Payer",
      senderEmail: "payer@example.com",
      content: "Got it",
      responseType: "acknowledgment",
      processed: true,
      receivedAt: new Date(Date.now() - 60_000),
      aiSummary: "Acknowledged receipt",
    });
    await db.insert(outboundEmailsTable).values({
      claimId: claim.id,
      conversationId: convId,
      messageId: `out-a-${Date.now()}`,
      kind: "manual",
      subject: "Reply",
      recipients: ["payer@example.com"],
      bodyPreview: "Thanks",
      sentByUserEmail: TEST_USER.email,
      sentByUserName: TEST_USER.displayName,
    });

    const res = await fetchJson<ThreadResponse>(`/api/claims/${claim.id}/email-thread`);
    assert.equal(res.status, 200);
    assert.equal(res.json.conversations.length, 1, "single conversationId must yield one ThreadConversation");
    assert.equal(res.json.conversations[0].messages.length, 2);
    assert.equal(res.json.conversations[0].conversationId, convId);
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("conversation grouping: messages with no conversationId surface as separate threads", async () => {
  const claim = await createSeedClaim();
  try {
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: null,
      externalMessageId: `msg-orphan-1-${Date.now()}`,
      subject: "Orphan one",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "first",
      responseType: "other",
      processed: true,
      receivedAt: new Date(),
    });
    await db.insert(outboundEmailsTable).values({
      claimId: claim.id,
      conversationId: null,
      messageId: `out-orphan-${Date.now()}`,
      kind: "manual",
      subject: "Orphan two",
      recipients: ["p@example.com"],
      bodyPreview: "second",
    });

    const res = await fetchJson<ThreadResponse>(`/api/claims/${claim.id}/email-thread`);
    assert.equal(res.status, 200);
    assert.equal(
      res.json.conversations.length,
      2,
      "messages without conversationId must each get their own thread bucket",
    );
  } finally {
    await cleanupClaim(claim.id);
  }
});

// ---- 2. Sibling tagging ------------------------------------------------

test("sibling tagging: inbound on a different claim in the same conversation surfaces siblingClaimRef", async () => {
  const primary = await createSeedClaim({ refNumber: "INV-PRIMARY" });
  const sibling = await createSeedClaim({ refNumber: "INV-SIBLING" });
  const convId = `conv-sibling-${Date.now()}`;
  try {
    // Anchor on the primary claim.
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: primary.id,
      conversationId: convId,
      externalMessageId: `msg-prim-${Date.now()}`,
      subject: "Group dispute",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "Anchor",
      responseType: "other",
      processed: true,
      receivedAt: new Date(Date.now() - 120_000),
    });
    // Sibling-claim message in the same Outlook conversation.
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: sibling.id,
      conversationId: convId,
      externalMessageId: `msg-sib-${Date.now()}`,
      subject: "Group dispute",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "Sibling response",
      responseType: "other",
      processed: true,
      receivedAt: new Date(Date.now() - 60_000),
    });

    const res = await fetchJson<ThreadResponse>(`/api/claims/${primary.id}/email-thread`);
    assert.equal(res.status, 200);
    const tagged = res.json.messages.filter((m) => m.siblingClaimRef !== null);
    assert.equal(tagged.length, 1, "exactly one sibling message must be tagged");
    assert.equal(tagged[0].siblingClaimRef, "INV-SIBLING");
    assert.equal(tagged[0].siblingClaimId, sibling.id);

    // Inverse view: the primary's message must appear as the sibling on the
    // sibling claim's detail page.
    const inverse = await fetchJson<ThreadResponse>(`/api/claims/${sibling.id}/email-thread`);
    const inverseTagged = inverse.json.messages.filter((m) => m.siblingClaimRef !== null);
    assert.equal(inverseTagged.length, 1);
    assert.equal(inverseTagged[0].siblingClaimRef, "INV-PRIMARY");
  } finally {
    await cleanupClaim(primary.id);
    await cleanupClaim(sibling.id);
  }
});

// ---- 3. Status pill (all four states) -----------------------------------

test("thread status: resolved when claim outcome is no longer Pending", async () => {
  const claim = await createSeedClaim({ status: "Resolved", outcome: "Approved" });
  const convId = `conv-resolved-${Date.now()}`;
  try {
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: convId,
      externalMessageId: `msg-r-${Date.now()}`,
      subject: "x",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "anything",
      responseType: "other",
      processed: false,
      receivedAt: new Date(),
    });
    const res = await fetchJson<ThreadResponse>(`/api/claims/${claim.id}/email-thread`);
    assert.equal(res.json.conversations[0].status, "resolved");
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("thread status: needs_review when latest inbound is unprocessed and not an acknowledgment", async () => {
  const claim = await createSeedClaim();
  const convId = `conv-nr-${Date.now()}`;
  try {
    const [row] = await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: convId,
      externalMessageId: `msg-nr-${Date.now()}`,
      subject: "Reply",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "We dispute this charge",
      responseType: "denial",
      processed: false,
      receivedAt: new Date(),
    }).returning();
    const res = await fetchJson<ThreadResponse>(`/api/claims/${claim.id}/email-thread`);
    assert.equal(res.json.conversations[0].status, "needs_review");
    assert.equal(
      res.json.conversations[0].latestUnprocessedInboundId,
      row.id,
      "latestUnprocessedInboundId must point at the row the Approve/Deny buttons should anchor to",
    );
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("thread status: acknowledged_pending when latest inbound is an acknowledgment (regardless of processed)", async () => {
  const claim = await createSeedClaim();
  const convId = `conv-ack-${Date.now()}`;
  try {
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: convId,
      externalMessageId: `msg-ack-${Date.now()}`,
      subject: "Got it",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "Acknowledged",
      responseType: "acknowledgment",
      processed: false,
      receivedAt: new Date(),
    });
    const res = await fetchJson<ThreadResponse>(`/api/claims/${claim.id}/email-thread`);
    assert.equal(res.json.conversations[0].status, "acknowledged_pending");
    assert.equal(
      res.json.conversations[0].latestUnprocessedInboundId,
      null,
      "Acknowledgments must NOT trigger Needs Review actions",
    );
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("thread status: awaiting_their_reply when our last outbound is the most recent message", async () => {
  const claim = await createSeedClaim();
  const convId = `conv-await-${Date.now()}`;
  try {
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: convId,
      externalMessageId: `msg-aw-${Date.now()}`,
      subject: "Initial",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "Old inbound",
      responseType: "other",
      processed: true,
      receivedAt: new Date(Date.now() - 300_000),
    });
    await db.insert(outboundEmailsTable).values({
      claimId: claim.id,
      conversationId: convId,
      messageId: `out-aw-${Date.now()}`,
      kind: "manual",
      subject: "Re: Initial",
      recipients: ["p@example.com"],
      bodyPreview: "Following up",
      sentAt: new Date(),
    });
    const res = await fetchJson<ThreadResponse>(`/api/claims/${claim.id}/email-thread`);
    assert.equal(res.json.conversations[0].status, "awaiting_their_reply");
  } finally {
    await cleanupClaim(claim.id);
  }
});

// ---- 4. Reply route (Graph mocked) -------------------------------------

test("POST reply: persists outbound row + audit log when Graph send succeeds", async () => {
  const claim = await createSeedClaim();
  const convId = `conv-reply-${Date.now()}`;
  const sentMessages: Array<{ originalMessageId: string; subject: string; bodyText: string; to: string[] }> = [];
  __setReplyImplForTesting(async (params) => {
    sentMessages.push({
      originalMessageId: params.originalMessageId,
      subject: params.subject ?? "",
      bodyText: params.bodyText,
      to: params.to ?? [],
    });
    return { messageId: `graph-out-${Date.now()}`, conversationId: convId };
  });

  try {
    const inboundExternalId = `msg-inbound-${Date.now()}`;
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: convId,
      externalMessageId: inboundExternalId,
      subject: "Need more info",
      senderName: "Payer",
      senderEmail: "payer@example.com",
      content: "Please send proof",
      responseType: "info_request",
      processed: false,
      receivedAt: new Date(),
    });

    const res = await fetchJson<{ id: string; direction: string; conversationId: string }>(
      `/api/claims/${claim.id}/email-thread/${encodeURIComponent(convId)}/reply`,
      {
        method: "POST",
        body: {
          subject: "Re: Need more info",
          bodyText: "Here is the requested documentation.",
          to: ["payer@example.com"],
          cc: [],
        },
      },
    );

    assert.equal(res.status, 200, `expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    assert.equal(res.json.direction, "outbound");
    assert.equal(res.json.conversationId, convId);

    // Graph caller saw the right pivot message.
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].originalMessageId, inboundExternalId);
    assert.deepEqual(sentMessages[0].to, ["payer@example.com"]);

    // Outbound row persisted.
    const persistedOutbound = await db.select().from(outboundEmailsTable)
      .where(eq(outboundEmailsTable.claimId, claim.id));
    assert.equal(persistedOutbound.length, 1);
    assert.equal(persistedOutbound[0].kind, "manual");
    assert.equal(persistedOutbound[0].conversationId, convId);
    assert.equal(persistedOutbound[0].sentByUserEmail, TEST_USER.email);

    // Audit row written with the new action.
    const audit = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.claimId, claim.id));
    const replyAudit = audit.find((a) => a.action === "email_reply_sent");
    assert.ok(replyAudit, `expected an email_reply_sent audit row; got ${JSON.stringify(audit.map((a) => a.action))}`);
    assert.equal((replyAudit!.metadata as any)?.outboundEmailId, persistedOutbound[0].id);
  } finally {
    __setReplyImplForTesting(null);
    await cleanupClaim(claim.id);
  }
});

test("POST reply: refuses to send under a claim the conversation isn't anchored to (broken access control regression)", async () => {
  // Two unrelated claims. The conversation belongs only to `other`. A
  // request that names `victim`'s id but `other`'s conversationId must be
  // rejected without ever touching Microsoft Graph.
  const victim = await createSeedClaim();
  const other = await createSeedClaim();
  const convId = `conv-foreign-${Date.now()}`;
  let graphCalled = false;
  __setReplyImplForTesting(async () => {
    graphCalled = true;
    return { messageId: "should-not-happen", conversationId: convId };
  });
  try {
    // Anchor the conversation on `other`, NOT on `victim`.
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: other.id,
      conversationId: convId,
      externalMessageId: `msg-foreign-${Date.now()}`,
      subject: "private",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "secret",
      responseType: "other",
      processed: false,
      receivedAt: new Date(),
    });

    const res = await fetchJson<{ error: string }>(
      `/api/claims/${victim.id}/email-thread/${encodeURIComponent(convId)}/reply`,
      {
        method: "POST",
        body: { subject: "Hi", bodyText: "x", to: ["p@example.com"] },
      },
    );
    assert.equal(res.status, 404, `cross-claim conversation must be refused; got ${res.status}`);
    assert.equal(graphCalled, false, "Graph must not be called when authorization fails");

    // No outbound row written under the victim claim.
    const persisted = await db.select().from(outboundEmailsTable)
      .where(eq(outboundEmailsTable.claimId, victim.id));
    assert.equal(persisted.length, 0);
  } finally {
    __setReplyImplForTesting(null);
    await cleanupClaim(victim.id);
    await cleanupClaim(other.id);
  }
});

test("POST reply: persists with the route's conversationId even if Graph echoes a different one", async () => {
  const claim = await createSeedClaim();
  const routeConvId = `conv-route-${Date.now()}`;
  __setReplyImplForTesting(async () => ({
    messageId: `graph-${Date.now()}`,
    conversationId: `graph-different-conv-${Date.now()}`, // Graph returns a NEW id.
  }));
  try {
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: routeConvId,
      externalMessageId: `msg-r-${Date.now()}`,
      subject: "Original",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "Body",
      responseType: "other",
      processed: false,
      receivedAt: new Date(),
    });
    const res = await fetchJson<{ conversationId: string }>(
      `/api/claims/${claim.id}/email-thread/${encodeURIComponent(routeConvId)}/reply`,
      {
        method: "POST",
        body: { subject: "Re: Original", bodyText: "Reply body", to: ["p@example.com"] },
      },
    );
    assert.equal(res.status, 200);
    assert.equal(
      res.json.conversationId,
      routeConvId,
      "outbound row must be persisted with the route's conversationId so threading stays consistent on the UI",
    );
    const persisted = await db.select().from(outboundEmailsTable)
      .where(eq(outboundEmailsTable.claimId, claim.id));
    assert.equal(persisted[0].conversationId, routeConvId);
  } finally {
    __setReplyImplForTesting(null);
    await cleanupClaim(claim.id);
  }
});

test("POST reply: rejects when no prior message exists for this conversation", async () => {
  const claim = await createSeedClaim();
  __setReplyImplForTesting(async () => {
    throw new Error("Graph should not be called when there's no pivot message");
  });
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/claims/${claim.id}/email-thread/conv-nonexistent-${Date.now()}/reply`,
      {
        method: "POST",
        body: {
          subject: "Hello",
          bodyText: "Body",
          to: ["x@example.com"],
        },
      },
    );
    assert.equal(res.status, 404);
  } finally {
    __setReplyImplForTesting(null);
    await cleanupClaim(claim.id);
  }
});

function makeMsg(id: string, overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id,
    direction: "inbound",
    conversationId: "c1",
    subject: null,
    sender: "x",
    senderEmail: null,
    bodyPreview: null,
    timestamp: new Date().toISOString(),
    responseId: null,
    responseType: "other",
    processed: true,
    aiSummary: null,
    extractedAmount: null,
    extractedDeadline: null,
    requestedAction: null,
    classifierSource: null,
    matchedVia: null,
    matchConfidence: null,
    claimId: null,
    siblingClaimRef: null,
    siblingClaimId: null,
    attachmentNames: null,
    ...overrides,
  };
}

test("groupAcknowledgmentBlocks: collapses runs of consecutive acks while leaving real messages alone", () => {
  const msgs = [
    makeMsg("a", { responseType: "other" }),
    makeMsg("b", { responseType: "acknowledgment" }),
    makeMsg("c", { responseType: "acknowledgment" }),
    makeMsg("d", { responseType: "denial" }),
    makeMsg("e", { responseType: "acknowledgment" }),
  ];
  const blocks = groupAcknowledgmentBlocks(msgs);
  assert.equal(blocks.length, 4, "5 msgs with [other, ack, ack, denial, ack] → 4 blocks");
  assert.equal(blocks[0].kind, "msg");
  assert.equal(blocks[1].kind, "acks");
  if (blocks[1].kind === "acks") assert.equal(blocks[1].msgs.length, 2);
  assert.equal(blocks[2].kind, "msg");
  assert.equal(blocks[3].kind, "acks");
  if (blocks[3].kind === "acks") assert.equal(blocks[3].msgs.length, 1);
});

test("GET email-thread: surfaces AI summary fields on inbound messages so the UI can render them", async () => {
  const claim = await createSeedClaim();
  try {
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: `conv-ai-${Date.now()}`,
      externalMessageId: `msg-ai-${Date.now()}`,
      subject: "Re: Claim",
      senderName: "Payer Bot",
      senderEmail: "p@example.com",
      content: "Approved for $123.45 by 2026-05-15.",
      responseType: "approval",
      aiSummary: "Approved $123.45; deadline 2026-05-15.",
      extractedAmount: "123.45",
      extractedDeadline: "2026-05-15",
      requestedAction: "Acknowledge approval",
      classifierSource: "ai",
      matchedVia: "claim_number",
      matchConfidence: "high",
      processed: false,
      receivedAt: new Date(),
    });
    const res = await fetchJson<{ conversations: Array<{ messages: ThreadMessage[] }> }>(
      `/api/claims/${claim.id}/email-thread`,
    );
    assert.equal(res.status, 200);
    const flat = res.json.conversations.flatMap((c) => c.messages);
    const m = flat.find((x) => x.classifierSource === "ai");
    assert.ok(m, "should surface AI-classified inbound");
    assert.equal(m!.aiSummary, "Approved $123.45; deadline 2026-05-15.");
    assert.equal(m!.extractedAmount, "123.45");
    assert.equal(m!.extractedDeadline, "2026-05-15");
    assert.equal(m!.requestedAction, "Acknowledge approval");
    assert.equal(m!.classifierSource, "ai");
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("GET email-thread: keeps current-claim messages with no conversationId visible even when claim has other threaded conversations", async () => {
  const claim = await createSeedClaim();
  try {
    // Threaded conversation on this claim.
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: `conv-threaded-${Date.now()}`,
      externalMessageId: `msg-th-${Date.now()}`,
      subject: "Threaded",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "in a thread",
      responseType: "other",
      processed: true,
      receivedAt: new Date(Date.now() - 60_000),
    });
    // Orphan response on this claim with conversationId = null
    // (older row; pre-threading import). MUST still appear in the view.
    await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: null,
      externalMessageId: `msg-orphan-${Date.now()}`,
      subject: "Orphan",
      senderName: "Payer",
      senderEmail: "p@example.com",
      content: "no conversationId — must not be dropped",
      responseType: "other",
      processed: true,
      receivedAt: new Date(),
    });
    const res = await fetchJson<{ messages: ThreadMessage[]; conversations: Array<{ messages: ThreadMessage[] }> }>(
      `/api/claims/${claim.id}/email-thread`,
    );
    assert.equal(res.status, 200);
    const subjects = res.json.messages.map((m) => m.subject);
    assert.ok(subjects.includes("Orphan"), `Orphan (null conversationId) must appear in flat messages; got ${JSON.stringify(subjects)}`);
    const grouped = res.json.conversations.flatMap((c) => c.messages.map((m) => m.subject));
    assert.ok(grouped.includes("Orphan"), `Orphan must appear in grouped conversations; got ${JSON.stringify(grouped)}`);
    assert.ok(grouped.includes("Threaded"), "Threaded message must still appear");
  } finally {
    await cleanupClaim(claim.id);
  }
});

// /responses/:id/process — tagging is a hint, never a verdict.

test("PATCH /responses/:id/process with approval keeps the claim in Needs Review (no auto-resolve) and records the AI hint", async () => {
  const claim = await createSeedClaim({ status: "Awaiting Response", outcome: "Pending" });
  try {
    const [resp] = await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: `conv-tag-approval-${Date.now()}`,
      externalMessageId: `msg-tag-${Date.now()}`,
      subject: "Approved",
      senderName: "Payer",
      senderEmail: "payer@example.com",
      content: "Looks good — approved.",
      responseType: "other",
      processed: false,
      receivedAt: new Date(),
    }).returning();

    const res = await fetchJson<typeof portalResponsesTable.$inferSelect>(
      `/api/responses/${resp.id}/process`,
      { method: "PATCH", body: { responseType: "approval" } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.responseType, "approval");
    assert.equal(res.json.processed, true);

    const [after] = await db.select().from(claimsTable).where(eq(claimsTable.id, claim.id));
    assert.equal(after.status, "Needs Review");
    assert.equal(after.outcome, "Pending");

    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, claim.id));
    const tagged = audits.find((a) => a.action === "response_tagged");
    assert.ok(tagged);
    assert.match(tagged!.details ?? "", /AI hint: Approval/);
    const taggedMeta = tagged!.metadata as { responseId?: number; responseType?: string; hint?: string } | null;
    assert.equal(taggedMeta?.responseId, resp.id);
    assert.equal(taggedMeta?.responseType, "approval");
    assert.equal(taggedMeta?.hint, "Approval");

    const noteRows = await db.select().from(notesTable).where(eq(notesTable.claimId, claim.id));
    const tagNote = noteRows.find((n) => /AI hint: Approval/.test(n.content ?? ""));
    assert.ok(tagNote);
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("PATCH /responses/:id/process with denial does NOT auto-deny — claim stays in Needs Review", async () => {
  const claim = await createSeedClaim({ status: "Awaiting Response", outcome: "Pending" });
  try {
    const [resp] = await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: `conv-tag-denial-${Date.now()}`,
      externalMessageId: `msg-tag-d-${Date.now()}`,
      subject: "Denied",
      senderName: "Payer",
      senderEmail: "payer@example.com",
      content: "Sorry, denied.",
      responseType: "other",
      processed: false,
      receivedAt: new Date(),
    }).returning();

    const res = await fetchJson<typeof portalResponsesTable.$inferSelect>(
      `/api/responses/${resp.id}/process`,
      { method: "PATCH", body: { responseType: "denial" } },
    );
    assert.equal(res.status, 200);

    const [after] = await db.select().from(claimsTable).where(eq(claimsTable.id, claim.id));
    assert.equal(after.status, "Needs Review");
    assert.equal(after.outcome, "Pending");

    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, claim.id));
    const tagged = audits.find((a) => a.action === "response_tagged");
    assert.ok(tagged);
    assert.match(tagged!.details ?? "", /AI hint: Denial/);
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("PATCH /responses/:id/process with partial_approval does NOT auto-resolve as Partially Approved", async () => {
  const claim = await createSeedClaim({ status: "Awaiting Response", outcome: "Pending" });
  try {
    const [resp] = await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: `conv-tag-partial-${Date.now()}`,
      externalMessageId: `msg-tag-p-${Date.now()}`,
      subject: "Partially Approved",
      senderName: "Payer",
      senderEmail: "payer@example.com",
      content: "Approved $20 of $45.",
      responseType: "other",
      processed: false,
      receivedAt: new Date(),
    }).returning();

    const res = await fetchJson<typeof portalResponsesTable.$inferSelect>(
      `/api/responses/${resp.id}/process`,
      { method: "PATCH", body: { responseType: "partial_approval" } },
    );
    assert.equal(res.status, 200);

    const [after] = await db.select().from(claimsTable).where(eq(claimsTable.id, claim.id));
    assert.equal(after.status, "Needs Review");
    assert.equal(after.outcome, "Pending");
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("PATCH /responses/:id/process with 'other' still pushes the claim into Needs Review (only acknowledgments are silent)", async () => {
  const claim = await createSeedClaim({ status: "Awaiting Response", outcome: "Pending" });
  try {
    const [resp] = await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: `conv-tag-other-${Date.now()}`,
      externalMessageId: `msg-tag-o-${Date.now()}`,
      subject: "Misc",
      senderName: "Payer",
      senderEmail: "payer@example.com",
      content: "Could you re-check this?",
      responseType: "other",
      processed: false,
      receivedAt: new Date(),
    }).returning();

    const res = await fetchJson<typeof portalResponsesTable.$inferSelect>(
      `/api/responses/${resp.id}/process`,
      { method: "PATCH", body: { responseType: "other" } },
    );
    assert.equal(res.status, 200);

    const [after] = await db.select().from(claimsTable).where(eq(claimsTable.id, claim.id));
    assert.equal(after.status, "Needs Review");
    assert.equal(after.outcome, "Pending");

    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, claim.id));
    const tagged = audits.find((a) => a.action === "response_tagged");
    assert.ok(tagged);
    assert.match(tagged!.details ?? "", /AI hint: Other/);
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("PATCH /responses/:id/process with acknowledgment leaves the claim's status untouched (ack is silent)", async () => {
  const claim = await createSeedClaim({ status: "Awaiting Response", outcome: "Pending" });
  try {
    const [resp] = await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: `conv-tag-ack-${Date.now()}`,
      externalMessageId: `msg-tag-a-${Date.now()}`,
      subject: "We received your dispute",
      senderName: "Payer",
      senderEmail: "payer@example.com",
      content: "Acknowledged — under review.",
      responseType: "other",
      processed: false,
      receivedAt: new Date(),
    }).returning();

    const res = await fetchJson<typeof portalResponsesTable.$inferSelect>(
      `/api/responses/${resp.id}/process`,
      { method: "PATCH", body: { responseType: "acknowledgment" } },
    );
    assert.equal(res.status, 200);

    const [after] = await db.select().from(claimsTable).where(eq(claimsTable.id, claim.id));
    assert.equal(after.status, "Awaiting Response");
    assert.equal(after.outcome, "Pending");

    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, claim.id));
    const tagged = audits.find((a) => a.action === "response_tagged");
    assert.equal(tagged, undefined);
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("PATCH /responses/:id/process resets a non-pending claim outcome back to Pending", async () => {
  const claim = await createSeedClaim({ status: "Resolved", outcome: "Approved" });
  try {
    const [resp] = await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: `conv-tag-reset-${Date.now()}`,
      externalMessageId: `msg-tag-reset-${Date.now()}`,
      subject: "Actually denied on review",
      senderName: "Payer",
      senderEmail: "payer@example.com",
      content: "Re-reviewed and the line item is denied.",
      responseType: "other",
      processed: false,
      receivedAt: new Date(),
    }).returning();

    const res = await fetchJson<typeof portalResponsesTable.$inferSelect>(
      `/api/responses/${resp.id}/process`,
      { method: "PATCH", body: { responseType: "denial" } },
    );
    assert.equal(res.status, 200);

    const [after] = await db.select().from(claimsTable).where(eq(claimsTable.id, claim.id));
    assert.equal(after.status, "Needs Review");
    assert.equal(after.outcome, "Pending");
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("PATCH /responses/:id/process rejects an unknown responseType with 400", async () => {
  const claim = await createSeedClaim({ status: "Awaiting Response", outcome: "Pending" });
  try {
    const [resp] = await db.insert(portalResponsesTable).values({
      source: "email",
      claimId: claim.id,
      conversationId: `conv-tag-bad-${Date.now()}`,
      externalMessageId: `msg-tag-bad-${Date.now()}`,
      subject: "x",
      senderName: "Payer",
      senderEmail: "payer@example.com",
      content: "x",
      responseType: "other",
      processed: false,
      receivedAt: new Date(),
    }).returning();

    const res = await fetchJson<{ error: string }>(
      `/api/responses/${resp.id}/process`,
      { method: "PATCH", body: { responseType: "totally_made_up" } },
    );
    assert.equal(res.status, 400);
    assert.match(res.json.error, /Invalid responseType/);

    const [after] = await db.select().from(claimsTable).where(eq(claimsTable.id, claim.id));
    assert.equal(after.status, "Awaiting Response");
    const [respAfter] = await db.select().from(portalResponsesTable).where(eq(portalResponsesTable.id, resp.id));
    assert.equal(respAfter.processed, false);
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("PATCH /responses/:id/process with approval on an invoice group keeps it in Needs Review with outcome Pending", async () => {
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `INV-TAG-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    status: "Resolved",
    outcome: "Approved",
  }).returning();

  try {
    const [resp] = await db.insert(portalResponsesTable).values({
      source: "email",
      invoiceGroupId: group.id,
      conversationId: `conv-tag-grp-${Date.now()}`,
      externalMessageId: `msg-tag-grp-${Date.now()}`,
      subject: "Approved",
      senderName: "Payer",
      senderEmail: "payer@example.com",
      content: "Looks good.",
      responseType: "other",
      processed: false,
      receivedAt: new Date(),
    }).returning();

    const res = await fetchJson<typeof portalResponsesTable.$inferSelect>(
      `/api/responses/${resp.id}/process`,
      { method: "PATCH", body: { responseType: "approval" } },
    );
    assert.equal(res.status, 200);

    const [after] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(after.status, "Needs Review");
    assert.equal(after.outcome, "Pending");

    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, group.id));
    const tagged = audits.find((a) => a.action === "response_tagged");
    assert.ok(tagged);
    assert.match(tagged!.details ?? "", /AI hint: Approval/);
    const taggedMeta = tagged!.metadata as { responseId?: number } | null;
    assert.equal(taggedMeta?.responseId, resp.id);
  } finally {
    await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, group.id)).catch(() => undefined);
    await db.delete(notesTable).where(eq(notesTable.invoiceGroupId, group.id)).catch(() => undefined);
    await db.delete(portalResponsesTable).where(eq(portalResponsesTable.invoiceGroupId, group.id)).catch(() => undefined);
    await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id)).catch(() => undefined);
  }
});

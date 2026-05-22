// Tier 0 of matchEmailToClaim: conversation_id fast-path.
//
// Every outbound email we send (both `replyToMessage` via the standard
// reply route AND `sendEmail` via the legacy-thread fresh-send route)
// persists Graph's `conversationId` on `outbound_emails`. When the
// payor replies, Outlook tags the inbound message with the same
// conversationId, so a direct lookup against `outbound_emails` is the
// strongest possible match — independent of subject/body identifiers
// and independent of the group's current status.
//
// Coverage:
//   - Tier 0 matches a fresh-send outbound row (invoiceGroupId) →
//     returns the group with conversation_id matchedVia.
//   - Tier 0 matches a reply-route outbound row (claimId) →
//     returns the claim.
//   - Tier 0 wins over body identifiers (even when invoice number
//     would have matched a different group).
//   - When the matching outbound row is on a group that has already
//     moved out of "Awaiting Response", Tier 0 still matches (this
//     is the whole point — never drop a known thread).
//   - No match when conversationId has never been seen before
//     (falls through to lower tiers).

import { test, after } from "node:test";
import { strict as assert } from "node:assert";
import { eq } from "drizzle-orm";

import { matchEmailToClaim } from "../lib/response-matcher";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  outboundEmailsTable,
} from "@workspace/db";
import type { InboxMessage } from "../lib/outlook";

after(async () => {
  await pool.end().catch(() => undefined);
});

function makeInbound(overrides: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id: `inbound-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
    subject: "",
    bodyPreview: "",
    body: { contentType: "text", content: "" },
    from: { emailAddress: { name: "Payor", address: "payor@example.com" } },
    receivedDateTime: new Date().toISOString(),
    isRead: false,
    conversationId: "",
    ...overrides,
  };
}

async function seedGroup(opts: { status?: string } = {}): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T-MATCH-G-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [g] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: (opts.status as any) ?? "Awaiting Response",
    outcome: "Pending",
  }).returning();
  return g;
}

async function seedClaim(opts: { invoiceGroupId?: number | null } = {}): Promise<typeof claimsTable.$inferSelect> {
  const confNumber = `T-MATCH-C-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [c] = await db.insert(claimsTable).values({
    confNumber,
    status: "Awaiting Response",
    outcome: "Pending",
    invoiceGroupId: opts.invoiceGroupId ?? null,
    claimAmount: "100.00",
  }).returning();
  return c;
}

async function seedOutbound(opts: {
  conversationId: string;
  invoiceGroupId?: number | null;
  claimId?: number | null;
}): Promise<typeof outboundEmailsTable.$inferSelect> {
  const [o] = await db.insert(outboundEmailsTable).values({
    messageId: `msg-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
    conversationId: opts.conversationId,
    invoiceGroupId: opts.invoiceGroupId ?? null,
    claimId: opts.claimId ?? null,
    submissionId: null,
    kind: "manual",
    subject: "Original outbound",
    recipients: ["payor@example.com"],
    bodyPreview: "hi",
    sentByUserEmail: "staff@example.com",
    sentByUserName: "Staff",
  }).returning();
  return o;
}

async function cleanupGroup(id: number): Promise<void> {
  const kids = await db.select({ id: claimsTable.id }).from(claimsTable).where(eq(claimsTable.invoiceGroupId, id));
  for (const c of kids) {
    await db.delete(outboundEmailsTable).where(eq(outboundEmailsTable.claimId, c.id)).catch(() => undefined);
    await db.delete(claimsTable).where(eq(claimsTable.id, c.id)).catch(() => undefined);
  }
  await db.delete(outboundEmailsTable).where(eq(outboundEmailsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

async function cleanupClaim(id: number): Promise<void> {
  await db.delete(outboundEmailsTable).where(eq(outboundEmailsTable.claimId, id)).catch(() => undefined);
  await db.delete(claimsTable).where(eq(claimsTable.id, id)).catch(() => undefined);
}

// ---- Group fresh-send case (the bug we just fixed) ----------------------

test("Tier 0: inbound reply matches the invoice group via conversation_id (fresh-send case)", async () => {
  const g = await seedGroup();
  const convId = `conv-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  try {
    await seedOutbound({ conversationId: convId, invoiceGroupId: g.id });

    const result = await matchEmailToClaim(makeInbound({
      conversationId: convId,
      subject: "Re: anything",
      bodyPreview: "thanks",
    }));

    assert.ok(result, "matcher must return a match");
    assert.equal(result!.invoiceGroupId, g.id);
    assert.equal(result!.claimId, null);
    assert.equal(result!.confidence, "high");
    assert.match(result!.matchedVia, /^conversation_id:/);
  } finally {
    await cleanupGroup(g.id);
  }
});

// ---- Per-claim reply case ----------------------------------------------

test("Tier 0: inbound reply matches the claim via conversation_id (reply route)", async () => {
  const c = await seedClaim();
  const convId = `conv-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  try {
    await seedOutbound({ conversationId: convId, claimId: c.id });

    const result = await matchEmailToClaim(makeInbound({
      conversationId: convId,
    }));

    assert.ok(result);
    assert.equal(result!.claimId, c.id);
    assert.equal(result!.invoiceGroupId, null);
    assert.equal(result!.confidence, "high");
  } finally {
    await cleanupClaim(c.id);
  }
});

// ---- Tier 0 wins over body identifiers ----------------------------------

test("Tier 0 beats Tier 2: conversation_id wins even when the body mentions a different group's invoice number", async () => {
  const ownerGroup = await seedGroup();
  const otherGroup = await seedGroup();
  const convId = `conv-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  try {
    await seedOutbound({ conversationId: convId, invoiceGroupId: ownerGroup.id });

    // The body mentions otherGroup.invoiceNumber, which Tier 2 would
    // happily match. Tier 0 must beat it because the operator already
    // bound this conversation to ownerGroup when they sent the
    // outbound email.
    const result = await matchEmailToClaim(makeInbound({
      conversationId: convId,
      subject: `Re: invoice ${otherGroup.invoiceNumber}`,
      bodyPreview: `regarding invoice ${otherGroup.invoiceNumber}`,
      body: { contentType: "text", content: `invoice ${otherGroup.invoiceNumber}` },
    }));

    assert.ok(result);
    assert.equal(result!.invoiceGroupId, ownerGroup.id, "must bind to the owning group, not the body-mentioned one");
  } finally {
    await cleanupGroup(ownerGroup.id);
    await cleanupGroup(otherGroup.id);
  }
});

// ---- Tier 0 ignores group status ----------------------------------------

test("Tier 0 still matches when the group is already Resolved (lower tiers would skip it)", async () => {
  const g = await seedGroup({ status: "Resolved" });
  const convId = `conv-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  try {
    await seedOutbound({ conversationId: convId, invoiceGroupId: g.id });

    // Body has no identifiers; lower tiers can't help. Tier 0 doesn't
    // filter by status, so the late reply still finds home.
    const result = await matchEmailToClaim(makeInbound({
      conversationId: convId,
      subject: "Re: thanks",
      bodyPreview: "got it",
    }));

    assert.ok(result, "late reply on a Resolved group should still match via conversation_id");
    assert.equal(result!.invoiceGroupId, g.id);
  } finally {
    await cleanupGroup(g.id);
  }
});

// ---- Negative: unseen conversationId ------------------------------------

test("no match when the conversation_id has never been seen and there are no body identifiers", async () => {
  const result = await matchEmailToClaim(makeInbound({
    conversationId: `unseen-conv-${Date.now()}`,
    subject: "Re: nothing",
    bodyPreview: "just checking in",
  }));
  assert.equal(result, null);
});

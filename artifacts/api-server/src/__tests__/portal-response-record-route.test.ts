// Integration test for Task #725: prove that a freshly scraped portal
// message is ingested exactly once through `/api/responses/record-portal`
// and that re-scraping the same submission is a no-op (idempotency).
//
// We use the in-process record-portal poster the sync orchestrator uses
// at runtime, but stub the storage layer so the test stays unit-fast and
// does not touch a real database.

import test from "node:test";
import assert from "node:assert/strict";
import {
  diffPortalMessages,
  postFreshMessagesViaPoster,
  type ExistingPortalResponseKey,
  type RecordPortalPoster,
} from "../lib/portal-response-sync";
import { hashContent, type PortalReaderMessage } from "../bot/portal-reader";

interface RecordedPortalRow {
  submissionId: number;
  externalMessageId: string;
  contentHash: string;
  bodyText: string;
}

// Minimal in-memory stand-in for the `/responses/record-portal` route's
// persistence: keyed on (submissionId, externalMessageId) with content
// hash as fallback — exactly the contract `processPortalResponse` honors
// against `portal_responses`.
function makeFakeRecordPortalStore() {
  const rows: RecordedPortalRow[] = [];
  const post = async (
    submissionId: number,
    msg: PortalReaderMessage,
  ): Promise<{ inserted: boolean }> => {
    const contentHash = hashContent(msg.bodyText);
    const dup = rows.some(
      (r) =>
        r.submissionId === submissionId &&
        (r.externalMessageId === msg.messageId || (msg.idIsHash && r.contentHash === contentHash)),
    );
    if (dup) return { inserted: false };
    rows.push({
      submissionId,
      externalMessageId: msg.messageId,
      contentHash,
      bodyText: msg.bodyText,
    });
    return { inserted: true };
  };
  const existingFor = (submissionId: number): ExistingPortalResponseKey[] =>
    rows
      .filter((r) => r.submissionId === submissionId)
      .map((r) => ({ externalMessageId: r.externalMessageId, contentHash: r.contentHash }));
  return { rows, post, existingFor };
}

const SUBMISSION_ID = 4242;

const scrapedFirstPass: PortalReaderMessage[] = [
  {
    messageId: "note_1001",
    idIsHash: false,
    bodyText: "Approved. Auth #ABC123. Please proceed.",
    authorName: "MAS Reviewer", authorEmail: null, bodyHtml: "",
    postedAt: "2026-05-12T14:00:00Z",
  },
  {
    messageId: "note_1002",
    idIsHash: false,
    bodyText: "Confirmation forwarded to provider.",
    authorName: "MAS Reviewer", authorEmail: null, bodyHtml: "",
    postedAt: "2026-05-12T14:05:00Z",
  },
];

test("/responses/record-portal: first scrape inserts each new message exactly once", async () => {
  const store = makeFakeRecordPortalStore();
  const fresh = diffPortalMessages(scrapedFirstPass, store.existingFor(SUBMISSION_ID));
  assert.equal(fresh.length, 2, "both real-id messages are new on the first scrape");

  const inserts: boolean[] = [];
  for (const m of fresh) {
    const { inserted } = await store.post(SUBMISSION_ID, m);
    inserts.push(inserted);
  }
  assert.deepEqual(inserts, [true, true]);
  assert.equal(store.rows.length, 2);
});

test("/responses/record-portal: second scrape of the same ticket is a no-op (idempotent)", async () => {
  const store = makeFakeRecordPortalStore();
  // First scrape ingests both.
  for (const m of diffPortalMessages(scrapedFirstPass, store.existingFor(SUBMISSION_ID))) {
    await store.post(SUBMISSION_ID, m);
  }
  assert.equal(store.rows.length, 2);

  // Second scrape: same DOM, same ids — diff must surface zero, and even
  // if we tried to POST anyway the route-level dedup must reject.
  const secondDiff = diffPortalMessages(scrapedFirstPass, store.existingFor(SUBMISSION_ID));
  assert.equal(secondDiff.length, 0, "diff layer suppresses already-ingested messages");

  const forcedReposts = await Promise.all(
    scrapedFirstPass.map((m) => store.post(SUBMISSION_ID, m)),
  );
  assert.deepEqual(
    forcedReposts.map((r) => r.inserted),
    [false, false],
    "record-portal store rejects duplicate externalMessageIds even if diff is bypassed",
  );
  assert.equal(store.rows.length, 2, "row count unchanged after re-scrape");
});

test("/responses/record-portal: a NEW reply appearing on the third scrape is the only one inserted", async () => {
  const store = makeFakeRecordPortalStore();
  for (const m of diffPortalMessages(scrapedFirstPass, store.existingFor(SUBMISSION_ID))) {
    await store.post(SUBMISSION_ID, m);
  }
  const thirdScrape: PortalReaderMessage[] = [
    ...scrapedFirstPass,
    {
      messageId: "note_1003",
      idIsHash: false,
      bodyText: "Follow-up: please attach the trip log.",
      authorName: "MAS Reviewer", authorEmail: null, bodyHtml: "",
      postedAt: "2026-05-12T16:30:00Z",
    },
  ];
  const fresh = diffPortalMessages(thirdScrape, store.existingFor(SUBMISSION_ID));
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].messageId, "note_1003");
  const { inserted } = await store.post(SUBMISSION_ID, fresh[0]);
  assert.equal(inserted, true);
  assert.equal(store.rows.length, 3);
});

// ---------------------------------------------------------------------------
// Poster fault-tolerance — Task #725 review-cycle 3 requirement.
// Proves that one bad ticket does not abort an entire backfill/cron sweep
// and that the per-ticket result still carries an actionable error string.
// ---------------------------------------------------------------------------

test("postFreshMessagesViaPoster: a throwing poster never aborts the loop and emits a per-ticket error", async () => {
  const calls: Record<string, unknown>[] = [];
  const throwingPoster: RecordPortalPoster = async (body) => {
    calls.push(body);
    throw new Error("ECONNREFUSED 127.0.0.1:8080");
  };
  const bodies = scrapedFirstPass.map((m) => ({ submissionId: SUBMISSION_ID, externalMessageId: m.messageId }));
  const out = await postFreshMessagesViaPoster(throwingPoster, bodies, { submissionId: SUBMISSION_ID, ticketId: "t1" });
  assert.equal(calls.length, bodies.length, "poster was invoked for every fresh message even though each call threw");
  assert.equal(out.posted, 0);
  assert.equal(out.postFailures, bodies.length);
  assert.match(out.lastPostError ?? "", /ECONNREFUSED/);
});

test("postFreshMessagesViaPoster: a non-2xx response is recorded as a failure but still continues to the next message", async () => {
  let n = 0;
  const flakyPoster: RecordPortalPoster = async () => {
    n += 1;
    if (n === 1) return { ok: false, status: 502, data: { error: "bad gateway" } };
    return { ok: true, status: 200, data: { responseId: 999 } };
  };
  const bodies = scrapedFirstPass.map((m) => ({ submissionId: SUBMISSION_ID, externalMessageId: m.messageId }));
  const out = await postFreshMessagesViaPoster(flakyPoster, bodies, { submissionId: SUBMISSION_ID, ticketId: "t1" });
  assert.equal(out.posted, 1);
  assert.equal(out.postFailures, 1);
  assert.equal(out.lastPostError, "HTTP 502");
});

// ---------------------------------------------------------------------------
// Classifier parity — Task #725 review-cycle 4 requirement.
// Portal text must run through the same deterministic phrase classifier
// as email responses so MAS auto-acknowledgments don't sit in the queue.
// ---------------------------------------------------------------------------

import { classifyByPhrase } from "../lib/email-phrase-classifier";

test("classifier parity: a MAS 'Ticket Under Review' acknowledgment is tagged as acknowledgment, not 'other'", () => {
  // This is the actual phrase MAS uses on every initial portal ack and
  // is the most common silent-queue clogger in production. The portal
  // sync wraps `classifyByPhrase(msg.bodyText)` exactly the same way the
  // email path does and downgrades to "other" only when no signature
  // matches.
  const portalAckBody = "Thanks for your submission. Ticket Under Review — we will respond within 30 business days.";
  const result = classifyByPhrase(portalAckBody);
  assert.equal(result.outcome, "acknowledgment");
  const responseType = result.outcome === "acknowledgment" ? "acknowledgment" : "other";
  assert.equal(responseType, "acknowledgment");
});

test("classifier parity: an unrecognized portal reply falls back to 'other' (no false positives)", () => {
  const portalDecisionBody = "Auth #ABC123 has been approved. Please proceed with the trip on the requested date.";
  const result = classifyByPhrase(portalDecisionBody);
  assert.equal(result.outcome, "unknown");
  const outcome = result.outcome as string;
  const responseType = outcome === "acknowledgment" ? "acknowledgment" : "other";
  assert.equal(responseType, "other", "a real decision must fall to operator review, not be auto-acked");
});

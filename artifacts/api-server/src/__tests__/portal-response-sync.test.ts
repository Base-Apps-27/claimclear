// Unit tests for Task #725 — pure logic only. The Playwright reader and
// the database lookups are exercised through extracted helpers
// (`diffPortalMessages`, `parsePortalTicketHtml`, `hashContent`) so
// these tests run in <1s with no browser and no DB.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  diffPortalMessages,
  syncPortalResponsesForSubmission,
  __setRecordPortalPosterForTests,
} from "../lib/portal-response-sync";
import { parsePortalTicketHtml, hashContent, type PortalReaderMessage } from "../bot/portal-reader";

function fakeMessage(overrides: Partial<PortalReaderMessage> = {}): PortalReaderMessage {
  return {
    messageId: "note_42",
    idIsHash: false,
    authorName: "MAS Reviewer",
    authorEmail: "review@medanswering.com",
    postedAt: "2026-05-10T15:00:00Z",
    bodyHtml: "<p>Approved.</p>",
    bodyText: "Approved.",
    ...overrides,
  };
}

test("diffPortalMessages: empty existing → every fetched message is new", () => {
  const fetched = [fakeMessage({ messageId: "note_1" }), fakeMessage({ messageId: "note_2", bodyText: "Pending" })];
  const fresh = diffPortalMessages(fetched, []);
  assert.equal(fresh.length, 2);
});

test("diffPortalMessages: message id already in externalMessageId → skipped", () => {
  const fetched = [fakeMessage({ messageId: "note_1" }), fakeMessage({ messageId: "note_2", bodyText: "B" })];
  const fresh = diffPortalMessages(fetched, [{ externalMessageId: "note_1", contentHash: null }]);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].messageId, "note_2");
});

test("diffPortalMessages: content hash dedups when message had only a hash id", () => {
  const body = "Identical body";
  const fetched = [fakeMessage({ messageId: hashContent(body), idIsHash: true, bodyText: body })];
  const fresh = diffPortalMessages(fetched, [
    { externalMessageId: null, contentHash: hashContent(body) },
  ]);
  assert.equal(fresh.length, 0);
});

test("diffPortalMessages: real Freshdesk ids win — identical body with a different note id is still flagged new", () => {
  // Per Task #725 spec, idempotency key is submissionId + portalMessageId
  // when an id is present. Two distinct note ids = two distinct portal
  // events even if MAS happens to type the same text twice.
  const fetched = [fakeMessage({ messageId: "note_77", idIsHash: false, bodyText: "Hello" })];
  const fresh = diffPortalMessages(fetched, [
    { externalMessageId: "note_55", contentHash: hashContent("Hello") },
  ]);
  assert.equal(fresh.length, 1, "second real-id message must NOT be collapsed by content hash");
  assert.equal(fresh[0].messageId, "note_77");
});

test("diffPortalMessages: hash-fallback message is deduped by content hash from a prior row", () => {
  // When the scraper had to hash (no DOM id), prior content-hash on file
  // legitimately blocks a re-insert.
  const body = "Same body, different scrape";
  const fetched = [fakeMessage({ messageId: hashContent(body), idIsHash: true, bodyText: body })];
  const fresh = diffPortalMessages(fetched, [
    { externalMessageId: "note_55", contentHash: hashContent(body) },
  ]);
  assert.equal(fresh.length, 0);
});

test("hashContent: identical input → identical hash, different input → different hash", () => {
  assert.equal(hashContent("hello world"), hashContent("hello world"));
  assert.notEqual(hashContent("a"), hashContent("b"));
  assert.match(hashContent("x"), /^hash:[0-9a-f]+$/);
});

test("parsePortalTicketHtml: extracts numeric note ids and bodies from a Freshdesk-shaped page", () => {
  const html = `
    <html><body>
      <h1 class="ticket-subject">Dispute for Invoice 1234</h1>
      <span class="ticket-status">Open</span>
      <div id="note_111" class="conversation">
        <span class="author">Reviewer A</span>
        <a href="mailto:a@masop.com">a@masop.com</a>
        <time datetime="2026-05-10T12:00:00Z">May 10</time>
        <div class="body">First reply text.</div>
      </div>
      <div id="note_222" class="conversation">
        <span class="author">Reviewer B</span>
        <div class="body">Second reply text.</div>
      </div>
    </body></html>
  `;
  const parsed = parsePortalTicketHtml(html, "98765");
  assert.equal(parsed.ticketId, "98765");
  assert.equal(parsed.status, "Open");
  assert.match(parsed.subject ?? "", /Dispute for Invoice 1234/);
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages[0].messageId, "note_111");
  assert.equal(parsed.messages[0].idIsHash, false);
  assert.equal(parsed.messages[0].authorEmail, "a@masop.com");
  assert.match(parsed.messages[0].bodyText, /First reply text/);
  assert.equal(parsed.messages[1].messageId, "note_222");
});

test("parsePortalTicketHtml: falls back to a content hash when no structured items match", () => {
  const html = `<html><body><p>Just visible text — no structured conversation items.</p></body></html>`;
  const parsed = parsePortalTicketHtml(html, "1");
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0].idIsHash, true);
  assert.match(parsed.messages[0].messageId, /^hash:/);
  // The fallback is stable across reads — same body → same id.
  const second = parsePortalTicketHtml(html, "1");
  assert.equal(second.messages[0].messageId, parsed.messages[0].messageId);
});

test("parsePortalTicketHtml: end-to-end dedup — first scrape returns 2 new, re-scrape returns 0 new", () => {
  const html = `
    <div id="note_1" class="conversation"><div class="body">A</div></div>
    <div id="note_2" class="conversation"><div class="body">B</div></div>
  `;
  const parsed = parsePortalTicketHtml(html, "t");
  const firstFresh = diffPortalMessages(parsed.messages, []);
  assert.equal(firstFresh.length, 2);

  // Simulate /responses/record-portal having stored those two messages,
  // then re-scrape.
  const existing = firstFresh.map((m) => ({
    externalMessageId: m.messageId,
    contentHash: hashContent(m.bodyText),
  }));
  const secondFresh = diffPortalMessages(parsed.messages, existing);
  assert.equal(secondFresh.length, 0);
});

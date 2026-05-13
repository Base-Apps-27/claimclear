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

test("parsePortalTicketHtml: returns zero messages when no structured conversation items match (no whole-page fallback)", () => {
  // Regression guard for the 2026-05 contamination: the old last-resort
  // fallback used to hash `stripTags(html)` of the entire page when
  // neither Path A (`fw-comment-item`) nor Path B (`id="note_X"`)
  // matched. For tickets with no carrier reply, that produced a single
  // fake "message" whose body was the page chrome (title + theme CSS +
  // `window.store` JSON), which the LLM then labelled `acknowledgment`,
  // contaminating 603 rows in `portal_responses`. The contract is now:
  // no structured matches → zero messages, even if `<body>` has visible
  // text.
  const html = `<html><body><p>Just visible text — no structured conversation items.</p></body></html>`;
  const parsed = parsePortalTicketHtml(html, "1");
  assert.equal(parsed.messages.length, 0);
});

test("parsePortalTicketHtml: page-chrome-only HTML (theme CSS, window.store) yields zero messages", () => {
  // The exact shape of the 2026-05 garbage rows: a Freshdesk ticket
  // page with header chrome and the inline theme stylesheet but no
  // `fw-comments-list` / `fw-comment-item` blocks. Must produce zero
  // messages so the diff layer inserts nothing.
  const html = `<html><head><title>[#88264] Dispute - Invoice #1855277160 : Medical Answering Services</title></head>
    <body>
      <style>/* theme */ .portal--light { --fw-body-bg: #ffffff; --fw-header-bg: #ffffff; }</style>
      <script>window.cspNonce = "abc=="; window.store = { portal: { id: 1 } };</script>
    </body></html>`;
  const parsed = parsePortalTicketHtml(html, "88264");
  assert.equal(parsed.messages.length, 0);
});

test("parsePortalTicketHtml: extracts status + comments from the modern Freshdesk customer portal DOM", () => {
  // Snapshot of the DOM shapes captured live from
  // tpissues.medanswering.com on 2026-05-13 (Task #725 follow-up).
  // The status badge is `fw-status-badge fw-status-badge__<state>`
  // and conversation items are `<div class="fw-comment-item ...">`
  // with NO numeric id — author/timestamp come out of `semi-bold`
  // and `data-timeago` respectively. Body is whatever remains in
  // the `comment-container` after the author-info paragraph.
  const html = `
    <html><body>
      <title> [#84645] Dispute - Invoice #1861627690 - GPS : MAS </title>
      <span class="me-4 fw-status-badge fw-status-badge__closed">Closed</span>
      <div class="fw-comments-list mt-16">
        <div class="fw-comment-item mb-16 mx-0 d-flex">
          <div class="fw-avatar"><div class="fw-avatar-text">T</div></div>
          <div class="bg-grey p-12 br-6 w-100 comment-container ">
            <p class="author-info">
              <span class="semi-bold">Transportation Provider</span>
              <span>said <span class="timeago" data-timeago="2026-04-28 15:39:55 -0400">14 days ago</span></span>
            </p>
            <div class="pt-12 comment-scroll">
              <h3>GPS Exemption Request Approved</h3>
              <div>Review confirmed GPS compliance for invoice 1861627690.</div>
            </div>
          </div>
        </div>
        <div class="fw-comment-item mb-16 mx-0 d-flex">
          <div class="fw-avatar"><div class="fw-avatar-text">T</div></div>
          <div class="bg-grey p-12 br-6 w-100 comment-container ">
            <p class="author-info">
              <span class="semi-bold">Transportation Provider</span>
              <span>said <span class="timeago" data-timeago="2026-04-28 07:01:34 -0400">15 days ago</span></span>
            </p>
            <div class="pt-12 comment-scroll">
              <div>Hi Accounting Agape, please review the GPS exemption.</div>
            </div>
          </div>
        </div>
        <div class="fw-comment-item mb-16 mx-0 d-flex">
          <div class="px-0 fw-reply-avatar closed-ticket d-none"></div>
          <div class="fw-comment-editor">reply form, no body</div>
        </div>
      </div>
    </body></html>
  `;
  const parsed = parsePortalTicketHtml(html, "84645");
  assert.equal(parsed.status, "Closed");
  assert.equal(parsed.messages.length, 2, "must skip the trailing reply-form block");
  // No numeric DOM id on Freshdesk's portal, so the parser falls back
  // to a content hash — but it MUST be stable across reads.
  assert.equal(parsed.messages[0].idIsHash, true);
  assert.match(parsed.messages[0].messageId, /^hash:/);
  assert.equal(parsed.messages[0].authorName, "Transportation Provider");
  assert.equal(parsed.messages[0].postedAt, "2026-04-28 15:39:55 -0400");
  assert.match(parsed.messages[0].bodyText, /GPS Exemption Request Approved/);
  assert.match(parsed.messages[0].bodyText, /confirmed GPS compliance/);
  // Stability: re-parse the same HTML and ids match exactly so dedup
  // works downstream.
  const second = parsePortalTicketHtml(html, "84645");
  assert.equal(second.messages[0].messageId, parsed.messages[0].messageId);
  assert.equal(second.messages[1].messageId, parsed.messages[1].messageId);
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

// Pure-function tests for the new HTML payor email plumbing on the
// /email-thread route. We exercise `inboundToMessage` and `outboundToMessage`
// directly so we don't need to spin up an Express server or a database — the
// schema-level concern (Task #288) is just that the right body fields are
// populated based on `bodyFormat`.

import test from "node:test";
import assert from "node:assert/strict";
import {
  inboundToMessage,
  outboundToMessage,
  htmlToTextSnippet,
  buildSiblingLookup,
} from "../lib/email-thread";
import type { PortalResponse, OutboundEmail } from "@workspace/db";

const lookup = buildSiblingLookup([]);

function makeResponse(overrides: Partial<PortalResponse> = {}): PortalResponse {
  return {
    id: 1,
    claimId: 42,
    invoiceGroupId: null,
    submissionId: null,
    source: "email",
    responseType: "other",
    subject: "Test subject",
    content: null,
    rawContent: null,
    bodyFormat: "text",
    senderEmail: "payor@example.com",
    senderName: "Payor Person",
    matchedVia: null,
    matchConfidence: null,
    portalTicketId: null,
    externalMessageId: null,
    conversationId: "conv-1",
    processed: false,
    autoLinked: false,
    aiSummary: null,
    extractedAmount: null,
    extractedDeadline: null,
    requestedAction: null,
    classifierSource: "keyword",
    classifierConfidence: null,
    metadata: null,
    receivedAt: new Date("2025-04-01T12:00:00Z"),
    createdAt: new Date("2025-04-01T12:00:00Z"),
    updatedAt: new Date("2025-04-01T12:00:00Z"),
    ...overrides,
  } as PortalResponse;
}

function makeOutbound(overrides: Partial<OutboundEmail> = {}): OutboundEmail {
  return {
    id: 7,
    claimId: 42,
    invoiceGroupId: null,
    submissionId: null,
    conversationId: "conv-1",
    externalMessageId: "msg-7",
    sentByUserEmail: "staff@example.com",
    sentByUserName: "Staff Member",
    subject: "Re: Test subject",
    bodyPreview: "Thanks for the update.",
    recipients: ["payor@example.com"],
    kind: "manual",
    attachmentNames: null,
    sentAt: new Date("2025-04-01T13:00:00Z"),
    createdAt: new Date("2025-04-01T13:00:00Z"),
    ...overrides,
  } as OutboundEmail;
}

test("inboundToMessage: HTML row populates bodyHtml + plain-text bodyPreview", () => {
  const r = makeResponse({
    bodyFormat: "html",
    rawContent: "<html><body><p>Hello <b>Payor</b>!</p><p>See attached.</p></body></html>",
    content: "Hello Payor! See attached.",
  });
  const m = inboundToMessage(r, 42, lookup);
  assert.equal(m.bodyFormat, "html");
  assert.equal(
    m.bodyHtml,
    "<html><body><p>Hello <b>Payor</b>!</p><p>See attached.</p></body></html>",
  );
  // bodyPreview should be a stripped, readable snippet — no raw tags.
  assert.ok(m.bodyPreview);
  assert.ok(!m.bodyPreview!.includes("<"));
  assert.ok(m.bodyPreview!.includes("Hello"));
  assert.ok(m.bodyPreview!.includes("Payor"));
});

test("inboundToMessage: text row leaves bodyHtml null and bodyPreview unchanged", () => {
  const r = makeResponse({
    bodyFormat: "text",
    rawContent: "Plain text reply\nwith a line break.",
    content: "Plain text reply\nwith a line break.",
  });
  const m = inboundToMessage(r, 42, lookup);
  assert.equal(m.bodyFormat, "text");
  assert.equal(m.bodyHtml, null);
  assert.equal(m.bodyPreview, "Plain text reply\nwith a line break.");
});

test("inboundToMessage: HTML row prefers rawContent over content for the source body", () => {
  // Legacy behaviour preserved: rawContent has the full body, content may
  // hold the truncated Graph snippet — we want bodyHtml to reflect the full
  // raw HTML so the renderer can show it.
  const fullHtml = "<div>" + "x".repeat(500) + "</div>";
  const r = makeResponse({
    bodyFormat: "html",
    rawContent: fullHtml,
    content: "x".repeat(50),
  });
  const m = inboundToMessage(r, 42, lookup);
  assert.equal(m.bodyHtml, fullHtml);
});

test("outboundToMessage: always reports text format and null bodyHtml", () => {
  const o = makeOutbound();
  const m = outboundToMessage(o, 42, lookup);
  assert.equal(m.bodyFormat, "text");
  assert.equal(m.bodyHtml, null);
  assert.equal(m.bodyPreview, "Thanks for the update.");
});

test("htmlToTextSnippet: drops scripts/styles, decodes entities, caps length", () => {
  const html =
    "<style>a{color:red}</style><script>alert('x')</script>" +
    "<p>Hello&nbsp;World &amp; friends</p>";
  const out = htmlToTextSnippet(html);
  assert.ok(!out.includes("alert"));
  assert.ok(!out.includes("color:red"));
  assert.ok(out.includes("Hello World & friends"));
});

test("htmlToTextSnippet: long HTML body is truncated with ellipsis", () => {
  const html = "<p>" + "long ".repeat(200) + "</p>";
  const out = htmlToTextSnippet(html);
  assert.ok(out.length <= 280);
  assert.ok(out.endsWith("…"));
});

test("htmlToTextSnippet: empty input returns empty string", () => {
  assert.equal(htmlToTextSnippet(""), "");
});

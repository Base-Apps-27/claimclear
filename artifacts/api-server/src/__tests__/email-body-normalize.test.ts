// Unit tests for the inbound-email body normalization pipeline.
//
// These pin the boundary between "noise we strip" and "payor content we
// preserve". When tightening normalization in the future, run this suite
// first — every regression here means the phrase classifier is now reading
// either too much (false positives) or too little (false negatives).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  htmlToText,
  stripExternalBanner,
  stripReplyQuote,
  stripFooter,
  normalizeInboundEmailBody,
} from "../lib/email-body-normalize";

test("htmlToText: strips tags, decodes entities, collapses whitespace", () => {
  const html = `<div>Hello&nbsp;<strong>world</strong>&amp;friends.<br/>Next line.</div>`;
  const out = htmlToText(html);
  assert.match(out, /Hello world ?&friends\./);
  assert.match(out, /Next line\./);
  assert.doesNotMatch(out, /<\/?[a-z]/i);
});

test("htmlToText: drops <style> and <script> bodies", () => {
  const html = `<style>.x{color:red}</style>real<script>alert(1)</script>content`;
  const out = htmlToText(html);
  assert.equal(out.includes("alert"), false);
  assert.equal(out.includes("color"), false);
  assert.match(out, /real\s+content/);
});

test("htmlToText: removes zero-width characters", () => {
  const html = `pre\u200B\u200C\u200Dpost`;
  assert.equal(htmlToText(html), "prepost");
});

test("stripExternalBanner: removes Outlook caution banner", () => {
  const text =
    "Caution: This is an external email and has a suspicious subject or content. Please do not click any links or attachments.   Real content begins here.";
  const out = stripExternalBanner(text);
  assert.equal(out.includes("Caution"), false);
  assert.match(out, /Real content begins here/);
});

test("stripReplyQuote: cuts at 'On <date>, <name> wrote:'", () => {
  const text =
    "Approved! On Mon, Apr 28, 2026 at 7:08 PM, Accounting <ap@example.com> wrote: original dispute body that mentions denied and approved everywhere.";
  const out = stripReplyQuote(text);
  assert.match(out, /^Approved!\s*$/);
  assert.equal(out.includes("denied"), false);
});

test("stripReplyQuote: cuts at Outlook 'From: … Sent:' header", () => {
  const text =
    "Top reply text. From: ap@example.com Sent: Tue 4/28/2026 Subject: foo original body with denied keyword.";
  const out = stripReplyQuote(text);
  assert.match(out, /^Top reply text\.\s*$/);
  assert.equal(out.includes("denied"), false);
});

test("stripReplyQuote: cuts at quoted '>' lines", () => {
  const text = "real reply\n> quoted approval line\n> more quote denied";
  const out = stripReplyQuote(text);
  assert.match(out, /^real reply\s*$/);
});

test("stripReplyQuote: returns input unchanged when no splitter present", () => {
  const text = "Just a plain payor message with no quoted reply.";
  assert.equal(stripReplyQuote(text), text);
});

test("stripFooter: removes Freshdesk View ticket trailer", () => {
  const text = "We received your request. View ticket at https://example.com/12345";
  const out = stripFooter(text);
  assert.match(out, /^We received your request\.\s*$/);
});

test("stripFooter: removes 'Regards, Medical Answering Services Support Team' block", () => {
  const text =
    "We received your request. Regards, Medical Answering Services Support Team Some boilerplate footer.";
  const out = stripFooter(text);
  assert.match(out, /^We received your request\.\s*$/);
});

test("stripFooter: removes trailing Freshdesk message id like 85010:4128361", () => {
  const text = "real body 85010:4128361";
  const out = stripFooter(text);
  assert.equal(out, "real body");
});

test("normalizeInboundEmailBody: end-to-end on Outlook reply with quoted dispute", () => {
  const html = `<div>Caution: This is an external email and has a suspicious subject or content. Please do not click any links or attachments.</div>
    <p>GPS Exemption Request Approved</p>
    <p>On Mon, Apr 28, 2026 at 7:08 PM, Accounting &lt;ap@example.com&gt; wrote:</p>
    <blockquote>The trip was denied previously, please re-review the GPS approved status.</blockquote>
    <p>Regards, Medical Answering Services Support Team</p>`;
  const out = normalizeInboundEmailBody(html);
  // Real payor content must be preserved
  assert.match(out, /GPS Exemption Request Approved/);
  // Caution banner stripped
  assert.equal(out.includes("Caution"), false);
  // Quoted reply (which contains "denied") stripped
  assert.equal(out.includes("denied"), false);
  assert.equal(out.toLowerCase().includes("re-review"), false);
  // Footer stripped
  assert.equal(out.includes("Regards"), false);
});

test("normalizeInboundEmailBody: handles empty / null input gracefully", () => {
  assert.equal(normalizeInboundEmailBody(""), "");
  // @ts-expect-error null is not in signature but should not throw
  assert.equal(normalizeInboundEmailBody(null), "");
});

test("normalizeInboundEmailBody: preserves real decision when both decision and ack appear", () => {
  // The phrase classifier handles precedence; normalization must keep BOTH
  // phrases visible so the classifier can see them.
  const html = `<p>Ticket Under Review</p><p>GPS Exemption Request Approved</p>`;
  const out = normalizeInboundEmailBody(html);
  assert.match(out, /Ticket Under Review/);
  assert.match(out, /GPS Exemption Request Approved/);
});

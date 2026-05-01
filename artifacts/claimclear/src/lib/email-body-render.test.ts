import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeHtml, resolveBodyRender } from "./email-body-render.ts";

const passthrough = (raw: string) => `SAN(${raw})`;

test("looksLikeHtml: detects structural tags", () => {
  assert.equal(looksLikeHtml("<html><body>hi</body></html>"), true);
  assert.equal(looksLikeHtml("<table><tr><td>x</td></tr></table>"), true);
  assert.equal(looksLikeHtml("<div>hello</div>"), true);
  assert.equal(looksLikeHtml("<p>line</p>"), true);
  assert.equal(looksLikeHtml("<!DOCTYPE html><html></html>"), true);
});

test("looksLikeHtml: rejects non-HTML strings", () => {
  assert.equal(looksLikeHtml(null), false);
  assert.equal(looksLikeHtml(undefined), false);
  assert.equal(looksLikeHtml(""), false);
  assert.equal(looksLikeHtml("plain text body, no markup"), false);
  // Sentence with a stray angle bracket should not trigger detection.
  assert.equal(looksLikeHtml("we send <invoice> XML files to payors"), false);
  // Single short snippet under length threshold.
  assert.equal(looksLikeHtml("<b>"), false);
  // Heart emoticon should not trigger.
  assert.equal(looksLikeHtml("thanks <3 for the update"), false);
});

test("resolveBodyRender: bodyHtml present → HTML branch", () => {
  const out = resolveBodyRender(
    {
      bodyHtml: "<p>hi</p>",
      bodyFormat: "html",
      bodyPreview: "hi",
    },
    passthrough,
  );
  assert.equal(out.kind, "html");
  if (out.kind === "html") assert.equal(out.html, "SAN(<p>hi</p>)");
});

test("resolveBodyRender: bodyFormat=text + plain preview → text branch", () => {
  const out = resolveBodyRender(
    {
      bodyHtml: null,
      bodyFormat: "text",
      bodyPreview: "Thanks for your reply.",
    },
    passthrough,
  );
  assert.equal(out.kind, "text");
  if (out.kind === "text") assert.equal(out.text, "Thanks for your reply.");
});

test("resolveBodyRender: bodyFormat=html but bodyHtml missing → falls back to preview as HTML", () => {
  const out = resolveBodyRender(
    {
      bodyHtml: null,
      bodyFormat: "html",
      bodyPreview: "<p>only preview</p>",
    },
    passthrough,
  );
  assert.equal(out.kind, "html");
  if (out.kind === "html") assert.equal(out.html, "SAN(<p>only preview</p>)");
});

test("resolveBodyRender: defensive fallback when text body clearly looks like HTML", () => {
  // bodyFormat is missing/text but the body is obviously HTML — render as HTML
  // so the panel never prints raw `<table>` tags as literal text.
  const out = resolveBodyRender(
    {
      bodyHtml: null,
      bodyFormat: "text",
      bodyPreview: "<table><tr><td>line</td></tr></table>",
    },
    passthrough,
  );
  assert.equal(out.kind, "html");
});

test("resolveBodyRender: empty body → text branch with empty string", () => {
  const out = resolveBodyRender(
    { bodyHtml: null, bodyFormat: "text", bodyPreview: "" },
    passthrough,
  );
  assert.equal(out.kind, "text");
  if (out.kind === "text") assert.equal(out.text, "");
});

test("resolveBodyRender: whitespace-only bodyHtml is ignored", () => {
  // A `bodyHtml` that's just whitespace should not trip the HTML branch —
  // we should fall through to the text rendering of the preview instead.
  const out = resolveBodyRender(
    { bodyHtml: "   \n  ", bodyFormat: "text", bodyPreview: "real text" },
    passthrough,
  );
  assert.equal(out.kind, "text");
  if (out.kind === "text") assert.equal(out.text, "real text");
});

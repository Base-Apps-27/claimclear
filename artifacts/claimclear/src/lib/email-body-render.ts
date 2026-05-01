/**
 * Shared sanitization + HTML-detection helpers for rendering payor
 * messages in the Communication panel. Kept as a tiny pure module so it
 * can be unit-tested without spinning up React or jsdom — all DOM-side
 * sanitization is delegated to DOMPurify, which the UI calls right after
 * deciding what mode to render in.
 *
 * Two surfaces use these helpers:
 *  - `MessageRow` inside `group-communication-thread.tsx` (the threaded
 *    Communication panel on Responses Awaiting Review and the invoice-
 *    group detail page).
 *  - `InlineResponseFallback` inside `responses-awaiting-review.tsx`
 *    (the card shown when a response exists but no email conversation
 *    is linked yet).
 *
 * Both surfaces want the same sanitizer config, the same defensive
 * "this plain text actually looks like HTML" guard, and the same answer
 * to "should I render HTML or pre-formatted text for this message?".
 */
import DOMPurify from "dompurify";

/**
 * Tags that are safe to render inside a sanitized payor email body.
 * Wide enough to handle typical marketing-template HTML (tables with
 * inline styles, alignment attributes, `<font>` blocks, horizontal
 * rules), but still narrow enough that we never accept `<script>`,
 * `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, or `<input>`
 * (DOMPurify drops anything not in this list).
 */
export const ALLOWED_EMAIL_TAGS: string[] = [
  "p", "br", "hr", "strong", "em", "u", "b", "i", "small", "mark",
  "sub", "sup", "ul", "ol", "li", "a", "blockquote", "pre", "code",
  "h1", "h2", "h3", "h4", "h5", "h6", "span", "div", "section",
  "article", "header", "footer", "table", "thead", "tbody", "tfoot",
  "tr", "th", "td", "caption", "colgroup", "col", "img", "center",
  "font",
];

/**
 * Attributes the sanitizer keeps. Includes alignment + table layout
 * attributes that legacy email clients still emit, plus the `style` and
 * `class` hooks that modern Outlook templates rely on. URL-bearing
 * attributes (`href`, `src`) are still gated by DOMPurify's
 * `ALLOWED_URI_REGEXP` — `javascript:` and `data:` URLs are blocked.
 */
export const ALLOWED_EMAIL_ATTR: string[] = [
  "href", "target", "rel", "src", "alt", "title", "name", "id",
  "width", "height", "align", "valign", "bgcolor", "border",
  "cellpadding", "cellspacing", "colspan", "rowspan", "dir",
  "style", "class", "color", "face", "size", "type",
];

/** URLs the sanitizer accepts. Notably excludes `javascript:` and `data:`. */
const SAFE_URI_REGEXP = /^(?:https?:|mailto:|tel:|cid:|#|\/|\.{1,2}\/)/i;

/** Tags we always strip even if a future allow-list change adds them. */
const FORBID_EMAIL_TAGS: string[] = [
  "script", "style", "iframe", "object", "embed", "form", "input",
  "button", "select", "option", "textarea", "link", "meta", "base",
  "frame", "frameset",
];

/** Attribute names we never want surviving sanitization. */
const FORBID_EMAIL_ATTR: string[] = [
  "onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur",
  "onchange", "onsubmit", "onkeydown", "onkeyup", "onkeypress",
  "formaction", "action",
];

/**
 * Sanitize a raw HTML email body for in-thread rendering. Always returns
 * a string safe to pass to `dangerouslySetInnerHTML`.
 */
export function sanitizeEmailHtml(raw: string): string {
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: ALLOWED_EMAIL_TAGS,
    ALLOWED_ATTR: ALLOWED_EMAIL_ATTR,
    FORBID_TAGS: FORBID_EMAIL_TAGS,
    FORBID_ATTR: FORBID_EMAIL_ATTR,
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Defensive plain-text-looks-like-HTML detector. Used when an inbound
 * message has no `bodyHtml` but the plain-text body clearly carries
 * markup (a regression in ingestion or a row that pre-dates the
 * `bodyFormat` column). Without this guard the renderer would print
 * literal `<html>` / `<table>` tags as text.
 *
 * False-positive guards: we don't trip on `<3` (no tag name follows the
 * `<`), single-character `<x>` snippets, or a plain mention of XML
 * inside a sentence ("we send <invoice> XML files"). The body must
 * contain at least one fully-formed HTML structural tag.
 */
export function looksLikeHtml(body: string | null | undefined): boolean {
  if (!body) return false;
  const trimmed = body.trim();
  if (trimmed.length < 6) return false;

  // The most reliable signal: an opening structural tag.
  if (/<\s*(html|head|body|table|div|tbody|thead|tr|td|p|br|meta|style|font|center|hr)\b/i.test(trimmed)) {
    return true;
  }
  // Doctype declarations or HTML comment opener also count.
  if (/^<!doctype\s+html/i.test(trimmed) || trimmed.startsWith("<!--")) return true;

  return false;
}

/**
 * Render-mode resolver for the Communication panel. Returns either
 *   - `{ kind: "html", html }` when the message has a populated
 *     `bodyHtml`, or when its `bodyPreview` looks like HTML markup
 *     (defensive fallback). The string is sanitized and ready for
 *     `dangerouslySetInnerHTML`.
 *   - `{ kind: "text", text }` otherwise — the caller should render it
 *     with `whitespace-pre-wrap` so newlines survive.
 *
 * Pure / synchronous so it can be exercised in tests without React.
 */
export type RenderedBody =
  | { kind: "html"; html: string }
  | { kind: "text"; text: string };

export function resolveBodyRender(
  input: {
    bodyHtml?: string | null;
    bodyFormat?: "html" | "text" | null;
    bodyPreview?: string | null;
  },
  // The sanitizer is injectable so tests can exercise the routing logic
  // (HTML vs text vs defensive fallback) without spinning up a DOM. The
  // real call site uses the default DOMPurify-backed `sanitizeEmailHtml`.
  sanitize: (raw: string) => string = sanitizeEmailHtml,
): RenderedBody {
  const html = input.bodyHtml ?? null;
  const preview = input.bodyPreview ?? "";

  // First pass: explicit HTML body.
  if (html && html.trim().length > 0) {
    return { kind: "html", html: sanitize(html) };
  }

  // Second pass: bodyFormat says HTML but bodyHtml didn't make it
  // through (e.g. older client, partial response). Try the preview.
  if (input.bodyFormat === "html" && preview && preview.trim().length > 0) {
    return { kind: "html", html: sanitize(preview) };
  }

  // Defensive fallback: plain-text body that clearly looks like HTML.
  if (looksLikeHtml(preview)) {
    return { kind: "html", html: sanitize(preview) };
  }

  return { kind: "text", text: preview };
}

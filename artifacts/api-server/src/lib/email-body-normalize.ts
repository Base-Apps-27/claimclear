// Inbound-email body normalization for the phrase-signature classifier.
//
// Why this exists: every inbound payor email is a *reply* to one of our
// outbound disputes, so the raw body always contains:
//   1. Outlook's "Caution: This is an external email…" banner.
//   2. The payor's actual message (a few lines of templated boilerplate
//      or a real decision).
//   3. The full quoted text of OUR original outbound dispute, including
//      the words "approved" / "denied" / "received" inside the dispute
//      narrative or the standard reply-quote header.
//   4. Footer signature blocks ("Regards, …", "Medical Answering Services
//      Support Team", Freshdesk view-ticket links, hidden tracking IDs).
//
// The legacy keyword classifier ran on `subject + body` raw, which made it
// fire on our own quoted words at least as often as the payor's. Rebuilding
// the deterministic classifier means the FIRST step is to throw all of the
// non-payor noise away so the SIGNATURES library only ever sees what the
// payor actually wrote on the top of the reply.

const EXTERNAL_BANNER_RE =
  /Caution\s*:\s*This is an external email[\s\S]*?attachments\s*\.\s*/i;

// Lines / phrases that mark the start of the quoted original message.
// We strip everything from the first match to the end of the body.
//   - `On <date>, <name> wrote:` (Outlook, Gmail, Apple Mail)
//   - `From: <addr> Sent: <date> Subject: …` (classic Outlook header)
//   - `From: <addr>` followed by `Sent: …` — same header variant
//   - Any line that begins with `>` (RFC reply-quoting)
//   - Standard "You don't often get email from …" Outlook external warning
//     that appears between the payor reply and our quoted original
const REPLY_QUOTE_SPLITTERS: RegExp[] = [
  // "On Mon, 28 Apr at 7:08 PM , Accounting Agape <foo@bar.com> wrote:"
  /\bOn\s+\w+,?\s+\d{1,2}\s+\w+(?:\s+\d{4})?\s+at\s+[\d:apmAPM\s]+,?\s+[^<\n]*<[^>]+>\s*wrote:/,
  // Same pattern, full date "On Mon, Apr 28, 2026 at 7:08 PM, … wrote:"
  /\bOn\s+\w+,?\s+\w+\s+\d{1,2},?\s+\d{4}\s+at\s+[\d:apmAPM\s]+,?\s+[^<\n]*<[^>]+>\s*wrote:/,
  // Bare "On … wrote:" fallback
  /\bOn\s+[^\n]{0,200}\s+wrote\s*:/,
  // Outlook header: "From: foo@bar.com Sent: Tue 4/28/2026"
  /From:\s*[^\s<]+@[^\s>]+\s*Sent:\s*/i,
  // Sometimes appears split across lines
  /\bSent:\s*\w+\s+\d{1,2}\/\d{1,2}\/\d{2,4}/i,
  // RFC reply quoting at column 0
  /(?:^|\n)\s*>\s/,
  // Outlook external sender education line
  /You don't often get email from\s+[^\s]+/i,
];

// Footer / signature blocks at the end of the payor message that we know
// are noise and should be cut. These match boundaries; everything from the
// match to end-of-string is dropped.
const FOOTER_CUT_MARKERS: RegExp[] = [
  // Freshdesk's "View ticket" affordance and the URL fallback note
  /\bView ticket\b[\s\S]*$/i,
  /If the button doesn't work,\s*copy-paste/i,
  // The MAS support-team sign-off
  /Regards,\s*Medical Answering Services Support Team[\s\S]*$/i,
  // Freshdesk per-message tracking id, e.g. "85010:4128361"
  /\b\d{4,6}:\d{6,}\b\s*$/,
];

/**
 * Strip HTML to plain text. Conservative: removes tags, decodes the few
 * entities we actually see in payor messages, normalises whitespace.
 * The output is a single line of text with single spaces between tokens.
 */
export function htmlToText(input: string): string {
  if (!input) return "";
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    // Treat common block-level breaks as soft newlines so that paragraph
    // boundaries survive into the cleaned text — useful for matching
    // splitters like "From: …" that the payor puts on its own line.
    .replace(/<\/(p|div|h[1-6]|li|tr|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width chars
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Strip the Outlook "external email" caution banner. Idempotent.
 */
export function stripExternalBanner(text: string): string {
  return text.replace(EXTERNAL_BANNER_RE, " ").trim();
}

/**
 * Strip the quoted original message from a reply. We look for the first
 * occurrence of any reply-quote splitter and cut everything from that
 * point onward (including the splitter itself).
 */
export function stripReplyQuote(text: string): string {
  let earliest = -1;
  for (const re of REPLY_QUOTE_SPLITTERS) {
    const m = re.exec(text);
    if (m && m.index >= 0 && (earliest < 0 || m.index < earliest)) {
      earliest = m.index;
    }
  }
  if (earliest < 0) return text;
  return text.slice(0, earliest).trim();
}

/**
 * Strip well-known footer/signature blocks at the end of the payor message.
 */
export function stripFooter(text: string): string {
  let out = text;
  for (const re of FOOTER_CUT_MARKERS) {
    out = out.replace(re, " ");
  }
  return out.trim();
}

/**
 * Full pipeline. Accepts either raw HTML or plain text and returns the
 * cleaned text the phrase-signature classifier should look at. The original
 * raw body is still preserved by the caller (it gets stored on
 * `portal_responses.raw_content`); only the cleaned body is fed to the
 * classifier and only the cleaned body is matched against the SIGNATURES
 * library.
 *
 * Order matters:
 *   1. HTML → text (so subsequent regexes can operate on plain text).
 *   2. Strip external-banner (it can be very long and full of decorative chrome).
 *   3. Strip reply-quote (everything from the first splitter onward — this
 *      is where almost all the false-positive keyword hits used to come from).
 *   4. Strip footer markers.
 *   5. Collapse remaining whitespace runs to single spaces.
 */
export function normalizeInboundEmailBody(rawBody: string): string {
  if (!rawBody) return "";
  let t = htmlToText(rawBody);
  t = stripExternalBanner(t);
  t = stripReplyQuote(t);
  t = stripFooter(t);
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

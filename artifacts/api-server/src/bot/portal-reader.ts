/// <reference lib="dom" />
// Read-side Playwright bot for Task #725.
//
// Opens a single MAS Freshdesk ticket page (tpissues.medanswering.com),
// scrapes its current status + the conversation thread, and returns a
// normalised view that `lib/portal-response-sync.ts` diffs against the
// `portal_responses` table. The bot is read-only — it never clicks a
// button that would change ticket state.
//
// Concurrency: callers MUST acquire `portalBrowserGate` before invoking
// `readPortalTicket`. The submit bot (`batch-worker.ts`) and this reader
// share one Chromium process; running both at once corrupts the saved
// `bot-session/state.json`.
//
// Testing: `parsePortalTicketHtml` is a pure function exported for unit
// tests, and `__setChromiumForTests` lets the integration-shaped tests
// swap a fake Playwright impl in.

import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { logger } from "../lib/logger";
import { PORTAL_URL, SESSION_DIR, ensureBrowsersInstalled } from "./batch-worker";

export interface PortalReaderMessage {
  /**
   * Stable per-message id pulled out of the DOM (Freshdesk renders each
   * conversation item with `id="note_<NUMERIC_ID>"`). When the page does
   * not surface an id we fall back to a content hash so dedup still works
   * across reads — see `hashContent`.
   */
  messageId: string;
  /** True when the id came from a hash fallback rather than a real DOM id. */
  idIsHash: boolean;
  authorName: string | null;
  authorEmail: string | null;
  /** ISO timestamp parsed from the message header, or null on parse failure. */
  postedAt: string | null;
  bodyHtml: string;
  bodyText: string;
}

export interface PortalReaderResult {
  ticketId: string;
  /** Freshdesk-rendered status string (e.g. "Open", "Pending", "Closed"). */
  status: string | null;
  /** Subject of the ticket as shown in the page header. */
  subject: string | null;
  messages: PortalReaderMessage[];
}

// ---------------------------------------------------------------------------
// Pure parser — exported for unit tests so we can pin the DOM contract
// without spinning up Playwright.
// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return html
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>(?!\n)/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** djb2-ish hash so the same body produces the same id across reads. */
export function hashContent(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return `hash:${(h >>> 0).toString(16)}`;
}

function pickFirst(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

/**
 * Best-effort parser for the MAS / Freshdesk customer-portal ticket page.
 * The layout has shifted under us a couple of times so we keep the patterns
 * permissive and fall back to a content hash when the per-message id we
 * really want isn't in the DOM. The reader pipeline always re-reads the
 * same ticket, so a stable-but-imperfect id is better than throwing.
 */
export function parsePortalTicketHtml(html: string, ticketId: string): PortalReaderResult {
  const status = pickFirst(html, [
    // Modern Freshdesk customer portal renders the badge with class
    // `fw-status-badge fw-status-badge__<state>` and the human label as
    // the inner text (e.g. "Closed", "Open", "Pending", "Resolved",
    // "Awaiting your Reply"). Match this first since it's what the
    // live tpissues.medanswering.com pages currently emit.
    /<span[^>]*class="[^"]*fw-status-badge[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    // Legacy patterns kept for backward-compat with older Freshdesk
    // skins and the unit-test fixtures.
    /<span[^>]*class="[^"]*ticket[-_]?status[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    /<div[^>]*class="[^"]*status[-_]?label[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<span[^>]*data-status[^>]*>([\s\S]*?)<\/span>/i,
    /Status[:\s]*<\/[a-z]+>\s*<[a-z]+[^>]*>([\s\S]*?)</i,
  ]);

  const subject = pickFirst(html, [
    /<h1[^>]*class="[^"]*ticket[-_]?subject[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<title>([\s\S]*?)<\/title>/i,
  ]);

  const messages: PortalReaderMessage[] = [];

  // Path A — modern Freshdesk customer portal (`fw-comment-item` blocks).
  // These carry NO numeric DOM id, so we mint a stable id from a hash
  // of the message body + timestamp (deduped via `diffPortalMessages`
  // downstream). Author is in `<span class="semi-bold">…</span>`,
  // timestamp in `<span class="timeago" data-timeago="YYYY-MM-DD HH:MM:SS ±HHMM">`.
  //
  // Block bounding: scope the search to inside `fw-comments-list` and
  // bound each block by either the next `fw-comment-item` start OR the
  // `fw-comment-editor` reply form (whichever comes first). Without
  // this, the LAST comment slurps trailing page chrome/scripts and the
  // body hash drifts run-to-run.
  const listMatch = html.match(
    /<div[^>]*class="[^"]*fw-comments-list[^"]*"[^>]*>([\s\S]*?)<div[^>]+id="fw-add-note-form"/i,
  );
  const commentsRegion = listMatch ? listMatch[1] : html;
  const fwStarts = Array.from(
    commentsRegion.matchAll(/<div[^>]*class="[^"]*fw-comment-item[^"]*"[^>]*>/gi),
  )
    .map((m) => m.index ?? -1)
    .filter((i) => i >= 0);
  // Editor boundary inside the comments region — anything at/after this
  // offset is the reply form, never a real message.
  const editorMatch = commentsRegion.match(/<div[^>]*class="[^"]*fw-comment-editor[^"]*"[^>]*>/i);
  const editorStart = editorMatch && editorMatch.index !== undefined ? editorMatch.index : commentsRegion.length;
  for (let i = 0; i < fwStarts.length; i += 1) {
    const start = fwStarts[i];
    if (start >= editorStart) continue; // reply-form item itself
    const nextItemStart = i + 1 < fwStarts.length ? fwStarts[i + 1] : commentsRegion.length;
    const end = Math.min(nextItemStart, editorStart);
    const block = commentsRegion.slice(start, end);

    const authorName = pickFirst(block, [
      /<span[^>]*class="[^"]*semi-bold[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    ]);
    const authorEmail = pickFirst(block, [/mailto:([^"'>\s]+)/i]);
    const postedAt = pickFirst(block, [
      /data-timeago="([^"]+)"/i,
      /data-livestamp="([^"]+)"/i,
      /<time[^>]*datetime="([^"]+)"/i,
    ]);
    // Body lives in the inner `comment-container` (or `comment-scroll`).
    // Drop ONLY the `<p class="author-info">…</p>` header inside that
    // container — a targeted strip avoids the over-broad "said N days
    // ago" regex that could chew real message content.
    const bodyMatch = block.match(
      /<div[^>]*class="[^"]*comment-(?:container|scroll)[^"]*"[^>]*>([\s\S]*)/i,
    );
    const bodyHtml = (bodyMatch ? bodyMatch[1] : block).replace(
      /<p[^>]*class="[^"]*author-info[^"]*"[^>]*>[\s\S]*?<\/p>/i,
      "",
    );
    const bodyText = stripTags(bodyHtml).trim();
    // Skip avatar-letter / one-character artifacts. Freshdesk renders
    // a circular author avatar as `<div class="avatar">A</div>` and on
    // some skins that bubbles into the comment-container when the real
    // body is empty (commenter posted only an attachment). Anything
    // shorter than a real word is noise — pin a minimum length so we
    // don't materialize a portal_responses row from a single letter.
    // (Caught by prod row #461: a one-char "A" body that wrongly
    // flipped invoice 1861920910 into Ready to Review.)
    const MIN_PORTAL_BODY_CHARS = 3;
    if (bodyText.length < MIN_PORTAL_BODY_CHARS) continue;
    // Mix the timestamp into the hash so two comments with identical
    // bodies but different posted-at values don't collapse into one
    // (rare, but Freshdesk doesn't guarantee bodies are unique).
    const hashInput = postedAt ? `${postedAt}\n${bodyText}` : bodyText;
    messages.push({
      messageId: hashContent(hashInput),
      idIsHash: true,
      authorName: authorName ? stripTags(authorName) : null,
      authorEmail,
      postedAt,
      bodyHtml,
      bodyText,
    });
  }

  // Path B — legacy / generic "id=note_X" structure. Kept so older
  // Freshdesk skins (and the existing unit-test fixtures) still parse.
  if (messages.length === 0) {
    const itemRe = /<(?:div|li|article)\b([^>]*\bid="(?:note|conv|thread)[_-]?(\d+)"[^>]*)>([\s\S]*?)<\/(?:div|li|article)>/gi;
    let match: RegExpExecArray | null;
    while ((match = itemRe.exec(html)) !== null) {
      const numericId = match[2];
      const block = match[3];
      const authorName = pickFirst(block, [
        /<(?:span|a|div)[^>]*class="[^"]*(?:author|user|name)[^"]*"[^>]*>([\s\S]*?)</i,
      ]);
      const authorEmail = pickFirst(block, [/mailto:([^"'>\s]+)/i]);
      const postedAt = pickFirst(block, [
        /<time[^>]*datetime="([^"]+)"/i,
        /data-timestamp="([^"]+)"/i,
      ]);
      const bodyMatch = block.match(
        /<(?:div|section)[^>]*class="[^"]*(?:body|content|message)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section)>/i,
      );
      const bodyHtml = bodyMatch ? bodyMatch[1] : block;
      const bodyText = stripTags(bodyHtml);
      if (!bodyText) continue;
      messages.push({
        messageId: `note_${numericId}`,
        idIsHash: false,
        authorName: authorName ? stripTags(authorName) : null,
        authorEmail,
        postedAt,
        bodyHtml,
        bodyText,
      });
    }
  }

  // No last-resort fallback. Earlier versions of this parser used to
  // hash `stripTags(html)` of the entire page when neither Path A nor
  // Path B matched, on the theory that "this ticket has SOMETHING new"
  // was better than silently dropping the read. In practice that path
  // synthesised one fake "message" per scrape whose body was just the
  // page chrome — Freshdesk's `<title>`, the inline `/* theme */`
  // CSS-variables block, and the `window.cspNonce` / `window.store`
  // bootstrap JSON — all of which `stripTags` reduces to plain text.
  // That body then fed the LLM classifier (which obediently labelled
  // it `acknowledgment`) and contaminated `portal_responses` with
  // 603 garbage rows in 2026-05 alone. A ticket whose conversation
  // contains zero structured carrier replies must yield zero messages,
  // even if the page itself has visible text. The diff layer then
  // correctly inserts nothing.

  return {
    ticketId,
    status: status ? stripTags(status) : null,
    subject: subject ? stripTags(subject) : null,
    messages,
  };
}

// ---------------------------------------------------------------------------
// Live reader — wraps Playwright. Tests substitute the chromium impl.
// ---------------------------------------------------------------------------

let __chromiumImpl: { launch: typeof chromium.launch } = chromium;
export function __setChromiumForTests(impl: { launch: typeof chromium.launch } | null): void {
  __chromiumImpl = impl ?? chromium;
}

function buildTicketUrl(ticketId: string): string {
  // Numeric ticket IDs hit the canonical Freshdesk URL. Some legacy rows
  // store a synthetic "portal-<timestamp>" id (see exports/silent-groups
  // -2026-05-12.csv) which is NOT a valid portal URL — callers must skip
  // those, but we accept the id here and let navigation fail loudly so
  // the sync orchestrator can mark the row unreadable.
  return `${PORTAL_URL}/support/tickets/${encodeURIComponent(ticketId)}`;
}

export interface ReadPortalTicketOpts {
  /** Override env-backed creds in tests; not used in production. */
  username?: string;
  password?: string;
  /** Per-call timeout for the navigation step. Defaults to 45s. */
  navigationTimeoutMs?: number;
}

/**
 * Open a portal ticket and return the parsed view. The caller is
 * responsible for funnelling concurrent reads through `portalBrowserGate`.
 *
 * Read-only contract: this function navigates and scrapes; it never
 * fills, clicks, or submits a form. The only state-changing side effect
 * is refreshing `bot-session/state.json` after a re-login.
 */
export async function readPortalTicket(
  ticketId: string,
  opts: ReadPortalTicketOpts = {},
): Promise<PortalReaderResult> {
  if (!ticketId || /^portal-/i.test(ticketId)) {
    throw new Error(
      `readPortalTicket: refused synthetic ticket id "${ticketId}" — only real Freshdesk numeric ids are scrapable`,
    );
  }

  await ensureBrowsersInstalled();

  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
  const statePath = path.join(SESSION_DIR, "state.json");

  const browser = await __chromiumImpl.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = fs.existsSync(statePath)
      ? await browser.newContext({ storageState: statePath })
      : await browser.newContext();
    const page = await context.newPage();

    const ticketUrl = buildTicketUrl(ticketId);
    const timeout = opts.navigationTimeoutMs ?? 45_000;

    logger.info({ ticketId, ticketUrl }, "Portal reader: navigating to ticket");
    await page.goto(ticketUrl, { waitUntil: "domcontentloaded", timeout });
    await page.waitForTimeout(1500);

    // If the storage state is stale we land on a login form. Re-login,
    // re-save state, then re-navigate. Mirrors the recovery path in the
    // submit bot so a single saved session works for both bots.
    const loginInput = await page.$('input[type="password"]');
    if (loginInput) {
      const username = opts.username ?? process.env.MAS_PORTAL_USERNAME ?? "";
      const password = opts.password ?? process.env.MAS_PORTAL_PASSWORD ?? "";
      if (!username || !password) {
        throw new Error("Portal reader: session expired and MAS_PORTAL_USERNAME/MAS_PORTAL_PASSWORD not configured");
      }
      const emailInput = await page.$('input[name="user[email]"], input[name="helpdesk_user[email]"], input[type="email"], #user_email');
      if (!emailInput) throw new Error("Portal reader: login form not recognized (no email input)");
      await emailInput.fill(username);
      await loginInput.fill(password);
      const submitBtn = await page.$('button[type="submit"], input[type="submit"], input[name="commit"]');
      if (submitBtn) await submitBtn.click();
      await page.waitForTimeout(3000);
      await context.storageState({ path: statePath });
      await page.goto(ticketUrl, { waitUntil: "domcontentloaded", timeout });
      await page.waitForTimeout(1500);
    }

    const html = await page.content();
    const parsed = parsePortalTicketHtml(html, ticketId);
    logger.info({
      ticketId,
      status: parsed.status,
      messageCount: parsed.messages.length,
    }, "Portal reader: parsed ticket");
    return parsed;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

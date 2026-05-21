/// <reference lib="dom" />
// Read-side Playwright bot for portal-vs-DB discovery.
//
// Opens a page of the MAS Freshdesk customer-portal ticket LIST
// (tpissues.medanswering.com/support/tickets?page=N) and scrapes the
// summary rows so we can reconcile what exists on the portal against
// the ticket ids we already track in portal_submissions.
//
// This is the discovery counterpart to `portal-reader.ts`. That file
// reads ONE ticket by id; this file enumerates ticket ids that exist
// on the portal so we can detect the ones we never knew about.
//
// Concurrency: callers MUST acquire `portalBrowserGate` before invoking
// `readPortalIndexPage` for the same reason the per-ticket reader does
// — Chromium and `bot-session/state.json` are shared with the submit
// bot. `parsePortalIndexHtml` is a pure function exported for unit
// tests and for ad-hoc parsing of saved HTML samples.
//
// Read-only contract: this function navigates and scrapes; it never
// fills, clicks, or submits a form. The only state-changing side
// effect is refreshing `bot-session/state.json` after a re-login.

import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { logger } from "../lib/logger";
import { PORTAL_URL, SESSION_DIR, ensureBrowsersInstalled } from "./batch-worker";

export interface PortalIndexRow {
  /** Numeric Freshdesk ticket id parsed from the row's link. */
  ticketId: string;
  /** Best-effort subject text. May be null on skins that hide it from the list. */
  subject: string | null;
  /** Best-effort status label scraped from the row badge (e.g. "Open", "Closed"). */
  status: string | null;
  /**
   * Whatever the row renders for "last updated" — usually a relative phrase
   * like "2 days ago" or an ISO timestamp from a `data-timeago` attribute.
   * Stored raw; downstream code can parse if it cares.
   */
  lastUpdatedRaw: string | null;
}

export interface PortalIndexPageResult {
  page: number;
  /** Total pages visible in the pager, if we can parse it. Null means unknown. */
  totalPagesHint: number | null;
  /** True if the page rendered zero ticket rows (end of list reached). */
  empty: boolean;
  rows: PortalIndexRow[];
}

// ---------------------------------------------------------------------------
// Pure parser — exported for unit tests so we can pin the DOM contract
// without spinning up Playwright. Mirrors the permissive multi-pattern
// approach used in `parsePortalTicketHtml`.
// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function pickFirst(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return stripTags(m[1]);
  }
  return null;
}

/**
 * Parse one page of the customer-portal "All Tickets" list.
 *
 * The Freshdesk customer portal has gone through a few skins, so we don't
 * lock to a single selector. The anchoring fact we trust is that every
 * ticket row contains an anchor whose href matches
 * `/support/tickets/<numeric_id>`. We use those anchor positions as
 * row delimiters, then look INSIDE each row's HTML neighborhood for the
 * subject, status badge, and a relative timestamp. Anything we can't
 * find comes back null — the reconciliation layer only needs the id.
 */
export function parsePortalIndexHtml(html: string, page: number): PortalIndexPageResult {
  // 404 / login-page short-circuits (same defense as portal-reader).
  if (
    /The page you were looking for doesn'?t exist \(404\)/i.test(html) ||
    /<title>[^<]*Page not found[^<]*<\/title>/i.test(html)
  ) {
    return { page, totalPagesHint: null, empty: true, rows: [] };
  }

  // Locate the ticket links. We capture the byte offset of each anchor
  // start so we can carve out a "row neighborhood" of HTML around it
  // (the surrounding ~2KB) without depending on the row container's
  // exact tag/class.
  const linkRe = /<a\b[^>]*\bhref="\/support\/tickets\/(\d+)(?:\?[^"]*)?"[^>]*>/gi;
  const matches: Array<{ id: string; idx: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    matches.push({ id: m[1], idx: m.index ?? 0 });
  }

  // De-duplicate by id while preserving first-occurrence position
  // (Freshdesk list rows sometimes render two anchors per ticket —
  // one on the subject, one on a "view" link). The row's status badge
  // and timestamp often live AFTER the second same-id anchor, so the
  // block boundary must skip past anchors with the same id and stop
  // only at the next DIFFERENT ticket id.
  const seen = new Set<string>();
  const rows: PortalIndexRow[] = [];
  for (const { id, idx } of matches) {
    if (seen.has(id)) continue;
    seen.add(id);

    // Neighborhood: from this anchor start to the next anchor for a
    // DIFFERENT ticket id (or ~2000 chars, whichever is smaller). Without
    // the same-id skip, a duplicate anchor on the same row would truncate
    // the block before the status badge.
    const next = matches.find((x) => x.idx > idx + 1 && x.id !== id);
    const end = Math.min(idx + 2000, next ? next.idx : html.length);
    const block = html.slice(idx, end);

    const subject = pickFirst(block, [
      // Anchor inner text is usually the subject on the customer portal.
      /<a\b[^>]*\bhref="\/support\/tickets\/\d+(?:\?[^"]*)?"[^>]*>([\s\S]*?)<\/a>/i,
      /<span[^>]*class="[^"]*(?:ticket[-_]?subject|subject)[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i,
    ]);

    const status = pickFirst(block, [
      /<span[^>]*class="[^"]*fw-status-badge[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      /<span[^>]*class="[^"]*(?:status|ticket[-_]?status|label)[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      /<div[^>]*class="[^"]*status[-_]?label[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<span[^>]*data-status[^>]*>([\s\S]*?)<\/span>/i,
    ]);

    const lastUpdatedRaw = pickFirst(block, [
      /data-timeago="([^"]+)"/i,
      /data-livestamp="([^"]+)"/i,
      /<time[^>]*datetime="([^"]+)"/i,
      /<span[^>]*class="[^"]*(?:updated|timeago|last[-_]?activity)[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    ]);

    rows.push({
      ticketId: id,
      subject: subject && subject.length > 0 ? subject : null,
      status: status && status.length > 0 ? status : null,
      lastUpdatedRaw: lastUpdatedRaw && lastUpdatedRaw.length > 0 ? lastUpdatedRaw : null,
    });
  }

  // Best-effort total-page hint from the pager. Freshdesk renders things
  // like `<a ... rel="last" data-page="42">` or simply "Page 1 of 42".
  // We only use this for logging / fanout planning, never for control flow.
  const totalPagesHint = (() => {
    const a = html.match(/rel="last"[^>]*data-page="(\d+)"/i);
    if (a) return parseInt(a[1], 10);
    const b = html.match(/Page\s+\d+\s+of\s+(\d+)/i);
    if (b) return parseInt(b[1], 10);
    const c = Array.from(html.matchAll(/\bdata-page="(\d+)"/gi))
      .map((mm) => parseInt(mm[1], 10))
      .filter((n) => Number.isFinite(n));
    if (c.length > 0) return Math.max(...c);
    return null;
  })();

  return {
    page,
    totalPagesHint,
    empty: rows.length === 0,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Live reader — wraps Playwright. Tests substitute the chromium impl.
// ---------------------------------------------------------------------------

let __chromiumImpl: { launch: typeof chromium.launch } = chromium;
export function __setChromiumForTests(impl: { launch: typeof chromium.launch } | null): void {
  __chromiumImpl = impl ?? chromium;
}

function buildIndexUrl(page: number, urlTemplate?: string): string {
  // The customer portal's default "all tickets" list lives at
  // /support/tickets?page=N. Some Freshdesk tenants expose a filter
  // variant (/support/tickets/filters/all_tickets?page=N) — operators
  // can pass a custom template through opts if we ever find a tenant
  // that needs it.
  const template = urlTemplate ?? `${PORTAL_URL}/support/tickets?page={page}`;
  return template.replace("{page}", String(page));
}

export interface ReadPortalIndexOpts {
  /** Override env-backed creds in tests; not used in production. */
  username?: string;
  password?: string;
  /** Per-call timeout for the navigation step. Defaults to 45s. */
  navigationTimeoutMs?: number;
  /**
   * Custom URL template for the list page. Use `{page}` as the page-
   * number placeholder. Defaults to `${PORTAL_URL}/support/tickets?page={page}`.
   */
  urlTemplate?: string;
  /**
   * When true, refuse to re-login if the saved session is stale and
   * throw instead. Default false (matches portal-reader behavior). Set
   * true for parallel fanout runs so concurrent processes don't race
   * to overwrite `bot-session/state.json`; the operator pre-warms the
   * session once and the parallel scanners stay strictly read-only.
   */
  readOnlySession?: boolean;
}

/**
 * Open one page of the portal ticket list and return the parsed rows.
 *
 * The caller is responsible for funnelling concurrent reads through
 * `portalBrowserGate`. Pages are 1-indexed to match the portal's own UI.
 */
export async function readPortalIndexPage(
  pageNum: number,
  opts: ReadPortalIndexOpts = {},
): Promise<PortalIndexPageResult> {
  if (!Number.isInteger(pageNum) || pageNum < 1) {
    throw new Error(`readPortalIndexPage: page must be a positive integer, got ${pageNum}`);
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

    const indexUrl = buildIndexUrl(pageNum, opts.urlTemplate);
    const timeout = opts.navigationTimeoutMs ?? 45_000;

    logger.info({ pageNum, indexUrl }, "Portal index reader: navigating to list page");
    const navResponse = await page.goto(indexUrl, { waitUntil: "domcontentloaded", timeout });
    await page.waitForTimeout(1500);

    const httpStatus = navResponse?.status() ?? null;
    if (httpStatus !== null && httpStatus >= 400) {
      logger.warn(
        { pageNum, indexUrl, httpStatus },
        "Portal index reader: list page returned HTTP error; returning empty result",
      );
      return { page: pageNum, totalPagesHint: null, empty: true, rows: [] };
    }

    // Stale-session recovery, mirrors `readPortalTicket`. The list page
    // either renders normally or bounces to the login form; nothing else.
    const loginInput = await page.$('input[type="password"]');
    if (loginInput) {
      if (opts.readOnlySession) {
        throw new Error(
          `Portal index reader: session expired on page ${pageNum} and readOnlySession=true; refusing to re-login. Pre-warm the session and re-run.`,
        );
      }
      const username = opts.username ?? process.env.MAS_PORTAL_USERNAME ?? "";
      const password = opts.password ?? process.env.MAS_PORTAL_PASSWORD ?? "";
      if (!username || !password) {
        throw new Error(
          "Portal index reader: session expired and MAS_PORTAL_USERNAME/MAS_PORTAL_PASSWORD not configured",
        );
      }
      const emailInput = await page.$(
        'input[name="user[email]"], input[name="helpdesk_user[email]"], input[type="email"], #user_email',
      );
      if (!emailInput) throw new Error("Portal index reader: login form not recognized (no email input)");
      await emailInput.fill(username);
      await loginInput.fill(password);
      const submitBtn = await page.$('button[type="submit"], input[type="submit"], input[name="commit"]');
      if (submitBtn) await submitBtn.click();
      await page.waitForTimeout(3000);
      await context.storageState({ path: statePath });
      await page.goto(indexUrl, { waitUntil: "domcontentloaded", timeout });
      await page.waitForTimeout(1500);
    }

    const html = await page.content();
    const parsed = parsePortalIndexHtml(html, pageNum);
    logger.info(
      {
        pageNum,
        rowCount: parsed.rows.length,
        totalPagesHint: parsed.totalPagesHint,
        empty: parsed.empty,
      },
      "Portal index reader: parsed list page",
    );
    return parsed;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

// Orchestrator for Task #725: turn freshly-scraped portal ticket messages
// into rows in `portal_responses` (via the existing record-portal route),
// idempotently and one ticket at a time.
//
// Why an orchestrator and not "just call the reader from the cron":
//   1. Concurrency control — every Playwright session must go through
//      `portalBrowserGate` so the submit bot and the reader take turns.
//   2. Idempotency — `submissionId + portalMessageId` (or content hash)
//      must dedup across reader runs; that lookup belongs near the DB,
//      not in the Playwright scraper.
//   3. Routing — ingestion goes through `/api/responses/record-portal`
//      (Task #725 invariant: never write to portal_responses directly),
//      and that endpoint takes a bot token, not a session cookie. We
//      keep the http-call shape in one place so it can be tested.
//
// `diffPortalMessages` is a pure function exported for unit tests.

import { db, portalSubmissionsTable, portalResponsesTable, invoiceGroupsTable } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { portalBrowserGate } from "./portal-browser-gate";
import { classifyByPhrase } from "./email-phrase-classifier";
import {
  readPortalTicket,
  hashContent,
  type PortalReaderMessage,
  type PortalReaderResult,
  type ReadPortalTicketOpts,
} from "../bot/portal-reader";

// ---------------------------------------------------------------------------
// Diff logic — pure
// ---------------------------------------------------------------------------

export interface ExistingPortalResponseKey {
  externalMessageId: string | null;
  contentHash: string | null;
}

/**
 * Returns the subset of `fetched` messages that are NOT already represented
 * in `existing`. The idempotency key (per Task #725 spec) is
 * `submissionId + portalMessageId`; the content hash is only consulted as
 * a fallback when the scraped message lacks a stable source id.
 *
 * Concretely:
 *   - A scraped message with a real Freshdesk id (`idIsHash=false`) is a
 *     duplicate ONLY if some existing row carries that exact
 *     externalMessageId. Two real messages with identical bodies but
 *     different ids are BOTH new — they're distinct portal events.
 *   - A scraped message that fell back to a content hash id
 *     (`idIsHash=true`) is a duplicate when either the same hash id is
 *     already on file as externalMessageId OR a previous row stored the
 *     same hash in metadata.contentHash.
 */
export function diffPortalMessages(
  fetched: PortalReaderMessage[],
  existing: ExistingPortalResponseKey[],
): PortalReaderMessage[] {
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();
  for (const e of existing) {
    if (e.externalMessageId) seenIds.add(e.externalMessageId);
    if (e.contentHash) seenHashes.add(e.contentHash);
  }
  const out: PortalReaderMessage[] = [];
  for (const m of fetched) {
    if (!m.idIsHash) {
      // Real Freshdesk note id — that is the canonical key. Do NOT fall
      // back to content hash here; two distinct ids with the same body
      // are two distinct portal events.
      if (seenIds.has(m.messageId)) continue;
      out.push(m);
      continue;
    }
    // Hash-fallback message: dedup against both axes.
    if (seenIds.has(m.messageId)) continue;
    if (seenHashes.has(hashContent(m.bodyText))) continue;
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// HTTP poster — extracted so tests can stub it.
// ---------------------------------------------------------------------------

export type RecordPortalPoster = (body: Record<string, unknown>) => Promise<{ ok: boolean; status: number; data: unknown }>;

let __posterImpl: RecordPortalPoster | null = null;
/** Test seam: override the HTTP call to /api/responses/record-portal. */
export function __setRecordPortalPosterForTests(poster: RecordPortalPoster | null): void {
  __posterImpl = poster;
}

async function defaultPoster(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: unknown }> {
  const port = process.env.PORT || 8080;
  const res = await fetch(`http://localhost:${port}/api/responses/record-portal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bot-token": process.env.BOT_SERVICE_TOKEN ?? "",
    },
    body: JSON.stringify(body),
  });
  let data: unknown;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

/**
 * Pure-ish helper extracted so the try/catch contract around the poster
 * is unit-testable without a database. For each body, calls the poster
 * exactly once. Transport throws are caught and counted; the loop never
 * aborts mid-sweep. Exported for tests.
 */
export async function postFreshMessagesViaPoster(
  poster: RecordPortalPoster,
  bodies: Array<Record<string, unknown>>,
  ctx: { submissionId: number; ticketId: string },
): Promise<{ posted: number; postFailures: number; lastPostError: string | null }> {
  let posted = 0;
  let postFailures = 0;
  let lastPostError: string | null = null;
  for (const body of bodies) {
    try {
      const resp = await poster(body);
      if (!resp.ok) {
        postFailures += 1;
        lastPostError = `HTTP ${resp.status}`;
        logger.warn({ ...ctx, status: resp.status, body: resp.data }, "Portal sync: record-portal POST failed");
        continue;
      }
      posted += 1;
    } catch (err) {
      postFailures += 1;
      lastPostError = err instanceof Error ? err.message : String(err);
      logger.warn({ ...ctx, err: lastPostError }, "Portal sync: record-portal POST threw");
    }
  }
  return { posted, postFailures, lastPostError };
}

/**
 * In-process poster used by the one-shot backfill CLI so it can run
 * without a separately-running API server. Calls `processPortalResponse`
 * directly — same business logic the HTTP route uses, same idempotency
 * guarantees on (submissionId, externalMessageId).
 */
export async function inProcessRecordPortalPoster(
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  // Lazy imports so unit tests that stub the poster never need to load
  // the heavy response-matcher / SSE modules.
  const { processPortalResponse } = await import("./response-matcher");
  const { broadcastGroupEvent } = await import("./sse");
  const submissionId = Number(body.submissionId);
  if (!Number.isFinite(submissionId)) {
    return { ok: false, status: 400, data: { error: "submissionId required" } };
  }
  const [submission] = await db
    .select()
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.id, submissionId));
  if (!submission) return { ok: false, status: 404, data: { error: "submission not found" } };
  const responseId = await processPortalResponse({
    claimId: null,
    invoiceGroupId: submission.invoiceGroupId,
    submissionId: submission.id,
    portalTicketId: submission.portalTicketId || "",
    responseType: (body.responseType as "acknowledgment" | "other") ?? "other",
    content: typeof body.content === "string" ? body.content : "",
    rawContent: typeof body.rawContent === "string" ? body.rawContent : undefined,
    bodyFormat: body.bodyFormat === "html" ? "html" : "text",
    subject: typeof body.subject === "string" ? body.subject : undefined,
    senderEmail: typeof body.senderEmail === "string" ? body.senderEmail : undefined,
    senderName: typeof body.senderName === "string" ? body.senderName : undefined,
    externalMessageId: typeof body.externalMessageId === "string" ? body.externalMessageId : undefined,
    metadata: (body.metadata as Record<string, unknown> | null) ?? null,
  });
  // Mirror the route-layer side effect so the operator queue updates
  // live during a backfill --apply just like it does on a normal POST.
  broadcastGroupEvent({
    type: "response_received",
    invoiceGroupId: submission.invoiceGroupId,
    userName: "Portal Response Sync",
    userEmail: null,
    timestamp: new Date().toISOString(),
  });
  return { ok: true, status: 200, data: { responseId, invoiceGroupId: submission.invoiceGroupId } };
}

// ---------------------------------------------------------------------------
// Per-submission sync
// ---------------------------------------------------------------------------

export interface SyncOneOptions {
  /** When true, do not POST anything; just return what would be created. */
  dryRun?: boolean;
  /** Forwarded to the reader. */
  readerOpts?: ReadPortalTicketOpts;
}

export interface SyncOneResult {
  submissionId: number;
  ticketId: string | null;
  status: "scraped" | "skipped_no_ticket" | "skipped_synthetic_ticket" | "error";
  newResponses: number;
  totalMessages: number;
  portalStatus: string | null;
  errorMessage?: string;
}

function isScrapableTicketId(t: string | null | undefined): t is string {
  if (!t) return false;
  if (/^portal-/i.test(t)) return false;
  return true;
}

/**
 * Read one ticket and POST any new conversation entries. Acquires the
 * shared portal browser gate around the Playwright work so the submit
 * bot can never interleave.
 */
export async function syncPortalResponsesForSubmission(
  submissionId: number,
  opts: SyncOneOptions = {},
): Promise<SyncOneResult> {
  const [sub] = await db
    .select()
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.id, submissionId));
  if (!sub) {
    return {
      submissionId,
      ticketId: null,
      status: "error",
      newResponses: 0,
      totalMessages: 0,
      portalStatus: null,
      errorMessage: "submission not found",
    };
  }

  const ticketId = sub.portalTicketId;
  if (!ticketId) {
    return {
      submissionId,
      ticketId: null,
      status: "skipped_no_ticket",
      newResponses: 0,
      totalMessages: 0,
      portalStatus: null,
    };
  }
  if (!isScrapableTicketId(ticketId)) {
    return {
      submissionId,
      ticketId,
      status: "skipped_synthetic_ticket",
      newResponses: 0,
      totalMessages: 0,
      portalStatus: null,
    };
  }

  // Pre-pull the existing responses for this submission so we can dedup
  // before scraping. Cheap; bounded by message count per ticket.
  const existingRows = await db
    .select({
      externalMessageId: portalResponsesTable.externalMessageId,
      metadata: portalResponsesTable.metadata,
    })
    .from(portalResponsesTable)
    .where(eq(portalResponsesTable.submissionId, submissionId));

  const existing: ExistingPortalResponseKey[] = existingRows.map((r) => {
    const meta = (r.metadata ?? null) as { contentHash?: string | null } | null;
    return {
      externalMessageId: r.externalMessageId ?? null,
      contentHash: meta?.contentHash ?? null,
    };
  });

  // The shared gate is typed <void> (it serves the submit bot too), so we
  // capture the reader's structured result through a closure instead of the
  // gate's resolution value.
  const readerCtx: { parsed: PortalReaderResult | null; error: unknown } = { parsed: null, error: null };
  const gateOutcome = await portalBrowserGate.run(async () => {
    try {
      readerCtx.parsed = await readPortalTicket(ticketId, opts.readerOpts);
    } catch (err) {
      readerCtx.error = err;
    }
  });
  if (gateOutcome.kind === "skipped") {
    return {
      submissionId,
      ticketId,
      status: "error",
      newResponses: 0,
      totalMessages: 0,
      portalStatus: null,
      errorMessage: "portal browser busy (gate held by submit bot or another reader)",
    };
  }
  try {
    await gateOutcome.result;
    if (readerCtx.error) throw readerCtx.error;
    if (!readerCtx.parsed) throw new Error("Portal reader returned no result");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ submissionId, ticketId, err: msg }, "Portal sync: reader failed");
    return {
      submissionId,
      ticketId,
      status: "error",
      newResponses: 0,
      totalMessages: 0,
      portalStatus: null,
      errorMessage: msg,
    };
  }

  const fresh = diffPortalMessages(readerCtx.parsed!.messages, existing);
  if (fresh.length === 0 || opts.dryRun) {
    return {
      submissionId,
      ticketId,
      status: "scraped",
      newResponses: opts.dryRun ? fresh.length : 0,
      totalMessages: readerCtx.parsed!.messages.length,
      portalStatus: readerCtx.parsed!.status,
    };
  }

  const poster = __posterImpl ?? defaultPoster;
  const bodies: Array<{ msg: PortalReaderMessage; body: Record<string, unknown> }> = fresh.map((msg) => {
    // Run portal text through the same deterministic phrase classifier
    // email responses use, so MAS auto-acknowledgments ("Ticket Under
    // Review", etc.) get tagged correctly and downstream auto-mark as
    // processed instead of sitting in the operator queue. Falls back to
    // "other" when no phrase signature matches — exact same contract as
    // the email path before LLM escalation.
    const phrase = classifyByPhrase(msg.bodyText);
    const responseType: "acknowledgment" | "other" = phrase.outcome === "acknowledgment" ? "acknowledgment" : "other";
    return {
      msg,
      body: {
        submissionId,
        responseType,
          content: msg.bodyText.slice(0, 280),
        rawContent: msg.bodyText,
        bodyFormat: "text",
        subject: readerCtx.parsed!.subject ?? undefined,
        senderEmail: msg.authorEmail ?? undefined,
        senderName: msg.authorName ?? undefined,
        externalMessageId: msg.messageId,
        metadata: {
          portalMessageId: msg.messageId,
          contentHash: hashContent(msg.bodyText),
          portalStatus: readerCtx.parsed!.status,
          postedAt: msg.postedAt,
          source: "portal_reader",
          phraseSignature: phrase.selectedSignatureId,
        },
      },
    };
  });
  const { posted, postFailures, lastPostError } = await postFreshMessagesViaPoster(
    poster,
    bodies.map((b) => b.body),
    { submissionId, ticketId },
  );
  if (posted === 0 && postFailures > 0) {
    return {
      submissionId,
      ticketId,
      status: "error",
      newResponses: 0,
      totalMessages: readerCtx.parsed!.messages.length,
      portalStatus: readerCtx.parsed!.status,
      errorMessage: `record-portal poster failed for all ${postFailures} message(s); last error: ${lastPostError}`,
    };
  }
  return {
    submissionId,
    ticketId,
    status: "scraped",
    newResponses: posted,
    totalMessages: readerCtx.parsed!.messages.length,
    portalStatus: readerCtx.parsed!.status,
    errorMessage: postFailures > 0 ? `${postFailures} of ${fresh.length} POST(s) failed; last error: ${lastPostError}` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Multi-submission sweep — used by the cron and the backfill CLI.
// ---------------------------------------------------------------------------

export interface DueSubmissionsOpts {
  /** Hard cap on how many submissions to scrape in one sweep. */
  limit?: number;
  /** Only consider these group ids (priority list). */
  priorityGroupIds?: number[];
  /** Skip groups not in any of these statuses. Defaults to ["Awaiting Response"]. */
  groupStatuses?: string[];
}

export interface DueSubmission {
  submissionId: number;
  invoiceGroupId: number;
  invoiceNumber: string | null;
  portalTicketId: string;
  groupStatus: string;
}

/**
 * Submissions eligible for portal-side sync: 'submitted' rows attached to
 * a real (non-synthetic) Freshdesk ticket whose invoice group is still in
 * a status the operator is waiting on a portal answer for. Ordered by
 * `priorityGroupIds` (those first, in the given order), then by oldest
 * `updated_at` ASC so chronically-silent tickets get scraped first and
 * cron sweeps can never starve old rows by re-processing the newest 25
 * over and over.
 */
export async function findDuePortalSyncSubmissions(opts: DueSubmissionsOpts = {}): Promise<DueSubmission[]> {
  const statuses = (opts.groupStatuses ?? ["Awaiting Response"]) as Array<"Awaiting Response">;
  const rows = await db
    .select({
      submissionId: portalSubmissionsTable.id,
      invoiceGroupId: portalSubmissionsTable.invoiceGroupId,
      invoiceNumber: portalSubmissionsTable.invoiceNumber,
      portalTicketId: portalSubmissionsTable.portalTicketId,
      groupStatus: invoiceGroupsTable.status,
    })
    .from(portalSubmissionsTable)
    .innerJoin(invoiceGroupsTable, eq(portalSubmissionsTable.invoiceGroupId, invoiceGroupsTable.id))
    .where(and(
      eq(portalSubmissionsTable.status, "submitted"),
      inArray(invoiceGroupsTable.status, statuses),
    ))
    .orderBy(asc(portalSubmissionsTable.updatedAt));

  const due: DueSubmission[] = [];
  for (const r of rows) {
    if (!isScrapableTicketId(r.portalTicketId)) continue;
    due.push({
      submissionId: r.submissionId,
      invoiceGroupId: r.invoiceGroupId,
      invoiceNumber: r.invoiceNumber,
      portalTicketId: r.portalTicketId!,
      groupStatus: r.groupStatus,
    });
  }

  if (opts.priorityGroupIds && opts.priorityGroupIds.length > 0) {
    const priority = new Set(opts.priorityGroupIds);
    const order = new Map(opts.priorityGroupIds.map((id, i) => [id, i] as const));
    due.sort((a, b) => {
      const ap = priority.has(a.invoiceGroupId) ? 0 : 1;
      const bp = priority.has(b.invoiceGroupId) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      if (ap === 0) return (order.get(a.invoiceGroupId)! - order.get(b.invoiceGroupId)!);
      return 0;
    });
  }

  if (opts.limit !== undefined) return due.slice(0, opts.limit);
  return due;
}

export interface SyncSweepResult {
  considered: number;
  scraped: number;
  skipped: number;
  errored: number;
  newResponses: number;
  perSubmission: SyncOneResult[];
}

/**
 * Sweep a list of due submissions sequentially, with a small jittered
 * pause between scrapes so we never hammer the portal. The shared
 * `portalBrowserGate` already serialises each Playwright launch — the
 * jitter just smoothes the request rate against MAS.
 */
export async function syncDuePortalSubmissions(
  due: DueSubmission[],
  opts: { dryRun?: boolean; minPauseMs?: number; maxPauseMs?: number } = {},
): Promise<SyncSweepResult> {
  const minPause = opts.minPauseMs ?? 500;
  const maxPause = opts.maxPauseMs ?? 2500;
  const result: SyncSweepResult = {
    considered: due.length,
    scraped: 0,
    skipped: 0,
    errored: 0,
    newResponses: 0,
    perSubmission: [],
  };
  for (let i = 0; i < due.length; i += 1) {
    const item = due[i];
    const r = await syncPortalResponsesForSubmission(item.submissionId, { dryRun: opts.dryRun });
    result.perSubmission.push(r);
    if (r.status === "scraped") {
      result.scraped += 1;
      result.newResponses += r.newResponses;
    } else if (r.status === "error") {
      result.errored += 1;
    } else {
      result.skipped += 1;
    }
    if (i < due.length - 1) {
      const jitter = minPause + Math.floor(Math.random() * Math.max(1, maxPause - minPause));
      await new Promise((res) => setTimeout(res, jitter));
    }
  }
  return result;
}

/**
 * Helpers for the per-claim email-thread view.
 *
 * Conversation grouping, sibling-claim tagging, and status computation are kept
 * here as pure functions so they're easy to unit-test without spinning up the
 * Express app or hitting Microsoft Graph. The HTTP route in
 * `routes/response-tracker.ts` calls into these.
 */

import type { PortalResponse, OutboundEmail, Claim } from "@workspace/db";

export type ThreadStatus =
  | "awaiting_their_reply"
  | "needs_review"
  | "acknowledged_pending"
  | "resolved";

export type ThreadDirection = "inbound" | "outbound";

export type ThreadBodyFormat = "html" | "text";

export interface ThreadMessage {
  id: string;
  direction: ThreadDirection;
  conversationId: string | null;
  subject: string | null;
  sender: string;
  senderEmail: string | null;
  bodyPreview: string | null;
  /**
   * Format of the original message body. Inbound rows reflect what the payor
   * sent (Microsoft Graph reports `text` or `html`); outbound is always
   * `text` today because the composer ships plain text via Graph.
   */
  bodyFormat: ThreadBodyFormat;
  /**
   * Raw HTML body when `bodyFormat === "html"`. Null for text rows and for
   * outbound rows. The renderer is responsible for sanitization — never
   * trust this string. `bodyPreview` always carries a safe plain-text
   * snippet so list views can show a teaser without parsing HTML.
   */
  bodyHtml: string | null;
  timestamp: string;

  // Inbound-only metadata. Carrying these on every message (with nulls for
  // outbound) keeps the OpenAPI schema flat and avoids a discriminated union.
  responseId: number | null;
  responseType: string | null;
  processed: boolean | null;
  aiSummary: string | null;
  extractedAmount: string | null;
  extractedDeadline: string | null;
  requestedAction: string | null;
  classifierSource: string | null;
  matchedVia: string | null;
  matchConfidence: string | null;

  // Sibling-claim tagging. Set when this message belongs to a different claim
  // than the one being viewed but in the same Outlook conversation
  // (e.g. one thread covering multiple legs of an invoice-group dispute).
  claimId: number | null;
  siblingClaimRef: string | null;
  siblingClaimId: number | null;

  // Outbound-only: filenames of files attached to this message, in send
  // order. Lets the thread bubble render an "Attached: foo.pdf, bar.png"
  // line so staff can see what evidence shipped with each reply without
  // hopping back to Outlook. Null on inbound (we don't track payer
  // attachments today) and on outbound rows sent before this column existed.
  attachmentNames: string[] | null;

  // Outbound-only: structured per-attachment metadata persisted on the
  // outbound row's `metadata.attachments` jsonb bag. Lets the thread bubble
  // render chips that link back to object storage for download. Null on
  // inbound rows and on legacy outbound rows that pre-date Task #713.
  attachments: ThreadAttachment[] | null;
}

export interface ThreadAttachment {
  name: string;
  size: number | null;
  contentType: string;
  downloadUrl: string;
}

export interface ThreadConversation {
  conversationId: string;
  status: ThreadStatus;
  lastActivityAt: string;
  latestUnprocessedInboundId: number | null;
  latestSubject: string | null;
  latestInboundSender: string | null;
  messages: ThreadMessage[];
}

export interface SiblingClaimLookup {
  /** Map of claim id → human-readable ref (refNumber || confNumber || `#id`). */
  refsById: Map<number, string>;
}

export function buildSiblingLookup(claims: Pick<Claim, "id" | "refNumber" | "confNumber">[]): SiblingClaimLookup {
  const refsById = new Map<number, string>();
  for (const c of claims) {
    refsById.set(c.id, c.refNumber || c.confNumber || `#${c.id}`);
  }
  return { refsById };
}

/**
 * Convert a portal_responses row into a thread message. `currentClaimId` is the
 * claim being viewed — when this row's claimId differs, we tag it as a
 * sibling so the UI can render an "↳ also covers INV-1234" pill.
 */
export function inboundToMessage(
  r: PortalResponse,
  currentClaimId: number,
  lookup: SiblingClaimLookup,
): ThreadMessage {
  const isSibling = r.claimId !== null && r.claimId !== currentClaimId;
  const siblingRef = isSibling ? lookup.refsById.get(r.claimId!) ?? `#${r.claimId}` : null;
  // Prefer `rawContent` over `content` so the UI receives the full body
  // text. Historically `content` was overwritten with Microsoft Graph's
  // ~255-char `bodyPreview` snippet, while `rawContent` captured the
  // full message — preferring `rawContent` keeps those rows intact.
  // New rows write the full body into both columns (see
  // `response-matcher.processEmailResponse`), so either source is safe.
  const rawBody = r.rawContent || r.content || "";
  const isHtml = r.bodyFormat === "html";
  const bodyHtml = isHtml ? rawBody : null;
  // Plain text snippet for list views / hover cards: when the row is HTML
  // we strip the markup down to a short readable preview; when it's text we
  // pass the body through unchanged so whitespace + newlines are preserved.
  const bodyPreview = isHtml ? htmlToTextSnippet(rawBody) : rawBody;
  return {
    id: `in-${r.id}`,
    direction: "inbound",
    conversationId: r.conversationId,
    subject: r.subject,
    sender: r.senderName || r.senderEmail || "Unknown",
    senderEmail: r.senderEmail,
    bodyPreview,
    bodyFormat: isHtml ? "html" : "text",
    bodyHtml,
    timestamp: toIso(r.receivedAt),
    responseId: r.id,
    responseType: r.responseType,
    processed: r.processed,
    aiSummary: r.aiSummary,
    extractedAmount: r.extractedAmount,
    extractedDeadline: r.extractedDeadline,
    requestedAction: r.requestedAction,
    classifierSource: r.classifierSource,
    matchedVia: r.matchedVia,
    matchConfidence: r.matchConfidence,
    claimId: r.claimId,
    siblingClaimRef: siblingRef,
    siblingClaimId: isSibling ? r.claimId : null,
    attachmentNames: null,
    attachments: null,
  };
}

export function outboundToMessage(
  o: OutboundEmail,
  currentClaimId: number,
  lookup: SiblingClaimLookup,
): ThreadMessage {
  const isSibling = o.claimId !== null && o.claimId !== currentClaimId;
  const siblingRef = isSibling ? lookup.refsById.get(o.claimId!) ?? `#${o.claimId}` : null;
  return {
    id: `out-${o.id}`,
    direction: "outbound",
    conversationId: o.conversationId,
    subject: o.subject,
    sender: o.sentByUserName || o.sentByUserEmail || "ClaimClear",
    senderEmail: o.sentByUserEmail,
    bodyPreview: o.bodyPreview,
    // The composer ships plain text via Graph today, so outbound rows have
    // no separate HTML body. If we ever start sending rich HTML replies,
    // populate `bodyHtml` here.
    bodyFormat: "text",
    bodyHtml: null,
    timestamp: toIso(o.sentAt),
    responseId: null,
    responseType: null,
    processed: null,
    aiSummary: null,
    extractedAmount: null,
    extractedDeadline: null,
    requestedAction: null,
    classifierSource: null,
    matchedVia: null,
    matchConfidence: null,
    claimId: o.claimId,
    siblingClaimRef: siblingRef,
    siblingClaimId: isSibling ? o.claimId : null,
    attachmentNames: Array.isArray(o.attachmentNames) && o.attachmentNames.length > 0
      ? o.attachmentNames
      : null,
    attachments: extractAttachments(o.metadata),
  };
}

/**
 * Pull the structured attachments array out of the outbound row's
 * `metadata` jsonb bag. Task #713 stores `{ name, size, contentType,
 * storageKey }` per file; we map `storageKey` → server download URL so
 * the thread bubble can render chips that link back to object storage.
 * Tolerant of legacy rows (returns null) and of partially-shaped
 * entries (only `name` + `storageKey` are required to render a chip).
 */
function extractAttachments(metadata: unknown): ThreadAttachment[] | null {
  if (!metadata || typeof metadata !== "object") return null;
  const bag = (metadata as { attachments?: unknown }).attachments;
  if (!Array.isArray(bag) || bag.length === 0) return null;
  const out: ThreadAttachment[] = [];
  for (const raw of bag) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : null;
    const storageKey = typeof r.storageKey === "string" ? r.storageKey : null;
    if (!name || !storageKey) continue;
    const size = typeof r.size === "number" && Number.isFinite(r.size) ? r.size : null;
    const contentType = typeof r.contentType === "string" ? r.contentType : "application/octet-stream";
    const downloadUrl = storageKey.startsWith("/objects/")
      ? `/api/storage/objects/${storageKey.slice("/objects/".length)}`
      : storageKey;
    out.push({ name, size, contentType, downloadUrl });
  }
  return out.length > 0 ? out : null;
}

function toIso(v: Date | string | null | undefined): string {
  if (v === null || v === undefined) return new Date(0).toISOString();
  if (v instanceof Date) return v.toISOString();
  return new Date(v).toISOString();
}

/**
 * Strip HTML markup down to a short plain-text snippet suitable for list
 * views, hover cards, and the response banner. Drops `<style>`/`<script>`
 * blocks entirely, treats common block-level closers as line breaks, and
 * caps the result so a wall of marketing-template HTML doesn't blow out
 * the renderer. Pure / synchronous so it can run in the API layer without
 * a DOM.
 */
const SNIPPET_MAX_LEN = 280;
export function htmlToTextSnippet(html: string): string {
  if (!html) return "";
  const withoutBlocks = html
    // Drop scripts/styles entirely so their contents don't leak as text.
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    // Block-level closers and `<br>` become spaces so words don't fuse.
    .replace(/<\/(p|div|li|tr|td|th|h[1-6]|blockquote|pre|section|article)>/gi, " ")
    .replace(/<br\s*\/?>(?=\s|$|<)/gi, " ");
  const stripped = withoutBlocks.replace(/<[^>]*>/g, " ");
  const decoded = stripped
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SNIPPET_MAX_LEN) return collapsed;
  return `${collapsed.slice(0, SNIPPET_MAX_LEN - 1).trimEnd()}…`;
}

/**
 * Compute the per-thread status pill from the latest message + current claim
 * outcome. Mirrors the four-state model documented on the OpenAPI schema:
 * resolved (claim is closed) > needs_review (real inbound, unprocessed)
 * > acknowledged_pending (latest inbound is an ack) > awaiting_their_reply
 * (we sent last).
 */
export function computeThreadStatus(
  messages: ThreadMessage[],
  isClaimResolved: boolean,
): ThreadStatus {
  if (isClaimResolved) return "resolved";
  if (messages.length === 0) return "awaiting_their_reply";

  // Find the latest message in time order. Messages are caller-sorted but we
  // tolerate any input order to keep this pure.
  const latest = [...messages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )[messages.length - 1];

  if (latest.direction === "outbound") return "awaiting_their_reply";

  // Latest is inbound. Acknowledgments are silent receipts ("we got your
  // request"); they should NOT show up as Needs Review even if unprocessed,
  // because we never auto-transition the claim for them. Real responses do.
  if (latest.responseType === "acknowledgment") return "acknowledged_pending";
  if (latest.processed === false) return "needs_review";

  // Inbound but already processed — next ball is in their court.
  return "awaiting_their_reply";
}

/**
 * Group a flat list of inbound + outbound messages by conversationId, sort
 * messages within each conversation chronologically, and compute the per-
 * conversation status pill.
 *
 * Messages with no conversationId are bucketed into a synthetic key per row
 * (so each shows as its own thread) — this preserves the legacy behaviour of
 * the old card before threading was wired up.
 */
export function groupByConversation(
  messages: ThreadMessage[],
  isClaimResolved: boolean,
): ThreadConversation[] {
  const buckets = new Map<string, ThreadMessage[]>();
  for (const msg of messages) {
    const key = msg.conversationId || `__none__${msg.id}`;
    const arr = buckets.get(key);
    if (arr) arr.push(msg);
    else buckets.set(key, [msg]);
  }

  const conversations: ThreadConversation[] = [];
  for (const [key, msgs] of buckets) {
    msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const latest = msgs[msgs.length - 1];

    // Latest unprocessed inbound is what the Approve/Deny/Mark Reviewed buttons
    // attach to. We deliberately ignore acknowledgments here — staff should
    // not be asked to review "we got your request" notes.
    const latestUnprocessedInbound = [...msgs]
      .reverse()
      .find(
        (m) =>
          m.direction === "inbound" &&
          m.processed === false &&
          m.responseType !== "acknowledgment",
      );

    // Last inbound's sender is what we prefill the Reply composer's "To" with.
    const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound");

    conversations.push({
      conversationId: key.startsWith("__none__") ? "" : key,
      status: computeThreadStatus(msgs, isClaimResolved),
      lastActivityAt: latest.timestamp,
      latestUnprocessedInboundId: latestUnprocessedInbound?.responseId ?? null,
      latestSubject: latest.subject,
      latestInboundSender: lastInbound?.senderEmail ?? null,
      messages: msgs,
    });
  }

  // Most-recent-activity descending so the most relevant thread shows up
  // first when there are multiple parallel threads on one claim.
  conversations.sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
  );
  return conversations;
}

/**
 * Group a thread's messages into either a single message block or a run of
 * consecutive acknowledgments. Used by the UI to collapse chatty payer
 * auto-responders behind a single "Show N acknowledgments" toggle. Pure so
 * it can be unit-tested without React.
 */
export type ThreadBlock =
  | { kind: "msg"; msg: ThreadMessage }
  | { kind: "acks"; msgs: ThreadMessage[] };

export function groupAcknowledgmentBlocks(messages: ThreadMessage[]): ThreadBlock[] {
  const out: ThreadBlock[] = [];
  for (const m of messages) {
    const isAck = m.responseType === "acknowledgment";
    const last = out[out.length - 1];
    if (isAck && last && last.kind === "acks") {
      last.msgs.push(m);
    } else if (isAck) {
      out.push({ kind: "acks", msgs: [m] });
    } else {
      out.push({ kind: "msg", msg: m });
    }
  }
  return out;
}

/**
 * Strip leading "Re:" / "Fwd:" prefixes so the reply composer doesn't stack
 * them ("Re: Re: Re:"). Outlook's createReply adds its own "Re:".
 */
export function stripReplyPrefixes(subject: string | null | undefined): string {
  if (!subject) return "";
  return subject
    .trim()
    .replace(/^(?:re|fwd?|fw)\s*:\s*/gi, "")
    .replace(/^(?:re|fwd?|fw)\s*:\s*/gi, "")
    .trim();
}

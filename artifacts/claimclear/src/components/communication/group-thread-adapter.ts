/**
 * Group thread adapter (Task #240).
 *
 * Translates the API's `EmailThreadResponse` (the same shape that powers the
 * per-claim email-thread route) into the display types consumed by
 * `GroupCommunicationThread` and `ResponseReceivedBanner`. Keeping the
 * mapping isolated here means the responses-awaiting-review page and the
 * full invoice-group detail page share one source of truth for "what does
 * the group's inbox look like" — the same intent the previous mock helpers
 * had.
 */
import type {
  EmailThreadResponse,
  EmailThreadConversation,
  EmailThreadMessage,
} from "@workspace/api-client-react";
import type {
  GroupConversation,
  GroupEmailMessage,
} from "./group-communication-thread";
import type { ResponseBannerData } from "./response-received-banner";

/**
 * Map a single API conversation row to the display shape the thread
 * component expects. The API carries both `bodyHtml` (raw HTML, when the
 * payor sent an HTML-formatted message) and `bodyPreview` (a safe plain-
 * text snippet); the component picks between them and runs DOMPurify on
 * the HTML branch. `mentionedLegIds` is sourced from `claimId` so each
 * message links back to the originating leg in the group page.
 */
export function mapToGroupConversations(
  thread: EmailThreadResponse | undefined,
  legIdToLabel: Map<number, string>,
): GroupConversation[] {
  if (!thread) return [];
  return thread.conversations.map((c: EmailThreadConversation) => ({
    conversationId: c.conversationId,
    // Conversation-level subject: API exposes `latestSubject` (the most
    // recent message's subject); fall back to the first message's subject
    // if for any reason the convenience field is missing.
    subject:
      c.latestSubject ??
      c.messages[0]?.subject ??
      "(no subject)",
    status: c.status,
    lastActivityAt: c.lastActivityAt,
    messages: c.messages.map((m) => mapMessage(m, legIdToLabel)),
  }));
}

function mapMessage(
  m: EmailThreadMessage,
  legIdToLabel: Map<number, string>,
): GroupEmailMessage {
  // Mentions: prefer the message's own `claimId` (the leg the row was
  // anchored on). Fall back to `siblingClaimId` when the row arrived via
  // a sibling-claim join — that lets the operator follow the link out
  // even though the leg is outside the group's own claim set.
  const mentions: { id: number; label: string }[] = [];
  const seen = new Set<number>();
  if (typeof m.claimId === "number") {
    const label = legIdToLabel.get(m.claimId) ?? `Leg #${m.claimId}`;
    mentions.push({ id: m.claimId, label });
    seen.add(m.claimId);
  }
  if (
    typeof m.siblingClaimId === "number" &&
    !seen.has(m.siblingClaimId)
  ) {
    mentions.push({
      id: m.siblingClaimId,
      label: m.siblingClaimRef ?? `Leg #${m.siblingClaimId}`,
    });
  }
  return {
    id: m.id,
    direction: m.direction,
    senderName: m.sender,
    senderEmail: m.senderEmail ?? "",
    subject: m.subject ?? "(no subject)",
    bodyHtml: m.bodyHtml ?? "",
    bodyFormat: (m.bodyFormat as "html" | "text" | undefined) ?? "text",
    bodyPreview: m.bodyPreview ?? "",
    timestamp: m.timestamp,
    attachments: m.attachmentNames ?? [],
    mentionedLegIds: mentions,
    // Inbound messages that haven't been processed yet are "unread" from
    // the operator's perspective. Outbound rows aren't unread.
    unread: m.direction === "inbound" && m.processed === false,
    responseType: m.responseType ?? null,
  };
}

/**
 * Pick the latest unprocessed inbound message for the response banner.
 * Mirrors the original mock's intent — show the most recent *substantive*
 * response. The `ResponseReceivedBanner` component already filters out
 * obvious auto-confirmations / ticket receipts via its `isSubstantive`
 * predicate, so we keep the picker simple here.
 */
export function pickGroupBannerData(
  thread: EmailThreadResponse | undefined,
): ResponseBannerData | null {
  if (!thread || thread.messages.length === 0) return null;
  // Walk newest -> oldest so we surface the most recent unread inbound.
  const newestFirst = [...thread.messages].sort(
    (a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  const candidate = newestFirst.find(
    (m) => m.direction === "inbound" && m.processed === false,
  );
  if (!candidate) return null;
  return {
    senderName: candidate.sender,
    subject: candidate.subject ?? "(no subject)",
    preview: candidate.bodyPreview ?? "",
    timestamp: candidate.timestamp,
    threadAnchorId: "invoice-thread",
  };
}

/**
 * Strip HTML tags from the rich-text composer's output for the reply
 * payload. The API expects plain `bodyText` (the Graph send route uses
 * `text/plain`); the composer hands us `bodyHtml`. We keep line breaks
 * (block tags become newlines) so the payor sees structured paragraphs
 * even after the markup is dropped.
 */
export function htmlBodyToPlainText(html: string): string {
  // Replace block-level closers with newlines, then strip remaining tags.
  const withBreaks = html
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>(?=\s|$|<)/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]*>/g, "");
  // Decode the few entities the rich-text editor emits so the recipient
  // doesn't see literal `&amp;` / `&nbsp;`.
  const decoded = stripped
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Collapse runs of >2 blank lines so the body doesn't balloon.
  return decoded.replace(/\n{3,}/g, "\n\n").trim();
}

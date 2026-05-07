// Microsoft Outlook integration via Replit connector (Microsoft Graph API)
import { Client } from "@microsoft/microsoft-graph-client";
import {
  EMAIL_MESSAGE_MAX_BYTES,
  INLINE_ATTACHMENT_THRESHOLD_BYTES,
} from "@workspace/api-zod";
import { logger } from "./logger";

// RFC 6761 reserves these TLDs as guaranteed-non-resolvable for testing /
// documentation. Sending to any of them produces an internal Graph bounce
// that counts against our sender reputation — Microsoft suspended our
// outbound on 2026-05-07 after a test sweep generated ~42 such bounces in
// 3 hours. This blocklist is the bottom-of-the-stack guard: ANY caller
// (route, cron, ad-hoc script) that feeds a test recipient short-circuits
// to a synthetic success and never reaches Graph.
const RESERVED_TEST_TLDS = new Set(["test", "example", "invalid", "local"]);

function isReservedTestRecipient(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain) return false;
  // Match either the full TLD or any subdomain ending in `.<tld>`.
  const lastDot = domain.lastIndexOf(".");
  const tld = lastDot < 0 ? domain : domain.slice(lastDot + 1);
  return RESERVED_TEST_TLDS.has(tld);
}

function splitRecipients(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  return list.map((e) => e.trim()).filter(Boolean);
}

/**
 * Returns true iff every supplied recipient (To + Cc combined) lies in an
 * RFC 6761 reserved-test TLD. When true, the caller MUST short-circuit
 * before hitting Graph — bounces from these domains will get our sender
 * suspended.
 *
 * Mixed batches (one real recipient + one test recipient) return false so
 * the real recipient still receives the email; if you want to block those
 * too, scrub the recipient list at the call site.
 */
function allRecipientsAreReservedTest(
  to: string | string[] | undefined,
  cc?: string | string[] | undefined,
): boolean {
  const all = [...splitRecipients(to), ...splitRecipients(cc)];
  if (all.length === 0) return false;
  return all.every(isReservedTestRecipient);
}

function syntheticTestSendResult(): SendEmailResult {
  // Stable-ish synthetic IDs so any DB row that captures them is obviously
  // a test artefact (and not mistaken for a real Graph messageId).
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return {
    messageId: `synthetic-test-${stamp}-${rand}`,
    conversationId: `synthetic-test-conv-${stamp}-${rand}`,
  };
}

let connectionSettings: any;

async function getAccessToken(): Promise<string> {
  if (
    connectionSettings &&
    connectionSettings.settings?.expires_at &&
    new Date(connectionSettings.settings.expires_at).getTime() > Date.now()
  ) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error("X-Replit-Token not found for repl/depl");
  }

  connectionSettings = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=outlook",
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    },
  )
    .then((res) => res.json())
    .then((data: any) => data.items?.[0]);

  const accessToken =
    connectionSettings?.settings?.access_token ||
    connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error("Outlook not connected");
  }
  return accessToken;
}

async function getOutlookClient(): Promise<Client> {
  const accessToken = await getAccessToken();
  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => accessToken,
    },
  });
}

export interface EmailAttachment {
  /** Filename shown in the recipient's mailbox (e.g. "evidence-1.pdf"). */
  name: string;
  /** Raw bytes of the attachment. */
  content: Buffer;
  /** MIME type (defaults to application/octet-stream when omitted). */
  contentType?: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  cc?: string | string[];
  attachments?: EmailAttachment[];
}

export interface SendEmailResult {
  messageId: string | null;
  conversationId: string | null;
}

// Per-chunk size for the upload-session PUTs. Graph's documented hard cap is
// ~4 MB; we use 3.2 MB to stay well under that and to align with a number
// that's an exact multiple of the 320 KiB block size Graph prefers.
const UPLOAD_SESSION_CHUNK_BYTES = 320 * 1024 * 10; // 3,276,800 bytes (3.125 MB)

/**
 * Attach a single `EmailAttachment` to an existing draft message. Routes to
 * Graph's inline `fileAttachment` POST when the payload is at or below
 * `INLINE_ATTACHMENT_THRESHOLD_BYTES`, otherwise opens an upload-session and
 * uploads the file in `UPLOAD_SESSION_CHUNK_BYTES` chunks via authenticated-
 * once `uploadUrl` PUTs.
 *
 * Exported (and accepts an optional `httpFetch` injection) so the upload
 * routing can be unit-tested without a live Graph client.
 */
export async function attachToDraft(
  client: Pick<Client, "api">,
  messageId: string,
  attachment: EmailAttachment,
  opts: { httpFetch?: typeof fetch } = {},
): Promise<{ kind: "inline" | "upload_session"; chunks?: number }> {
  const httpFetch = opts.httpFetch ?? globalThis.fetch;
  const size = attachment.content.length;
  const contentType = attachment.contentType || "application/octet-stream";

  if (size <= INLINE_ATTACHMENT_THRESHOLD_BYTES) {
    await client.api(`/me/messages/${messageId}/attachments`).post({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: attachment.name,
      contentType,
      contentBytes: attachment.content.toString("base64"),
    });
    return { kind: "inline" };
  }

  // Upload-session flow. The createUploadSession POST is authenticated via
  // the Graph client; the returned `uploadUrl` is pre-authorized and must
  // be PUT to *without* the bearer token.
  const session = await client
    .api(`/me/messages/${messageId}/attachments/createUploadSession`)
    .post({
      AttachmentItem: {
        attachmentType: "file",
        name: attachment.name,
        size,
        contentType,
      },
    });
  const uploadUrl: string | undefined = session?.uploadUrl;
  if (!uploadUrl) {
    throw new Error(
      `Outlook createUploadSession did not return an uploadUrl for ${attachment.name}`,
    );
  }

  let offset = 0;
  let chunks = 0;
  while (offset < size) {
    const end = Math.min(offset + UPLOAD_SESSION_CHUNK_BYTES, size);
    const slice = attachment.content.subarray(offset, end);
    const res = await httpFetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(slice.length),
        "Content-Range": `bytes ${offset}-${end - 1}/${size}`,
      },
      // Buffer is a Uint8Array view; cast to BodyInit so undici's typings
      // accept it without a copy.
      body: slice as unknown as BodyInit,
    });
    if (!res.ok && res.status !== 202) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Upload-session PUT for ${attachment.name} failed at bytes ${offset}-${end - 1}: ${res.status} ${body.slice(0, 200)}`,
      );
    }
    chunks += 1;
    offset = end;
  }
  return { kind: "upload_session", chunks };
}

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  // RFC 6761 reserved-test TLD guard. See module-top comment on
  // RESERVED_TEST_TLDS for the 2026-05-07 incident this prevents.
  if (allRecipientsAreReservedTest(options.to, options.cc)) {
    const recipients = [...splitRecipients(options.to), ...splitRecipients(options.cc)];
    logger.warn(
      { recipients, subject: options.subject },
      "outlook.sendEmail: short-circuited — all recipients are RFC 6761 reserved test domains; no Graph call made",
    );
    return syntheticTestSendResult();
  }

  const client = await getOutlookClient();

  const toRecipients = (Array.isArray(options.to) ? options.to : options.to.split(","))
    .map((e) => e.trim())
    .filter(Boolean)
    .map((email) => ({ emailAddress: { address: email } }));

  const ccRecipients = options.cc
    ? (Array.isArray(options.cc) ? options.cc : options.cc.split(","))
        .map((e) => e.trim())
        .filter(Boolean)
        .map((email) => ({ emailAddress: { address: email } }))
    : [];

  const attachments = options.attachments ?? [];
  const totalAttachmentBytes = attachments.reduce((sum, a) => sum + a.content.length, 0);
  if (totalAttachmentBytes > EMAIL_MESSAGE_MAX_BYTES) {
    throw new Error(
      `Email attachments total ${totalAttachmentBytes} bytes which exceeds the ` +
      `${EMAIL_MESSAGE_MAX_BYTES}-byte (25 MB) per-message cap.`,
    );
  }

  const draft: any = {
    subject: options.subject,
    body: {
      contentType: "HTML",
      content: options.html,
    },
    toRecipients,
  };

  if (ccRecipients.length > 0) {
    draft.ccRecipients = ccRecipients;
  }

  // Create the draft up front (without inline attachments) so we have a
  // messageId to attach against — the upload-session route requires the
  // draft to already exist, and routing per-attachment via `attachToDraft`
  // lets a single mixed batch (small + large) work in one send.
  const created = await client.api("/me/messages").post(draft);
  const messageId: string = created?.id;
  const conversationId: string | null = created?.conversationId ?? null;

  if (!messageId) {
    throw new Error("Outlook draft create did not return an id");
  }

  for (const attachment of attachments) {
    await attachToDraft(client, messageId, attachment);
  }

  await client.api(`/me/messages/${messageId}/send`).post({});

  return { messageId, conversationId };
}

export interface ReplyToMessageOptions {
  /** ID of the original Outlook message we're replying to. */
  originalMessageId: string;
  /** Plain-text body for the reply. Sent as text/plain so Outlook keeps original quoted history intact. */
  bodyText: string;
  /**
   * Subject override. Optional — Graph's createReply already prefixes the
   * original subject with "Re:" automatically when this is omitted.
   */
  subject?: string;
  /**
   * To/Cc overrides. Optional — Graph's createReply uses the original sender
   * as the default recipient, but we usually pass these explicitly so the UI
   * is the source of truth.
   */
  to?: string[];
  cc?: string[];
  /**
   * Files to attach to the reply. Same `EmailAttachment` shape as `sendEmail`.
   * Total payload must stay under `EMAIL_MESSAGE_MAX_BYTES` (25 MB);
   * per-attachment routing decides between the inline POST and the Graph
   * upload-session flow based on `INLINE_ATTACHMENT_THRESHOLD_BYTES`.
   */
  attachments?: EmailAttachment[];
}

/**
 * Reply to an existing Outlook message via Graph's `/me/messages/{id}/createReply`
 * + `/send` flow. Using createReply (instead of raw sendMail) preserves the
 * `In-Reply-To` / `References` headers so the conversation thread stays intact
 * in both our mailbox and the recipient's.
 *
 * Returns the new draft's `id` and `conversationId` so the caller can persist
 * an `outbound_emails` row that ties the new message back into the same thread.
 */
export async function replyToMessage(options: ReplyToMessageOptions): Promise<SendEmailResult> {
  // Same RFC 6761 reserved-test TLD guard as sendEmail. Replies from a
  // test fixture (which may pass synthetic to/cc) must never hit Graph.
  if (allRecipientsAreReservedTest(options.to, options.cc)) {
    const recipients = [...splitRecipients(options.to), ...splitRecipients(options.cc)];
    logger.warn(
      { recipients, subject: options.subject },
      "outlook.replyToMessage: short-circuited — all recipients are RFC 6761 reserved test domains; no Graph call made",
    );
    return syntheticTestSendResult();
  }

  const client = await getOutlookClient();

  // 1. createReply: Graph wires up In-Reply-To / References / threading headers
  //    and returns a draft we can mutate before sending.
  const draft = await client.api(`/me/messages/${options.originalMessageId}/createReply`).post({});
  const messageId: string | undefined = draft?.id;
  if (!messageId) {
    throw new Error("Outlook createReply did not return a draft id");
  }
  const conversationId: string | null = draft?.conversationId ?? null;

  // 2. PATCH body (and optional subject / recipients) onto the draft. Plain-text
  //    body type so the original quoted history Outlook auto-includes is not
  //    re-encoded as HTML.
  const patch: Record<string, unknown> = {
    body: { contentType: "Text", content: options.bodyText },
  };
  if (options.subject) {
    patch.subject = options.subject;
  }
  if (options.to && options.to.length > 0) {
    patch.toRecipients = options.to.map((address) => ({ emailAddress: { address } }));
  }
  if (options.cc && options.cc.length > 0) {
    patch.ccRecipients = options.cc.map((address) => ({ emailAddress: { address } }));
  }
  await client.api(`/me/messages/${messageId}`).patch(patch);

  // 3. Attachments — route each one through `attachToDraft`, which picks
  //    the inline POST or the Graph upload-session PUT loop based on size.
  //    A single mixed batch (one big + several small) works in one send.
  if (options.attachments && options.attachments.length > 0) {
    const totalAttachmentBytes = options.attachments.reduce((sum, a) => sum + a.content.length, 0);
    if (totalAttachmentBytes > EMAIL_MESSAGE_MAX_BYTES) {
      throw new Error(
        `Reply attachments total ${totalAttachmentBytes} bytes which exceeds the ` +
        `${EMAIL_MESSAGE_MAX_BYTES}-byte (25 MB) per-message cap.`,
      );
    }
    for (const attachment of options.attachments) {
      await attachToDraft(client, messageId, attachment);
    }
  }

  // 4. Send. Graph returns 202 Accepted with no body.
  await client.api(`/me/messages/${messageId}/send`).post({});

  return { messageId, conversationId };
}

export async function isOutlookConnected(): Promise<boolean> {
  try {
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}

export interface OutlookProbeResult {
  ok: boolean;
  error?: string;
  email?: string;
}

export async function probeOutlook(): Promise<OutlookProbeResult> {
  try {
    const client = await getOutlookClient();
    const me = await client.api("/me").select("mail,userPrincipalName").get();
    return { ok: true, email: me?.mail || me?.userPrincipalName };
  } catch (err: any) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { ok: false, error: msg.slice(0, 500) };
  }
}

export interface InboxMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: string; content: string };
  from: { emailAddress: { name: string; address: string } };
  receivedDateTime: string;
  isRead: boolean;
  conversationId: string;
}

export interface SearchEmailOptions {
  afterDate?: string;
  searchQuery?: string;
  folder?: string;
  top?: number;
}

export async function searchInboxEmails(options: SearchEmailOptions = {}): Promise<InboxMessage[]> {
  const client = await getOutlookClient();
  const folder = options.folder || "inbox";
  const top = options.top || 50;

  let endpoint = `/me/mailFolders/${folder}/messages`;
  const queryParams: string[] = [
    `$top=${top}`,
    "$orderby=receivedDateTime desc",
    "$select=id,subject,bodyPreview,body,from,receivedDateTime,isRead,conversationId",
  ];

  if (options.afterDate) {
    queryParams.push(`$filter=receivedDateTime ge ${options.afterDate}`);
  }

  if (options.searchQuery) {
    queryParams.push(`$search="${options.searchQuery}"`);
  }

  endpoint += "?" + queryParams.join("&");

  const result = await client.api(endpoint).get();
  return result.value || [];
}

export async function getEmailById(messageId: string): Promise<InboxMessage | null> {
  const client = await getOutlookClient();
  try {
    const msg = await client
      .api(`/me/messages/${messageId}`)
      .select("id,subject,bodyPreview,body,from,receivedDateTime,isRead,conversationId")
      .get();
    return msg;
  } catch {
    return null;
  }
}

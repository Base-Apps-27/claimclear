// Microsoft Outlook integration via Replit connector (Microsoft Graph API)
import { Client } from "@microsoft/microsoft-graph-client";

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

// Microsoft Graph caps inline ("fileAttachment") payloads at ~3 MB total per
// message. Anything larger requires the upload-session API. We refuse early
// with a clear error rather than letting Graph reject mid-send.
const INLINE_ATTACHMENT_LIMIT_BYTES = 3 * 1024 * 1024;

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
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
  if (totalAttachmentBytes > INLINE_ATTACHMENT_LIMIT_BYTES) {
    throw new Error(
      `Email attachments total ${totalAttachmentBytes} bytes which exceeds the ` +
      `${INLINE_ATTACHMENT_LIMIT_BYTES}-byte inline cap. Use a smaller attachment set ` +
      `or implement the Graph upload-session flow.`,
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

  if (attachments.length > 0) {
    draft.attachments = attachments.map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.name,
      contentType: a.contentType || "application/octet-stream",
      contentBytes: a.content.toString("base64"),
    }));
  }

  // Create a draft message so we can read back its id + conversationId
  const created = await client.api("/me/messages").post(draft);
  const messageId: string = created?.id;
  const conversationId: string | null = created?.conversationId ?? null;

  if (!messageId) {
    throw new Error("Outlook draft create did not return an id");
  }

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

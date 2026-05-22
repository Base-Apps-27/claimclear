// Task #713 — staged-upload attachment resolution for the reply composer.
//
// Trust model:
//   1. The composer streams each picked file to
//      `PUT /storage/reply-attachments/stage`. That endpoint validates the
//      MIME type against the reply-attachment allowlist, writes the bytes
//      into object storage, and inserts a `reply_attachment_staging` row
//      pinned to the calling user. It returns an opaque `stagedId`.
//   2. The reply request later carries `attachments: [{ stagedId }, ...]`.
//      This helper looks each id up server-side, requires that the row
//      belongs to the same user that's now sending, and re-uses the
//      authoritative size + content type recorded at upload time. The
//      client never gets to choose which storage key gets attached or
//      what we tell Outlook the file's MIME type is.
//   3. On a successful send the caller marks the rows as consumed
//      (`markStagedAttachmentsConsumed`) so the 24-hour janitor leaves
//      them alone — they're now part of the audit trail.
//
// Sister janitor: `purgeStaleReplyAttachmentStaging` runs hourly via a
// `setInterval` registered in `index.ts` and removes any unconsumed row
// older than 24h plus its underlying blob.

import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import {
  REPLY_ATTACHMENT_ALLOWED_MIME_SET,
  REPLY_ATTACHMENT_TOTAL_BYTES,
} from "@workspace/api-zod";
import { db, replyAttachmentStagingTable } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { downloadAttachmentsWithRetry } from "./email-attachments";
import type { EmailAttachment } from "./outlook";

export interface StagedAttachmentRef {
  stagedId: string;
}

export interface PersistedAttachmentMeta {
  /** Operator-supplied filename. */
  name: string;
  /** Authoritative size from the staging row (server-recorded at upload). */
  size: number;
  /** Authoritative content type from the staging row (server-validated). */
  contentType: string;
  /** Internal `/objects/...` path. Never leaks to the client raw — the
   *  thread bubble + audit feed see a `/api/storage/objects/...` URL. */
  storageKey: string;
  /** Staging row id, kept so the caller can mark it consumed after send. */
  stagedId: string;
}

export interface ResolvedReplyAttachments {
  /** Attachments shaped for `attachToDraft` / `replyToMessage`. */
  forGraph: EmailAttachment[];
  /** Filenames in send order, for the legacy `attachmentNames` column. */
  names: string[];
  /** Full per-attachment metadata persisted on the outbound row. */
  metadata: PersistedAttachmentMeta[];
  /** Staging ids the caller should mark consumed once the send succeeds. */
  stagedIds: string[];
}

/**
 * Discriminated result so the caller can map validation failures to a 400
 * (bad input) and storage-fetch failures to a 502 (transient infrastructure
 * issue) without sniffing error messages.
 */
export type ReplyAttachmentResult =
  | { ok: true; value: ResolvedReplyAttachments }
  | { ok: false; status: 400 | 403 | 502; error: string };

function normalizeRefs(raw: unknown): StagedAttachmentRef[] | { error: string } {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return { error: "attachments must be an array" };
  const out: StagedAttachmentRef[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown> | null;
    if (!item || typeof item !== "object") {
      return { error: `attachments[${i}] must be an object` };
    }
    const stagedId = typeof item.stagedId === "string" ? item.stagedId.trim() : "";
    if (!stagedId) {
      return { error: `attachments[${i}] requires stagedId` };
    }
    if (seen.has(stagedId)) {
      return { error: `attachments[${i}] (${stagedId}) is listed more than once` };
    }
    seen.add(stagedId);
    out.push({ stagedId });
  }
  return out;
}

/**
 * Resolve a list of `{ stagedId }` refs into validated attachment metadata
 * + downloaded bytes ready for Outlook. Enforces ownership, the MIME
 * allowlist (against the server-recorded type, never the client's) and
 * the 25 MB total payload cap. There is intentionally no per-file or
 * per-image count cap — any combination is fine so long as the combined
 * bytes stay under 25 MB.
 *
 * @param raw         The request `attachments` array (untrusted input).
 * @param userEmail   Email of the operator hitting the reply endpoint.
 *                    Used for ownership checks against the staging row.
 * @param label       Logging label forwarded to the storage downloader.
 */
export async function resolveReplyAttachments(
  raw: unknown,
  userEmail: string | null,
  label: string,
): Promise<ReplyAttachmentResult> {
  const parsed = normalizeRefs(raw);
  if (!Array.isArray(parsed)) {
    return { ok: false, status: 400, error: parsed.error };
  }
  if (parsed.length === 0) {
    return { ok: true, value: { forGraph: [], names: [], metadata: [], stagedIds: [] } };
  }

  const ids = parsed.map((p) => p.stagedId);
  const rows = await db
    .select()
    .from(replyAttachmentStagingTable)
    .where(inArray(replyAttachmentStagingTable.id, ids));

  const byId = new Map(rows.map((r) => [r.id, r]));

  const metadata: PersistedAttachmentMeta[] = [];
  let totalBytes = 0;

  for (let i = 0; i < parsed.length; i++) {
    const ref = parsed[i];
    const row = byId.get(ref.stagedId);
    if (!row) {
      return {
        ok: false,
        status: 400,
        error: `attachments[${i}] (${ref.stagedId}): staged upload not found or expired. Re-attach the file.`,
      };
    }
    // Ownership: the row's recorded user must match the sender. We treat
    // a null recorded user (legacy / unauthenticated upload path) as
    // "anyone can claim" only if the current user is also null — i.e. we
    // never let a logged-in user steal an anonymous upload.
    if (row.userEmail !== userEmail) {
      return {
        ok: false,
        status: 403,
        error: `attachments[${i}] (${row.fileName}): not yours to attach.`,
      };
    }
    if (row.consumedAt) {
      return {
        ok: false,
        status: 400,
        error: `attachments[${i}] (${row.fileName}): already attached to another reply — re-upload to send again.`,
      };
    }
    // Server-recorded MIME is authoritative. We do NOT fall back to the
    // client value if it isn't in the allowlist — that's exactly the
    // bypass the reviewer flagged.
    const ct = (row.contentType || "").toLowerCase();
    if (!REPLY_ATTACHMENT_ALLOWED_MIME_SET.has(ct)) {
      return {
        ok: false,
        status: 400,
        error: `attachments[${i}] (${row.fileName}): unsupported file type "${ct}".`,
      };
    }

    const size = row.sizeBytes;
    totalBytes += size;
    if (totalBytes > REPLY_ATTACHMENT_TOTAL_BYTES) {
      return {
        ok: false,
        status: 400,
        error: `Selected attachments total ${(totalBytes / (1024 * 1024)).toFixed(1)} MB. Emails are capped at 25 MB total — please remove or split some files.`,
      };
    }

    metadata.push({
      name: row.fileName,
      size,
      contentType: ct,
      storageKey: row.storageKey,
      stagedId: row.id,
    });
  }

  let forGraph: EmailAttachment[] = [];
  try {
    const downloaded = await downloadAttachmentsWithRetry(
      metadata.map((m) => m.storageKey),
      label,
    );
    forGraph = downloaded.map((att, idx) => ({
      name: metadata[idx].name,
      content: att.content,
      contentType: metadata[idx].contentType,
    }));
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "Failed to download attachments",
    };
  }

  return {
    ok: true,
    value: {
      forGraph,
      names: metadata.map((m) => m.name),
      metadata,
      stagedIds: metadata.map((m) => m.stagedId),
    },
  };
}

/**
 * Stamp `consumed_at` on the given staging rows so the janitor doesn't
 * delete the underlying blob — the audit trail still references it. Best
 * effort: errors are swallowed so a bookkeeping failure never undoes a
 * successful send.
 */
export async function markStagedAttachmentsConsumed(
  stagedIds: string[],
): Promise<void> {
  if (stagedIds.length === 0) return;
  try {
    await db
      .update(replyAttachmentStagingTable)
      .set({ consumedAt: new Date() })
      .where(inArray(replyAttachmentStagingTable.id, stagedIds));
  } catch {
    // Intentionally swallowed — the email already went out.
  }
}

/**
 * Convert a `storageKey` (a `/objects/...` path) into a public download
 * URL the UI can hit. Mirrors the route mounted in `routes/storage.ts`.
 */
export function storageKeyToDownloadUrl(storageKey: string): string {
  if (!storageKey.startsWith("/objects/")) return storageKey;
  return `/api/storage/objects/${storageKey.slice("/objects/".length)}`;
}

const STAGED_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Janitor: delete unconsumed staged uploads older than 24h, plus the
 * underlying object-storage blob. Idempotent — safe to call from a
 * `setInterval`. Returns counts for the caller to log.
 */
export async function purgeStaleReplyAttachmentStaging(): Promise<{
  rowsDeleted: number;
  blobsDeleted: number;
}> {
  const cutoff = new Date(Date.now() - STAGED_ATTACHMENT_TTL_MS);
  const stale = await db
    .select()
    .from(replyAttachmentStagingTable)
    .where(
      and(
        isNull(replyAttachmentStagingTable.consumedAt),
        lt(replyAttachmentStagingTable.createdAt, cutoff),
      ),
    );

  if (stale.length === 0) return { rowsDeleted: 0, blobsDeleted: 0 };

  const storage = new ObjectStorageService();
  let blobsDeleted = 0;
  for (const row of stale) {
    const ok = await storage.tryDeleteObjectEntity(row.storageKey);
    if (ok) blobsDeleted += 1;
  }

  await db
    .delete(replyAttachmentStagingTable)
    .where(
      inArray(
        replyAttachmentStagingTable.id,
        stale.map((r) => r.id),
      ),
    );

  return { rowsDeleted: stale.length, blobsDeleted };
}

/**
 * Register the hourly purge sweep. Pattern mirrors `bot-presence`:
 * `.unref()` so the timer never blocks process shutdown, and we tolerate
 * an immediate first sweep on boot to clean up anything left over from
 * the previous process.
 */
export function startReplyAttachmentStagingJanitor(
  log: { info: (obj: object, msg?: string) => void; error: (obj: object, msg?: string) => void },
): void {
  const sweep = async () => {
    try {
      const result = await purgeStaleReplyAttachmentStaging();
      if (result.rowsDeleted > 0) {
        log.info(result, "purged stale reply-attachment staging rows");
      }
    } catch (err) {
      log.error({ err }, "reply-attachment janitor sweep failed");
    }
  };
  // First sweep deferred a few seconds so it doesn't pile onto cold-start.
  setTimeout(sweep, 30_000).unref();
  setInterval(sweep, 60 * 60 * 1000).unref();
}

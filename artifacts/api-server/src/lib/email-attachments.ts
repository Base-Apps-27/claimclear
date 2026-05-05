// Shared helpers for downloading evidence URLs into in-memory
// `EmailAttachment` payloads suitable for Microsoft Graph fileAttachment.
// Extracted from direct-email-dispatch.ts so other senders (e.g. the in-app
// reply composer) can reuse the same GCS-first / HTTP-fallback strategy
// without dragging in the dispute-send pipeline.

import path from "path";
import { EMAIL_MESSAGE_MAX_BYTES } from "@workspace/api-zod";
import { ObjectStorageService } from "./objectStorage";
import type { EmailAttachment } from "./outlook";
import { logger } from "./logger";

const MAX_ATTACHMENT_BYTES = EMAIL_MESSAGE_MAX_BYTES;
const DOWNLOAD_TIMEOUT_MS = 60_000;

export async function downloadAttachment(
  url: string,
  index: number,
  label: string,
): Promise<EmailAttachment> {
  if (typeof url !== "string" || !url.startsWith("/objects/")) {
    throw new Error(`Attachment URL rejected — only application storage paths (/objects/...) are permitted: ${url}`);
  }

  try {
    const storage = new ObjectStorageService();
    const file = await storage.getObjectEntityFile(url);
    const [metadata] = await file.getMetadata();
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    await new Promise<void>((resolve, reject) => {
      file.createReadStream()
        .on("data", (chunk: Buffer | string) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buf.length;
          if (totalBytes > MAX_ATTACHMENT_BYTES) {
            reject(new Error(`Attachment file exceeds ${MAX_ATTACHMENT_BYTES} byte size limit`));
            return;
          }
          chunks.push(buf);
        })
        .on("end", () => resolve())
        .on("error", (err) => reject(err));
    });
    const filename = pickFilename(url, label, index, (metadata.contentType as string | undefined) ?? null);
    return {
      name: filename,
      content: Buffer.concat(chunks),
      contentType: (metadata.contentType as string | undefined) ?? guessMimeFromName(filename),
    };
  } catch (objErr) {
    logger.warn(
      { url, err: objErr instanceof Error ? objErr.message : String(objErr) },
      "email-attachments: object storage download failed, trying HTTP fallback",
    );
    const apiBase = `http://localhost:${process.env.PORT || 8080}`;
    const httpUrl = `${apiBase}${url.replace(/^\/objects\//, "/api/storage/objects/")}`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    const response = await fetch(httpUrl, { signal: controller.signal });
    clearTimeout(timeoutHandle);
    if (!response.ok || !response.body) {
      throw new Error(`HTTP fallback ${httpUrl} returned ${response.status}`);
    }
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment file exceeds ${MAX_ATTACHMENT_BYTES} byte size limit`);
    }
    const contentType = response.headers.get("content-type") || undefined;
    const filename = pickFilename(url, label, index, contentType ?? null);
    return { name: filename, content: buf, contentType: contentType ?? guessMimeFromName(filename) };
  }
}

/**
 * Download a list of evidence URLs with up to 3 retries each (matching the
 * direct-email dispatch behaviour). Throws on the first URL that exhausts
 * its retries — callers should surface that as a 502 so the composer can
 * keep the user's draft and recipient list intact for a retry.
 */
export async function downloadAttachmentsWithRetry(
  urls: string[],
  label: string,
): Promise<EmailAttachment[]> {
  const out: EmailAttachment[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    let lastErr: unknown = null;
    let downloaded: EmailAttachment | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        downloaded = await downloadAttachment(url, i, label);
        break;
      } catch (err) {
        lastErr = err;
        logger.warn(
          { url, attempt, err: err instanceof Error ? err.message : String(err) },
          "email-attachments: download attempt failed",
        );
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    if (!downloaded) {
      throw new Error(
        `Evidence download failed for ${url}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
      );
    }
    out.push(downloaded);
  }
  return out;
}

export function pickFilename(url: string, label: string, index: number, contentType: string | null): string {
  const last = url.split("/").pop() || "";
  const cleaned = last.split("?")[0] || "";
  const hasExt = cleaned.includes(".") && !cleaned.startsWith(".");
  if (hasExt) return cleaned;
  const ext = mimeToExt(contentType) || ".bin";
  return `${label}-evidence-${index + 1}${ext}`;
}

function mimeToExt(contentType: string | null): string | null {
  if (!contentType) return null;
  const type = contentType.split(";")[0].trim().toLowerCase();
  switch (type) {
    case "image/png": return ".png";
    case "image/jpeg": return ".jpg";
    case "image/gif": return ".gif";
    case "image/webp": return ".webp";
    case "application/pdf": return ".pdf";
    case "text/plain": return ".txt";
    case "text/csv": return ".csv";
    case "application/json": return ".json";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return ".xlsx";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return ".docx";
    default: return null;
  }
}

export function guessMimeFromName(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".pdf": return "application/pdf";
    case ".txt": return "text/plain";
    case ".csv": return "text/csv";
    case ".json": return "application/json";
    case ".xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default: return "application/octet-stream";
  }
}

export const ALLOWED_UPLOAD_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/bmp",
  "application/pdf",
  // Spreadsheets — operators routinely attach CSV / Excel exports as
  // supporting evidence (ride manifests, payor remittance reports, etc.).
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type AllowedUploadContentType = (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number];

export const ALLOWED_UPLOAD_CONTENT_TYPES_SET = new Set<string>(ALLOWED_UPLOAD_CONTENT_TYPES);

// Single source of truth for the maximum size of an outbound email message
// (subject + body + all attachments). 25 MB matches the safe Exchange/Outlook
// recipient default. Both the in-app reply composer and the dispute-send /
// direct-email pipeline cap their payloads here; the per-evidence upload
// limit also drops to this cap so a file that lands in object storage can
// always be attached without a downstream re-encode.
export const EMAIL_MESSAGE_MAX_BYTES = 25 * 1024 * 1024;

// Per-attachment threshold for choosing Microsoft Graph's inline
// `fileAttachment` route vs. the upload-session API. Anything at or below
// this size goes inline (single POST); anything larger is uploaded in
// chunks via `createUploadSession`. Graph's documented hard cap on the
// inline route is ~3 MB total per message.
export const INLINE_ATTACHMENT_THRESHOLD_BYTES = 3 * 1024 * 1024;

// Server-side upload size limit. Aligned with `EMAIL_MESSAGE_MAX_BYTES` so
// any file that successfully lands in object storage is small enough to be
// attached to a single email later without surprising the operator.
export const MAX_UPLOAD_SIZE_BYTES = EMAIL_MESSAGE_MAX_BYTES;

// Reply-composer attachment limits (Task #713). The composer accepts a
// narrower MIME slice than `ALLOWED_UPLOAD_CONTENT_TYPES` — payors expect
// images and PDFs (plus the occasional spreadsheet), not arbitrary
// office docs — and caps the total per-message payload at the 25 MB
// Outlook ceiling. There is intentionally no per-file or per-image count
// cap: any combination of files is fine so long as the combined bytes
// stay under the 25 MB total.
export const REPLY_ATTACHMENT_ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  // Spreadsheets — payors frequently expect CSV / Excel exports as
  // supporting documents (e.g. trip-leg manifests).
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type ReplyAttachmentMime = (typeof REPLY_ATTACHMENT_ALLOWED_MIME)[number];

export const REPLY_ATTACHMENT_ALLOWED_MIME_SET = new Set<string>(
  REPLY_ATTACHMENT_ALLOWED_MIME,
);

export const REPLY_ATTACHMENT_TOTAL_BYTES = EMAIL_MESSAGE_MAX_BYTES;

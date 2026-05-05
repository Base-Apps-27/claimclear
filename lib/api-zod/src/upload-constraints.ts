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

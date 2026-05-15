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
// images and PDFs, not arbitrary office docs — and caps the total per-
// message payload at the 25 MB Outlook ceiling.
//
// Count limits: at most 5 *images* per reply (the original task scope),
// plus any number of PDFs that fit under the 25 MB total cap. PDFs are
// the long tail (single supporting doc per claim), so we don't budget
// them against the image count. A separate hard ceiling on combined
// attachments keeps a runaway client from posting hundreds of tiny PDFs.
export const REPLY_ATTACHMENT_ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  // Spreadsheets — payors frequently expect CSV / Excel exports as
  // supporting documents (e.g. trip-leg manifests). Counted against the
  // 25 MB total only, never against the per-reply image cap.
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type ReplyAttachmentMime = (typeof REPLY_ATTACHMENT_ALLOWED_MIME)[number];

export const REPLY_ATTACHMENT_ALLOWED_MIME_SET = new Set<string>(
  REPLY_ATTACHMENT_ALLOWED_MIME,
);

export const REPLY_ATTACHMENT_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
export const REPLY_ATTACHMENT_IMAGE_MIME_SET = new Set<string>(
  REPLY_ATTACHMENT_IMAGE_MIME,
);

/** Max image attachments per reply (PDFs are budgeted only against bytes). */
export const MAX_REPLY_ATTACHMENT_IMAGES = 5;
/** Hard ceiling on combined attachments per reply (images + PDFs). */
/**
 * Defensive ceiling on the *total* number of attachments per reply (images
 * + PDFs combined). The product requirement is "max 5 images + PDFs that
 * fit within the 25 MB cap". This 10-file ceiling is intentionally
 * generous: it sits above the image cap so a worst case of 5 images + 5
 * small PDFs is still allowed, while preventing a degenerate payload of
 * dozens of tiny PDFs from blowing past Outlook's per-message attachment
 * limit (which is 250 in Microsoft 365 but unbounded server cost on our
 * side). If product later wants the cap relaxed for PDF-heavy replies,
 * raise this constant; the 25 MB total + 5-image image cap stay in force.
 */
export const MAX_REPLY_ATTACHMENT_FILES = 10;
export const REPLY_ATTACHMENT_TOTAL_BYTES = EMAIL_MESSAGE_MAX_BYTES;

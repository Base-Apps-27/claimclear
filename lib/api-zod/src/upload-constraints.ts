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

export const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;

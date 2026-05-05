export * from "./generated/api";
export type { AuthUser } from "./generated/types";
// Task #321: re-export the payor-denial-reason union (orval-generated mirror
// of the OpenAPI enum) so cross-package parity tests and operator UI code
// don't have to reach into `./generated/types/...` paths.
export {
  PayorDenialReasonCode,
  type PayorDenialReasonCode as PayorDenialReasonCodeType,
} from "./generated/types/payorDenialReasonCode";
// Upload constraints live outside the generated directory so they survive
// codegen (`orval --config` wipes `generated/` with clean:true).
export {
  ALLOWED_UPLOAD_CONTENT_TYPES,
  ALLOWED_UPLOAD_CONTENT_TYPES_SET,
  MAX_UPLOAD_SIZE_BYTES,
  EMAIL_MESSAGE_MAX_BYTES,
  INLINE_ATTACHMENT_THRESHOLD_BYTES,
  type AllowedUploadContentType,
} from "./upload-constraints";

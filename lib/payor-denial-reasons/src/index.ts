// Single source of truth for the lightweight "why did the payor reject our
// dispute?" signal recorded against an invoice_group when the operator
// reviews an inbound response on the Responses Awaiting Review page
// (Task #321). This is intentionally separate from the heavyweight
// `closure_*` columns / `lib/closure-options` package: payor denial
// reasons are a per-response qualitative tag we capture on the way past,
// not a closure decision (the group is NOT being closed when this is
// recorded), and they must never be treated as a `ClosureReason`.
//
// The codes here are mirrored into:
//   - the `payor_denial_reason` column on `invoice_groups`
//     (free-form text at the DB level; this package is the API-level
//     enforcer)
//   - the `PayorDenialReasonCode` enum in `lib/api-spec/openapi.yaml`
//     (kept in lockstep via `payor-denial-reason.parity.ts` on the server)
//   - the inbound-email classifier's `suggestedPayorDenialReason` field
//     (so the AI hint and the operator picker share one vocabulary)
//
// `payor_other` requires a free-text `payor_denial_reason_note` so the
// operator must explain themselves; the API enforces that — see
// `routes/invoice-groups.ts`.

export interface PayorDenialReason {
  /** Stable machine code persisted to the DB and the OpenAPI enum. */
  code: string;
  /** Operator-facing label. Keep short — these render in a single-select. */
  label: string;
}

export const PAYOR_DENIAL_REASONS = [
  { code: "payor_rejected_gps", label: "Payor rejected GPS evidence" },
  { code: "payor_rejected_signature", label: "Payor rejected signature evidence" },
  { code: "payor_reclassified_error", label: "Payor reclassified the error type" },
  { code: "payor_cited_benefit_rule", label: "Payor cited contract / benefit rule" },
  { code: "payor_cited_timely_filing", label: "Payor cited timely filing" },
  { code: "payor_no_clear_reason", label: "No clear reason given" },
  { code: "payor_other", label: "Other" },
] as const satisfies readonly PayorDenialReason[];

export type PayorDenialReasonCode = (typeof PAYOR_DENIAL_REASONS)[number]["code"];

export const PAYOR_DENIAL_REASON_CODES: readonly PayorDenialReasonCode[] =
  PAYOR_DENIAL_REASONS.map((r) => r.code);

const LABEL_BY_CODE: Record<PayorDenialReasonCode, string> = Object.fromEntries(
  PAYOR_DENIAL_REASONS.map((r) => [r.code, r.label]),
) as Record<PayorDenialReasonCode, string>;

export function payorDenialReasonLabel(code: PayorDenialReasonCode): string {
  return LABEL_BY_CODE[code];
}

export function isPayorDenialReasonCode(value: unknown): value is PayorDenialReasonCode {
  return typeof value === "string" && (PAYOR_DENIAL_REASON_CODES as readonly string[]).includes(value);
}

/**
 * Exhaustiveness helper for `switch` over `PayorDenialReasonCode`. Mirrors
 * the `assertNeverClosureReason` pattern used by `lib/closure-options` so
 * adding a new code here forces every consumer's switch to compile-fail
 * until it handles the new case.
 */
export function assertNeverPayorDenialReason(code: never): never {
  throw new Error(`Unhandled payor denial reason: ${String(code)}`);
}

// Client-side feature-flag accessor. Each surface that wants to gate
// behind the per-claim → per-invoice transition reads the flag through
// this single helper so a future "flip the flag for everyone" change is
// a one-file edit.
//
// Vite only exposes env vars that are prefixed with `VITE_` to the
// client bundle, so the flag is sourced from `VITE_PER_INVOICE_TRANSITION_ENABLED`.
// Strings "true" / "1" enable the flag; everything else (undefined,
// "false", "0", empty string) disables it. Defaulting to off ensures the
// flag-off legacy UI is what ships when the env var is unset.

const RAW = import.meta.env.VITE_PER_INVOICE_TRANSITION_ENABLED as
  | string
  | undefined;

function asBool(v: string | undefined): boolean {
  if (v == null) return false;
  const norm = String(v).trim().toLowerCase();
  return norm === "true" || norm === "1";
}

export const PER_INVOICE_TRANSITION_ENABLED = asBool(RAW);

// Helper accessor so callsites can read the flag through a function call —
// useful when we eventually swap the static env-var read for a runtime
// `/feature-flags` fetch without touching every import site.
export function isPerInvoiceTransitionEnabled(): boolean {
  return PER_INVOICE_TRANSITION_ENABLED;
}

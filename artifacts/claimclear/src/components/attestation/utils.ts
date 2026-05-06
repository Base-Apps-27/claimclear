import type { ClaimResponse } from "@workspace/api-client-react";

/** Pull the headline invoice number off a leg, falling back to "—". */
export function pickInvoiceNumber(claim: ClaimResponse): string {
  const raw = (claim.invoiceNumbers ?? "").trim();
  if (!raw) return "—";
  const first = raw.split(/[,\s]+/).filter(Boolean)[0];
  return first ?? "—";
}

/** First invoice token on a leg, or null when nothing is on file. */
export function firstInvoiceToken(claim: ClaimResponse): string | null {
  const raw = (claim.invoiceNumbers ?? "").trim();
  if (!raw) return null;
  const first = raw.split(/[,\s]+/).filter(Boolean)[0];
  return first ?? null;
}

export interface RelativeAge {
  label: string;
  isStale: boolean;
}

/**
 * Render an enteredAt timestamp as a compact "3d old" / "2h old" /
 * "5m old" string. Anything ≥7 days old is flagged stale so the
 * sidebar can paint an amber dot ahead of the label.
 */
export function relativeAge(iso: string | null | undefined, now: Date = new Date()): RelativeAge | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const ms = now.getTime() - t;
  if (ms < 60_000) return { label: "just now", isStale: false };
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  let label: string;
  if (days >= 1) label = `${days}d old`;
  else if (hours >= 1) label = `${hours}h old`;
  else label = `${mins}m old`;
  return { label, isStale: days >= 7 };
}

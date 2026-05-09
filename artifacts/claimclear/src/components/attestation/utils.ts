import type { ClaimResponse } from "@workspace/api-client-react";
import { formatRelative } from "@/lib/time";

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
  /** Origin ISO so callers can attach `absoluteTooltip` on the rendered label (#562). */
  iso: string;
  label: string;
  isStale: boolean;
}

/**
 * Render an enteredAt timestamp as a compact relative-age string
 * (e.g. "3d ago"). Routes the label through the shared
 * `lib/time/formatRelative` so attestation queue rows agree with every
 * other "5m ago" surface in the operator app (#562). The `isStale`
 * flag is computed alongside so the sidebar can still paint an amber
 * dot when the leg has been waiting ≥7 days.
 */
export function relativeAge(iso: string | null | undefined, now: Date = new Date()): RelativeAge | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const label = formatRelative(iso, now.getTime());
  if (!label) return null;
  const isStale = now.getTime() - t >= 7 * 24 * 60 * 60 * 1000;
  return { iso, label, isStale };
}

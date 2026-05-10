import type { ClaimResponse } from "@workspace/api-client-react";
import { formatRelative, formatDate } from "@/lib/time";

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

/**
 * Render a service date (`YYYY-MM-DD` or full ISO) as a short
 * "Mon D" label, omitting the year when it matches the current
 * calendar year. Used by the Variant B left rail (Task #650).
 */
export function formatServiceDateShort(
  input: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!input) return null;
  const full = formatDate(input);
  if (!full || full === "N/A") return null;
  const yearSuffix = `, ${now.getFullYear()}`;
  return full.endsWith(yearSuffix) ? full.slice(0, -yearSuffix.length) : full;
}

const FRESH_WINDOW_MS = 30 * 60 * 1000;

/**
 * True when an attestation leg's verdict landed within the last
 * 30 minutes. Drives the blue "just landed" dot on the left rail.
 */
export function isFreshSince(
  iso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t <= FRESH_WINDOW_MS;
}

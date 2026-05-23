// Task #848 — shared helpers for CSV export endpoints. The filename
// the operator sees in their download tray is composed on the client
// (page-aware filter signature like `queue_held-driverSmith_2026-05-23.csv`)
// and forwarded via the `?filename=` query param. We sanitise here so
// a caller can't smuggle CRLF / quote characters into the
// `Content-Disposition` header.
export function sanitiseCsvFilename(raw: string): string {
  if (!raw) return "";
  // Strip anything outside [A-Za-z0-9._-]; clamp length so an
  // accidental URL-encoded blob can't blow past header limits.
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200);
  if (cleaned.length === 0) return "";
  return cleaned.endsWith(".csv") ? cleaned : `${cleaned}.csv`;
}

// CSV cell escape: Excel formula-injection guard + quote/quote-doubling.
// Kept here so all three export endpoints stay byte-identical and the
// "with all fields" toggle behaves the same wherever it surfaces.
export function csvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

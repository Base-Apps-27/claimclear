import { format, parseISO } from "date-fns";

// Parse a date string for display. A bare `YYYY-MM-DD` (the wire shape
// for `claims.date` / `invoice_groups.service_date`) is a CALENDAR day,
// not a timestamp — `new Date("2026-04-06")` would parse it as midnight
// UTC, which then renders as "Apr 5" in any negative-UTC offset (e.g.
// ET in April: UTC-4 → 8pm Apr 5). Force local-midnight parsing for
// date-only strings so the displayed day always matches the stored
// service date. Full ISO timestamps fall through to the standard
// parser so `formatDateTime` keeps working for audit-log timestamps.
function parseDisplayDate(dateStr: string): Date {
  // YYYY-MM-DD or YYYY-MM-DDT... — split off the calendar portion.
  // If there's a 'T' (timestamp), parse as ISO so the time-of-day
  // helpers below render the wall-clock the way the caller expects.
  if (dateStr.length >= 10 && dateStr[4] === "-" && dateStr[7] === "-" && (dateStr.length === 10 || dateStr[10] === "T")) {
    if (dateStr.length === 10) {
      const [y, m, d] = dateStr.split("-").map(Number);
      // Local-midnight constructor — no TZ shift, the displayed day
      // matches the YYYY-MM-DD on the wire exactly.
      return new Date(y, m - 1, d);
    }
    return parseISO(dateStr);
  }
  return new Date(dateStr);
}

// Returns "—" for null/undefined so server-nulled money fields (clerks)
// render cleanly. Also distinguishes "no amount on this row" from a real
// $0.00 for admin/user surfaces.
export function formatCurrency(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num);
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "N/A";
  try {
    return format(parseDisplayDate(dateStr), "MMM d, yyyy");
  } catch (e) {
    return dateStr;
  }
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "N/A";
  try {
    return format(parseDisplayDate(dateStr), "MMM d, yyyy h:mm a");
  } catch (e) {
    return dateStr;
  }
}

// Compatibility shim for the legacy `@/lib/format` import path. Date /
// time helpers now live in `@/lib/time` (see #562 — single display-TZ
// module). New code should import from `@/lib/time` directly; this file
// keeps `formatDate` / `formatDateTime` exported for the existing call
// sites and continues to own the money formatter (which is not a
// timezone concern).

export { formatDate, formatDateTime } from "@/lib/time";

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

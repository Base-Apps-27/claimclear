import { format } from "date-fns";

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
    return format(new Date(dateStr), "MMM d, yyyy");
  } catch (e) {
    return dateStr;
  }
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "N/A";
  try {
    return format(new Date(dateStr), "MMM d, yyyy h:mm a");
  } catch (e) {
    return dateStr;
  }
}

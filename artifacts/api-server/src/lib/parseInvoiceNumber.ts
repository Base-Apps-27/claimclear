export function parseInvoiceNumber(refNumber: string | null | undefined): string | null {
  if (!refNumber) return null;
  const trimmed = refNumber.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 1 && /^\d+$/.test(parts[0])) {
    return parts[0];
  }
  return null;
}

// Shared predicate for spreadsheet/upload column headers that carry
// member-identifying PII. Used by both the browser-side import wizard
// (to strip the column the moment a file is parsed, before any data
// hits React state, the resume-later localStorage cache, or the
// `/api/import` payload) and the server-side import endpoint (as a
// belt-and-suspenders guard for older clients or direct API callers).
// Keeping the rule in one place ensures the two sides can never drift.
//
// Scope is intentionally narrow per Task #741: only "Member Name" and
// obvious variants ("Member", "Patient", "Patient Name"). Header
// matching is case-insensitive and tolerant of spacing/punctuation —
// "member name", "Member_Name", "MEMBER NAME ", and "Patient name"
// all match.

const PII_HEADER_NORMALIZED = new Set<string>([
  "member",
  "membername",
  "patient",
  "patientname",
]);

export function normalizePiiHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isPiiHeader(header: string): boolean {
  if (typeof header !== "string") return false;
  const normalized = normalizePiiHeader(header);
  if (!normalized) return false;
  return PII_HEADER_NORMALIZED.has(normalized);
}

// Task #848 — page-aware CSV filename builder. Composes a short filter
// signature (e.g. `queue_held-driverSmith_2026-05-23.csv`) the operator
// recognises in their download tray and that survives a subsequent
// "did I already grab this view?" check. The server sanitises the
// final string before echoing it in `Content-Disposition`, so the
// helper here only needs to produce something human-readable.
export function buildCsvFilename(
  prefix: string,
  tokens: Array<string | null | undefined>,
  date: Date = new Date(),
): string {
  const sluggedTokens = tokens
    .map((t) => (t == null ? "" : slugifyToken(String(t))))
    .filter((t) => t.length > 0);
  const datePart = date.toISOString().slice(0, 10);
  const signature = sluggedTokens.length > 0 ? `_${sluggedTokens.join("-")}` : "";
  return `${slugifyToken(prefix)}${signature}_${datePart}.csv`;
}

function slugifyToken(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "")
    .slice(0, 40);
}

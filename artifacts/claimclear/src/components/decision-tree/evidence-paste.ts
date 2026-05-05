// Shared evidence paste/upload helpers. Pure data + pure helpers — no
// React, no fetch, no toast. Components consume it via
// `evidence-paste-upload.tsx`.

/** Maximum file size accepted for any SOP evidence or instruction
 *  image upload. */
export const MAX_EVIDENCE_SIZE = 50 * 1024 * 1024;

/** MIME allowlist for SOP-evidence file pickers and clipboard pastes. */
export const ALLOWED_EVIDENCE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/bmp",
  "application/pdf",
]);

/** Extract File items from a ClipboardEvent's DataTransfer, filtered
 *  by the SOP-evidence allowlist. PDFs are excluded when `acceptPdf`
 *  is false. */
export function extractClipboardFiles(
  data: DataTransfer | null | undefined,
  opts?: { acceptPdf?: boolean },
): File[] {
  if (!data || !data.items) return [];
  const acceptPdf = opts?.acceptPdf !== false;
  const out: File[] = [];
  for (let i = 0; i < data.items.length; i++) {
    const it = data.items[i];
    if (it.kind !== "file") continue;
    const f = it.getAsFile();
    if (!f) continue;
    if (!ALLOWED_EVIDENCE_TYPES.has(f.type)) continue;
    if (!acceptPdf && f.type === "application/pdf") continue;
    out.push(f);
  }
  return out;
}

/** True iff `navigator.clipboard.read` is available. Consumers hide
 *  the explicit Paste button when it isn't (older Safari / non-secure
 *  contexts). Keyboard paste keeps working via `onPaste`. */
export function isClipboardReadAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard !== "undefined" &&
    typeof navigator.clipboard.read === "function"
  );
}

/** Read the first allowed file from the Async Clipboard API, or
 *  `null` if nothing usable is on the clipboard. The `read` callback
 *  is injected so tests can drive every branch without jsdom. */
export async function readAllowedFileFromClipboard(
  read: () => Promise<readonly ClipboardItem[]>,
  opts?: { acceptPdf?: boolean },
): Promise<File | null> {
  const acceptPdf = opts?.acceptPdf !== false;
  const items = await read();
  for (const item of items) {
    for (const mime of item.types) {
      if (!ALLOWED_EVIDENCE_TYPES.has(mime)) continue;
      if (!acceptPdf && mime === "application/pdf") continue;
      const blob = await item.getType(mime);
      const ext = mime.split("/")[1] || "bin";
      return new File([blob], `pasted.${ext}`, { type: mime });
    }
  }
  return null;
}

/** Paste button click handler: reads the clipboard and routes a
 *  found file to `onUpload`, otherwise calls `onNothingFound`. */
export async function pasteFromClipboard(opts: {
  read: () => Promise<readonly ClipboardItem[]>;
  onUpload: (file: File) => void;
  onNothingFound: () => void;
  acceptPdf?: boolean;
}): Promise<void> {
  let file: File | null = null;
  try {
    file = await readAllowedFileFromClipboard(opts.read, {
      acceptPdf: opts.acceptPdf,
    });
  } catch {
    opts.onNothingFound();
    return;
  }
  if (file) opts.onUpload(file);
  else opts.onNothingFound();
}

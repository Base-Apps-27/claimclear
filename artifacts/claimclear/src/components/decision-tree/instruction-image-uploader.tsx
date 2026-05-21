// Task #784 — restored from the pre-#780 modal editor. Lets an SOP
// author attach a single reference image to a question node's
// instruction block. The runner already surfaces
// `instructionImagePath` next to the question (see player.tsx and
// sop-advance-player.tsx), so we just need to round-trip the path
// through the editor + the storage upload endpoint.
import { useCallback, useState } from "react";
import { Loader2, X } from "lucide-react";
import { EMAIL_MESSAGE_MAX_BYTES } from "@workspace/api-zod";
import {
  ALLOWED_EVIDENCE_TYPES,
  SPREADSHEET_EVIDENCE_TYPES,
  extractClipboardFiles,
} from "./evidence-paste";
import { EvidencePasteUpload } from "./evidence-paste-upload";

export function InstructionImageUploader({
  imagePath,
  imageUrl,
  onUploaded,
  onRemove,
}: {
  imagePath?: string;
  imageUrl?: string;
  onUploaded: (path: string) => void;
  onRemove: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!ALLOWED_EVIDENCE_TYPES.has(file.type) || file.type === "application/pdf") {
        setError("Images only (no PDFs).");
        return;
      }
      if (SPREADSHEET_EVIDENCE_TYPES.has(file.type)) {
        setError("Images only (no spreadsheets).");
        return;
      }
      if (file.size > EMAIL_MESSAGE_MAX_BYTES) {
        setError("Image is larger than the 25 MB cap.");
        return;
      }
      setError(null);
      setPreview(URL.createObjectURL(file));
      setUploading(true);
      try {
        const res = await fetch("/api/storage/uploads", {
          method: "PUT",
          headers: {
            "Content-Type": file.type,
            "x-upload-name": file.name,
          },
          credentials: "include",
          body: file,
        });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        const { objectPath } = (await res.json()) as { objectPath?: string };
        if (!objectPath) throw new Error("Upload response missing objectPath");
        onUploaded(objectPath);
      } catch (e) {
        setPreview(null);
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [onUploaded],
  );

  // The storage path comes back as `/objects/...`; serve it back via
  // the `/api/storage/objects/*` route so cookies/auth ride along.
  const currentSrc =
    preview ||
    (imagePath?.startsWith("/objects/") ? `/api/storage${imagePath}` : imagePath) ||
    (imageUrl?.startsWith("/objects/") ? `/api/storage${imageUrl}` : imageUrl) ||
    null;

  if (currentSrc) {
    return (
      <div className="space-y-1">
        <div className="relative group inline-block">
          <img
            src={currentSrc}
            alt="Instruction reference"
            className="rounded border max-h-28 w-auto"
            data-testid="instruction-image-preview"
          />
          {uploading && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center rounded">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
          )}
          {!uploading && (
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                onRemove();
              }}
              className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Remove instruction image"
              data-testid="instruction-image-remove"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {error && <p className="text-[10px] text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div
        className="flex gap-2"
        tabIndex={0}
        onPaste={(e) =>
          extractClipboardFiles(e.clipboardData, { acceptPdf: false }).forEach(handleFile)
        }
        data-testid="instruction-image-paste-zone"
      >
        <EvidencePasteUpload
          onFile={handleFile}
          acceptPdf={false}
          testIdPrefix="instruction-image"
          uploadLabels={{ empty: "Upload image", more: "Replace" }}
        />
      </div>
      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  );
}

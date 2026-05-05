// Shared Upload + Paste primitive used by every decision-tree surface
// that captures an image (SOP-evidence rows, instruction-image editor).
// Pure UI: `onFile` is the consumer's extension point for persistence,
// and consumers mount their own `onPaste` wrapper around whatever
// surface they want paste-to-upload to apply to.

import * as React from "react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, ClipboardPaste } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  isClipboardReadAvailable,
  pasteFromClipboard,
} from "./evidence-paste";

void React; // JSX runtime: keep React in scope under tsx --test.

export interface EvidencePasteUploadProps {
  /** Called with each selected / pasted File. */
  onFile: (file: File) => void;
  /** When true, both buttons render disabled. */
  disabled?: boolean;
  /** When true, the Upload button switches to its "more" label. */
  hasItems?: boolean;
  /** When false, PDFs are excluded from both the file input accept
   *  list and the paste pipeline. */
  acceptPdf?: boolean;
  /** Test-id prefix. Emits `${prefix}-upload-btn`, `-paste-btn`,
   *  `-file-input`. */
  testIdPrefix: string;
  /** Override for Upload button labels. Defaults to "Upload image" /
   *  "Add another". */
  uploadLabels?: { empty: string; more: string };
}

const DEFAULT_LABELS = { empty: "Upload image", more: "Add another" };

const ACCEPT_WITH_PDF =
  ".png,.jpg,.jpeg,.gif,.webp,.bmp,.tiff,.heic,.heif,.pdf,image/png,image/jpeg,image/gif,image/webp,image/bmp,image/tiff,image/heic,image/heif,application/pdf";
const ACCEPT_IMAGE_ONLY =
  ".png,.jpg,.jpeg,.gif,.webp,.bmp,.tiff,.heic,.heif,image/png,image/jpeg,image/gif,image/webp,image/bmp,image/tiff,image/heic,image/heif";

export function EvidencePasteUpload({
  onFile,
  disabled = false,
  hasItems = false,
  acceptPdf = true,
  testIdPrefix,
  uploadLabels,
}: EvidencePasteUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const clipboardReadAvailable = isClipboardReadAvailable();
  const labels = uploadLabels ?? DEFAULT_LABELS;
  const accept = acceptPdf ? ACCEPT_WITH_PDF : ACCEPT_IMAGE_ONLY;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          if (inputRef.current) inputRef.current.value = "";
        }}
        data-testid={`${testIdPrefix}-file-input`}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="gap-1.5 h-7 text-xs"
        data-testid={`${testIdPrefix}-upload-btn`}
      >
        <Upload className="h-3 w-3" />
        {hasItems ? labels.more : labels.empty}
      </Button>
      {clipboardReadAvailable && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            void pasteFromClipboard({
              read: () => navigator.clipboard.read(),
              onUpload: onFile,
              onNothingFound: () =>
                toast({
                  title: "No image found in clipboard",
                  description:
                    "Copy a screenshot or image first, then paste here.",
                  variant: "destructive",
                }),
              acceptPdf,
            })
          }
          disabled={disabled}
          title="Paste from clipboard (Ctrl/Cmd+V)"
          className="gap-1.5 h-7 text-xs"
          data-testid={`${testIdPrefix}-paste-btn`}
        >
          <ClipboardPaste className="h-3 w-3" />
          Paste
        </Button>
      )}
    </>
  );
}

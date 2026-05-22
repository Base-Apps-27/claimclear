import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, FileText, ImageIcon, Loader2, X } from "lucide-react";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".heic"];
const PDF_EXTENSIONS = [".pdf"];

function getPathFromUrl(url: string): string {
  try {
    return new URL(url, "http://x").pathname.toLowerCase();
  } catch {
    return url.toLowerCase().split("?")[0];
  }
}

function isImageUrl(url: string): boolean {
  const p = getPathFromUrl(url);
  return IMAGE_EXTENSIONS.some(ext => p.endsWith(ext));
}

function isPdfUrl(url: string): boolean {
  const p = getPathFromUrl(url);
  return PDF_EXTENSIONS.some(ext => p.endsWith(ext));
}

function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url, "http://x").pathname;
    const last = path.split("/").filter(Boolean).pop() || url;
    return decodeURIComponent(last);
  } catch {
    const last = url.split("?")[0].split("/").filter(Boolean).pop() || url;
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }
}

// Some evidence URLs are stored as bare `/objects/...` paths and need
// the `/api/storage` prefix to actually resolve. Others are already
// full URLs (e.g. external attachment download URLs from email). This
// helper normalizes both shapes into something the browser can fetch.
function resolveUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("/objects/")) return `/api/storage${url}`;
  return url;
}

export interface EvidencePreviewItem {
  url: string;
  name?: string;
  size?: number | null;
}

interface EvidencePreviewContextValue {
  open: (item: EvidencePreviewItem) => void;
}

const EvidencePreviewContext = createContext<EvidencePreviewContextValue | null>(null);

export function useEvidencePreview(): EvidencePreviewContextValue {
  const ctx = useContext(EvidencePreviewContext);
  if (!ctx) {
    // Safe fallback so components rendered outside the provider (e.g.
    // certain test harnesses) don't crash — they just fall back to
    // opening the file in a new tab like before.
    return {
      open: (item) => {
        if (typeof window !== "undefined") {
          window.open(resolveUrl(item.url), "_blank", "noopener,noreferrer");
        }
      },
    };
  }
  return ctx;
}

export function EvidencePreviewProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<EvidencePreviewItem | null>(null);

  const open = useCallback((next: EvidencePreviewItem) => {
    setItem(next);
  }, []);

  const value = useMemo<EvidencePreviewContextValue>(() => ({ open }), [open]);

  return (
    <EvidencePreviewContext.Provider value={value}>
      {children}
      <EvidencePreviewDialog
        item={item}
        onOpenChange={(o) => {
          if (!o) setItem(null);
        }}
      />
    </EvidencePreviewContext.Provider>
  );
}

interface EvidencePreviewDialogProps {
  item: EvidencePreviewItem | null;
  onOpenChange: (open: boolean) => void;
}

function EvidencePreviewDialog({ item, onOpenChange }: EvidencePreviewDialogProps) {
  const url = item?.url ?? "";
  const resolved = resolveUrl(url);
  const name = item?.name || (url ? fileNameFromUrl(url) : "");
  const image = url ? isImageUrl(url) : false;
  const pdf = url ? isPdfUrl(url) : false;

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl w-[95vw] p-0 gap-0 max-h-[90vh] flex flex-col"
        data-testid="evidence-preview-dialog"
      >
        <DialogHeader className="px-4 py-3 border-b flex-row items-center justify-between space-y-0 gap-3">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2 min-w-0">
            {image ? (
              <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate" title={name}>{name || "Preview"}</span>
          </DialogTitle>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs"
              asChild
              data-testid="evidence-preview-download"
            >
              <a href={resolved} download={name || undefined}>
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs"
              asChild
              data-testid="evidence-preview-open-new-tab"
            >
              <a href={resolved} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Open full page
              </a>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onOpenChange(false)}
              aria-label="Close preview"
              data-testid="evidence-preview-close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto bg-muted/30">
          {item ? (
            <PreviewBody url={resolved} image={image} pdf={pdf} name={name} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ url, image, pdf, name }: { url: string; image: boolean; pdf: boolean; name: string }) {
  const [loading, setLoading] = useState(image || pdf);
  const [errored, setErrored] = useState(false);

  if (image) {
    return (
      <div className="relative flex items-center justify-center p-4 min-h-[40vh]">
        {loading && !errored && (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground absolute" />
        )}
        {errored ? (
          <Unsupported url={url} name={name} message="This image couldn't be loaded." />
        ) : (
          <img
            src={url}
            alt={name}
            className="max-h-[75vh] max-w-full object-contain rounded shadow-sm bg-background"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setErrored(true);
            }}
            data-testid="evidence-preview-image"
          />
        )}
      </div>
    );
  }

  if (pdf) {
    return (
      <div className="relative h-[75vh]">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <iframe
          src={url}
          title={name}
          className="w-full h-full border-0 bg-background"
          onLoad={() => setLoading(false)}
          data-testid="evidence-preview-pdf"
        />
      </div>
    );
  }

  return <Unsupported url={url} name={name} />;
}

function Unsupported({ url, name, message }: { url: string; name: string; message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center min-h-[40vh]">
      <FileText className="h-10 w-10 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">{message || "Preview not available for this file type."}</p>
        <p className="text-xs text-muted-foreground mt-1 break-all">{name}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button asChild variant="default" size="sm" className="gap-1.5">
          <a href={url} download={name || undefined}>
            <Download className="h-3.5 w-3.5" />
            Download
          </a>
        </Button>
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
            Open in new tab
          </a>
        </Button>
      </div>
    </div>
  );
}

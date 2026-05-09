import { FileText, ImageIcon, ExternalLink } from "lucide-react";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".heic"];

function isImageUrl(url: string): boolean {
  try {
    const path = new URL(url, "http://x").pathname.toLowerCase();
    return IMAGE_EXTENSIONS.some(ext => path.endsWith(ext));
  } catch {
    const lower = url.toLowerCase().split("?")[0];
    return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
  }
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface EvidenceFileListProps {
  urls: string[];
  sizeMap?: Map<string, number>;
}

export function EvidenceFileList({ urls, sizeMap }: EvidenceFileListProps) {
  if (urls.length === 0) {
    return <span className="text-red-500 font-medium">No evidence files</span>;
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-green-700 font-medium text-xs">
        {urls.length} file{urls.length === 1 ? "" : "s"} attached
      </span>
      <ul className="flex flex-col gap-1.5">
        {urls.map((url, i) => {
          const name = fileNameFromUrl(url);
          const image = isImageUrl(url);
          const size = sizeMap?.get(url);
          return (
            <li key={`${url}-${i}`} className="flex items-center gap-2 text-sm">
              {image ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0"
                  title={name}
                >
                  <img
                    src={url}
                    alt={name}
                    className="h-10 w-10 object-cover rounded border bg-muted"
                    loading="lazy"
                  />
                </a>
              ) : (
                <div className="h-10 w-10 rounded border bg-muted flex items-center justify-center shrink-0">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline truncate flex items-center gap-1 min-w-0"
                  title={name}
                >
                  {image ? (
                    <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate">{name}</span>
                </a>
                {size != null && size > 0 && (
                  <span className="text-[11px] text-muted-foreground">{formatFileSize(size)}</span>
                )}
              </div>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-primary hover:underline shrink-0"
              >
                View
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

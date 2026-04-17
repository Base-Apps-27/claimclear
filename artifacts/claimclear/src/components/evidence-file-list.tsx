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

interface EvidenceFileListProps {
  urls: string[];
}

export function EvidenceFileList({ urls }: EvidenceFileListProps) {
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
                <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import DOMPurify from "dompurify";
import { useGetClaim, getGetClaimQueryKey, useGetPortalSubmission, getGetPortalSubmissionQueryKey } from "@workspace/api-client-react";
import type { PortalSubmissionResponse } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatCurrency, formatDate } from "@/lib/format";
import { FileText, ExternalLink, ImageIcon, Loader2 } from "lucide-react";

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
    try { return decodeURIComponent(last); } catch { return last; }
  }
}

function extractAttachmentUrls(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map(v => {
        if (typeof v === "string") return v;
        if (v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string") {
          return (v as { url: string }).url;
        }
        return null;
      })
      .filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  return [];
}

function findSizeForUrl(evidenceFiles: unknown, url: string): number | null {
  if (!Array.isArray(evidenceFiles)) return null;
  for (const f of evidenceFiles as Array<unknown>) {
    if (f && typeof f === "object") {
      const obj = f as { url?: unknown; size?: unknown };
      if (obj.url === url && typeof obj.size === "number") return obj.size;
    }
  }
  return null;
}

function formatSize(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  submissionId: number | null;
  initialSubmission?: PortalSubmissionResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SubmissionPreviewDialog({ submissionId, initialSubmission, open, onOpenChange }: Props) {
  const { data: fetched, isLoading: subLoading } = useGetPortalSubmission(submissionId || 0, {
    query: { queryKey: getGetPortalSubmissionQueryKey(submissionId || 0), enabled: !!submissionId && open },
  });
  const submission = fetched ?? initialSubmission ?? null;
  const claimId = submission?.claimId ?? 0;
  const { data: claim } = useGetClaim(claimId, {
    query: { queryKey: getGetClaimQueryKey(claimId), enabled: !!claimId && open },
  });

  const attachments = extractAttachmentUrls(submission?.attachmentUrls);
  const description = submission?.descriptionHtml || "";
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(description);
  const sanitizedHtml = looksLikeHtml
    ? DOMPurify.sanitize(description, {
        ALLOWED_TAGS: ["p", "br", "strong", "em", "u", "b", "i", "ul", "ol", "li", "a", "blockquote", "pre", "code", "h1", "h2", "h3", "h4", "h5", "h6", "span", "div"],
        ALLOWED_ATTR: ["href", "target", "rel"],
      })
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Portal Submission Preview</DialogTitle>
          <DialogDescription>
            Read-only view of exactly what the bot will submit to the MAS portal. No bot session is consumed.
          </DialogDescription>
        </DialogHeader>

        {!submission || subLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading preview...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 overflow-y-auto min-h-0 pr-1">
            <div className="md:col-span-2 space-y-4">
              <div className="rounded-md border p-3 space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Submission</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Conf #</div>
                    <div className="font-mono">{submission.confNumber || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Claim Amount</div>
                    <div className="font-medium">{formatCurrency(submission.claimAmount || "0")}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground">Subject</div>
                    <div>{submission.subject || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Issue Type</div>
                    <div>{submission.issueType || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Invoice #</div>
                    <div className="font-mono">{submission.invoiceNumber || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Service Date</div>
                    <div>{submission.serviceDate || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">GPS Breadcrumbs</div>
                    <div>{submission.gpsBreadcrumbsAvailable || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Requester Email</div>
                    <div className="truncate" title={submission.requesterEmail || ""}>{submission.requesterEmail || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Phone</div>
                    <div>{submission.phoneNumber || "-"}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</div>
                  {submission.descriptionEditorName && (
                    <span className="text-xs text-muted-foreground">Last edited by {submission.descriptionEditorName}</span>
                  )}
                </div>
                {description ? (
                  looksLikeHtml ? (
                    <div
                      className="text-sm leading-relaxed bg-muted/30 rounded p-3 border prose prose-sm max-w-none dark:prose-invert"
                      // Sanitized via DOMPurify above with a strict tag/attr allow-list.
                      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                    />
                  ) : (
                    <div className="text-sm whitespace-pre-wrap leading-relaxed bg-muted/30 rounded p-3 border">
                      {description}
                    </div>
                  )
                ) : (
                  <div className="text-sm text-muted-foreground italic">No description generated yet.</div>
                )}
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Attachments ({attachments.length})
                </div>
                {attachments.length === 0 ? (
                  <div className="text-sm text-muted-foreground italic">No attachments will be uploaded.</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {attachments.map((url, i) => {
                      const name = fileNameFromUrl(url);
                      const image = isImageUrl(url);
                      const size = formatSize(findSizeForUrl(submission.evidenceFiles, url));
                      return (
                        <a
                          key={`${url}-${i}`}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="border rounded-md p-2 hover:bg-accent/40 transition-colors flex flex-col gap-1.5"
                          title={name}
                        >
                          {image ? (
                            <img
                              src={url}
                              alt={name}
                              loading="lazy"
                              className="w-full h-24 object-cover rounded bg-muted"
                            />
                          ) : (
                            <div className="w-full h-24 rounded bg-muted flex items-center justify-center">
                              <FileText className="h-8 w-8 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex items-center gap-1 text-xs min-w-0">
                            {image ? <ImageIcon className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}
                            <span className="truncate flex-1">{name}</span>
                            <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                          </div>
                          {size && <div className="text-[10px] text-muted-foreground">{size}</div>}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-md border p-3 space-y-2 bg-muted/20">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Source Claim
                </div>
                {!claim ? (
                  <div className="text-sm text-muted-foreground italic">Loading claim...</div>
                ) : (
                  <div className="space-y-2 text-sm">
                    <FieldRow label="Conf #" value={claim.confNumber} mono submissionValue={submission.confNumber} />
                    <FieldRow label="Date" value={claim.date ? formatDate(claim.date) : "-"} submissionValue={submission.serviceDate} />
                    <FieldRow label="Ref #" value={claim.refNumber || "-"} mono submissionValue={submission.refNumber} />
                    <FieldRow label="Client #" value={claim.clientNumber || "-"} submissionValue={submission.clientNumber} />
                    <FieldRow label="Car #" value={claim.carNumber || "-"} submissionValue={submission.carNumber} />
                    <FieldRow
                      label="Amount"
                      value={formatCurrency(claim.claimAmount || "0")}
                      submissionValue={submission.claimAmount ? formatCurrency(submission.claimAmount) : null}
                    />
                    <Separator />
                    <div>
                      <div className="text-xs text-muted-foreground">Status</div>
                      <Badge variant="outline">{claim.status}</Badge>
                    </div>
                    {claim.errorTypeName && (
                      <div>
                        <div className="text-xs text-muted-foreground">Error Type</div>
                        <div>{claim.errorTypeName}</div>
                      </div>
                    )}
                    {claim.errorDetails && (
                      <div>
                        <div className="text-xs text-muted-foreground">Error Details</div>
                        <div className="text-xs whitespace-pre-wrap">{claim.errorDetails}</div>
                      </div>
                    )}
                    {submission.disputeReason && (
                      <div>
                        <div className="text-xs text-muted-foreground">Dispute Reason</div>
                        <div className="text-xs whitespace-pre-wrap">{submission.disputeReason}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface FieldRowProps {
  label: string;
  value: string | null | undefined;
  submissionValue?: string | null | undefined;
  mono?: boolean;
}

function FieldRow({ label, value, submissionValue, mono }: FieldRowProps) {
  const mismatch =
    submissionValue != null &&
    value != null &&
    String(submissionValue).trim() !== "" &&
    String(value).trim() !== "" &&
    String(submissionValue).trim() !== String(value).trim() &&
    String(value).trim() !== "-";
  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="text-xs text-muted-foreground">{label}</div>
        {mismatch && (
          <Badge variant="outline" className="h-4 px-1 text-[9px] border-amber-400 text-amber-700 bg-amber-50">
            differs
          </Badge>
        )}
      </div>
      <div className={mono ? "font-mono" : ""}>{value || "-"}</div>
    </div>
  );
}

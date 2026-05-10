import { useMemo } from "react";
import { Link } from "wouter";
import {
  useGetInvoiceGroup,
  getGetInvoiceGroupQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  AttestationPendingExtras,
  InvoiceGroupDetailResponse,
} from "@workspace/api-client-react";
import { Separator } from "@/components/ui/separator";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Section, TonePill } from "@/components/cohesion";
import { formatDateTime } from "@/lib/format";
import {
  buildReattestChecklist,
  renderChecklistAsText,
} from "@/components/whats-next/reattest-instruction-template";
import {
  ExternalLink,
  Mail,
  FileText,
  CircleDashed,
} from "lucide-react";
import { AttestationWizard } from "./attestation-wizard";
import { PerLegRow, type MergedRow } from "./per-leg-row";
import { pickInvoiceNumber } from "./utils";

export interface GroupBucket {
  key: string;
  invoiceGroupId: number | null;
  rows: MergedRow[];
  earliestEnteredAt: string | null;
  pendingCount: number;
  queuedCount: number;
  /** True when any leg in the bucket is denied or non-contestable.
   *  Drives the red "hot" dot on the left rail (Task #650). */
  hasDenialOrNonContestable: boolean;
  /** Most-recent verdictRecordedAt across the bucket when within the
   *  fresh window (30 min). Null otherwise. Drives the blue "just
   *  landed" dot on the left rail (Task #650). */
  freshSinceLandedAt: string | null;
  /** Min `claim.date` across the bucket. Drives the rail's service
   *  date sort + display (Task #650). */
  earliestServiceDate: string | null;
}

export function GroupReviewPane({
  bucket,
  onAdvance,
}: {
  bucket: GroupBucket;
  onAdvance?: () => void;
}) {
  const groupId = bucket.invoiceGroupId;
  const detailQuery = useGetInvoiceGroup(groupId ?? 0, {
    query: {
      queryKey: getGetInvoiceGroupQueryKey(groupId ?? 0),
      enabled: groupId != null,
    },
  });
  const detail: InvoiceGroupDetailResponse | null =
    groupId != null ? detailQuery.data ?? null : null;

  const lastResponse = useMemo(() => {
    let best: AttestationPendingExtras | null = null;
    for (const row of bucket.rows) {
      const ex = row.extras;
      if (!ex?.lastResponseAt) continue;
      if (!best?.lastResponseAt || ex.lastResponseAt > best.lastResponseAt) {
        best = ex;
      }
    }
    return best;
  }, [bucket.rows]);

  const headLeg = bucket.rows[0].claim;
  const invoiceNumber = detail?.invoiceNumber ?? pickInvoiceNumber(headLeg);

  const deniedLegs = useMemo<readonly ClaimResponse[]>(() => {
    const rides = detail?.rides ?? [];
    return rides.filter((r) => r.outcome === "Denied");
  }, [detail]);

  const pendingRename = useMemo(() => {
    const re = /Update the invoice # from #(\S+) to #(\S+?)\./;
    for (const row of bucket.rows) {
      const note = row.claim.attestationNote;
      if (!note) continue;
      const m = note.match(re);
      if (m) return { from: m[1], to: m[2] };
    }
    return null;
  }, [bucket.rows]);

  // Kept (even though the wizard owns the live action surface now)
  // because the persisted-notes disclosure compares each saved note
  // against the live walkthrough text so a queued operator's earlier
  // walkthrough doesn't shadow the current one verbatim.
  const checklist = useMemo(
    () =>
      buildReattestChecklist(
        deniedLegs,
        invoiceNumber ?? null,
        pendingRename,
      ),
    [deniedLegs, invoiceNumber, pendingRename],
  );

  const liveChecklistText = useMemo(
    () => renderChecklistAsText(checklist),
    [checklist],
  );

  const persistedNotes = useMemo(() => {
    const liveTrim = liveChecklistText.trim();
    return bucket.rows
      .map((r) => ({ claim: r.claim, note: r.claim.attestationNote ?? null }))
      .filter((n) => {
        if (!n.note) return false;
        const noteTrim = n.note.trim();
        if (noteTrim.length === 0) return false;
        if (noteTrim === liveTrim) return false;
        if (liveTrim.includes(noteTrim)) return false;
        return true;
      });
  }, [bucket.rows, liveChecklistText]);

  return (
    <div data-testid={`group-review-pane-${bucket.key}`}>
      <Section padded={false}>
        <div className="p-5 space-y-5">
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {pendingRename && (
                  <span data-testid="queue-row-rename-chip">
                    <TonePill tone="purple" className="text-[10px] font-mono">
                      Renamed → #{pendingRename.to}
                    </TonePill>
                  </span>
                )}
              </div>
            </div>
            {groupId != null && (
              <Link
                href={`/invoice-groups/${groupId}`}
                className="text-sm text-primary hover:underline inline-flex items-center gap-1.5 shrink-0"
                data-testid={`group-review-open-${groupId}`}
              >
                Open invoice group <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </header>

          {groupId == null ? (
            <div
              className="rounded-md border border-dashed bg-muted/20 px-3 py-2.5 text-sm text-muted-foreground flex items-start gap-2"
              data-testid="group-orphan-leg-note"
            >
              <CircleDashed className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                This leg isn't tied to an invoice group — confirm it
                individually below.
              </span>
            </div>
          ) : (
            <SkeletonSwap
              loading={detailQuery.isLoading && !detail}
              skeleton={
                <div className="space-y-2" data-testid="group-detail-loading">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              }
            >
              <section data-testid="reattest-instructions">
                <AttestationWizard
                  key={bucket.key}
                  bucket={bucket}
                  detail={detail}
                  invoiceNumber={invoiceNumber}
                  onAdvance={onAdvance ?? (() => {})}
                />
              </section>
            </SkeletonSwap>
          )}

          <Separator />

          {lastResponse?.lastResponseAt ? (
            <div
              className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap"
              data-testid="group-last-response"
            >
              {lastResponse.lastResponseSource === "email" ? (
                <Mail className="h-3.5 w-3.5" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              <span>
                Last payor response · Received{" "}
                {formatDateTime(lastResponse.lastResponseAt)}
                {lastResponse.lastResponseSource
                  ? ` · ${lastResponse.lastResponseSource}`
                  : ""}
                {lastResponse.lastResponseSubject
                  ? ` — ${lastResponse.lastResponseSubject}`
                  : ""}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No payor response on file.
            </p>
          )}

          <details
            className="group rounded-md border bg-muted/20"
            data-testid="wizard-per-leg-disclosure"
          >
            <summary className="cursor-pointer list-none px-3 py-2 text-[11px] uppercase tracking-wide font-bold text-muted-foreground hover:text-foreground flex items-center justify-between gap-2">
              <span>Finish legs individually</span>
              <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground/70 group-open:hidden">
                Show
              </span>
              <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground/70 hidden group-open:inline">
                Hide
              </span>
            </summary>
            <div className="border-t p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Use the per-leg button only when finishing legs individually.
              </p>
              <ul
                className="divide-y rounded-md border bg-card"
                data-testid="group-leg-breakdown"
              >
                {bucket.rows.map((row) => (
                  <PerLegRow
                    key={row.claim.id}
                    row={row}
                    invoiceGroupId={groupId}
                    detail={detail}
                  />
                ))}
              </ul>
            </div>
          </details>

          {persistedNotes.length > 0 && (
            <details
              className="group rounded-md border bg-muted/20"
              data-testid="persisted-attestation-notes"
            >
              <summary className="cursor-pointer list-none px-3 py-2 text-[11px] uppercase tracking-wide font-bold text-muted-foreground hover:text-foreground flex items-center justify-between gap-2">
                <span>Original walkthrough captured when queued</span>
                <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground/70 group-open:hidden">
                  Show
                </span>
                <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground/70 hidden group-open:inline">
                  Hide
                </span>
              </summary>
              <div className="border-t p-3 space-y-2">
                {persistedNotes.map((n) => (
                  <div
                    key={n.claim.id}
                    className="rounded-md border bg-card px-3 py-2.5 text-sm"
                    data-testid={`persisted-note-${n.claim.id}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                      <span className="font-mono font-medium text-foreground">
                        #{n.claim.confNumber}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase tracking-wide font-bold"
                      >
                        {n.claim.outcome}
                      </Badge>
                    </div>
                    <div className="mt-1.5 whitespace-pre-wrap text-foreground/90 leading-5">
                      {n.note}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </Section>
    </div>
  );
}

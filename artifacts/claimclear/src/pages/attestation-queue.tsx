import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useListAttestationPending } from "@workspace/api-client-react";
import type {
  ClaimResponse,
  AttestationPendingExtras,
} from "@workspace/api-client-react";
import { AttestationPrompt } from "@/components/attestation-prompt";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency, formatDate } from "@/lib/format";
import { ShieldCheck, FileText, Mail, ExternalLink } from "lucide-react";

type AttestationState = "pending" | "queued";

/**
 * Admin review surface for off-system re-attestation.
 *
 * Single un-tabbed list (Tasks consolidation). Pending and queued rows
 * share one workspace because they're both "owed off-system" — the
 * difference (whether you parked it for a teammate with portal access,
 * or it's still on you) is shown as a per-row badge instead of a tab.
 *
 * Completed history was retired from this surface — it lives on each
 * claim's detail page in the audit trail.
 *
 * Layout is master/detail: list of items on the left (sorted oldest-
 * first by when they entered the queue) and the full review context
 * on the right, with a single confirm CTA driven by the shared
 * AttestationPrompt component. The same prompt is rendered on the
 * claim-detail page, so the action affordance and copy never drift.
 */
export default function AttestationQueue() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Attestation Queue</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Approved verdicts that still need to be re-attested in the payor portal off-system —
          both the ones still on you and the ones parked for a teammate with portal access.
          Open each claim in the portal, complete the re-attestation, then confirm it here so
          the dashboard and audit trail line up.
        </p>
      </div>
      <QueueWorkspace />
    </div>
  );
}

interface MergedRow {
  state: AttestationState;
  claim: ClaimResponse;
  extras: AttestationPendingExtras | null;
  /** When this row entered the queue — used purely for stable sort. */
  enteredAt: string | null;
}

function QueueWorkspace() {
  // Fire pending + queued in parallel and merge client-side. The
  // backend endpoint takes one state at a time, but the user-facing
  // surface is single-bucket now, so we collapse it here.
  const pending = useListAttestationPending({ state: "pending" });
  const queued = useListAttestationPending({ state: "queued" });

  const isLoading = pending.isLoading || queued.isLoading;

  const rows = useMemo<MergedRow[]>(() => {
    const buildRows = (
      data: typeof pending.data,
      state: AttestationState,
    ): MergedRow[] => {
      const claims = data?.claims ?? [];
      const extrasMap = (data?.extras ?? {}) as Record<string, AttestationPendingExtras>;
      return claims.map((claim) => {
        const ex = extrasMap[String(claim.id)] ?? null;
        // For queued rows, attestationQueuedAt marks the moment they
        // entered this surface. For pending rows the closest analog is
        // the verdict-recorded timestamp (carried in extras).
        const enteredAt =
          state === "queued"
            ? claim.attestationQueuedAt ?? ex?.verdictRecordedAt ?? null
            : ex?.verdictRecordedAt ?? null;
        return { state, claim, extras: ex, enteredAt };
      });
    };
    const merged = [
      ...buildRows(pending.data, "pending"),
      ...buildRows(queued.data, "queued"),
    ];
    // Oldest first so the longest-waiting work bubbles to the top.
    merged.sort((a, b) => {
      const aT = a.enteredAt ? new Date(a.enteredAt).getTime() : 0;
      const bT = b.enteredAt ? new Date(b.enteredAt).getTime() : 0;
      return aT - bT;
    });
    return merged;
  }, [pending.data, queued.data]);

  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Keep the right-pane selection in sync with the visible list. If
  // the selected claim disappears (it just got attested and the lists
  // re-fetched), fall back to the top of the list so the operator
  // never stares at an empty pane.
  useEffect(() => {
    if (rows.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId == null || !rows.some((r) => r.claim.id === selectedId)) {
      setSelectedId(rows[0].claim.id);
    }
  }, [rows, selectedId]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <Skeleton className="h-[480px] w-full" />
        <Skeleton className="h-[480px] w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-2">
          <ShieldCheck className="h-6 w-6 mx-auto text-emerald-500" />
          <p className="font-medium text-sm">All caught up.</p>
          <p className="text-sm text-muted-foreground">
            Nothing waiting on attestation right now.
          </p>
        </CardContent>
      </Card>
    );
  }

  const selectedRow = rows.find((r) => r.claim.id === selectedId) ?? null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
      <Card className="lg:sticky lg:top-4">
        <ScrollArea className="h-[calc(100vh-220px)] max-h-[640px]">
          <ul className="divide-y" data-testid="queue-list">
            {rows.map((row) => {
              const { claim, extras, state } = row;
              const isSel = claim.id === selectedId;
              return (
                <li key={claim.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(claim.id)}
                    className={
                      "w-full text-left px-4 py-3 transition-colors " +
                      (isSel ? "bg-muted" : "hover:bg-muted/50")
                    }
                    data-testid={`queue-row-${claim.id}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium">
                        {claim.confNumber}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {claim.outcome}
                      </Badge>
                      <StateBadge state={state} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                      <InvoiceLine claim={claim} />
                      {extras?.verdictRecordedAt && (
                        <div>Verdict {formatDateTime(extras.verdictRecordedAt)}</div>
                      )}
                      {state === "queued" && claim.attestationQueuedBy && (
                        <div className="truncate">
                          Parked by {claim.attestationQueuedBy}
                          {claim.attestationQueuedAt
                            ? ` · ${formatDateTime(claim.attestationQueuedAt)}`
                            : ""}
                        </div>
                      )}
                      {claim.attestationNote && (
                        <div className="italic truncate">"{claim.attestationNote}"</div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </Card>

      {selectedRow && (
        <ReviewPane
          claim={selectedRow.claim}
          extras={selectedRow.extras}
          state={selectedRow.state}
        />
      )}
    </div>
  );
}

/**
 * Per-row indicator that tells the operator which bucket this claim is
 * in without forcing a tab choice up front. Pending = on you. Queued =
 * parked for the teammate with portal access.
 */
function StateBadge({ state }: { state: AttestationState }) {
  if (state === "pending") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] border-amber-300 bg-amber-50 text-amber-800"
        data-testid="state-badge-pending"
      >
        Owed by you
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-[10px] border-blue-300 bg-blue-50 text-blue-800"
      data-testid="state-badge-queued"
    >
      Parked for portal user
    </Badge>
  );
}

function ReviewPane({
  claim,
  extras,
  state,
}: {
  claim: ClaimResponse;
  extras: AttestationPendingExtras | null;
  state: AttestationState;
}) {
  return (
    <Card data-testid={`review-pane-${claim.id}`}>
      <CardContent className="p-5 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-mono text-lg font-semibold">{claim.confNumber}</h3>
              <Badge variant="outline">{claim.outcome}</Badge>
              <StateBadge state={state} />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {claim.errorTypeName ?? "Unclassified"}
              {claim.date ? ` · Service ${formatDate(claim.date)}` : ""}
            </div>
          </div>
          <Link
            href={`/claims/${claim.id}`}
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            data-testid={`review-pane-open-${claim.id}`}
          >
            Open full claim <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        {/* Context grid */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Field label="Invoice">
            <InvoiceLine claim={claim} />
          </Field>
          <Field label="Verdict recorded">
            {extras?.verdictRecordedAt ? formatDateTime(extras.verdictRecordedAt) : "—"}
          </Field>
          <Field label="Claim amount">
            {claim.claimAmount ? formatCurrency(claim.claimAmount) : "—"}
          </Field>
          <Field label="Approved amount">
            {claim.approvedAmount ? formatCurrency(claim.approvedAmount) : "—"}
          </Field>
          {claim.attestationQueuedBy && (
            <Field label="Parked by">
              {claim.attestationQueuedBy}
              {claim.attestationQueuedAt
                ? ` · ${formatDateTime(claim.attestationQueuedAt)}`
                : ""}
            </Field>
          )}
        </dl>

        {/* Last response */}
        {extras?.lastResponseAt ? (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
              {extras.lastResponseSource === "email" ? (
                <Mail className="h-3.5 w-3.5" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              Last payor response · {formatDateTime(extras.lastResponseAt)}
              {extras.lastResponseSource ? ` · ${extras.lastResponseSource}` : ""}
            </div>
            {extras.lastResponseSubject && (
              <div className="mt-1 truncate">{extras.lastResponseSubject}</div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">
            No payor response recorded for this claim yet.
          </div>
        )}

        {/* Existing attestation note */}
        {claim.attestationNote && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <div className="font-medium text-muted-foreground">Note on file</div>
            <div className="mt-1 whitespace-pre-wrap">{claim.attestationNote}</div>
          </div>
        )}

        {/* Single confirm CTA via the shared prompt */}
        <div className="pt-1">
          <AttestationPrompt claim={claim} compact />
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium truncate">{children}</dd>
    </div>
  );
}

function InvoiceLine({ claim }: { claim: ClaimResponse }) {
  // invoiceNumbers is a single comma- or space-delimited text field on the
  // claim — we display the first one as the headline and a "+N more" suffix
  // when there are several so long lists don't blow out the row.
  const raw = (claim.invoiceNumbers ?? "").trim();
  if (!raw) return <>—</>;
  const parts = raw.split(/[,\s]+/).filter(Boolean);
  if (parts.length <= 1) return <>{raw}</>;
  if (parts.length === 2) return <>{parts.join(", ")}</>;
  return <>{parts[0]} +{parts.length - 1} more</>;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

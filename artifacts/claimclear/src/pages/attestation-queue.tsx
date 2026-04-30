import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useListAttestationPending } from "@workspace/api-client-react";
import type {
  ClaimResponse,
  AttestationPendingExtras,
} from "@workspace/api-client-react";
import { AttestationPrompt } from "@/components/attestation-prompt";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency, formatDate } from "@/lib/format";
import { ShieldCheck, Inbox, Check, FileText, Mail, ExternalLink } from "lucide-react";

type TabKey = "pending" | "queued" | "completed";

const TAB_META: Record<TabKey, { label: string; icon: typeof ShieldCheck; empty: string }> = {
  pending: {
    label: "Pending",
    icon: ShieldCheck,
    empty: "Nothing pending. Approved verdicts will land here as they're recorded.",
  },
  queued: {
    label: "Queued",
    icon: Inbox,
    empty: "Nothing parked. When a teammate marks a claim 'Park for portal user', it shows up here.",
  },
  completed: {
    label: "Recently completed",
    icon: Check,
    empty: "No re-attestations confirmed yet.",
  },
};

/**
 * Admin review surface for off-system re-attestation.
 *
 * Layout is master/detail: a list of items on the left (sorted oldest-first
 * by when they entered the queue) and the full review context for the
 * selected item on the right, with a single confirm CTA driven by the
 * shared AttestationPrompt component. The same prompt is rendered on the
 * claim-detail page, so the action affordance and copy never drift.
 */
export default function AttestationQueue() {
  const [tab, setTab] = useState<TabKey>("queued");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Attestation Queue</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Approved verdicts that still need to be re-attested in the payor portal off-system.
          Pick a claim on the left, open it in the portal, complete the re-attestation, then
          confirm it here so the dashboard and audit trail line up.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="pending" data-testid="tab-pending">
            <ShieldCheck className="h-4 w-4 mr-1.5" /> Pending
          </TabsTrigger>
          <TabsTrigger value="queued" data-testid="tab-queued">
            <Inbox className="h-4 w-4 mr-1.5" /> Queued
          </TabsTrigger>
          <TabsTrigger value="completed" data-testid="tab-completed">
            <Check className="h-4 w-4 mr-1.5" /> Completed
          </TabsTrigger>
        </TabsList>
        {(Object.keys(TAB_META) as TabKey[]).map((key) => (
          <TabsContent key={key} value={key} className="mt-4">
            <QueueWorkspace state={key} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function QueueWorkspace({ state }: { state: TabKey }) {
  const { data, isLoading } = useListAttestationPending({ state });

  const claims = useMemo<ClaimResponse[]>(() => data?.claims ?? [], [data]);
  const extrasMap = (data?.extras ?? {}) as Record<string, AttestationPendingExtras>;

  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Keep the right-pane selection in sync with the visible list. If the
  // selected claim disappears (e.g., it just got attested and the list
  // re-fetched), fall back to the top of the list so the operator never
  // stares at an empty pane.
  useEffect(() => {
    if (claims.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId == null || !claims.some((c) => c.id === selectedId)) {
      setSelectedId(claims[0].id);
    }
  }, [claims, selectedId]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <Skeleton className="h-[480px] w-full" />
        <Skeleton className="h-[480px] w-full" />
      </div>
    );
  }

  if (claims.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {TAB_META[state].empty}
        </CardContent>
      </Card>
    );
  }

  const selectedClaim = claims.find((c) => c.id === selectedId) ?? null;
  const selectedExtras = selectedClaim ? extrasMap[String(selectedClaim.id)] ?? null : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
      <Card className="lg:sticky lg:top-4">
        <ScrollArea className="h-[calc(100vh-220px)] max-h-[640px]">
          <ul className="divide-y" data-testid={`queue-list-${state}`}>
            {claims.map((claim) => {
              const ex = extrasMap[String(claim.id)] ?? null;
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
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">
                        {claim.confNumber}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {claim.outcome}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                      <InvoiceLine claim={claim} />
                      {ex?.verdictRecordedAt && (
                        <div>Verdict {formatDateTime(ex.verdictRecordedAt)}</div>
                      )}
                      {state === "queued" && claim.attestationQueuedBy && (
                        <div className="truncate">
                          Parked by {claim.attestationQueuedBy}
                          {claim.attestationQueuedAt
                            ? ` · ${formatDateTime(claim.attestationQueuedAt)}`
                            : ""}
                        </div>
                      )}
                      {state === "completed" && claim.attestedBy && (
                        <div className="truncate">
                          Confirmed by {claim.attestedBy}
                          {claim.attestedAt ? ` · ${formatDateTime(claim.attestedAt)}` : ""}
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

      {selectedClaim && (
        <ReviewPane claim={selectedClaim} extras={selectedExtras} />
      )}
    </div>
  );
}

function ReviewPane({
  claim,
  extras,
}: {
  claim: ClaimResponse;
  extras: AttestationPendingExtras | null;
}) {
  return (
    <Card data-testid={`review-pane-${claim.id}`}>
      <CardContent className="p-5 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-mono text-lg font-semibold">{claim.confNumber}</h3>
              <Badge variant="outline">{claim.outcome}</Badge>
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
          {claim.attestedBy && (
            <Field label="Confirmed by">
              {claim.attestedBy}
              {claim.attestedAt ? ` · ${formatDateTime(claim.attestedAt)}` : ""}
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

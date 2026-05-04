import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListAttestationPending,
  useGetInvoiceGroupAttestationHistory,
  useGetInvoiceGroup,
  useCompleteGroupReattest,
  useAttestClaim,
  useConfirmQueuedAttestation,
  useCompleteLegMasAction,
  getListAttestationPendingQueryKey,
  getGetInvoiceGroupAttestationHistoryQueryKey,
  getGetInvoiceGroupQueryKey,
  getGetAttestationCountsQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetClaimQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  AttestationPendingExtras,
  GroupAttestationHistoryEntry,
  GroupAttestationHistoryLeg,
  GetInvoiceGroupAttestationHistoryParams,
  InvoiceGroupDetailResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MasActionChecklist } from "@/components/mas-action-checklist";
import { buildReattestChecklist } from "@/components/whats-next/reattest-instruction-template";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useUrlParams } from "@/lib/use-url-params";
import { formatDate } from "@/lib/format";
import {
  ShieldCheck,
  FileText,
  Mail,
  ExternalLink,
  CheckCircle2,
  Clock,
  Ban,
  CircleDashed,
} from "lucide-react";

type AttestationState = "pending" | "queued";
type HistoryRange = NonNullable<GetInvoiceGroupAttestationHistoryParams["range"]>;

const VALID_TABS = ["open", "completed"] as const;
type Tab = typeof VALID_TABS[number];
const VALID_RANGES: readonly HistoryRange[] = ["7d", "30d", "all"];

/**
 * Admin review surface for off-system re-attestation.
 *
 * Two tabs:
 *   * `open` — pending + queued legs that still need an action; the
 *     historical single-list workspace.
 *   * `completed` — invoice groups whose MAS re-attest has already been
 *     stamped, with per-leg outcomes for each ride and a master/detail
 *     pane mirroring the open tab's layout.
 *
 * Tab + range filter are both URL-persisted via wouter (`?tab=…&range=…`)
 * so reload, hot-reload, and shared links all reopen on the same view.
 */
export default function AttestationQueue() {
  const { get, set } = useUrlParams();
  const tabParam = get("tab");
  const activeTab: Tab = (VALID_TABS as readonly string[]).includes(tabParam)
    ? (tabParam as Tab)
    : "open";

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
      <Tabs
        value={activeTab}
        onValueChange={(value) => set({ tab: value === "open" ? null : value }, false)}
      >
        <TabsList data-testid="attestation-tabs">
          <TabsTrigger value="open" data-testid="attestation-tab-open">
            Open
          </TabsTrigger>
          <TabsTrigger value="completed" data-testid="attestation-tab-completed">
            Completed re-attestations
          </TabsTrigger>
        </TabsList>
        <TabsContent value="open" className="mt-4">
          <QueueWorkspace />
        </TabsContent>
        <TabsContent value="completed" className="mt-4">
          <CompletedWorkspace />
        </TabsContent>
      </Tabs>
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

interface GroupBucket {
  /** Stable React key — `g:<groupId>` for grouped rows, `c:<claimId>` for orphans. */
  key: string;
  invoiceGroupId: number | null;
  rows: MergedRow[];
  earliestEnteredAt: string | null;
  pendingCount: number;
  queuedCount: number;
}

/**
 * Aggregate the merged pending+queued legs by `invoiceGroupId`. Legs
 * without a group fall into their own single-leg bucket so the rare
 * orphan case still gets a row instead of being silently dropped.
 * Buckets are sorted oldest-first by their earliest `enteredAt` to
 * preserve the per-leg sort the spec calls out.
 */
function aggregateByGroup(rows: MergedRow[]): GroupBucket[] {
  const byKey = new Map<string, GroupBucket>();
  for (const row of rows) {
    const id = row.claim.invoiceGroupId ?? null;
    const key = id != null ? `g:${id}` : `c:${row.claim.id}`;
    const bucket = byKey.get(key) ?? {
      key,
      invoiceGroupId: id,
      rows: [],
      earliestEnteredAt: null,
      pendingCount: 0,
      queuedCount: 0,
    };
    bucket.rows.push(row);
    if (row.state === "pending") bucket.pendingCount += 1;
    else bucket.queuedCount += 1;
    if (row.enteredAt) {
      const t = new Date(row.enteredAt).getTime();
      if (
        !bucket.earliestEnteredAt ||
        t < new Date(bucket.earliestEnteredAt).getTime()
      ) {
        bucket.earliestEnteredAt = row.enteredAt;
      }
    }
    byKey.set(key, bucket);
  }
  const buckets = [...byKey.values()];
  buckets.sort((a, b) => {
    const aT = a.earliestEnteredAt ? new Date(a.earliestEnteredAt).getTime() : 0;
    const bT = b.earliestEnteredAt ? new Date(b.earliestEnteredAt).getTime() : 0;
    return aT - bT;
  });
  return buckets;
}

function QueueWorkspace() {
  // Fire pending + queued in parallel and merge client-side. The
  // backend endpoint takes one state at a time, but the user-facing
  // surface is single-bucket now, so we collapse it here.
  const pending = useListAttestationPending({ state: "pending" });
  const queued = useListAttestationPending({ state: "queued" });

  const isLoading = pending.isLoading || queued.isLoading;

  const groups = useMemo<GroupBucket[]>(() => {
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
    return aggregateByGroup(merged);
  }, [pending.data, queued.data]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Keep the right-pane selection in sync with the visible list. If
  // the selected group disappears (it just got attested and the lists
  // re-fetched), fall back to the top of the list so the operator
  // never stares at an empty pane.
  useEffect(() => {
    if (groups.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (selectedKey == null || !groups.some((g) => g.key === selectedKey)) {
      setSelectedKey(groups[0].key);
    }
  }, [groups, selectedKey]);

  // SSR pass: useEffect doesn't fire, so derive the effective selection
  // here so the detail pane renders on the first paint. Mirrors the
  // approach used by the Completed tab below.
  const effectiveSelectedKey =
    selectedKey != null && groups.some((g) => g.key === selectedKey)
      ? selectedKey
      : groups[0]?.key ?? null;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <Skeleton className="h-[480px] w-full" />
        <Skeleton className="h-[480px] w-full" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-2">
          <ShieldCheck className="h-6 w-6 mx-auto text-emerald-500" />
          <p className="font-medium text-sm" data-testid="open-empty">
            All caught up.
          </p>
          <p className="text-sm text-muted-foreground">
            Nothing waiting on attestation right now.
          </p>
        </CardContent>
      </Card>
    );
  }

  const selectedGroup = groups.find((g) => g.key === effectiveSelectedKey) ?? null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
      <Card className="lg:sticky lg:top-4">
        <ScrollArea className="h-[calc(100vh-220px)] max-h-[640px]">
          <ul className="divide-y" data-testid="queue-list">
            {groups.map((bucket) => (
              <GroupListRow
                key={bucket.key}
                bucket={bucket}
                isSelected={bucket.key === effectiveSelectedKey}
                onSelect={() => setSelectedKey(bucket.key)}
              />
            ))}
          </ul>
        </ScrollArea>
      </Card>

      {selectedGroup && <GroupReviewPane bucket={selectedGroup} />}
    </div>
  );
}

function GroupListRow({
  bucket,
  isSelected,
  onSelect,
}: {
  bucket: GroupBucket;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const headLeg = bucket.rows[0].claim;
  const invoice = pickInvoiceNumber(headLeg);
  const payor = headLeg.clientNumber ?? "—";
  const legCount = bucket.rows.length;
  const summaryParts: string[] = [];
  if (bucket.pendingCount > 0) {
    summaryParts.push(`${bucket.pendingCount} owed by you`);
  }
  if (bucket.queuedCount > 0) {
    summaryParts.push(`${bucket.queuedCount} parked`);
  }
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={
          "w-full text-left px-4 py-3 transition-colors " +
          (isSelected ? "bg-muted" : "hover:bg-muted/50")
        }
        data-testid={`queue-row-${bucket.key}`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium">{invoice}</span>
          <Badge variant="outline" className="text-[10px]" data-testid={`queue-row-leg-count-${bucket.key}`}>
            {legCount} leg{legCount === 1 ? "" : "s"}
          </Badge>
          <GroupStateBadge
            pending={bucket.pendingCount}
            queued={bucket.queuedCount}
          />
        </div>
        <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
          <div className="truncate">Payor {payor}</div>
          {bucket.earliestEnteredAt && (
            <div>Oldest {formatDateTime(bucket.earliestEnteredAt)}</div>
          )}
          {summaryParts.length > 0 && (
            <div data-testid={`queue-row-summary-${bucket.key}`}>
              {summaryParts.join(" · ")}
            </div>
          )}
        </div>
      </button>
    </li>
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

/**
 * Aggregated state pill for a group row. When the group has both
 * pending and queued legs we render a single mixed-state pill so the
 * operator can see the split at a glance; otherwise we fall back to the
 * single-state pill so the look stays consistent with the rest of the
 * surface.
 */
function GroupStateBadge({
  pending,
  queued,
}: {
  pending: number;
  queued: number;
}) {
  if (pending > 0 && queued > 0) {
    return (
      <Badge
        variant="outline"
        className="text-[10px] border-amber-300 bg-gradient-to-r from-amber-50 to-blue-50 text-amber-900"
        data-testid="state-badge-mixed"
      >
        Owed by you + parked
      </Badge>
    );
  }
  if (pending > 0) return <StateBadge state="pending" />;
  return <StateBadge state="queued" />;
}

function GroupReviewPane({ bucket }: { bucket: GroupBucket }) {
  // For grouped legs we pull the parent group detail so we can derive
  // the live denied-leg list (the persisted attestationNote is a stale
  // snapshot — see the Task #430 scope addition) and feed
  // MasActionChecklist its `rides`. Orphan legs (no invoiceGroupId)
  // skip the fetch and render a degraded single-leg view.
  const groupId = bucket.invoiceGroupId;
  const detailQuery = useGetInvoiceGroup(groupId ?? 0, {
    query: {
      queryKey: getGetInvoiceGroupQueryKey(groupId ?? 0),
      enabled: groupId != null,
    },
  });
  const detail: InvoiceGroupDetailResponse | null =
    groupId != null ? detailQuery.data ?? null : null;

  // Pick the most recent payor response across the legs in this
  // bucket. The per-claim extras already carry the latest hit per
  // claim; one max() over the bucket keeps the umbrella context
  // honest when different legs surface different responses.
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
  const payor = detail?.clientNumber ?? headLeg.clientNumber ?? "—";

  // Live derivation: the instructional walkthrough comes from the
  // current verdict mix, not from `attestationNote` (the persisted
  // snapshot at queue time). Drives buildReattestChecklist directly so
  // the lines on screen always match the actions MasActionChecklist is
  // offering.
  const deniedLegs = useMemo<readonly ClaimResponse[]>(() => {
    const rides = detail?.rides ?? [];
    return rides.filter((r) => r.outcome === "Denied");
  }, [detail]);
  const checklist = useMemo(
    () => buildReattestChecklist(deniedLegs, invoiceNumber ?? null),
    [deniedLegs, invoiceNumber],
  );

  // Persisted notes from queue time — surfaced under a collapsed
  // disclosure so the audit trail is reachable but doesn't compete
  // with the live walkthrough above.
  const persistedNotes = useMemo(
    () =>
      bucket.rows
        .map((r) => ({
          claim: r.claim,
          note: r.claim.attestationNote ?? null,
        }))
        .filter((n) => !!n.note),
    [bucket.rows],
  );

  return (
    <Card data-testid={`group-review-pane-${bucket.key}`}>
      <CardContent className="p-5 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-mono text-lg font-semibold">
                {invoiceNumber || "—"}
              </h3>
              <Badge variant="outline" className="text-[10px]">
                {bucket.rows.length} leg{bucket.rows.length === 1 ? "" : "s"}
              </Badge>
              <GroupStateBadge
                pending={bucket.pendingCount}
                queued={bucket.queuedCount}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Payor {payor}
            </div>
          </div>
          {groupId != null && (
            <Link
              href={`/invoice-groups/${groupId}`}
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              data-testid={`group-review-open-${groupId}`}
            >
              Open invoice group <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>

        {/* Last response context */}
        {lastResponse?.lastResponseAt ? (
          <div
            className="rounded-md border bg-muted/30 px-3 py-2 text-xs"
            data-testid="group-last-response"
          >
            <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
              {lastResponse.lastResponseSource === "email" ? (
                <Mail className="h-3.5 w-3.5" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              Why this is owed · last payor response{" "}
              {formatDateTime(lastResponse.lastResponseAt)}
              {lastResponse.lastResponseSource
                ? ` · ${lastResponse.lastResponseSource}`
                : ""}
            </div>
            {lastResponse.lastResponseSubject && (
              <div className="mt-1 truncate">{lastResponse.lastResponseSubject}</div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">
            No payor response recorded for this group yet.
          </div>
        )}

        {/* Live instructional walkthrough — sourced from current verdict mix */}
        <div data-testid="reattest-instructions">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Steps to take
          </h4>
          <ol className="space-y-1.5 text-sm" data-testid="reattest-instruction-list">
            {checklist.map((item, idx) => (
              <li
                key={item.id}
                className="flex items-start gap-2"
                data-testid={`reattest-instruction-${item.id}`}
              >
                <span className="font-mono text-xs text-muted-foreground mt-0.5 shrink-0">
                  {idx + 1}.
                </span>
                <span>{item.text}</span>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-muted-foreground mt-2">
            Each line above maps to a row below — work top-to-bottom; the
            re-attest box stays gated until every MAS cancel is checked.
          </p>
        </div>

        {/* Action checklist — gated re-attest CTA lives here */}
        {detail ? (
          <GroupActionChecklist detail={detail} bucketKey={bucket.key} />
        ) : groupId == null ? (
          <div className="text-xs text-muted-foreground italic">
            This leg isn't tied to an invoice group — confirm individually below.
          </div>
        ) : detailQuery.isLoading ? (
          <Skeleton className="h-32 w-full" data-testid="group-detail-loading" />
        ) : (
          <div
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
            data-testid="group-detail-error"
          >
            Couldn't load the invoice group's MAS checklist. Open the group
            page for the full controls.
          </div>
        )}

        {/* Per-leg breakdown with the per-leg "Confirm just this leg" affordance */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Legs in this group
          </h4>
          <ul className="space-y-2" data-testid="group-leg-breakdown">
            {bucket.rows.map((row) => (
              <PerLegRow
                key={row.claim.id}
                row={row}
                invoiceGroupId={groupId}
              />
            ))}
          </ul>
        </div>

        {/* Persisted attestation notes — collapsed disclosure */}
        {persistedNotes.length > 0 && (
          <details
            className="text-xs"
            data-testid="persisted-attestation-notes"
          >
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Show original walkthrough captured when this was queued
            </summary>
            <div className="mt-2 space-y-2">
              {persistedNotes.map((n) => (
                <div
                  key={n.claim.id}
                  className="rounded-md border bg-muted/20 px-3 py-2"
                  data-testid={`persisted-note-${n.claim.id}`}
                >
                  <div className="font-mono text-[11px] text-muted-foreground">
                    #{n.claim.confNumber}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap">{n.note}</div>
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function GroupActionChecklist({
  detail,
  bucketKey,
}: {
  detail: InvoiceGroupDetailResponse;
  bucketKey: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const completeReattest = useCompleteGroupReattest();
  const completeLegMas = useCompleteLegMasAction();

  const invalidateAfterMutation = async () => {
    await Promise.all([
      qc.invalidateQueries({
        queryKey: getGetInvoiceGroupQueryKey(detail.id),
      }),
      qc.invalidateQueries({
        queryKey: getListAttestationPendingQueryKey({ state: "pending" }),
      }),
      qc.invalidateQueries({
        queryKey: getListAttestationPendingQueryKey({ state: "queued" }),
      }),
      qc.invalidateQueries({
        queryKey: getGetInvoiceGroupAttestationHistoryQueryKey(),
      }),
      qc.invalidateQueries({ queryKey: getGetAttestationCountsQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
    ]);
  };

  return (
    <div data-testid={`group-action-checklist-${bucketKey}`}>
      <MasActionChecklist
        group={detail}
        onCompleteLegMasAction={async (claimId, body) => {
          await completeLegMas.mutateAsync({ id: claimId, data: body });
          await invalidateAfterMutation();
          toast({
            title: "MAS cancellation recorded",
            description: `Marked claim ${claimId} cancelled in MAS.`,
          });
        }}
        onCompleteGroupReattest={async (body) => {
          const invoiceLabel = detail.invoiceNumber ?? `#${detail.id}`;
          const eligible = (detail.rides ?? []).filter(
            (r) => r.outcome === "Approved" || r.outcome === "Partially Approved",
          );
          const blocked = eligible.filter(
            (r) => r.masActionRequired === "cancel" && r.masActionCompletedAt == null,
          );
          try {
            await completeReattest.mutateAsync({ id: detail.id, data: body });
          } catch (err) {
            const status = (err as { response?: { status?: number } } | null)?.response?.status;
            if (status === 409 && blocked.length > 0) {
              const refs = blocked.map((b) => b.confNumber).join(", ");
              toast({
                variant: "destructive",
                title: "Re-attestation skipped some legs",
                description: `${blocked.length} leg${blocked.length === 1 ? "" : "s"} on ${invoiceLabel} still need a MAS cancel before they can graduate: ${refs}.`,
              });
              return;
            }
            throw err;
          }
          await invalidateAfterMutation();
          const total = eligible.length;
          toast({
            title: "Re-attestation confirmed",
            description: `Confirmed re-attestation for invoice ${invoiceLabel} — ${total} leg${total === 1 ? "" : "s"} graduated.`,
          });
        }}
      />
    </div>
  );
}

function PerLegRow({
  row,
  invoiceGroupId,
}: {
  row: MergedRow;
  invoiceGroupId: number | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const attest = useAttestClaim();
  const confirm = useConfirmQueuedAttestation();
  const { claim, state } = row;

  const busy = attest.isPending || confirm.isPending;

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getGetClaimQueryKey(claim.id) }),
      qc.invalidateQueries({
        queryKey: getListAttestationPendingQueryKey({ state: "pending" }),
      }),
      qc.invalidateQueries({
        queryKey: getListAttestationPendingQueryKey({ state: "queued" }),
      }),
      qc.invalidateQueries({ queryKey: getGetAttestationCountsQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
      ...(invoiceGroupId != null
        ? [
            qc.invalidateQueries({
              queryKey: getGetInvoiceGroupQueryKey(invoiceGroupId),
            }),
          ]
        : []),
    ]);
  };

  const onConfirmJustThisLeg = async () => {
    if (state === "pending") {
      await attest.mutateAsync({ id: claim.id, data: {} });
    } else {
      await confirm.mutateAsync({ id: claim.id, data: {} });
    }
    await invalidate();
    toast({
      title: "Leg confirmed",
      description: `Confirmed re-attestation for ${claim.confNumber}.`,
    });
  };

  return (
    <li
      className="flex items-start gap-3 rounded-md border bg-muted/20 px-3 py-2 text-xs"
      data-testid={`group-leg-row-${claim.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium">{claim.confNumber}</span>
          <Badge variant="outline" className="text-[10px]">
            {claim.outcome}
          </Badge>
          <StateBadge state={state} />
        </div>
        {claim.attestationNote && (
          <div className="text-muted-foreground italic mt-1 break-words">
            "{claim.attestationNote}"
          </div>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-[11px] h-7 px-2 shrink-0"
        onClick={onConfirmJustThisLeg}
        disabled={busy}
        data-testid={`confirm-just-this-leg-${claim.id}`}
      >
        Confirm just this leg
      </Button>
    </li>
  );
}

/** Pull the headline invoice number off a leg, falling back to "—". */
function pickInvoiceNumber(claim: ClaimResponse): string {
  const raw = (claim.invoiceNumbers ?? "").trim();
  if (!raw) return "—";
  const first = raw.split(/[,\s]+/).filter(Boolean)[0];
  return first ?? "—";
}

// ─────────────────────────────────────────────────────────────────────
// Completed re-attestations tab
// ─────────────────────────────────────────────────────────────────────

/**
 * Master/detail history view for invoice groups whose MAS re-attest is
 * already stamped. Mirrors the open-tab layout (left sidebar list,
 * right-pane detail) but renders read-only — no action affordances,
 * since every leg has already moved through the queue.
 *
 * Range is URL-persisted via `?range=7d|30d|all` (default 7d). The
 * selected group is local state only — selection isn't worth a URL
 * round-trip and would race the data refetch when the range changes.
 */
function CompletedWorkspace() {
  const { get, set } = useUrlParams();
  const rangeParam = get("range");
  const range: HistoryRange = (VALID_RANGES as readonly string[]).includes(rangeParam)
    ? (rangeParam as HistoryRange)
    : "7d";

  const history = useGetInvoiceGroupAttestationHistory({ range });
  const groups = history.data?.groups ?? [];
  const truncated = history.data?.truncated ?? false;

  // Lazy initializer so the first SSR pass already has a selected
  // group; useEffect fix-up below picks up subsequent data churn
  // (range change, refetch evicting the prior selection, etc).
  const [selectedId, setSelectedId] = useState<number | null>(
    () => groups[0]?.group.id ?? null,
  );
  useEffect(() => {
    if (groups.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (selectedId == null || !groups.some((g) => g.group.id === selectedId)) {
      setSelectedId(groups[0].group.id);
    }
  }, [groups, selectedId]);
  // SSR pass: if the lazy initializer ran with an empty list and the
  // first non-empty data arrives via a synchronous re-render path, the
  // useEffect above still corrects state. But during pure SSR (no
  // effects fire), we want to render the first group immediately even
  // when state was set during the first render. Compute the effective
  // selection here so the detail pane renders on the SSR pass.
  const effectiveSelectedId =
    selectedId != null && groups.some((g) => g.group.id === selectedId)
      ? selectedId
      : groups[0]?.group.id ?? null;

  return (
    <div className="space-y-3" data-testid="completed-workspace">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">
          Invoice groups whose MAS re-attestation has been confirmed in the
          window below. Read-only — open the claim or group page to see the
          full audit trail.
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="completed-range"
            className="text-xs text-muted-foreground"
          >
            Window
          </label>
          <Select
            value={range}
            onValueChange={(v) => set({ range: v === "7d" ? null : v }, false)}
          >
            <SelectTrigger
              id="completed-range"
              className="w-[140px] h-8 text-xs"
              data-testid="completed-range-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d" data-testid="completed-range-7d">
                Last 7 days
              </SelectItem>
              <SelectItem value="30d" data-testid="completed-range-30d">
                Last 30 days
              </SelectItem>
              <SelectItem value="all" data-testid="completed-range-all">
                All time
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {history.isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          <Skeleton className="h-[480px] w-full" />
          <Skeleton className="h-[480px] w-full" />
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <ShieldCheck className="h-6 w-6 mx-auto text-emerald-500" />
            <p className="font-medium text-sm" data-testid="completed-empty">
              {range === "all"
                ? "No completed re-attestations on file."
                : `No completed re-attestations in the last ${range === "30d" ? "30 days" : "7 days"}.`}
            </p>
            {range !== "all" && (
              <p className="text-sm text-muted-foreground">
                Try widening the range with the selector above.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <CompletedMasterDetail
          groups={groups}
          truncated={truncated}
          selectedId={effectiveSelectedId}
          onSelect={setSelectedId}
        />
      )}
    </div>
  );
}

function CompletedMasterDetail({
  groups,
  truncated,
  selectedId,
  onSelect,
}: {
  groups: GroupAttestationHistoryEntry[];
  truncated: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const selected = groups.find((g) => g.group.id === selectedId) ?? null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
      <Card className="lg:sticky lg:top-4">
        <ScrollArea className="h-[calc(100vh-260px)] max-h-[640px]">
          <ul className="divide-y" data-testid="completed-list">
            {groups.map((entry) => {
              const isSel = entry.group.id === selectedId;
              return (
                <li key={entry.group.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(entry.group.id)}
                    className={
                      "w-full text-left px-4 py-3 transition-colors " +
                      (isSel ? "bg-muted" : "hover:bg-muted/50")
                    }
                    data-testid={`completed-row-${entry.group.id}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium">
                        {entry.group.invoiceNumber}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] border-emerald-300 bg-emerald-50 text-emerald-800"
                      >
                        Re-attested
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                      <div className="truncate">
                        Payor {entry.group.clientNumber ?? "—"}
                        {" · "}
                        {entry.legs.length} leg{entry.legs.length === 1 ? "" : "s"}
                      </div>
                      <div>
                        Earliest service {formatDate(earliestServiceDate(entry.legs))}
                      </div>
                      {entry.group.reattestCompletedAt && (
                        <div>
                          Confirmed {formatDateTime(entry.group.reattestCompletedAt)}
                        </div>
                      )}
                      {entry.group.reattestCompletedBy && (
                        <div className="truncate">
                          by {entry.group.reattestCompletedBy}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
        {truncated && (
          <div
            className="border-t px-4 py-2 text-xs text-muted-foreground"
            data-testid="completed-truncated-banner"
          >
            Showing the 200 most recent. Narrow the range to see fewer.
          </div>
        )}
      </Card>
      {selected && <CompletedDetailPane entry={selected} />}
    </div>
  );
}

function CompletedDetailPane({ entry }: { entry: GroupAttestationHistoryEntry }) {
  const { group, legs } = entry;
  return (
    <Card data-testid={`completed-detail-${group.id}`}>
      <CardContent className="p-5 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-mono text-lg font-semibold">{group.invoiceNumber}</h3>
              <Badge
                variant="outline"
                className="border-emerald-300 bg-emerald-50 text-emerald-800"
              >
                Re-attested
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Payor {group.clientNumber ?? "—"}
              {" · "}
              {group.errorTypeName ?? "Unclassified"}
            </div>
          </div>
          <Link
            href={`/invoice-groups/${group.id}`}
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            data-testid={`completed-detail-open-${group.id}`}
          >
            Open invoice group <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Field label="Payor">{group.clientNumber ?? "—"}</Field>
          <Field label="Earliest service">{formatDate(earliestServiceDate(legs))}</Field>
          <Field label="Confirmed">
            {group.reattestCompletedAt ? formatDateTime(group.reattestCompletedAt) : "—"}
          </Field>
          <Field label="Confirmed by">
            {group.reattestCompletedBy ?? "—"}
          </Field>
        </dl>

        {group.reattestNote && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <div className="font-medium text-muted-foreground">Re-attest note</div>
            <div className="mt-1 whitespace-pre-wrap">{group.reattestNote}</div>
          </div>
        )}

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Per-leg outcomes
          </h4>
          <ul className="space-y-2" data-testid="completed-legs">
            {legs.map((leg) => (
              <CompletedLegRow key={leg.claim.id} leg={leg} />
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function CompletedLegRow({ leg }: { leg: GroupAttestationHistoryLeg }) {
  const { claim, attestationOutcome, outcomeAt, outcomeBy, outcomeNote } = leg;
  const meta = OUTCOME_META[attestationOutcome];
  const Icon = meta.icon;
  return (
    <li
      className={`flex items-start gap-3 rounded-md border ${meta.bg} px-3 py-2 text-xs`}
      data-testid={`completed-leg-${claim.id}`}
    >
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${meta.iconClass}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium">{claim.confNumber}</span>
          <Badge variant="outline" className="text-[10px]">
            {claim.outcome}
          </Badge>
          <Badge
            variant="outline"
            className={`text-[10px] ${meta.badge}`}
            data-testid={`completed-leg-outcome-${claim.id}`}
          >
            {meta.label}
          </Badge>
        </div>
        <div className="text-muted-foreground mt-1 space-y-0.5">
          {outcomeAt && (
            <div>
              {meta.timeLabel} {formatDateTime(outcomeAt)}
              {outcomeBy ? ` · ${outcomeBy}` : ""}
            </div>
          )}
          {outcomeNote && (
            <div className="italic break-words">"{outcomeNote}"</div>
          )}
        </div>
      </div>
      <Link
        href={`/claims/${claim.id}`}
        className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 shrink-0"
        data-testid={`completed-leg-open-${claim.id}`}
      >
        Open <ExternalLink className="h-3 w-3" />
      </Link>
    </li>
  );
}

const OUTCOME_META: Record<
  GroupAttestationHistoryLeg["attestationOutcome"],
  {
    label: string;
    timeLabel: string;
    icon: typeof CheckCircle2;
    iconClass: string;
    bg: string;
    badge: string;
  }
> = {
  attested: {
    label: "Re-attested",
    timeLabel: "Attested",
    icon: CheckCircle2,
    iconClass: "text-emerald-700",
    bg: "border-emerald-200 bg-emerald-50",
    badge: "border-emerald-300 bg-white/60 text-emerald-800",
  },
  mas_cancelled: {
    label: "MAS cancelled",
    timeLabel: "Cancelled",
    icon: Ban,
    iconClass: "text-rose-700",
    bg: "border-rose-200 bg-rose-50",
    badge: "border-rose-300 bg-white/60 text-rose-800",
  },
  queued: {
    label: "Queued for portal user",
    timeLabel: "Queued",
    icon: Clock,
    iconClass: "text-blue-700",
    bg: "border-blue-200 bg-blue-50",
    badge: "border-blue-300 bg-white/60 text-blue-800",
  },
  not_required: {
    label: "Not required",
    timeLabel: "—",
    icon: CircleDashed,
    iconClass: "text-muted-foreground",
    bg: "border-muted bg-muted/30",
    badge: "border-muted-foreground/20 text-muted-foreground",
  },
};

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

function earliestServiceDate(legs: GroupAttestationHistoryLeg[]): string | null {
  let earliest: string | null = null;
  for (const leg of legs) {
    const d = leg.claim.date ?? null;
    if (!d) continue;
    if (!earliest || d < earliest) earliest = d;
  }
  return earliest;
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

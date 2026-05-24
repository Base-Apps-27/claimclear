import { useEffect, useMemo, useRef, useState } from "react";
import {
  useListAttestationPending,
  getExportAttestationPendingCsvUrl,
} from "@workspace/api-client-react";
import { ExportCsvControl } from "@/components/export-csv-control";
import { buildCsvFilename } from "@/lib/csv-export-filename";
import { useRowSettle } from "@/hooks/use-row-settle";
import type {
  ClaimResponse,
  AttestationPendingExtras,
} from "@workspace/api-client-react";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { ShieldCheck } from "lucide-react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useUrlParams } from "@/lib/use-url-params";
import { MasterDetailShell } from "./master-detail-shell";
import { QueueSidebar } from "./queue-sidebar";
import { QueueRow } from "./queue-row";
import { GroupReviewPane, type GroupBucket } from "./group-review-pane";
import { type MergedRow, type AttestationState } from "./per-leg-row";
import {
  pickInvoiceNumber,
  formatServiceDateShort,
  isFreshSince,
} from "./utils";

type SortMode = "service-asc" | "service-desc";
const VALID_SORTS: readonly SortMode[] = ["service-asc", "service-desc"];

function aggregateByGroup(rows: MergedRow[], now: Date = new Date()): GroupBucket[] {
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
      hasDenialOrNonContestable: false,
      freshSinceLandedAt: null,
      earliestServiceDate: null,
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
    // Variant B aggregations (Task #650).
    if (
      row.claim.outcome === "Denied" ||
      row.claim.sopOutcome === "cannot_dispute"
    ) {
      bucket.hasDenialOrNonContestable = true;
    }
    const verdict = row.extras?.verdictRecordedAt ?? null;
    if (verdict) {
      const verdictIso =
        typeof verdict === "string" ? verdict : new Date(verdict).toISOString();
      if (isFreshSince(verdictIso, now)) {
        if (
          !bucket.freshSinceLandedAt ||
          verdictIso > bucket.freshSinceLandedAt
        ) {
          bucket.freshSinceLandedAt = verdictIso;
        }
      }
    }
    const svc = row.claim.date ?? null;
    if (svc) {
      if (!bucket.earliestServiceDate || svc < bucket.earliestServiceDate) {
        bucket.earliestServiceDate = svc;
      }
    }
    byKey.set(key, bucket);
  }
  return [...byKey.values()];
}

function sortBuckets(buckets: GroupBucket[], mode: SortMode): GroupBucket[] {
  const copy = [...buckets];
  copy.sort((a, b) => {
    const aSvc = a.earliestServiceDate;
    const bSvc = b.earliestServiceDate;
    // Nulls sink to the bottom regardless of direction so a missing
    // service date never wins the sort ordering.
    if (aSvc && !bSvc) return -1;
    if (!aSvc && bSvc) return 1;
    if (aSvc && bSvc && aSvc !== bSvc) {
      return mode === "service-asc"
        ? aSvc.localeCompare(bSvc)
        : bSvc.localeCompare(aSvc);
    }
    // Tie-break on entered-at to preserve the existing chronological
    // ordering for buckets without a service date on file.
    const aT = a.earliestEnteredAt
      ? new Date(a.earliestEnteredAt).getTime()
      : 0;
    const bT = b.earliestEnteredAt
      ? new Date(b.earliestEnteredAt).getTime()
      : 0;
    return aT - bT;
  });
  return copy;
}

export function QueueWorkspace() {
  const { get, set } = useUrlParams();
  const groupParam = get("group");
  const sortParam = get("sort");
  const sort: SortMode = (VALID_SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as SortMode)
    : "service-asc";

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
      return claims.map((claim: ClaimResponse) => {
        const ex = extrasMap[String(claim.id)] ?? null;
        const enteredAt =
          state === "queued"
            ? claim.attestationQueuedAt ?? ex?.verdictRecordedAt ?? null
            : ex?.verdictRecordedAt ?? null;
        return {
          state,
          claim,
          extras: ex,
          enteredAt:
            typeof enteredAt === "string"
              ? enteredAt
              : enteredAt
                ? new Date(enteredAt as unknown as string).toISOString()
                : null,
        };
      });
    };
    const merged = [
      ...buildRows(pending.data, "pending"),
      ...buildRows(queued.data, "queued"),
    ];
    return sortBuckets(aggregateByGroup(merged), sort);
  }, [pending.data, queued.data, sort]);

  // Task #893 — the subhead under the Queue header used to read
  // "{N} items pending" (raw leg count), which contradicted the
  // group-based headline number directly above it. Switch to a
  // groups-based label so the two read consistently.
  const totalPendingGroups = groups.length;

  const [selectedKey, setSelectedKey] = useState<string | null>(
    groupParam || null,
  );
  // Tracks whether the operator has explicitly clicked a row; drives
  // the "Next up" tag visibility on the top row (Task #650).
  const [hasUserSelected, setHasUserSelected] = useState<boolean>(
    Boolean(groupParam),
  );

  // Remember the prior list + chosen key so that when the selected
  // bucket disappears (re-attest / queue / closure) we can advance
  // selection to the *adjacent* bucket in the prior sort order rather
  // than snapping back to the top of the list.
  const prevGroupsRef = useRef<GroupBucket[]>(groups);
  const prevSelectedRef = useRef<string | null>(selectedKey);

  useEffect(() => {
    if (groups.length === 0) {
      setSelectedKey(null);
      prevGroupsRef.current = groups;
      prevSelectedRef.current = null;
      return;
    }
    const stillThere =
      selectedKey != null && groups.some((g) => g.key === selectedKey);
    if (!stillThere) {
      const prevList = prevGroupsRef.current;
      const prevKey = prevSelectedRef.current;
      let nextKey: string | null = null;
      if (prevKey != null) {
        const prevIdx = prevList.findIndex((g) => g.key === prevKey);
        if (prevIdx >= 0) {
          for (let i = prevIdx + 1; i < prevList.length; i += 1) {
            if (groups.some((g) => g.key === prevList[i].key)) {
              nextKey = prevList[i].key;
              break;
            }
          }
          if (nextKey == null) {
            for (let i = prevIdx - 1; i >= 0; i -= 1) {
              if (groups.some((g) => g.key === prevList[i].key)) {
                nextKey = prevList[i].key;
                break;
              }
            }
          }
        }
      }
      setSelectedKey(nextKey ?? groups[0].key);
    }
    prevGroupsRef.current = groups;
    prevSelectedRef.current = stillThere ? selectedKey : selectedKey;
  }, [groups, selectedKey]);

  const effectiveSelectedKey =
    (groupParam && groups.some((g) => g.key === groupParam))
      ? groupParam
      : selectedKey != null && groups.some((g) => g.key === selectedKey)
        ? selectedKey
        : groups[0]?.key ?? null;

  // Keep prevSelectedRef tracking the *current* effective selection so
  // the adjacency lookup above works on the next bucket-removal pass.
  useEffect(() => {
    prevSelectedRef.current = effectiveSelectedKey;
  }, [effectiveSelectedKey]);

  const onSelect = (key: string) => {
    setSelectedKey(key);
    setHasUserSelected(true);
    set({ group: key }, false);
  };

  const onSortChange = (next: SortMode) => {
    set({ sort: next }, false);
  };

  // Task #490 — soften bucket removal. When the operator clears the
  // selected bucket (re-attest / queue / closure) the row holds its
  // slot for ~360ms while the success-tint settle plays, then unmounts
  // and the auto-advanced bucket gets a brief highlight ring.
  const settle = useRowSettle(
    groups,
    (g) => g.key,
    effectiveSelectedKey,
  );

  const selectedGroup = groups.find((g) => g.key === effectiveSelectedKey) ?? null;

  return (
    <SkeletonSwap
      loading={isLoading}
      skeleton={
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          <Skeleton className="h-[480px] w-full" />
          <Skeleton className="h-[480px] w-full" />
        </div>
      }
    >
      {groups.length === 0 ? (
        <div className="rounded-md border border-border bg-card">
          <EmptyState
            icon={ShieldCheck}
            title="All caught up."
            description="Legs land here once you mark MAS re-attest complete on the invoice."
          />
          <span data-testid="open-empty" className="sr-only">
            All caught up.
          </span>
        </div>
      ) : (
    <MasterDetailShell
      sidebar={
        <QueueSidebar
          title="Queue"
          count={groups.length}
          listTestId="queue-list"
          subhead={
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span
                className="text-xs text-muted-foreground"
                data-testid="queue-pending-total"
              >
                {totalPendingGroups} group{totalPendingGroups === 1 ? "" : "s"}{" "}
                pending
              </span>
              <ExportCsvControl
                testIdPrefix="attestation-export-csv"
                buildUrl={(allFields) =>
                  getExportAttestationPendingCsvUrl({
                    sort,
                    allFields: allFields || undefined,
                    filename: buildCsvFilename("attestation-open", [
                      `sort${sort === "service-desc" ? "Desc" : "Asc"}`,
                    ]),
                  })
                }
                buildFilename={(allFields) =>
                  buildCsvFilename("attestation-open", [
                    `sort${sort === "service-desc" ? "Desc" : "Asc"}`,
                    allFields ? "allFields" : null,
                  ])
                }
              />
              <Select
                value={sort}
                onValueChange={(v) => onSortChange(v as SortMode)}
              >
                <SelectTrigger
                  className="h-7 text-xs w-[210px]"
                  data-testid="queue-sort-select"
                  aria-label="Sort buckets"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="service-asc"
                    data-testid="queue-sort-service-asc"
                  >
                    Sort: Service date (oldest first)
                  </SelectItem>
                  <SelectItem
                    value="service-desc"
                    data-testid="queue-sort-service-desc"
                  >
                    Sort: Service date (newest first)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
        >
          {settle.slots.map((slot, idx) => {
            const bucket = slot.item;
            const headLeg = bucket.rows[0].claim;
            const invoice = pickInvoiceNumber(headLeg);
            const serviceLabel = formatServiceDateShort(
              bucket.earliestServiceDate,
            );
            return (
              <QueueRow
                key={bucket.key}
                rowKey={bucket.key}
                invoiceNumber={invoice}
                legCount={bucket.rows.length}
                legCountTestId={`queue-row-leg-count-${bucket.key}`}
                rowTestId={`queue-row-${bucket.key}`}
                isSelected={bucket.key === effectiveSelectedKey}
                onSelect={() => onSelect(bucket.key)}
                enteredAt={bucket.earliestEnteredAt}
                isSettling={slot.isSettling}
                isJustSelected={settle.isJustSelected(bucket.key)}
                pendingCount={bucket.pendingCount + bucket.queuedCount}
                pendingCountTestId={`queue-row-pending-count-${bucket.key}`}
                serviceDateLabel={serviceLabel}
                serviceDateTestId={`queue-row-service-date-${bucket.key}`}
                isHot={bucket.hasDenialOrNonContestable}
                hotDotTestId={`queue-row-hot-dot-${bucket.key}`}
                isFresh={Boolean(bucket.freshSinceLandedAt)}
                freshDotTestId={`queue-row-fresh-dot-${bucket.key}`}
                isNextUp={!hasUserSelected && idx === 0 && !slot.isSettling}
              />
            );
          })}
        </QueueSidebar>
      }
      detail={
        selectedGroup && (
          <GroupReviewPane
            bucket={selectedGroup}
            onAdvance={() => {
              const idx = groups.findIndex(
                (g) => g.key === selectedGroup.key,
              );
              const next = groups[idx + 1] ?? groups[idx - 1] ?? null;
              if (next) onSelect(next.key);
            }}
          />
        )
      }
    />
      )}
    </SkeletonSwap>
  );
}

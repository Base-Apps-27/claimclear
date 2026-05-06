import { useEffect, useMemo, useState } from "react";
import {
  useListAttestationPending,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  AttestationPendingExtras,
} from "@workspace/api-client-react";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { StatusPill } from "@/components/cohesion";
import { ShieldCheck } from "lucide-react";
import { useUrlParams } from "@/lib/use-url-params";
import { MasterDetailShell } from "./master-detail-shell";
import { QueueSidebar } from "./queue-sidebar";
import { QueueRow } from "./queue-row";
import { GroupReviewPane, type GroupBucket } from "./group-review-pane";
import { type MergedRow, type AttestationState } from "./per-leg-row";
import { pickInvoiceNumber } from "./utils";

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

export function QueueWorkspace() {
  const { get, set } = useUrlParams();
  const groupParam = get("group");

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
        return { state, claim, extras: ex, enteredAt };
      });
    };
    const merged = [
      ...buildRows(pending.data, "pending"),
      ...buildRows(queued.data, "queued"),
    ];
    return aggregateByGroup(merged);
  }, [pending.data, queued.data]);

  const [selectedKey, setSelectedKey] = useState<string | null>(
    groupParam || null,
  );

  useEffect(() => {
    if (groups.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (selectedKey == null || !groups.some((g) => g.key === selectedKey)) {
      setSelectedKey(groups[0].key);
    }
  }, [groups, selectedKey]);

  const effectiveSelectedKey =
    (groupParam && groups.some((g) => g.key === groupParam))
      ? groupParam
      : selectedKey != null && groups.some((g) => g.key === selectedKey)
        ? selectedKey
        : groups[0]?.key ?? null;

  const selectedGroup = groups.find((g) => g.key === effectiveSelectedKey) ?? null;

  const onSelect = (key: string) => {
    setSelectedKey(key);
    set({ group: key }, false);
  };

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
            description="Nothing waiting on attestation right now."
          />
          <span data-testid="open-empty" className="sr-only">
            All caught up.
          </span>
        </div>
      ) : (
    <MasterDetailShell
      sidebar={
        <QueueSidebar title="Queue" count={groups.length} listTestId="queue-list">
          {groups.map((bucket) => {
            const headLeg = bucket.rows[0].claim;
            const invoice = pickInvoiceNumber(headLeg);
            const payor = headLeg.clientNumber ?? "—";
            const tone =
              bucket.pendingCount > 0 ? "amber" : "blue";
            const pillLabel =
              bucket.pendingCount > 0
                ? `${bucket.pendingCount} owed by you`
                : `${bucket.queuedCount} parked`;
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
                middleLine={
                  <>
                    <span className="truncate">Payor {payor}</span>
                    <span data-testid={`queue-row-summary-${bucket.key}`}>
                      <StatusPill tone={tone} className="text-[10px] uppercase tracking-wide font-bold">
                        {pillLabel}
                      </StatusPill>
                    </span>
                  </>
                }
              />
            );
          })}
        </QueueSidebar>
      }
      detail={selectedGroup && <GroupReviewPane bucket={selectedGroup} />}
    />
      )}
    </SkeletonSwap>
  );
}

import { useEffect, useState } from "react";
import {
  useGetInvoiceGroupAttestationHistory,
} from "@workspace/api-client-react";
import type {
  GroupAttestationHistoryEntry,
} from "@workspace/api-client-react";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Section, TonePill } from "@/components/cohesion";
import { ShieldCheck } from "lucide-react";
import { useUrlParams } from "@/lib/use-url-params";
import { formatDate, formatDateTime } from "@/lib/format";
import { MasterDetailShell } from "./master-detail-shell";
import { QueueSidebar } from "./queue-sidebar";
import { QueueRow } from "./queue-row";
import {
  CompletedDetailPane,
  earliestServiceDate,
} from "./completed-detail-pane";

export function CompletedWorkspace() {
  const { get, set } = useUrlParams();
  const groupParam = get("group");

  // Task #893 — the trailing time-window filter (7d / 30d / all) was
  // dropped: the Completed tab now always shows every completed
  // re-attestation on file so the tab badge matches what the operator
  // sees and an older completion never silently disappears.
  const history = useGetInvoiceGroupAttestationHistory();
  const groups = history.data?.groups ?? [];
  const truncated = history.data?.truncated ?? false;

  const initialFromUrl = (() => {
    if (!groupParam) return null;
    const n = Number(groupParam);
    return Number.isFinite(n) ? n : null;
  })();
  const [selectedId, setSelectedId] = useState<number | null>(
    () => initialFromUrl ?? groups[0]?.group.id ?? null,
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

  const effectiveSelectedId =
    initialFromUrl != null && groups.some((g) => g.group.id === initialFromUrl)
      ? initialFromUrl
      : selectedId != null && groups.some((g) => g.group.id === selectedId)
        ? selectedId
        : groups[0]?.group.id ?? null;

  return (
    <div className="space-y-4" data-testid="completed-workspace">
      <Section title="Completed re-attestations">
        <p className="text-sm text-muted-foreground">
          Every invoice group whose MAS re-attestation has been confirmed,
          most-recent first.
        </p>
      </Section>

      <SkeletonSwap
        loading={history.isLoading}
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
              title="No completed re-attestations on file."
            />
            <span data-testid="completed-empty" className="sr-only">
              No completed re-attestations on file.
            </span>
          </div>
        ) : (
          <CompletedMasterDetail
            groups={groups}
            truncated={truncated}
            selectedId={effectiveSelectedId}
            onSelect={(id) => {
              setSelectedId(id);
              set({ group: String(id) }, false);
            }}
          />
        )}
      </SkeletonSwap>
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
    <MasterDetailShell
      sidebar={
        <QueueSidebar
          title="Completed re-attestations"
          count={groups.length}
          listTestId="completed-list"
          footer={
            truncated ? (
              <div
                className="border-t px-4 py-2 text-xs text-muted-foreground"
                data-testid="completed-truncated-banner"
              >
                Showing the 200 most recent.
              </div>
            ) : null
          }
        >
          {groups.map((entry) => (
            <QueueRow
              key={entry.group.id}
              rowKey={String(entry.group.id)}
              invoiceNumber={entry.group.invoiceNumber}
              legCount={entry.legs.length}
              rowTestId={`completed-row-${entry.group.id}`}
              isSelected={entry.group.id === selectedId}
              onSelect={() => onSelect(entry.group.id)}
              selectedTone="green"
              middleLine={
                <>
                  <span className="truncate">
                    Payor {entry.group.clientNumber ?? "—"}
                  </span>
                  <TonePill tone="green" className="text-[10px] uppercase tracking-wide font-bold">
                    Re-attested
                  </TonePill>
                </>
              }
              bottomLine={
                <span>
                  Earliest service{" "}
                  {formatDate(earliestServiceDate(entry.legs))}
                  {entry.group.reattestCompletedAt
                    ? ` · ${formatDateTime(entry.group.reattestCompletedAt)}`
                    : ""}
                </span>
              }
            />
          ))}
        </QueueSidebar>
      }
      detail={selected ? <CompletedDetailPane entry={selected} /> : null}
    />
  );
}

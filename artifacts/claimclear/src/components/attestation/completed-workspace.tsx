import { useEffect, useState } from "react";
import {
  useGetInvoiceGroupAttestationHistory,
} from "@workspace/api-client-react";
import type {
  GroupAttestationHistoryEntry,
  GetInvoiceGroupAttestationHistoryParams,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Section, StatusPill } from "@/components/cohesion";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
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

type HistoryRange = NonNullable<GetInvoiceGroupAttestationHistoryParams["range"]>;
const VALID_RANGES: readonly HistoryRange[] = ["7d", "30d", "all"];

export function CompletedWorkspace() {
  const { get, set } = useUrlParams();
  const rangeParam = get("range");
  const range: HistoryRange = (VALID_RANGES as readonly string[]).includes(rangeParam)
    ? (rangeParam as HistoryRange)
    : "7d";
  const groupParam = get("group");

  const history = useGetInvoiceGroupAttestationHistory({ range });
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
      <Section
        title="Window"
        action={
          <Select
            value={range}
            onValueChange={(v) =>
              set({ range: v === "7d" ? null : v }, false)
            }
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
        }
      >
        <p className="text-sm text-muted-foreground">
          Invoice groups whose MAS re-attestation has been confirmed in the
          window above.
        </p>
      </Section>

      {history.isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          <Skeleton className="h-[480px] w-full" />
          <Skeleton className="h-[480px] w-full" />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-md border border-border bg-card">
          <EmptyState
            icon={ShieldCheck}
            title={
              range === "all"
                ? "No completed re-attestations on file."
                : `No completed re-attestations in the last ${range === "30d" ? "30 days" : "7 days"}.`
            }
            description={
              range === "all"
                ? undefined
                : "Try widening the range with the selector above."
            }
          />
          <span data-testid="completed-empty" className="sr-only">
            {range === "all"
              ? "No completed re-attestations on file."
              : `No completed re-attestations in the last ${range === "30d" ? "30 days" : "7 days"}.`}
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
                Showing the 200 most recent. Narrow the range to see fewer.
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
                  <StatusPill tone="green" className="text-[10px] uppercase tracking-wide font-bold">
                    Re-attested
                  </StatusPill>
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

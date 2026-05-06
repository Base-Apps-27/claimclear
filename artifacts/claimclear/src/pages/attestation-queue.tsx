import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader, StatusPill } from "@/components/cohesion";
import {
  useListAttestationPending,
  useGetInvoiceGroupAttestationHistory,
} from "@workspace/api-client-react";
import { useUrlParams } from "@/lib/use-url-params";
import { QueueWorkspace } from "@/components/attestation/queue-workspace";
import { CompletedWorkspace } from "@/components/attestation/completed-workspace";

const VALID_TABS = ["open", "completed"] as const;
type TabValue = (typeof VALID_TABS)[number];

export default function AttestationQueue() {
  const { get, set } = useUrlParams();
  const tabParam = get("tab");
  const tab: TabValue = (VALID_TABS as readonly string[]).includes(tabParam)
    ? (tabParam as TabValue)
    : "open";

  const rangeParam = get("range");
  const completedRange = (["7d", "30d", "all"] as const).includes(
    rangeParam as "7d" | "30d" | "all",
  )
    ? (rangeParam as "7d" | "30d" | "all")
    : "7d";

  const pending = useListAttestationPending({ state: "pending" });
  const queued = useListAttestationPending({ state: "queued" });
  const history = useGetInvoiceGroupAttestationHistory({
    range: completedRange,
  });

  const openCount =
    (pending.data?.claims?.length ?? 0) + (queued.data?.claims?.length ?? 0);
  const completedCount = history.data?.groups?.length ?? 0;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Attestation"
        sub="Confirm in MAS that the surviving Approved legs were re-attested after each verdict."
        accent="blue"
        actions={
          <div className="flex items-center gap-2" data-testid="attestation-header-counts">
            <StatusPill
              tone={openCount > 0 ? "amber" : "muted"}
              className="text-[10px] uppercase tracking-wide font-bold"
              data-testid="attestation-header-count-open"
            >
              {openCount} open
            </StatusPill>
            <StatusPill
              tone="green"
              className="text-[10px] uppercase tracking-wide font-bold"
              data-testid="attestation-header-count-completed"
            >
              {completedCount} completed
            </StatusPill>
          </div>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(v) =>
          set({ tab: v === "open" ? null : v, group: null }, false)
        }
        data-testid="attestation-tabs"
      >
        <TabsList className="bg-transparent p-0 h-auto border-b w-full justify-start rounded-none">
          <TabsTrigger
            value="open"
            data-testid="attestation-tab-open"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2 text-sm gap-2"
          >
            Open
            <span
              className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
              data-testid="attestation-tab-open-count"
            >
              {openCount}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="completed"
            data-testid="attestation-tab-completed"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2 text-sm gap-2"
          >
            Completed re-attestations
            <span
              className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
              data-testid="attestation-tab-completed-count"
            >
              {completedCount}
            </span>
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

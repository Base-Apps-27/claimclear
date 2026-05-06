import { useMemo } from "react";
import {
  useGetInvoiceGroup,
  getGetInvoiceGroupQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  NeedsClassificationInboxGroup,
  NeedsClassificationInboxClaim,
} from "@workspace/api-client-react";
import { deriveLegSubStatus } from "@workspace/leg-state";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { QueueNeedsReviewPanel } from "@/components/queue-needs-review-panel";
import { successToast } from "@/hooks/use-toast";

// Task #412: Shared "open the classification picker" dialog. Wraps the
// existing QueueNeedsReviewPanel inside a Dialog and is reachable from
// every entry point that needs to set or change a leg's Error Type
// (leg-row Classify button, claim-detail "Classify this leg" button,
// claim-detail "Change" affordance next to the Error Type badge). The
// Queue page also uses it for the Classification Inbox row click — the
// previous inline Dialog wrapping in queue.tsx folded into here so
// look + behavior stay in one place.
//
// Two modes:
//   - inbox cohort (highlightLegId omitted): shows every
//     needs-classification leg in the group, just like the existing
//     inbox modal. Used by the Queue inbox row click.
//   - single leg (highlightLegId set): scopes the panel to one leg
//     (highlighted), pre-fills the Select if it already has an Error
//     Type. Used by the leg-row + detail-page entry points.
//
// In single-leg mode the dialog auto-closes on a successful classify
// (panel fires onCompleted with the success message); the parent
// receives the message via onCompleted to show it as a toast/banner.
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: number;
  // When set, the panel renders only this leg's row (highlighted) and
  // pre-fills its Select with the live errorTypeId. When omitted, the
  // panel renders the full inbox cohort for the group.
  highlightLegId?: number;
  // Optional caller-supplied success message handler. Defaults to a
  // toast so every entry point gets feedback without having to wire
  // its own surface. The dialog always closes on completion regardless
  // of the handler, so callers don't need to manage open state in
  // their onCompleted.
  onCompleted?: (message: string) => void;
}

function buildSyntheticInboxGroup(
  group: {
    id: number;
    invoiceNumber: string | null;
    status: string;
    rideCount: number;
    totalAmount?: string | null;
    clientNumber?: string | null;
    rides?: ClaimResponse[];
  },
  highlightLegId?: number,
): NeedsClassificationInboxGroup {
  const rides: ClaimResponse[] = group.rides ?? [];
  // For inbox cohort use we filter to needs_classification legs (matches
  // the server-side inbox payload). For single-leg use we always include
  // the highlighted leg even if it's already classified — the panel
  // honors the same flag and renders that row regardless.
  const eligible = rides.filter((r) => {
    if (highlightLegId === r.id) return true;
    return deriveLegSubStatus(r) === "needs_classification";
  });
  const claims: NeedsClassificationInboxClaim[] = eligible.map((r) => ({
    id: r.id,
    confNumber: r.confNumber,
    date: r.date ?? null,
    claimAmount: r.claimAmount ?? null,
    errorDetails: r.errorDetails ?? null,
    isBlank: !(typeof r.errorDetails === "string" && r.errorDetails.trim().length > 0),
  }));
  // qualifyingSiblingCount mirrors the server definition: legs that
  // already carry an errorTypeId or non-empty errorDetails. Computed
  // here so the panel's header strip + all-blank shortcut keep working
  // when we synthesize the payload from a live invoice group fetch.
  const qualifyingSiblingCount = rides.filter((r) => {
    const hasET = typeof r.errorTypeId === "string" && r.errorTypeId.length > 0;
    const hasED = typeof r.errorDetails === "string" && r.errorDetails.trim().length > 0;
    return hasET || hasED;
  }).length;
  const needsClassificationCount = rides.filter(
    (r) => deriveLegSubStatus(r) === "needs_classification",
  ).length;
  return {
    id: group.id,
    invoiceNumber: group.invoiceNumber,
    status: group.status,
    rideCount: group.rideCount,
    totalAmount: group.totalAmount,
    clientNumber: group.clientNumber,
    needsClassificationCount,
    qualifyingSiblingCount,
    allBlank: qualifyingSiblingCount === 0 && needsClassificationCount > 0,
    claims,
  };
}

export function ClassifyDialog({
  open,
  onOpenChange,
  groupId,
  highlightLegId,
  onCompleted,
}: Props) {
  // Lazy-fetch the group so the dialog only spends bandwidth when
  // it's actually open. The query key matches the panel's own
  // useGetInvoiceGroup call so React Query dedupes.
  const { data: group, isLoading } = useGetInvoiceGroup(groupId, {
    query: {
      queryKey: getGetInvoiceGroupQueryKey(groupId),
      enabled: !!groupId && open,
    },
  });

  const inboxGroup = useMemo(() => {
    if (!group) return null;
    return buildSyntheticInboxGroup(group, highlightLegId);
  }, [group, highlightLegId]);

  function handleCompleted(message: string) {
    if (onCompleted) {
      onCompleted(message);
    } else {
      successToast({ title: "__VERB__", description: message });
    }
    // Always close the dialog after a successful completion. The
    // parent surface invalidates queries via the panel's invalidateAll
    // so a refetch lands the new state without manual coordination.
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] p-0 gap-0"
        data-testid="classify-dialog"
      >
        <DialogTitle className="sr-only">Classification workspace</DialogTitle>
        <DialogDescription className="sr-only">
          Pick the Error Type for this leg.
        </DialogDescription>
        <div className="overflow-y-auto max-h-[90vh] p-6 pt-10">
          {isLoading || !inboxGroup ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading classification workspace…
            </div>
          ) : (
            <QueueNeedsReviewPanel
              inboxGroup={inboxGroup}
              highlightLegId={highlightLegId}
              onCompleted={handleCompleted}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

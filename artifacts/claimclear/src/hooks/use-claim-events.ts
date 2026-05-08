import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetClaimQueryKey,
  getListClaimNotesQueryKey,
  getListClaimAuditLogsQueryKey,
  getGetPresenceQueryKey,
  getGetInvoiceGroupQueryKey,
  getListInvoiceGroupEvidenceQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { toast } from "@/hooks/use-toast";
import { useEventSource } from "@/hooks/use-event-source";

interface ClaimEvent {
  type: string;
  claimId: number;
  userName: string | null;
  userEmail: string | null;
  timestamp: string;
}

interface PresenceSSEEvent {
  type: "viewer_joined" | "viewer_left" | "bot_started" | "bot_completed";
  resourceType: "claim" | "invoice_group";
  resourceId: number;
  userName: string | null;
  userEmail: string | null;
  botProcess?: string;
  timestamp: string;
}

const EVENT_LABELS: Record<string, string> = {
  status_changed: "changed the status",
  outcome_changed: "changed the outcome",
  claim_edited: "updated the claim",
  evidence_updated: "updated the evidence",
  hold_placed: "placed the claim on hold",
  hold_removed: "removed the hold",
  workflow_updated: "updated the workflow",
  note_added: "added a note",
  note_deleted: "deleted a note",
  claim_created: "created the claim",
  claim_deleted: "deleted the claim",
};

export interface ClaimEventsHandle {
  /**
   * Author of the most recent claim_update SSE event for this claim.
   * Used by callers (claim-detail-v2) to gate one-shot UI flourishes
   * on whether the change was triggered by the current operator vs a
   * collaborator. Stored in a ref so observing it inside a status-
   * change effect doesn't add a re-render dependency.
   */
  lastClaimUpdateBy: { current: { email: string | null; type: string; timestamp: string } | null };
}

export function useClaimEvents(claimId: number | undefined): ClaimEventsHandle {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const lastClaimUpdateBy = useRef<{ email: string | null; type: string; timestamp: string } | null>(null);

  const handleEvent = useCallback(
    (event: MessageEvent) => {
      try {
        const data: ClaimEvent = JSON.parse(event.data);

        lastClaimUpdateBy.current = {
          email: data.userEmail ?? null,
          type: data.type,
          timestamp: data.timestamp,
        };

        queryClient.invalidateQueries({ queryKey: getGetClaimQueryKey(data.claimId) });
        queryClient.invalidateQueries({ queryKey: getListClaimNotesQueryKey(data.claimId) });
        queryClient.invalidateQueries({ queryKey: getListClaimAuditLogsQueryKey(data.claimId) });

        if (data.userEmail && user?.email && data.userEmail !== user.email) {
          const who = data.userName || data.userEmail;
          const action = EVENT_LABELS[data.type] || "made a change";
          toast({
            title: "Claim updated",
            description: `${who} ${action}`,
            duration: 4000,
          });
        }
      } catch {
        // ignore malformed events
      }
    },
    [queryClient, user?.email],
  );

  const handlePresenceEvent = useCallback(
    (event: MessageEvent) => {
      try {
        const data: PresenceSSEEvent = JSON.parse(event.data);
        queryClient.invalidateQueries({
          queryKey: getGetPresenceQueryKey(data.resourceType, data.resourceId),
        });
      } catch {
        // ignore malformed events
      }
    },
    [queryClient],
  );

  useEventSource({
    url: `/api/claims/${claimId}/events`,
    events: { claim_update: handleEvent, presence_update: handlePresenceEvent },
    enabled: !!claimId,
  });

  return { lastClaimUpdateBy };
}

interface GroupEvent {
  type: string;
  invoiceGroupId: number;
  userName: string | null;
  userEmail: string | null;
  timestamp: string;
}

const GROUP_EVENT_LABELS: Record<string, string> = {
  group_status_changed: "changed the status",
  group_outcome_changed: "changed the outcome",
  group_edited: "updated the invoice group",
  group_evidence_added: "added evidence",
  group_evidence_removed: "removed evidence",
  group_hold_placed: "placed the group on hold",
  group_hold_removed: "removed the hold",
  group_workflow_updated: "updated the workflow",
  group_triaged: "classified the group",
};

export interface InvoiceGroupEventsHandle {
  /**
   * Author of the most recent group_update SSE event for this invoice
   * group. Used by callers (invoice-group-detail-v2) to gate one-shot
   * UI flourishes on whether the change was triggered by the current
   * operator vs a collaborator. Mirrors `lastClaimUpdateBy` on
   * `useClaimEvents`. Stored in a ref so observing it inside a status-
   * change effect doesn't add a re-render dependency.
   */
  lastGroupUpdateBy: { current: { email: string | null; type: string; timestamp: string } | null };
}

export function useInvoiceGroupEvents(groupId: number | undefined): InvoiceGroupEventsHandle {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const lastGroupUpdateBy = useRef<{ email: string | null; type: string; timestamp: string } | null>(null);

  const handleEvent = useCallback(
    (event: MessageEvent) => {
      try {
        const data: GroupEvent = JSON.parse(event.data);

        lastGroupUpdateBy.current = {
          email: data.userEmail ?? null,
          type: data.type,
          timestamp: data.timestamp,
        };

        queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(data.invoiceGroupId) });
        queryClient.invalidateQueries({ queryKey: getListInvoiceGroupEvidenceQueryKey(data.invoiceGroupId) });
        queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupValidTransitionsQueryKey(data.invoiceGroupId) });

        if (data.userEmail && user?.email && data.userEmail !== user.email) {
          const who = data.userName || data.userEmail;
          const action = GROUP_EVENT_LABELS[data.type] || "made a change";
          toast({
            title: "Invoice group updated",
            description: `${who} ${action}`,
            duration: 4000,
          });
        }
      } catch {
        // ignore
      }
    },
    [queryClient, user?.email],
  );

  const handlePresenceEvent = useCallback(
    (event: MessageEvent) => {
      try {
        const data: PresenceSSEEvent = JSON.parse(event.data);
        queryClient.invalidateQueries({
          queryKey: getGetPresenceQueryKey(data.resourceType, data.resourceId),
        });
      } catch {
        // ignore malformed events
      }
    },
    [queryClient],
  );

  useEventSource({
    url: `/api/invoice-groups/${groupId}/events`,
    events: { group_update: handleEvent, presence_update: handlePresenceEvent },
    enabled: !!groupId,
  });

  return { lastGroupUpdateBy };
}

export function useInvoiceGroupsListEvents() {
  const queryClient = useQueryClient();

  const handleGroupUpdate = useCallback(() => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        if (!Array.isArray(key) || typeof key[0] !== "string") return false;
        // Task #546 — the hidden-items strip on the Responses Awaiting
        // Review page is computed off the same group/response state the
        // inbox reads, so it must invalidate on the same SSE pulse the
        // inbox does. Otherwise an operator could classify or "wait for
        // payor again" a row and watch the chip lag for up to a poll
        // interval.
        return (
          key[0].startsWith("/api/invoice-groups") ||
          key[0].startsWith("/api/responses/awaiting-review")
        );
      },
    });
  }, [queryClient]);

  useEventSource({
    url: "/api/invoice-groups/events",
    events: { group_update: handleGroupUpdate },
  });
}

export function useClaimsListEvents() {
  const queryClient = useQueryClient();

  const handleClaimUpdate = useCallback(() => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return Array.isArray(key) && key[0] === "/api/claims";
      },
    });
  }, [queryClient]);

  const handleGroupUpdate = useCallback(() => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return Array.isArray(key) && key[0] === "/api/invoice-groups";
      },
    });
  }, [queryClient]);

  useEventSource({
    url: "/api/claims/events",
    events: { claim_update: handleClaimUpdate, group_update: handleGroupUpdate },
  });
}

// Dashboard summary/activity invalidation. Listens to both the claims-list
// and invoice-groups-list SSE streams so any status/outcome change anywhere
// in the app refreshes the "Expiring Soon" cards and KPIs in real time.
//
// Each EventSource gets its own independent reconnect cycle via
// `useEventSource` (Task #509). Previously a single shared reconnect
// timer driven by the claims source meant a groups-stream error would
// silently leave that source dead until the claims stream also errored;
// the per-source reconnect is the simpler and more correct shape.
export function useDashboardLiveUpdates() {
  const queryClient = useQueryClient();

  const invalidateDashboard = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return Array.isArray(key) && typeof key[0] === "string" && key[0].startsWith("/api/dashboard");
      },
    });
  }, [queryClient]);

  useEventSource({
    url: "/api/invoice-groups/events",
    events: { group_update: invalidateDashboard },
  });
  useEventSource({
    url: "/api/claims/events",
    events: { claim_update: invalidateDashboard, group_update: invalidateDashboard },
  });
}

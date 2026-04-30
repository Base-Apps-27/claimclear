import { useEffect, useRef, useCallback } from "react";
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

export function useClaimEvents(claimId: number | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const retryCount = useRef(0);

  const handleEvent = useCallback(
    (event: MessageEvent) => {
      try {
        const data: ClaimEvent = JSON.parse(event.data);

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

  useEffect(() => {
    if (!claimId) return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      es = new EventSource(`${base}/api/claims/${claimId}/events`, {
        withCredentials: true,
      });

      es.addEventListener("claim_update", handleEvent);
      es.addEventListener("presence_update", handlePresenceEvent);

      es.onopen = () => {
        retryCount.current = 0;
      };

      es.onerror = () => {
        es?.close();
        const delay = Math.min(1000 * 2 ** Math.min(retryCount.current, 5), 30000);
        retryCount.current += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [claimId, handleEvent, handlePresenceEvent]);
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

export function useInvoiceGroupEvents(groupId: number | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const retryCount = useRef(0);

  const handleEvent = useCallback(
    (event: MessageEvent) => {
      try {
        const data: GroupEvent = JSON.parse(event.data);
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

  useEffect(() => {
    if (!groupId) return;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      es = new EventSource(`${base}/api/invoice-groups/${groupId}/events`, {
        withCredentials: true,
      });
      es.addEventListener("group_update", handleEvent);
      es.addEventListener("presence_update", (event: MessageEvent) => {
        try {
          const data: PresenceSSEEvent = JSON.parse(event.data);
          queryClient.invalidateQueries({
            queryKey: getGetPresenceQueryKey(data.resourceType, data.resourceId),
          });
        } catch {
          // ignore malformed events
        }
      });
      es.onopen = () => { retryCount.current = 0; };
      es.onerror = () => {
        es?.close();
        const delay = Math.min(1000 * 2 ** Math.min(retryCount.current, 5), 30000);
        retryCount.current += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    }
    connect();
    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [groupId, handleEvent]);
}

export function useInvoiceGroupsListEvents() {
  const queryClient = useQueryClient();
  const retryCount = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      es = new EventSource(`${base}/api/invoice-groups/events`, {
        withCredentials: true,
      });
      es.addEventListener("group_update", () => {
        queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey;
            return Array.isArray(key) && typeof key[0] === "string" && key[0].startsWith("/api/invoice-groups");
          },
        });
      });
      es.onopen = () => { retryCount.current = 0; };
      es.onerror = () => {
        es?.close();
        const delay = Math.min(1000 * 2 ** Math.min(retryCount.current, 5), 30000);
        retryCount.current += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    }
    connect();
    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [queryClient]);
}

export function useClaimsListEvents() {
  const queryClient = useQueryClient();
  const retryCount = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      es = new EventSource(`${base}/api/claims/events`, {
        withCredentials: true,
      });

      es.addEventListener("claim_update", () => {
        queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey;
            return Array.isArray(key) && key[0] === "/api/claims";
          },
        });
      });

      es.addEventListener("group_update", () => {
        queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey;
            return Array.isArray(key) && key[0] === "/api/invoice-groups";
          },
        });
      });

      es.onopen = () => {
        retryCount.current = 0;
      };

      es.onerror = () => {
        es?.close();
        const delay = Math.min(1000 * 2 ** Math.min(retryCount.current, 5), 30000);
        retryCount.current += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [queryClient]);
}

// Dashboard summary/activity invalidation. Listens to both the claims-list
// and invoice-groups-list SSE streams so any status/outcome change anywhere
// in the app refreshes the "Expiring Soon" cards and KPIs in real time.
export function useDashboardLiveUpdates() {
  const queryClient = useQueryClient();
  const retryCount = useRef(0);

  useEffect(() => {
    const sources: EventSource[] = [];
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function invalidateDashboard() {
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && typeof key[0] === "string" && key[0].startsWith("/api/dashboard");
        },
      });
    }

    function connect() {
      if (cancelled) return;
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

      const groupsEs = new EventSource(`${base}/api/invoice-groups/events`, { withCredentials: true });
      groupsEs.addEventListener("group_update", invalidateDashboard);
      groupsEs.onopen = () => { retryCount.current = 0; };
      groupsEs.onerror = () => {
        groupsEs.close();
      };
      sources.push(groupsEs);

      const claimsEs = new EventSource(`${base}/api/claims/events`, { withCredentials: true });
      claimsEs.addEventListener("claim_update", invalidateDashboard);
      claimsEs.addEventListener("group_update", invalidateDashboard);
      claimsEs.onopen = () => { retryCount.current = 0; };
      claimsEs.onerror = () => {
        claimsEs.close();
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** Math.min(retryCount.current, 5), 30000);
        retryCount.current += 1;
        reconnectTimer = setTimeout(() => {
          // Close any leftover sources before reconnecting.
          while (sources.length) sources.pop()?.close();
          connect();
        }, delay);
      };
      sources.push(claimsEs);
    }

    connect();

    return () => {
      cancelled = true;
      while (sources.length) sources.pop()?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [queryClient]);
}

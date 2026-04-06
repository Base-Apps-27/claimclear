import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetClaimQueryKey,
  getListClaimNotesQueryKey,
  getListClaimAuditLogsQueryKey,
  getGetPresenceQueryKey,
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
  claimId: number;
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
        queryClient.invalidateQueries({ queryKey: getGetPresenceQueryKey(data.claimId) });
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

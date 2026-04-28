import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListPortalSubmissionsQueryKey } from "@workspace/api-client-react";

// Mirror of the server's BatchEvent discriminated union (sse.ts).
export type PortalBatchEvent =
  | {
      type: "batch_started";
      batchId: string;
      triggeredBy: string;
      startedAt: string;
      total: number;
      submissionIds: number[];
    }
  | {
      type: "batch_progress";
      batchId: string;
      processed: number;
      succeeded: number;
      failed: number;
      total: number;
    }
  | {
      type: "row_status_changed";
      batchId: string;
      submissionId: number;
      newStatus: "queued" | "in_progress" | "submitted" | "failed" | "pending";
    }
  | {
      type: "batch_completed" | "batch_failed" | "batch_aborted";
      batchId: string;
      completedAt: string;
      processed: number;
      succeeded: number;
      failed: number;
      total: number;
      message?: string;
    };

export interface ActiveBatchSnapshot {
  batchId: string;
  triggeredBy: string;
  startedAt: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  submissionIds: number[];
}

interface ActiveBatchResponse {
  active: boolean;
  batchId?: string;
  triggeredBy?: string;
  startedAt?: string;
  total?: number;
  processed?: number;
  succeeded?: number;
  failed?: number;
  submissionIds?: number[];
}

/**
 * Subscribes to the global portal-submission batch SSE channel and exposes
 * the currently in-flight batch (if any). On mount the hook hydrates from
 * /portal-submissions/active-batch so a user opening the page mid-run sees
 * the existing batch immediately, then keeps it up to date via SSE.
 *
 * Reliability:
 *  - Hydrates from /active-batch on mount, on every SSE (re)connect, and on
 *    a 15s heartbeat while the document is visible. This is the safety net
 *    for missed events (brief disconnects, tab suspend, mobile background).
 *  - Any progress / row event for an unknown batch triggers an immediate
 *    /active-batch fetch so the UI never stays stale just because we missed
 *    `batch_started`.
 *
 * Whenever an event arrives (start, row status change, progress, completion)
 * the listing query is invalidated so badges (Queued / In Progress /
 * Submitted / Failed) re-render with fresh data from the server.
 */
export function usePortalBatchEvents(): ActiveBatchSnapshot | null {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<ActiveBatchSnapshot | null>(null);
  const retryCount = useRef(0);
  // Avoid kicking off many concurrent /active-batch requests when several
  // events arrive for an unknown batch in quick succession.
  const hydrateInFlight = useRef(false);

  const invalidateList = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListPortalSubmissionsQueryKey() });
  }, [queryClient]);

  const hydrateFromServer = useCallback(async () => {
    if (hydrateInFlight.current) return;
    hydrateInFlight.current = true;
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${base}/api/portal-submissions/active-batch`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data: ActiveBatchResponse = await res.json();
      if (data.active) {
        setActive({
          batchId: data.batchId!,
          triggeredBy: data.triggeredBy!,
          startedAt: data.startedAt!,
          total: data.total ?? 0,
          processed: data.processed ?? 0,
          succeeded: data.succeeded ?? 0,
          failed: data.failed ?? 0,
          submissionIds: data.submissionIds ?? [],
        });
      } else {
        // Server says no active run — clear any stale local snapshot. This
        // covers the case where we missed batch_completed entirely.
        setActive(null);
      }
    } catch {
      // best-effort; SSE / next heartbeat will retry
    } finally {
      hydrateInFlight.current = false;
    }
  }, []);

  // Hydrate once on mount.
  useEffect(() => {
    void hydrateFromServer();
  }, [hydrateFromServer]);

  // Safety-net poll while the tab is visible. SSE handles real-time
  // updates; this catches the rare case where SSE drops silently or events
  // are delivered out of order. 15s is short enough to feel live and long
  // enough not to load the server (one user, one tab, one cheap GET).
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void hydrateFromServer();
    };
    interval = setInterval(tick, 15000);
    const onVisible = () => {
      // When the tab becomes visible again immediately reconcile, since SSE
      // may have been suspended.
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void hydrateFromServer();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      if (interval) clearInterval(interval);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, [hydrateFromServer]);

  // Subscribe to SSE.
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      es = new EventSource(`${base}/api/portal-submissions/batch-events`, {
        withCredentials: true,
      });

      es.addEventListener("batch_update", (event: MessageEvent) => {
        let data: PortalBatchEvent;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        if (data.type === "batch_started") {
          setActive({
            batchId: data.batchId,
            triggeredBy: data.triggeredBy,
            startedAt: data.startedAt,
            total: data.total,
            processed: 0,
            succeeded: 0,
            failed: 0,
            submissionIds: data.submissionIds,
          });
        } else if (data.type === "batch_progress") {
          setActive((prev) => {
            if (prev && prev.batchId === data.batchId) {
              return {
                ...prev,
                processed: data.processed,
                succeeded: data.succeeded,
                failed: data.failed,
                total: data.total,
              };
            }
            // Unknown batch — likely missed batch_started. Reconcile from
            // the server so the in-progress card still appears.
            void hydrateFromServer();
            return prev;
          });
        } else if (data.type === "row_status_changed") {
          // Per-row event for an unknown batch — same reconciliation.
          setActive((prev) => {
            if (!prev || prev.batchId !== data.batchId) {
              void hydrateFromServer();
            }
            return prev;
          });
        } else if (
          data.type === "batch_completed" ||
          data.type === "batch_failed" ||
          data.type === "batch_aborted"
        ) {
          setActive((prev) => (prev && prev.batchId === data.batchId ? null : prev));
        }
        // Every event implies row data on the server moved; refresh the list
        // so badges, retry timers, and statuses stay in sync.
        invalidateList();
      });

      es.onopen = () => {
        retryCount.current = 0;
        // Reconnects (and the very first connect) may have missed events
        // that fired while we were disconnected. Reconcile once now.
        void hydrateFromServer();
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
  }, [invalidateList, hydrateFromServer]);

  return active;
}

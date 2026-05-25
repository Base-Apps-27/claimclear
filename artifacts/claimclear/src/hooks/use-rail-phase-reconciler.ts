import { useEffect } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";

// Task #852 — opportunistically refresh the Recently Viewed rail's
// cached phase pills using payloads already flowing through the React
// Query cache. The rail snapshots a group's phase at visit time, so
// if a teammate (or a portal event) moves a group forward while the
// operator is sitting on the dashboard / queue / list, the pill goes
// stale until the operator re-visits the detail page. By subscribing
// to the QueryCache and harvesting `{id, phase}` pairs from list
// (`/api/invoice-groups`) and detail (`/api/invoice-groups/{id}`)
// responses as they land, we keep the rail honest with zero extra
// HTTP requests. Cross-tab updates continue to flow through the
// existing `storage` event in `useRecentGroupVisits`.
//
// Lives in its own module (not inlined in layout.tsx) so it can be
// unit-tested in isolation without dragging in the layout's auth /
// API-client / shadcn dependency tree (Task #883).
export type RailReconcileFn = (
  updates: Iterable<{ id: number; phase?: string | null }>,
  options?: { cue?: boolean },
) => void;

export function useRailPhaseReconciler(applyPhaseUpdates: RailReconcileFn) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const harvest = (query: Query, options?: { cue?: boolean }) => {
      const key = query.queryKey;
      if (!Array.isArray(key) || typeof key[0] !== "string") return;
      const path = key[0] as string;
      const data = query.state.data as unknown;
      if (!data) return;
      if (path === "/api/invoice-groups") {
        const groups = (data as { groups?: unknown }).groups;
        if (!Array.isArray(groups)) return;
        const updates: { id: number; phase?: string | null }[] = [];
        for (const g of groups) {
          if (g && typeof g === "object") {
            const { id, phase } = g as { id?: unknown; phase?: unknown };
            if (typeof id === "number") {
              updates.push({
                id,
                phase: typeof phase === "string" ? phase : null,
              });
            }
          }
        }
        if (updates.length > 0) applyPhaseUpdates(updates, options);
      } else if (path.startsWith("/api/invoice-groups/")) {
        // Detail endpoint key is `["/api/invoice-groups/{id}"]` —
        // ignore nested sub-resources (history, threads, etc.) which
        // share the prefix but carry extra path segments.
        const rest = path.slice("/api/invoice-groups/".length);
        if (rest.length === 0 || rest.includes("/")) return;
        const idNum = Number(rest);
        if (!Number.isInteger(idNum)) return;
        const phase = (data as { phase?: unknown }).phase;
        applyPhaseUpdates(
          [{ id: idNum, phase: typeof phase === "string" ? phase : null }],
          options,
        );
      }
    };

    // Reconcile against whatever is already in the cache when the
    // sidebar mounts (e.g. the operator navigated from the queue to
    // the dashboard — the list query already lives in the cache).
    // Pass `cue: false` so this mount-time sync doesn't flash rows
    // for changes the operator has likely already seen elsewhere
    // (Task #882). Live updates from the cache subscription below
    // still flash normally.
    for (const q of cache.getAll()) harvest(q, { cue: false });

    const unsub = cache.subscribe((event) => {
      if (event.type === "updated" && event.action?.type === "success") {
        harvest(event.query);
      }
    });
    return () => unsub();
  }, [queryClient, applyPhaseUpdates]);
}

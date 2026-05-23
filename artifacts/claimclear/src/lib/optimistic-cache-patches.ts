// Task #835 — Pure cache-patch helpers shared by the five wired
// surfaces of `useOptimisticMutation`. Keeping them out of the React
// tree lets them be unit-tested without a render harness and reused
// from every call site that needs to flip a leg or a group.

import type {
  InvoiceGroupResponse,
  ClaimResponse,
} from "@workspace/api-client-react";

/**
 * Return a copy of the group cache with `legId`'s leg row patched.
 * Unknown / missing legs are left intact so a stale or partial cache
 * does not throw — the worst case is a no-op flip that the server
 * refetch will repair on settle.
 */
export function patchGroupLeg(
  old: unknown,
  legId: number,
  patch: Partial<ClaimResponse>,
): unknown {
  if (!old || typeof old !== "object") return old;
  const g = old as InvoiceGroupResponse;
  if (!Array.isArray(g.rides)) return old;
  let touched = false;
  const rides = g.rides.map((r) => {
    if (r.id !== legId) return r;
    touched = true;
    return { ...r, ...patch };
  });
  if (!touched) return old;
  return { ...g, rides };
}

/**
 * Patch multiple legs in one pass — used by the bulk reclassify
 * surface so every visible row flips error type within a frame.
 */
export function patchGroupLegs(
  old: unknown,
  patches: Map<number, Partial<ClaimResponse>>,
): unknown {
  if (!old || typeof old !== "object") return old;
  const g = old as InvoiceGroupResponse;
  if (!Array.isArray(g.rides)) return old;
  const rides = g.rides.map((r) => {
    const patch = patches.get(r.id);
    return patch ? { ...r, ...patch } : r;
  });
  return { ...g, rides };
}

/**
 * Patch top-level invoice-group fields (status / phase / counts).
 */
export function patchGroupFields(
  old: unknown,
  patch: Partial<InvoiceGroupResponse>,
): unknown {
  if (!old || typeof old !== "object") return old;
  return { ...(old as InvoiceGroupResponse), ...patch };
}

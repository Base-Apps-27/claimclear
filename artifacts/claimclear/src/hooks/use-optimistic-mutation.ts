// Task #835 — Shared optimistic-update wrapper around tanstack-query.
//
// The five noisiest operator actions (Approve response, Mark no-issue,
// Bulk reclassify, Queue for re-attest, Mark handled offline) used to
// wait 2–6 seconds for a server refetch before showing the new state.
// This hook bakes in the standard onMutate snapshot / onError rollback
// pattern so the UI flips within a frame and reverts cleanly on
// failure with a standardized toast.
//
// The hook deliberately accepts a plain `mutationFn` rather than
// replacing the generated `useXxx()` mutation hooks — callers can
// hand it `generatedMutation.mutateAsync`, which keeps the network
// path / retry behaviour / mutation key wired through the generated
// client. The optimistic cache patches + rollback live here.
//
// Contract pinned by the test suite (`use-optimistic-mutation.test.tsx`):
//   • Patches are applied synchronously inside onMutate so the UI
//     flips before the network round-trip starts.
//   • On error, every snapshot is restored verbatim (we do NOT trust
//     a "merge" — the cache returns to its pre-mutation shape).
//   • `showSaving` flips true ONLY when the request actually exceeds
//     the SAVING_INDICATOR_DELAY_MS threshold (300ms by default), so
//     a sub-300ms round-trip never paints a "Saving…" indicator.
//   • Toast title defaults to `errorTitle ?? "Couldn't save — reverted"`
//     so every wrapped call site shares the same failure copy.

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export const SAVING_INDICATOR_DELAY_MS = 300;

export interface OptimisticPatch {
  queryKey: QueryKey;
  /** Receives the current cache value (may be undefined) and returns the patched value. */
  updater: (old: unknown) => unknown;
}

export interface UseOptimisticMutationOptions<TVariables, TData> {
  /** Network call. Usually `generatedMutation.mutateAsync`. */
  mutationFn: (variables: TVariables) => Promise<TData>;
  /** Patches to apply to the query cache before the network call. */
  buildPatches: (variables: TVariables) => OptimisticPatch[];
  /** Query keys to invalidate on settle (success or error rollback). */
  invalidateKeys?: (variables: TVariables, data?: TData) => QueryKey[];
  /** Standardized failure-toast title. */
  errorTitle?: string | ((variables: TVariables, error: Error) => string);
  /** Side-effects on success (e.g. milestone notifications). */
  onSuccess?: (data: TData, variables: TVariables) => void;
  /** Side-effects on error AFTER rollback has been applied. */
  onError?: (error: Error, variables: TVariables) => void;
  /** Override the saving-indicator threshold (mostly for tests). */
  savingIndicatorDelayMs?: number;
}

interface OptimisticContext {
  snapshots: Array<{ queryKey: QueryKey; data: unknown }>;
}

export interface UseOptimisticMutationResult<TVariables, TData> {
  /** Fires the optimistic patch + mutation; returns the server response. */
  run: (variables: TVariables) => Promise<TData>;
  /** True while the underlying mutation is in flight. */
  isPending: boolean;
  /** True only after the request actually exceeds SAVING_INDICATOR_DELAY_MS. */
  showSaving: boolean;
  /** Last error from the wrapped mutation (cleared on next run). */
  error: Error | null;
}

export function useOptimisticMutation<TVariables, TData>(
  opts: UseOptimisticMutationOptions<TVariables, TData>,
): UseOptimisticMutationResult<TVariables, TData> {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showSaving, setShowSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayMs = opts.savingIndicatorDelayMs ?? SAVING_INDICATOR_DELAY_MS;

  // Avoid stale closure on opts: callers usually inline the object.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const mutation = useMutation<TData, Error, TVariables, OptimisticContext>({
    mutationFn: (variables) => optsRef.current.mutationFn(variables),
    onMutate: async (variables) => {
      clearTimer();
      // The "Saving…" indicator only paints when the request actually
      // exceeds the threshold — for sub-300ms calls the operator never
      // sees a flicker.
      timerRef.current = setTimeout(() => setShowSaving(true), delayMs);

      const patches = optsRef.current.buildPatches(variables);
      const snapshots: Array<{ queryKey: QueryKey; data: unknown }> = [];
      for (const p of patches) {
        // Cancel in-flight refetches so they can't clobber our patch.
        await qc.cancelQueries({ queryKey: p.queryKey });
        const prev = qc.getQueryData(p.queryKey);
        snapshots.push({ queryKey: p.queryKey, data: prev });
        qc.setQueryData(p.queryKey, p.updater(prev));
      }
      return { snapshots };
    },
    onError: (err, variables, context) => {
      // Restore every snapshot verbatim — we never trust a merge.
      if (context?.snapshots) {
        for (const s of context.snapshots) {
          qc.setQueryData(s.queryKey, s.data);
        }
      }
      const titleSource = optsRef.current.errorTitle;
      const title =
        typeof titleSource === "function"
          ? titleSource(variables, err)
          : (titleSource ?? "Couldn't save — reverted");
      toast({
        title,
        description: err.message || String(err),
        variant: "destructive",
      });
      optsRef.current.onError?.(err, variables);
    },
    onSuccess: (data, variables) => {
      optsRef.current.onSuccess?.(data, variables);
    },
    onSettled: (data, _err, variables) => {
      clearTimer();
      setShowSaving(false);
      const keys = optsRef.current.invalidateKeys?.(variables, data);
      if (keys) {
        for (const key of keys) {
          qc.invalidateQueries({ queryKey: key });
        }
      }
    },
  });

  const run = useCallback(
    (variables: TVariables) => mutation.mutateAsync(variables),
    [mutation],
  );

  return {
    run,
    isPending: mutation.isPending,
    showSaving,
    error: mutation.error,
  };
}

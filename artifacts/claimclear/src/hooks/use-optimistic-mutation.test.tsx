// Task #835 — Unit test for `useOptimisticMutation`.
//
// Pins the contract the five wired surfaces rely on:
//   • Patches apply synchronously inside onMutate (cache flips before
//     the network call resolves).
//   • On error, every snapshot restores verbatim and a destructive
//     toast fires with the configured title.
//   • `showSaving` stays false for sub-threshold round-trips and
//     flips true only when the request exceeds the threshold.

import "../components/decision-tree/terminals/_setup-jsdom.ts";

import * as React from "react";
import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

const toastCalls: Array<{ title?: unknown; description?: unknown; variant?: unknown }> = [];

mock.module("@/hooks/use-toast", {
  namedExports: {
    useToast: () => ({
      toast: (props: { title?: unknown; description?: unknown; variant?: unknown }) =>
        toastCalls.push(props),
    }),
    toast: (props: { title?: unknown; description?: unknown; variant?: unknown }) =>
      toastCalls.push(props),
    successToast: () => undefined,
  },
});

const { render, act, cleanup } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider, useQueryClient } = await import("@tanstack/react-query");
const { useOptimisticMutation } = await import("./use-optimistic-mutation");

void React;

const CACHE_KEY = ["test-cache"] as const;

interface CacheShape {
  value: string;
}

function Harness({
  mutationFn,
  onResult,
  savingIndicatorDelayMs,
}: {
  mutationFn: (v: { next: string }) => Promise<{ ok: true }>;
  onResult: (api: {
    run: (v: { next: string }) => Promise<unknown>;
    showSaving: boolean;
    isPending: boolean;
    cache: CacheShape | undefined;
  }) => void;
  savingIndicatorDelayMs?: number;
}) {
  const qc = useQueryClient();
  // Seed once so the cache survives re-renders triggered by the
  // hook's internal state updates.
  React.useMemo(() => {
    qc.setQueryData<CacheShape>(CACHE_KEY, { value: "initial" });
  }, [qc]);
  const m = useOptimisticMutation<{ next: string }, { ok: true }>({
    mutationFn,
    errorTitle: "Couldn't apply test patch — reverted",
    buildPatches: (vars) => [
      {
        queryKey: CACHE_KEY,
        updater: () => ({ value: vars.next }),
      },
    ],
    savingIndicatorDelayMs,
  });
  React.useEffect(() => {
    onResult({
      run: m.run,
      showSaving: m.showSaving,
      isPending: m.isPending,
      cache: qc.getQueryData<CacheShape>(CACHE_KEY),
    });
  });
  return <span data-testid="x" />;
}

function mount(
  mutationFn: (v: { next: string }) => Promise<{ ok: true }>,
  onResult: (api: {
    run: (v: { next: string }) => Promise<unknown>;
    showSaving: boolean;
    isPending: boolean;
    cache: CacheShape | undefined;
  }) => void,
  savingIndicatorDelayMs?: number,
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <Harness
        mutationFn={mutationFn}
        onResult={onResult}
        savingIndicatorDelayMs={savingIndicatorDelayMs}
      />
    </QueryClientProvider>,
  );
}

test("optimistic patch flips cache before mutationFn resolves", async (t) => {
  t.after(cleanup);
  toastCalls.length = 0;
  let resolveFn!: (v: { ok: true }) => void;
  const pending = new Promise<{ ok: true }>((r) => { resolveFn = r; });

  let api: { run: (v: { next: string }) => Promise<unknown>; cache: CacheShape | undefined } | null = null;
  mount(() => pending, (a) => { api = a; });

  assert.equal(api!.cache?.value, "initial");

  // Fire the optimistic mutation but DON'T await it — the cache must
  // flip synchronously before the server resolves.
  let runPromise!: Promise<unknown>;
  await act(async () => {
    runPromise = api!.run({ next: "patched" });
    // Yield once so onMutate's microtasks run.
    await Promise.resolve();
  });

  assert.equal(api!.cache?.value, "patched",
    "cache must flip to the optimistic value before the network call resolves");

  await act(async () => {
    resolveFn({ ok: true });
    await runPromise;
  });

  assert.equal(toastCalls.length, 0, "no error toast on success");
});

test("on error the cache rolls back and a destructive toast fires with the configured title", async (t) => {
  t.after(cleanup);
  toastCalls.length = 0;

  let api: { run: (v: { next: string }) => Promise<unknown>; cache: CacheShape | undefined } | null = null;
  mount(() => Promise.reject(new Error("boom from server")), (a) => { api = a; });

  assert.equal(api!.cache?.value, "initial");

  await act(async () => {
    await api!.run({ next: "patched" }).catch(() => {});
  });

  assert.equal(api!.cache?.value, "initial",
    "cache must roll back to the snapshotted value after an error");
  assert.equal(toastCalls.length, 1, "exactly one error toast on failure");
  assert.equal(toastCalls[0].variant, "destructive");
  assert.equal(toastCalls[0].title, "Couldn't apply test patch — reverted");
  assert.match(String(toastCalls[0].description), /boom from server/);
});

test("showSaving stays false for sub-threshold round-trips", async (t) => {
  t.after(cleanup);
  toastCalls.length = 0;

  const states: boolean[] = [];
  let api: {
    run: (v: { next: string }) => Promise<unknown>;
    showSaving: boolean;
  } | null = null;
  mount(
    // Resolves immediately — way under the 60ms threshold.
    () => Promise.resolve({ ok: true }),
    (a) => {
      states.push(a.showSaving);
      api = a;
    },
    60,
  );

  await act(async () => {
    await api!.run({ next: "fast" });
  });

  assert.ok(
    states.every((s) => s === false),
    `showSaving must stay false for fast requests; got ${JSON.stringify(states)}`,
  );
});

test("showSaving flips true when the request exceeds the threshold", async (t) => {
  t.after(cleanup);
  toastCalls.length = 0;

  let resolveFn!: (v: { ok: true }) => void;
  const pending = new Promise<{ ok: true }>((r) => { resolveFn = r; });
  const states: boolean[] = [];
  let api: {
    run: (v: { next: string }) => Promise<unknown>;
    showSaving: boolean;
  } | null = null;
  mount(
    () => pending,
    (a) => {
      states.push(a.showSaving);
      api = a;
    },
    20,
  );

  let runPromise!: Promise<unknown>;
  await act(async () => {
    runPromise = api!.run({ next: "slow" });
    // Wait past the 20ms threshold so the indicator timer fires.
    await new Promise((r) => setTimeout(r, 50));
  });

  assert.ok(
    states.some((s) => s === true),
    `showSaving must flip true once the request exceeds the threshold; got ${JSON.stringify(states)}`,
  );

  await act(async () => {
    resolveFn({ ok: true });
    await runPromise;
  });

  // After settle, showSaving must drop back to false.
  assert.equal(states[states.length - 1], false,
    "showSaving must clear once the mutation settles");
});

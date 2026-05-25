// Integration coverage for `useRailPhaseReconciler` (Task #852 / #883).
//
// The reconciler subscribes to the React Query cache and harvests
// `{id, phase}` pairs from the list endpoint (`/api/invoice-groups`)
// and the detail endpoint (`/api/invoice-groups/{id}`) as their
// responses land. The rail's `applyPhaseUpdates` then refreshes the
// cached pills without firing extra HTTP requests. These tests pin
// that contract so a future refactor of the query keys or response
// shapes can't silently break the freshness guarantee:
//
//   1. A successful list query feeds every `{id, phase}` it contains
//      into `applyPhaseUpdates`.
//   2. A successful detail query feeds the single `{id, phase}` it
//      represents (id parsed from the trailing path segment).
//   3. Sub-resource keys that share the `/api/invoice-groups/` prefix
//      (history, threads, anything with extra path segments) are
//      ignored — they don't carry an authoritative phase for the
//      parent group.

import "../components/decision-tree/terminals/_setup-jsdom.ts";

import * as React from "react";
import { test, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { render, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRailPhaseReconciler } from "./use-rail-phase-reconciler";

void React;

type Update = { id: number; phase?: string | null };

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const batches: Update[][] = [];
  const apply = (updates: Iterable<Update>) => {
    batches.push(Array.from(updates));
  };
  const Probe: React.FC = () => {
    useRailPhaseReconciler(apply);
    return null;
  };
  render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(Probe),
    ),
  );
  return { client, batches };
}

async function seedQuery<T>(
  client: QueryClient,
  queryKey: readonly unknown[],
  data: T,
) {
  await act(async () => {
    await client.fetchQuery({
      queryKey: queryKey as unknown[],
      queryFn: async () => data,
    });
  });
}

beforeEach(() => {
  cleanup();
});

test("list payload from /api/invoice-groups feeds every {id, phase} into applyPhaseUpdates", async () => {
  const { client, batches } = setup();

  await seedQuery(client, ["/api/invoice-groups"], {
    groups: [
      { id: 1, phase: "draft" },
      { id: 2, phase: "sent" },
      { id: 3, phase: null },
      { id: 4 }, // missing phase: must be coerced to null, not dropped
    ],
  });

  const flat = batches.flat();
  const byId = new Map(flat.map((u) => [u.id, u.phase]));
  assert.equal(byId.get(1), "draft");
  assert.equal(byId.get(2), "sent");
  assert.equal(byId.get(3), null, "explicit null phase passes through");
  assert.equal(byId.get(4), null, "missing phase is coerced to null");
  assert.equal(byId.size, 4, "every group with a numeric id must appear");
});

test("detail payload from /api/invoice-groups/{id} feeds a single {id, phase}", async () => {
  const { client, batches } = setup();

  await seedQuery(client, ["/api/invoice-groups/42"], { phase: "approved" });

  const flat = batches.flat();
  assert.deepEqual(
    flat,
    [{ id: 42, phase: "approved" }],
    "detail key must emit exactly one update with the id parsed from the URL",
  );
});

test("sub-resource keys like /api/invoice-groups/42/history are ignored", async () => {
  const { client, batches } = setup();

  await seedQuery(client, ["/api/invoice-groups/42/history"], {
    groups: [{ id: 42, phase: "shouldNotLeak" }],
  });
  await seedQuery(client, ["/api/invoice-groups/42/responses"], {
    phase: "shouldNotLeak",
  });
  await seedQuery(client, ["/api/invoice-groups/abc"], { phase: "ignored" });

  assert.equal(
    batches.length,
    0,
    "neither sub-resource keys nor non-numeric ids may trigger a rail update",
  );
});

// Unit coverage for `useEventSource` (Task #509).
//
// The four contracts exercised here are the ones the dashboard's
// dual-stream and the system-events confetti relied on the old
// hand-rolled connect functions to provide:
//
//   1. The hook opens an EventSource against `${BASE_URL}<url>` with
//      credentials and registers each named handler on mount.
//   2. Closing on unmount cancels any in-flight reconnect timer (no
//      stray reconnects after the component is gone).
//   3. `onerror` triggers an exponential-backoff reconnect (1s, 2s, 4s
//      … capped at 30s) and resets to 0 after a successful open. This
//      is the regression that bit the dashboard when both streams
//      shared one timer.
//   4. `replayGuard: true` drops named-event payloads whose JSON
//      `timestamp` parses older than the connection's open time —
//      the protection that keeps a confetti burst from re-firing on
//      reconnect.

import "../components/decision-tree/terminals/_setup-jsdom.ts";

import * as React from "react";
import { test, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { render, cleanup, act } from "@testing-library/react";
import { useEventSource } from "./use-event-source";

void React;

// Lightweight EventSource stub that records constructor calls and
// lets tests drive open/error/named-event lifecycle by hand.
interface FakeES {
  url: string;
  withCredentials: boolean;
  closed: boolean;
  listeners: Map<string, Array<(e: MessageEvent) => void>>;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
}
let instances: FakeES[] = [];

class FakeEventSource {
  url: string;
  withCredentials: boolean;
  closed = false;
  listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = !!init?.withCredentials;
    instances.push(this as unknown as FakeES);
  }
  addEventListener(name: string, handler: (e: MessageEvent) => void) {
    const arr = this.listeners.get(name) ?? [];
    arr.push(handler);
    this.listeners.set(name, arr);
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  instances = [];
  (globalThis as { EventSource: unknown }).EventSource = FakeEventSource;
});

function dispatch(es: FakeES, name: string, data: unknown) {
  const handlers = es.listeners.get(name) ?? [];
  const event = { data: JSON.stringify(data) } as MessageEvent;
  for (const h of handlers) h(event);
}

test("opens an EventSource with the BASE_URL prefix and registered listeners", () => {
  const seen: unknown[] = [];
  function H() {
    useEventSource({
      url: "/api/events",
      events: { ping: (e) => seen.push(JSON.parse(e.data)) },
    });
    return null;
  }
  const { unmount } = render(<H />);
  assert.equal(instances.length, 1);
  assert.match(instances[0].url, /\/api\/events$/);
  assert.equal(instances[0].withCredentials, true);
  assert.ok(instances[0].listeners.has("ping"));

  act(() => {
    dispatch(instances[0], "ping", { hello: "world" });
  });
  assert.deepEqual(seen, [{ hello: "world" }]);

  unmount();
  assert.equal(instances[0].closed, true);
  cleanup();
});

test("on error, schedules an exponential-backoff reconnect and unmount cancels it", async () => {
  function H() {
    useEventSource({ url: "/api/events", events: {} });
    return null;
  }
  const { unmount } = render(<H />);
  assert.equal(instances.length, 1);

  // Simulate a transport failure — the hook should close this socket
  // and arm a reconnect timer (1000ms for the first retry).
  act(() => {
    instances[0].onerror?.();
  });
  assert.equal(instances[0].closed, true);

  // Unmount BEFORE the reconnect fires; the cleanup must cancel the
  // pending timer so no second EventSource is ever constructed.
  unmount();
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(instances.length, 1, "no reconnect should have happened after unmount");
  cleanup();
});

test("reconnect actually fires when the component is still mounted", async () => {
  function H() {
    useEventSource({ url: "/api/events", events: {} });
    return null;
  }
  const { unmount } = render(<H />);
  act(() => {
    instances[0].onerror?.();
  });
  // First retry delay is 1000ms; wait a hair longer.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1200));
  });
  assert.equal(instances.length, 2, "expected exactly one reconnect");
  unmount();
  cleanup();
});

test("replayGuard drops events whose timestamp predates the connection open", () => {
  const seen: unknown[] = [];
  function H() {
    useEventSource({
      url: "/api/events",
      events: { tick: (e) => seen.push(JSON.parse(e.data)) },
      replayGuard: true,
    });
    return null;
  }
  const { unmount } = render(<H />);
  const es = instances[0];

  // Open the connection — this stamps connectedAt = Date.now().
  act(() => {
    es.onopen?.();
  });
  const openedAt = Date.now();

  // Old event (1s before open) — must be dropped.
  act(() => {
    dispatch(es, "tick", { timestamp: new Date(openedAt - 1000).toISOString(), v: "old" });
  });

  // Fresh event (1s after open) — must be delivered.
  act(() => {
    dispatch(es, "tick", { timestamp: new Date(openedAt + 1000).toISOString(), v: "new" });
  });

  // Untimestamped event — best-effort guard lets it through.
  act(() => {
    dispatch(es, "tick", { v: "untimestamped" });
  });

  assert.deepEqual(
    seen.map((s) => (s as { v: string }).v),
    ["new", "untimestamped"],
  );

  unmount();
  cleanup();
});

test("dispatch resolves the latest handler closure at fire time (no reconnect needed)", () => {
  const seen: string[] = [];
  function H({ tag }: { tag: string }) {
    useEventSource({
      url: "/api/events",
      // Fresh closure each render — captures the current `tag`. The
      // hook must call THIS closure, not the one present at open time.
      events: { tick: () => seen.push(tag) },
    });
    return null;
  }
  const { rerender, unmount } = render(<H tag="first" />);
  const es = instances[0];
  act(() => {
    dispatch(es, "tick", {});
  });
  // Re-render with a new closure — same EventSource, same listeners.
  rerender(<H tag="second" />);
  assert.equal(instances.length, 1, "rerender must not tear down the EventSource");
  act(() => {
    dispatch(es, "tick", {});
  });
  assert.deepEqual(seen, ["first", "second"]);
  unmount();
  cleanup();
});

test("without replayGuard, every event is delivered regardless of timestamp", () => {
  const seen: unknown[] = [];
  function H() {
    useEventSource({
      url: "/api/events",
      events: { tick: (e) => seen.push(JSON.parse(e.data).v) },
    });
    return null;
  }
  const { unmount } = render(<H />);
  const es = instances[0];
  act(() => {
    es.onopen?.();
  });
  act(() => {
    dispatch(es, "tick", { timestamp: new Date(Date.now() - 60_000).toISOString(), v: "ancient" });
    dispatch(es, "tick", { v: "fresh" });
  });
  assert.deepEqual(seen, ["ancient", "fresh"]);
  unmount();
  cleanup();
});

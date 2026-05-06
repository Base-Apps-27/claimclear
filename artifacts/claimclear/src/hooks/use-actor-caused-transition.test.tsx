// Unit coverage for `useActorCausedTransition` (Task #509).
//
// Exercises the four guarantees the hook owns:
//   1. Initial mount does not fire (no prev value to compare).
//   2. Same-value re-renders do not fire.
//   3. Local-mark fast path fires unconditionally regardless of who
//      authored the SSE event.
//   4. With no local mark, a different-author SSE tag suppresses;
//      missing-author falls through and fires.

import "../components/decision-tree/terminals/_setup-jsdom.ts";

import * as React from "react";
import { test, mock } from "node:test";
import { strict as assert } from "node:assert";
import { render, cleanup, act } from "@testing-library/react";

void React;

// Stub `useAuth` per-test so we can vary the current operator's email
// without restructuring the hook under test. Default is the operator
// "me@example.com".
let currentEmail: string | null = "me@example.com";
mock.module("@workspace/replit-auth-web", {
  namedExports: {
    useAuth: () => ({
      user: { email: currentEmail },
      isLoading: false,
      isAuthenticated: true,
      sessionExpiry: null,
      login: () => {},
      logout: () => {},
      clearAuth: () => {},
    }),
  },
});

const { useActorCausedTransition } = await import("./use-actor-caused-transition");
const { markLocalAction } = await import("./use-local-action-mark");

interface HarnessProps {
  value: string | undefined;
  lastUpdateBy: { current: { email: string | null } | null };
  onTransition: (next: string, prev: string) => void;
  keyName?: string;
}
function Harness(props: HarnessProps) {
  useActorCausedTransition<string>({
    key: props.keyName ?? "claim:1",
    lastUpdateBy: props.lastUpdateBy,
    currentValue: props.value,
    isTransition: (_prev, next) => next === "Processed",
    onTransition: props.onTransition,
  });
  return null;
}

test("does not fire on initial mount even when value is the terminal", async () => {
  const calls: Array<[string, string]> = [];
  const lastUpdateBy = { current: null };
  const { unmount } = render(
    <Harness
      value="Processed"
      lastUpdateBy={lastUpdateBy}
      onTransition={(n, p) => calls.push([p, n])}
    />,
  );
  assert.equal(calls.length, 0);
  unmount();
  cleanup();
});

test("fires on a qualifying transition with no SSE author and no local mark", async () => {
  const calls: Array<[string, string]> = [];
  const lastUpdateBy = { current: null };
  const { rerender, unmount } = render(
    <Harness
      value="Open"
      lastUpdateBy={lastUpdateBy}
      onTransition={(n, p) => calls.push([p, n])}
    />,
  );
  await act(async () => {
    rerender(
      <Harness
        value="Processed"
        lastUpdateBy={lastUpdateBy}
        onTransition={(n, p) => calls.push([p, n])}
      />,
    );
  });
  assert.deepEqual(calls, [["Open", "Processed"]]);
  unmount();
  cleanup();
});

test("does not fire when same value re-renders", async () => {
  const calls: Array<[string, string]> = [];
  const lastUpdateBy = { current: null };
  const { rerender, unmount } = render(
    <Harness value="Open" lastUpdateBy={lastUpdateBy} onTransition={(n, p) => calls.push([p, n])} />,
  );
  await act(async () => {
    rerender(
      <Harness value="Open" lastUpdateBy={lastUpdateBy} onTransition={(n, p) => calls.push([p, n])} />,
    );
  });
  assert.equal(calls.length, 0);
  unmount();
  cleanup();
});

test("suppresses when SSE author is a different operator", async () => {
  currentEmail = "me@example.com";
  const calls: Array<[string, string]> = [];
  const lastUpdateBy = { current: { email: "other@example.com" } };
  const { rerender, unmount } = render(
    <Harness value="Open" lastUpdateBy={lastUpdateBy} onTransition={(n, p) => calls.push([p, n])} />,
  );
  await act(async () => {
    rerender(
      <Harness value="Processed" lastUpdateBy={lastUpdateBy} onTransition={(n, p) => calls.push([p, n])} />,
    );
  });
  assert.equal(calls.length, 0);
  unmount();
  cleanup();
});

test("local mark wins over a different-author SSE tag", async () => {
  currentEmail = "me@example.com";
  const calls: Array<[string, string]> = [];
  const lastUpdateBy = { current: { email: "other@example.com" } };
  markLocalAction("claim:99");
  const { rerender, unmount } = render(
    <Harness
      keyName="claim:99"
      value="Open"
      lastUpdateBy={lastUpdateBy}
      onTransition={(n, p) => calls.push([p, n])}
    />,
  );
  await act(async () => {
    rerender(
      <Harness
        keyName="claim:99"
        value="Processed"
        lastUpdateBy={lastUpdateBy}
        onTransition={(n, p) => calls.push([p, n])}
      />,
    );
  });
  assert.deepEqual(calls, [["Open", "Processed"]]);
  unmount();
  cleanup();
});

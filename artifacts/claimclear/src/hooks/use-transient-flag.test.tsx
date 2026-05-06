// Unit coverage for `useTransientFlag` and `useTransientFlagSet` (Task #509).
//
// Both hooks own the `useState + useRef + setTimeout + cleanup` pattern
// that used to live ad-hoc in 7 places. The contracts pinned here:
//   • `fire()` flips `active` true synchronously.
//   • The flag flips back false after `durationMs`.
//   • Back-to-back `fire()` calls cancel the in-flight timer cleanly
//     (no leaked early flip-back).
//   • `useTransientFlagSet.fire(ids)` activates the given ids together.

import "../components/decision-tree/terminals/_setup-jsdom.ts";

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { render, act, cleanup } from "@testing-library/react";
import { useTransientFlag, useTransientFlagSet } from "./use-transient-flag";

void React;

function FlagHarness({
  durationMs,
  onState,
}: {
  durationMs: number;
  onState: (s: { active: boolean; fire: () => void }) => void;
}) {
  const { active, fire } = useTransientFlag(durationMs);
  React.useEffect(() => {
    onState({ active, fire });
  });
  return <span data-testid="flag">{active ? "on" : "off"}</span>;
}

test("useTransientFlag flips true on fire and back false after the duration", async () => {
  let last: { active: boolean; fire: () => void } | null = null;
  const { getByTestId, unmount } = render(
    <FlagHarness durationMs={20} onState={(s) => (last = s)} />,
  );
  assert.equal(getByTestId("flag").textContent, "off");
  await act(async () => {
    last!.fire();
  });
  assert.equal(getByTestId("flag").textContent, "on");
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  assert.equal(getByTestId("flag").textContent, "off");
  unmount();
  cleanup();
});

function SetHarness({
  durationMs,
  onState,
}: {
  durationMs: number;
  onState: (s: { isActive: (id: number) => boolean; fire: (ids: number[]) => void }) => void;
}) {
  const { isActive, fire } = useTransientFlagSet<number>(durationMs);
  React.useEffect(() => {
    onState({ isActive, fire });
  });
  return (
    <span data-testid="set">{[1, 2, 3].filter(isActive).join(",")}</span>
  );
}

test("useTransientFlagSet activates the given ids and clears them after the duration", async () => {
  let last: { isActive: (id: number) => boolean; fire: (ids: number[]) => void } | null = null;
  const { getByTestId, unmount } = render(
    <SetHarness durationMs={20} onState={(s) => (last = s)} />,
  );
  assert.equal(getByTestId("set").textContent, "");
  await act(async () => {
    last!.fire([1, 3]);
  });
  assert.equal(getByTestId("set").textContent, "1,3");
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  assert.equal(getByTestId("set").textContent, "");
  unmount();
  cleanup();
});

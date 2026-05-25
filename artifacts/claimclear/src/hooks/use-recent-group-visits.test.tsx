// Unit coverage for the opportunistic phase reconciler on
// `useRecentGroupVisits` (Task #852 / #883).
//
// The three contracts exercised here are the ones the sidebar rail
// relies on to stay honest when a teammate moves a group forward
// elsewhere:
//
//   1. `applyPhaseUpdates` rewrites the cached phase pill only for
//      rail entries whose ids appear in the update batch — every
//      other entry is left untouched.
//   2. The call is a no-op (no storage write, no same-tab event,
//      no state churn) when every supplied id already carries the
//      supplied phase — this is what keeps the React Query subscriber
//      from thrashing the rail on every successful refetch.
//   3. When something does change, the same-tab CustomEvent fires so
//      other sidebar instances (and the rail's own subscriber) re-read
//      from localStorage immediately, without waiting on the cross-tab
//      `storage` event that only fires across tabs.

import "../components/decision-tree/terminals/_setup-jsdom.ts";

import * as React from "react";
import { test, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { render, cleanup, act } from "@testing-library/react";
import {
  useRecentGroupVisits,
  type RecentGroupVisit,
} from "./use-recent-group-visits";

void React;

const USER_ID = "user-1";
const STORAGE_KEY = `claimclear:recent-groups:${USER_ID}`;
const SAME_TAB_EVENT = "claimclear:recent-groups-updated";

function seedStorage(entries: RecentGroupVisit[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

type HookValue = ReturnType<typeof useRecentGroupVisits>;

function captureHook(): { current: HookValue } {
  const ref = { current: null as unknown as HookValue };
  const Capture: React.FC = () => {
    ref.current = useRecentGroupVisits(USER_ID);
    return null;
  };
  render(React.createElement(Capture));
  return ref;
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
});

test("applyPhaseUpdates rewrites only the entries whose ids appear in the batch", () => {
  seedStorage([
    { id: 1, invoiceNumber: "INV-1", phase: "draft", visitedAt: 1 },
    { id: 2, invoiceNumber: "INV-2", phase: "draft", visitedAt: 2 },
    { id: 3, invoiceNumber: "INV-3", phase: "draft", visitedAt: 3 },
  ]);

  const hook = captureHook();

  act(() => {
    hook.current.applyPhaseUpdates([
      { id: 2, phase: "sent" },
      { id: 99, phase: "noisy" }, // unknown id: must be silently ignored
    ]);
  });

  const phasesById = new Map(hook.current.visits.map((v) => [v.id, v.phase]));
  assert.equal(phasesById.get(1), "draft", "untouched entry kept its phase");
  assert.equal(phasesById.get(2), "sent", "matching id was rewritten");
  assert.equal(phasesById.get(3), "draft", "untouched entry kept its phase");
  assert.equal(hook.current.visits.length, 3, "unknown ids must not extend the rail");

  // The localStorage payload must agree with the in-memory state so a
  // re-mount (or sibling tab) reads the fresh phases too.
  const stored = JSON.parse(
    window.localStorage.getItem(STORAGE_KEY) ?? "[]",
  ) as RecentGroupVisit[];
  const storedById = new Map(stored.map((v) => [v.id, v.phase]));
  assert.equal(storedById.get(2), "sent");
  assert.equal(storedById.get(1), "draft");
});

test("applyPhaseUpdates is a no-op when every supplied phase already matches", () => {
  seedStorage([
    { id: 1, invoiceNumber: "INV-1", phase: "draft", visitedAt: 1 },
    { id: 2, invoiceNumber: "INV-2", phase: "sent", visitedAt: 2 },
  ]);

  const hook = captureHook();
  const visitsBefore = hook.current.visits;

  let sameTabFired = 0;
  const onEvent = () => {
    sameTabFired++;
  };
  window.addEventListener(SAME_TAB_EVENT, onEvent);

  act(() => {
    hook.current.applyPhaseUpdates([
      { id: 1, phase: "draft" },
      { id: 2, phase: "sent" },
    ]);
  });

  window.removeEventListener(SAME_TAB_EVENT, onEvent);

  assert.equal(
    sameTabFired,
    0,
    "same-tab event must not fire when nothing actually changes",
  );
  assert.equal(
    hook.current.visits,
    visitsBefore,
    "visits identity must be stable when applyPhaseUpdates is a no-op (no React re-render churn)",
  );
});

test("applyPhaseUpdates dispatches the same-tab event when at least one phase changes", () => {
  seedStorage([
    { id: 1, invoiceNumber: "INV-1", phase: "draft", visitedAt: 1 },
    { id: 2, invoiceNumber: "INV-2", phase: "sent", visitedAt: 2 },
  ]);

  const hook = captureHook();

  let sameTabFired = 0;
  const onEvent = () => {
    sameTabFired++;
  };
  window.addEventListener(SAME_TAB_EVENT, onEvent);

  act(() => {
    // id 1 changes (draft -> sent); id 2 is a no-op. The batch as a
    // whole still counts as "changed" and must notify the same tab.
    hook.current.applyPhaseUpdates([
      { id: 1, phase: "sent" },
      { id: 2, phase: "sent" },
    ]);
  });

  window.removeEventListener(SAME_TAB_EVENT, onEvent);

  assert.equal(
    sameTabFired,
    1,
    "same-tab event must fire exactly once per applyPhaseUpdates call that produced a change",
  );
  const phasesById = new Map(hook.current.visits.map((v) => [v.id, v.phase]));
  assert.equal(phasesById.get(1), "sent");
  assert.equal(phasesById.get(2), "sent");
});

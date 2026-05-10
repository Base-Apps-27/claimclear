// Unit coverage for `useUnsavedDraftLeaveGuard` (Task #672).
//
// The hook owns the beforeunload + history.pushState/replaceState +
// popstate plumbing previously duplicated across
// `per-leg-context-editor.tsx` and `rich-text-editor.tsx`. The
// contracts pinned here:
//   • While `hasUnsavedDraft` is false, no listeners or history
//     patches are installed and `leaveConfirmOpen` stays false.
//   • Activating the guard installs the `beforeunload` listener and
//     wraps `history.pushState`/`replaceState`. A wrapped pushState
//     call defers the navigation (URL does NOT change yet) and flips
//     `leaveConfirmOpen` to true.
//   • `confirmLeave` resolves a pending push by calling the original
//     pushState (URL changes); `cancelLeave` drops the pending nav
//     and just closes the dialog.
//   • Deactivating the guard restores the original history methods
//     and removes the window listeners — no leakage to other screens.

import "../components/decision-tree/terminals/_setup-jsdom.ts";

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { render, act, cleanup } from "@testing-library/react";
import {
  useUnsavedDraftLeaveGuard,
  type UnsavedDraftLeaveGuard,
} from "./use-unsaved-draft-leave-guard";

void React;

function Harness({
  hasUnsavedDraft,
  onState,
}: {
  hasUnsavedDraft: boolean;
  onState: (s: UnsavedDraftLeaveGuard) => void;
}) {
  const guard = useUnsavedDraftLeaveGuard(hasUnsavedDraft);
  React.useEffect(() => {
    onState(guard);
  });
  return (
    <span data-testid="open">{guard.leaveConfirmOpen ? "yes" : "no"}</span>
  );
}

test("useUnsavedDraftLeaveGuard: inactive while hasUnsavedDraft=false; pushState passes through", async () => {
  const startUrl = window.location.href;
  const originalPush = window.history.pushState;
  let last: UnsavedDraftLeaveGuard | null = null;
  const { getByTestId, unmount } = render(
    <Harness hasUnsavedDraft={false} onState={(s) => (last = s)} />,
  );
  assert.equal(getByTestId("open").textContent, "no");
  // pushState must NOT be patched while the guard is inactive.
  assert.equal(window.history.pushState, originalPush);
  await act(async () => {
    window.history.pushState({}, "", "/inactive-passthrough");
  });
  assert.equal(window.location.pathname, "/inactive-passthrough");
  assert.equal(last!.leaveConfirmOpen, false);
  // Restore for sibling tests.
  window.history.pushState({}, "", startUrl);
  unmount();
  cleanup();
});

test("useUnsavedDraftLeaveGuard: active guard intercepts pushState, defers nav, opens dialog; confirmLeave resolves it", async () => {
  const startUrl = window.location.href;
  const originalPush = window.history.pushState;
  let last: UnsavedDraftLeaveGuard | null = null;
  const { getByTestId, unmount } = render(
    <Harness hasUnsavedDraft={true} onState={(s) => (last = s)} />,
  );
  // History methods are now patched.
  assert.notEqual(window.history.pushState, originalPush);
  assert.equal(getByTestId("open").textContent, "no");

  await act(async () => {
    window.history.pushState({ a: 1 }, "", "/intercepted");
  });
  // URL must NOT have changed — navigation was deferred.
  assert.equal(window.location.href, startUrl);
  assert.equal(getByTestId("open").textContent, "yes");

  await act(async () => {
    last!.confirmLeave();
  });
  // Confirming runs the original pushState, so the URL flips now.
  assert.equal(window.location.pathname, "/intercepted");
  assert.equal(getByTestId("open").textContent, "no");

  window.history.pushState({}, "", startUrl);
  unmount();
  cleanup();
});

test("useUnsavedDraftLeaveGuard: cancelLeave drops the pending navigation and closes the dialog", async () => {
  const startUrl = window.location.href;
  let last: UnsavedDraftLeaveGuard | null = null;
  const { getByTestId, unmount } = render(
    <Harness hasUnsavedDraft={true} onState={(s) => (last = s)} />,
  );
  await act(async () => {
    window.history.pushState({}, "", "/will-be-cancelled");
  });
  assert.equal(getByTestId("open").textContent, "yes");
  assert.equal(window.location.href, startUrl);

  await act(async () => {
    last!.cancelLeave();
  });
  assert.equal(getByTestId("open").textContent, "no");
  assert.equal(window.location.href, startUrl);
  unmount();
  cleanup();
});

test("useUnsavedDraftLeaveGuard: deactivating restores pass-through pushState (no leak)", async () => {
  const startUrl = window.location.href;
  const patchedSentinel = window.history.pushState;
  let last: UnsavedDraftLeaveGuard | null = null;
  const { rerender, unmount } = render(
    <Harness hasUnsavedDraft={true} onState={(s) => (last = s)} />,
  );
  // Active: pushState is wrapped (different function reference).
  assert.notEqual(window.history.pushState, patchedSentinel);
  await act(async () => {
    rerender(<Harness hasUnsavedDraft={false} onState={(s) => (last = s)} />);
  });
  // After deactivation, a pushState call must navigate WITHOUT
  // tripping the dialog — proving the patch is gone.
  await act(async () => {
    window.history.pushState({}, "", "/after-deactivate");
  });
  assert.equal(window.location.pathname, "/after-deactivate");
  assert.equal(last!.leaveConfirmOpen, false);
  window.history.pushState({}, "", startUrl);
  unmount();
  cleanup();
});

test("useUnsavedDraftLeaveGuard: unmounting an active guard also restores pass-through pushState", async () => {
  const startUrl = window.location.href;
  const beforeMount = window.history.pushState;
  const { unmount } = render(
    <Harness hasUnsavedDraft={true} onState={() => {}} />,
  );
  assert.notEqual(window.history.pushState, beforeMount);
  await act(async () => {
    unmount();
  });
  // After unmount, pushState must pass through to the real navigation.
  await act(async () => {
    window.history.pushState({}, "", "/after-unmount");
  });
  assert.equal(window.location.pathname, "/after-unmount");
  window.history.pushState({}, "", startUrl);
  cleanup();
});

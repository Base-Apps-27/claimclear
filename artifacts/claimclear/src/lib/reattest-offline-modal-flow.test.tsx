// Task #335 — visual end-to-end coverage for the right-rail offline
// re-attest override modal on the invoice-group detail page (Task #333).
//
// Backend behavior (admin-only, >=10-char trimmed note, distinct
// `mas_reattest_recorded_offline` audit row, bypasses
// cancel-completeness) is fully pinned by
// artifacts/api-server/src/__tests__/mas-reattest-offline.test.ts. The
// front-end coverage so far is unit-level (audit-action-meta-mas-offline
// and the audit-label glossary). This file covers the UI flow:
//
//   1. Admin sees the "Mark as already re-attested" link on a group
//      whose `reattestRequired=true` and `reattestCompletedAt=null`.
//   2. Non-admin (or already-completed group) does NOT see the link.
//   3. Walking the modal's local state (typing the note, ticking the
//      confirm checkbox, mutation in flight) flips the submit button
//      through its disabled→enabled→disabled transitions exactly the
//      way the inline form does at runtime.
//   4. On submit, the body posted to
//      POST /invoice-groups/:id/reattest/complete is
//      `{ recordedOffline: true, offlineNote: <trimmed-note> }` —
//      pinning the same shape the backend test asserts from the
//      server side.
//
// We follow the project pattern established by
// per-leg-context-editor.tsx → per-leg-context-editor.test.tsx: pure helpers are
// factored out of the React component (visibility gate, submit
// predicate, payload builder) so the regression-relevant edges can be
// exercised from node:test without spinning up jsdom. A render-side
// check uses react-dom/server to confirm a small harness component
// puts the right disabled/enabled attribute on the actual submit
// button markup as the helper output flips.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import {
  isOfflineReattestNoteValid,
  canSubmitOfflineReattest,
  canShowOfflineReattestOverride,
  buildOfflineReattestPayload,
} from "./reattest-offline-modal-helpers";

void React;

/* ------------------------------------------------------------------ */
/* 1. Visibility of the override link (admin gate + lifecycle gate). */
/* ------------------------------------------------------------------ */

test("override link is shown for an admin viewing a group with reattestRequired=true and no completion stamp", () => {
  // Mirrors the right-rail render gate at the top of the
  // "Admin overrides" block in invoice-group-detail-v2.tsx.
  assert.equal(
    canShowOfflineReattestOverride({
      isAdmin: true,
      reattestRequired: true,
      reattestCompletedAt: null,
    }),
    true,
  );
});

test("override link is HIDDEN for a non-admin even when reattestRequired=true", () => {
  // The non-admin path is a quiet status panel pointing the operator at
  // Responses Awaiting Review — the override surface must not render.
  assert.equal(
    canShowOfflineReattestOverride({
      isAdmin: false,
      reattestRequired: true,
      reattestCompletedAt: null,
    }),
    false,
  );
});

test("override link is HIDDEN once reattestCompletedAt is stamped (organic completion or prior offline override)", () => {
  // Once the group has been re-attested (either via the standard
  // checklist on RAR or via a previous offline override), the override
  // surface goes away — no second-press of the same admin button.
  assert.equal(
    canShowOfflineReattestOverride({
      isAdmin: true,
      reattestRequired: true,
      reattestCompletedAt: "2026-04-30T12:00:00.000Z",
    }),
    false,
  );
});

test("override link is HIDDEN when reattestRequired=false (no MAS work pending)", () => {
  // Groups that never tripped the re-attest flag have nothing to
  // override, so the admin block doesn't render either.
  assert.equal(
    canShowOfflineReattestOverride({
      isAdmin: true,
      reattestRequired: false,
      reattestCompletedAt: null,
    }),
    false,
  );
});

/* ------------------------------------------------------------------ */
/* 2. Disabled → enabled → disabled transitions on the submit button. */
/* ------------------------------------------------------------------ */

test("submit is DISABLED on a fresh modal (empty note + checkbox unticked)", () => {
  // Initial modal state: nothing typed, nothing ticked. Backend would
  // 400 on a short note; the front-end gate stops the request before
  // it leaves the browser.
  assert.equal(
    canSubmitOfflineReattest({ note: "", confirmed: false, isPending: false }),
    false,
  );
});

test("submit stays DISABLED while the note is under the 10-trimmed-char floor (matches backend validator)", () => {
  // Even with the confirm checkbox ticked, a 9-char (or whitespace-
  // padded) note must keep the button disabled — the trimmed-length
  // floor is what mas-reattest-offline.test.ts pins on the server.
  assert.equal(isOfflineReattestNoteValid("too short"), false); // 9 chars
  assert.equal(isOfflineReattestNoteValid("         "), false); // 9 spaces, trims to 0
  assert.equal(
    canSubmitOfflineReattest({
      note: "too short",
      confirmed: true,
      isPending: false,
    }),
    false,
  );
});

test("submit stays DISABLED when the note clears 10 chars but the confirm checkbox is unticked", () => {
  // The acknowledgement checkbox is a deliberate second gesture — a
  // 10+ char note alone is not enough to enable the button.
  assert.equal(isOfflineReattestNoteValid("Paper-log reconciliation"), true);
  assert.equal(
    canSubmitOfflineReattest({
      note: "Paper-log reconciliation",
      confirmed: false,
      isPending: false,
    }),
    false,
  );
});

test("submit ENABLES once note is >=10 trimmed chars AND confirm checkbox is ticked AND mutation is idle", () => {
  // The successful-submit path: every gate flips green.
  assert.equal(
    canSubmitOfflineReattest({
      note: "Re-attested via paper log on 04/29",
      confirmed: true,
      isPending: false,
    }),
    true,
  );
});

test("submit re-DISABLES while the mutation is in flight (prevents double-fire)", () => {
  // Operator clicks submit, mutation goes pending; even though the note
  // and checkbox are both still valid, the button must lock to stop a
  // second click from posting a duplicate.
  assert.equal(
    canSubmitOfflineReattest({
      note: "Re-attested via paper log on 04/29",
      confirmed: true,
      isPending: true,
    }),
    false,
  );
});

test("trimmed-length floor counts trimmed characters, not raw length", () => {
  // The note "  short.  " is 10 raw chars but only 6 after trimming —
  // must be rejected. Conversely, an exactly-10-char trimmed string
  // (still surrounded by whitespace) must pass.
  assert.equal(isOfflineReattestNoteValid("  short.  "), false);
  assert.equal(isOfflineReattestNoteValid("   1234567890   "), true);
  assert.equal(isOfflineReattestNoteValid("1234567890"), true);
  assert.equal(isOfflineReattestNoteValid("123456789"), false);
});

/* ------------------------------------------------------------------ */
/* 3. Request payload shape posted on submit.                         */
/* ------------------------------------------------------------------ */

test("buildOfflineReattestPayload sends recordedOffline=true and the trimmed note", () => {
  // Pins the body shape the backend asserts in
  // mas-reattest-offline.test.ts. Trimming on the way out matters
  // because the server-side validator also trims; if the front-end
  // sent the raw note, a "10 chars + trailing newline" note would
  // pass the front-end gate but the server's count could disagree.
  const payload = buildOfflineReattestPayload(
    "  Re-attested via paper log on 04/29  ",
  );
  assert.deepEqual(payload, {
    recordedOffline: true,
    offlineNote: "Re-attested via paper log on 04/29",
  });
});

test("buildOfflineReattestPayload narrows recordedOffline to the literal `true` (TypeScript contract)", () => {
  // Using `as const` semantics here — the backend's offline branch is
  // gated on `recordedOffline === true`, not just truthy, so the
  // payload type must pin the literal.
  const payload = buildOfflineReattestPayload("ten chars!");
  assert.equal(payload.recordedOffline, true);
  assert.equal(typeof payload.offlineNote, "string");
});

/* ------------------------------------------------------------------ */
/* 4. Render-side smoke: a tiny harness component that mirrors the    */
/*    actual submit-button markup. Confirms the helper output makes   */
/*    its way onto the rendered `disabled` attribute and the          */
/*    data-testid the page exposes (button-submit-offline-reattest).  */
/* ------------------------------------------------------------------ */

function SubmitButtonHarness(props: {
  note: string;
  confirmed: boolean;
  isPending: boolean;
}) {
  const enabled = canSubmitOfflineReattest(props);
  return (
    <button
      type="button"
      disabled={!enabled}
      data-testid="button-submit-offline-reattest"
    >
      Mark as re-attested
    </button>
  );
}

test("submit button markup carries the disabled attribute when the helper says no", () => {
  const html = renderToStaticMarkup(
    <SubmitButtonHarness note="" confirmed={false} isPending={false} />,
  );
  assert.match(html, /data-testid="button-submit-offline-reattest"/);
  // react-dom/server emits `disabled=""` for the boolean attribute.
  assert.match(html, /disabled=""/);
});

test("submit button markup drops the disabled attribute once all gates pass", () => {
  const html = renderToStaticMarkup(
    <SubmitButtonHarness
      note="Re-attested via paper log on 04/29"
      confirmed
      isPending={false}
    />,
  );
  assert.match(html, /data-testid="button-submit-offline-reattest"/);
  assert.equal(html.includes("disabled"), false);
});

test("submit button markup re-asserts disabled while the mutation is in flight", () => {
  // Even with note + checkbox green, the in-flight lock must reach
  // the rendered attribute.
  const html = renderToStaticMarkup(
    <SubmitButtonHarness
      note="Re-attested via paper log on 04/29"
      confirmed
      isPending
    />,
  );
  assert.match(html, /disabled=""/);
});

/* ------------------------------------------------------------------ */
/* 5. End-to-end "click submit" simulation: the predicate sequence     */
/*    a real operator walks through (open modal → type → tick →       */
/*    submit) lands on the right payload. This is the closest the     */
/*    project's no-jsdom test pattern can get to the Playwright-style  */
/*    flow described in Task #335.                                    */
/* ------------------------------------------------------------------ */

test("admin operator walkthrough: opens modal, types note, ticks confirm, submits → posts the right body", () => {
  // Step 1: page loads. Admin + reattestRequired + no completion →
  //         override link is rendered.
  const isAdmin = true;
  const group = { reattestRequired: true, reattestCompletedAt: null as string | null };
  assert.equal(
    canShowOfflineReattestOverride({
      isAdmin,
      reattestRequired: group.reattestRequired,
      reattestCompletedAt: group.reattestCompletedAt,
    }),
    true,
    "admin must see the override link",
  );

  // Step 2: operator clicks the link, modal opens with empty form.
  let note = "";
  let confirmed = false;
  let isPending = false;
  assert.equal(
    canSubmitOfflineReattest({ note, confirmed, isPending }),
    false,
    "fresh modal must have submit disabled",
  );

  // Step 3: operator starts typing. Still under the floor.
  note = "short";
  assert.equal(canSubmitOfflineReattest({ note, confirmed, isPending }), false);

  // Step 4: operator finishes the note (clears 10 chars) but hasn't
  //         ticked the checkbox yet.
  note = "Re-attested via paper log on 04/29";
  assert.equal(canSubmitOfflineReattest({ note, confirmed, isPending }), false);

  // Step 5: operator ticks the confirm checkbox. Submit unlocks.
  confirmed = true;
  assert.equal(
    canSubmitOfflineReattest({ note, confirmed, isPending }),
    true,
    "submit must enable once note + checkbox are both valid",
  );

  // Step 6: operator clicks submit. The body posted matches the
  //         backend contract.
  const payload = buildOfflineReattestPayload(note);
  assert.deepEqual(payload, {
    recordedOffline: true,
    offlineNote: "Re-attested via paper log on 04/29",
  });

  // Step 7: mutation goes pending → submit re-locks until the
  //         response lands (success closes the modal and resets
  //         the form; the lifecycle gate also drops the override
  //         once the server stamps reattestCompletedAt).
  isPending = true;
  assert.equal(
    canSubmitOfflineReattest({ note, confirmed, isPending }),
    false,
    "submit must re-lock while the mutation is in flight",
  );
  isPending = false;
  group.reattestCompletedAt = "2026-05-02T12:00:00.000Z";
  assert.equal(
    canShowOfflineReattestOverride({
      isAdmin,
      reattestRequired: group.reattestRequired,
      reattestCompletedAt: group.reattestCompletedAt,
    }),
    false,
    "post-success: the override surface must disappear once the server stamps completion",
  );
});

test("non-admin operator walkthrough: override link is never rendered, so the modal is unreachable", () => {
  // Mirrors the second test the task asks for: an operator (not admin)
  // viewing a reattestRequired group must NOT see the override link.
  // We assert the gate returns false for every lifecycle slice — the
  // modal mount in invoice-group-detail-v2.tsx is also wrapped by the
  // same gate, so the modal contents (textarea, checkbox, submit)
  // never enter the DOM for a non-admin.
  for (const completedAt of [null, "2026-05-02T12:00:00.000Z"]) {
    assert.equal(
      canShowOfflineReattestOverride({
        isAdmin: false,
        reattestRequired: true,
        reattestCompletedAt: completedAt,
      }),
      false,
      `non-admin must never see the override (completedAt=${completedAt})`,
    );
  }
});

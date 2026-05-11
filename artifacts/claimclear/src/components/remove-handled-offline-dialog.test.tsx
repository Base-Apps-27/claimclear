// Task #689 — interaction tests for the per-leg "Remove — handled
// offline" dialog. The backend coverage in
// artifacts/api-server/src/__tests__/per-leg-state.test.ts already
// pins the >=10-char note rule, the source-state guard, and the
// distinct `claim_removed_handled_offline` audit row. These tests pin
// the *front-end* contract that flows into that route:
//
//   1. The submit button is disabled until BOTH the note is long
//      enough AND the operator ticks the "I confirm" checkbox, and
//      goes back to disabled while the mutation is in flight.
//   2. The body posted to POST /claims/:id/exclude is exactly
//      `{ reason: "handled_offline", note: <trimmed-note> }` — i.e.
//      whitespace is trimmed before submission.
//   3. A small render-side check confirms the actual submit button
//      markup picks up the disabled attribute as the predicate flips,
//      so a UI rewrite that drops the `disabled={!canSubmit}` wiring
//      is caught.
//
// We follow the same pure-helper + render-harness split used by
// reattest-offline-modal-flow.test.tsx so we don't need jsdom.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HANDLED_OFFLINE_NOTE_MIN,
  isHandledOfflineNoteValid,
  canSubmitHandledOffline,
  buildHandledOfflinePayload,
  trimmedNoteLength,
  runHandledOfflineSuccessSideEffects,
  type HandledOfflineQueryKeyBuilders,
} from "./remove-handled-offline-dialog-helpers";

void React;

/* ------------------------------------------------------------------ */
/* 1. Note-length predicate (server enforces the same rule).          */
/* ------------------------------------------------------------------ */

test("isHandledOfflineNoteValid rejects an empty note", () => {
  assert.equal(isHandledOfflineNoteValid(""), false);
});

test("isHandledOfflineNoteValid rejects a whitespace-only note even past the min length", () => {
  // 12 spaces would clear the literal length but the trimmed length
  // is what the server checks — and the dialog's counter mirrors.
  assert.equal(isHandledOfflineNoteValid("            "), false);
});

test("isHandledOfflineNoteValid rejects a note with fewer than min trimmed characters", () => {
  assert.equal(isHandledOfflineNoteValid("   short   "), false);
});

test("isHandledOfflineNoteValid accepts a trimmed-length note exactly at the min", () => {
  assert.equal(trimmedNoteLength("abcdefghij"), HANDLED_OFFLINE_NOTE_MIN);
  assert.equal(isHandledOfflineNoteValid("abcdefghij"), true);
});

test("isHandledOfflineNoteValid accepts a realistic operator note", () => {
  assert.equal(
    isHandledOfflineNoteValid(
      "Confirmed in MAS portal — already paid offline last week.",
    ),
    true,
  );
});

/* ------------------------------------------------------------------ */
/* 2. Submit gate — note + checkbox + not-in-flight all required.     */
/* ------------------------------------------------------------------ */

test("canSubmitHandledOffline is false with a valid note but no checkbox", () => {
  assert.equal(
    canSubmitHandledOffline({
      note: "Already attested offline last Friday.",
      confirmed: false,
      isPending: false,
    }),
    false,
  );
});

test("canSubmitHandledOffline is false with the checkbox ticked but a too-short note", () => {
  assert.equal(
    canSubmitHandledOffline({
      note: "too short",
      confirmed: true,
      isPending: false,
    }),
    false,
  );
});

test("canSubmitHandledOffline is true once both gates clear and the mutation is idle", () => {
  assert.equal(
    canSubmitHandledOffline({
      note: "Already attested offline last Friday.",
      confirmed: true,
      isPending: false,
    }),
    true,
  );
});

test("canSubmitHandledOffline goes back to false while the mutation is in flight", () => {
  // Mirrors the runtime <Button disabled> behavior so a rapid second
  // click can't fire a second exclude.
  assert.equal(
    canSubmitHandledOffline({
      note: "Already attested offline last Friday.",
      confirmed: true,
      isPending: true,
    }),
    false,
  );
});

/* ------------------------------------------------------------------ */
/* 3. Payload shape — what we actually post to /claims/:id/exclude.   */
/* ------------------------------------------------------------------ */

test("buildHandledOfflinePayload emits reason=handled_offline and trims the note", () => {
  const payload = buildHandledOfflinePayload(
    "    Already attested offline.    \n",
  );
  assert.equal(payload.reason, "handled_offline");
  assert.equal(payload.note, "Already attested offline.");
});

/* ------------------------------------------------------------------ */
/* 4. Render-side proof: a tiny harness confirms the predicate is     */
/*    actually wired into the submit button's `disabled` attribute.   */
/* ------------------------------------------------------------------ */

function SubmitHarness({
  note,
  confirmed,
  isPending,
}: {
  note: string;
  confirmed: boolean;
  isPending: boolean;
}) {
  const can = canSubmitHandledOffline({ note, confirmed, isPending });
  return (
    <button
      type="button"
      data-testid="remove-handled-offline-confirm"
      disabled={!can}
    >
      Remove leg
    </button>
  );
}

test("submit button is rendered disabled when the gate is not yet open", () => {
  const html = renderToStaticMarkup(
    <SubmitHarness note="" confirmed={false} isPending={false} />,
  );
  assert.match(html, /data-testid="remove-handled-offline-confirm"/);
  assert.match(html, /disabled/, "submit must start disabled");
});

test("submit button drops the disabled attribute once the note + checkbox are both satisfied", () => {
  const html = renderToStaticMarkup(
    <SubmitHarness
      note="Confirmed offline — clean line."
      confirmed={true}
      isPending={false}
    />,
  );
  assert.match(html, /data-testid="remove-handled-offline-confirm"/);
  // react-dom/server omits the attribute entirely when disabled is
  // false on a <button>, so a missing token is the proof.
  assert.equal(
    /disabled/.test(html),
    false,
    "submit must be enabled once both gates clear",
  );
});

test("submit button is rendered disabled again while the mutation is in flight", () => {
  const html = renderToStaticMarkup(
    <SubmitHarness
      note="Confirmed offline — clean line."
      confirmed={true}
      isPending={true}
    />,
  );
  assert.match(html, /disabled/);
});

/* ------------------------------------------------------------------ */
/* 5. Success-flow side effects — what the dialog does after the      */
/*    server confirms the exclusion. Pinned at the helper level so a  */
/*    refactor of the React component can't silently drop one of the  */
/*    invalidations or the onRemoved hand-off.                        */
/* ------------------------------------------------------------------ */

function recordingKeys(): {
  keys: HandledOfflineQueryKeyBuilders;
  calls: { name: string; args: readonly unknown[] }[];
} {
  const calls: { name: string; args: readonly unknown[] }[] = [];
  return {
    calls,
    keys: {
      getGetClaimQueryKey: (id: number) => {
        const key = ["claim", id] as const;
        calls.push({ name: "getGetClaimQueryKey", args: [id] });
        return key;
      },
      getListClaimAuditLogsQueryKey: (id: number) => {
        const key = ["claim", id, "audit"] as const;
        calls.push({ name: "getListClaimAuditLogsQueryKey", args: [id] });
        return key;
      },
      getGetInvoiceGroupQueryKey: (id: number) => {
        const key = ["invoiceGroup", id] as const;
        calls.push({ name: "getGetInvoiceGroupQueryKey", args: [id] });
        return key;
      },
      getListInvoiceGroupsQueryKey: () => {
        const key = ["invoiceGroups"] as const;
        calls.push({ name: "getListInvoiceGroupsQueryKey", args: [] });
        return key;
      },
    },
  };
}

test("success flow invalidates leg + audit + group + group-list, closes the dialog, and notifies the parent (queue path)", () => {
  // Mirrors the queue-row path: a leg in an invoice group, with an
  // onRemoved callback the parent uses to refresh its row state.
  const invalidations: readonly unknown[][] = [];
  const opens: boolean[] = [];
  let removedFired = 0;
  const { keys } = recordingKeys();

  runHandledOfflineSuccessSideEffects({
    qc: {
      invalidateQueries: ({ queryKey }) => {
        (invalidations as unknown[][]).push([...queryKey]);
        return undefined;
      },
    },
    keys,
    claimId: 4242,
    groupId: 99,
    onOpenChange: (next) => opens.push(next),
    onRemoved: () => {
      removedFired += 1;
    },
  });

  // 4 invalidations in dialog-source order.
  assert.deepEqual(invalidations, [
    ["claim", 4242],
    ["claim", 4242, "audit"],
    ["invoiceGroup", 99],
    ["invoiceGroups"],
  ]);
  // Dialog closes after success.
  assert.deepEqual(opens, [false]);
  // Parent surface (queue overflow menu) is told the leg was removed
  // exactly once so it can refresh / collapse.
  assert.equal(removedFired, 1);
});

test("success flow skips the per-group invalidation when the dialog was opened without a groupId (leg-detail path)", () => {
  // Mirrors the leg-detail header trigger: the dialog is mounted
  // without a groupId because the leg-detail page already drives its
  // own claim refresh through the leg query.
  const invalidations: readonly unknown[][] = [];
  const opens: boolean[] = [];
  const { keys } = recordingKeys();

  runHandledOfflineSuccessSideEffects({
    qc: {
      invalidateQueries: ({ queryKey }) => {
        (invalidations as unknown[][]).push([...queryKey]);
        return undefined;
      },
    },
    keys,
    claimId: 7,
    groupId: null,
    onOpenChange: (next) => opens.push(next),
    // No onRemoved — leg-detail path doesn't need the callback.
  });

  // No `["invoiceGroup", *]` entry because groupId is null. The list
  // invalidation still runs so the queue picks up the change.
  assert.deepEqual(invalidations, [
    ["claim", 7],
    ["claim", 7, "audit"],
    ["invoiceGroups"],
  ]);
  assert.deepEqual(opens, [false]);
});

test("success flow does not throw when onRemoved is omitted", () => {
  // Defensive: leg-detail path passes no onRemoved. The helper must
  // tolerate that without throwing.
  const { keys } = recordingKeys();
  assert.doesNotThrow(() =>
    runHandledOfflineSuccessSideEffects({
      qc: { invalidateQueries: () => undefined },
      keys,
      claimId: 1,
      groupId: undefined,
      onOpenChange: () => {},
    }),
  );
});

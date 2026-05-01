import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  DEFAULT_COLLAPSED_GROUPS,
  getInitialCollapsedGroups,
  getCheckedDraftIds,
  selectionIsAllDrafts,
  formatCompletedElsewhereLabel,
  formatCompletedElsewhereTooltip,
  countDraftsAlreadyDoneElsewhere,
  makePillClickHandler,
  makeDiscardArmState,
  isDiscardStillArmed,
  DISCARD_ARM_TTL_MS,
} from "./portal-submissions-helpers";

test("default-collapsed groups include cancelled (Calm Portal Submissions task)", () => {
  assert.ok(DEFAULT_COLLAPSED_GROUPS.has("cancelled"));
  assert.ok(DEFAULT_COLLAPSED_GROUPS.has("submitted"));
  const set = getInitialCollapsedGroups();
  assert.notEqual(set, DEFAULT_COLLAPSED_GROUPS, "must return a fresh mutable set");
  assert.ok(set.has("cancelled"));
});

test("getCheckedDraftIds returns only ids of rows whose status is draft AND checked", () => {
  const rows = [
    { id: 1, status: "draft" },
    { id: 2, status: "draft" },
    { id: 3, status: "pending" },
    { id: 4, status: "draft" },
  ];
  const checked = new Set([1, 3, 4]);
  assert.deepEqual(getCheckedDraftIds(rows, checked), [1, 4]);
});

test("selectionIsAllDrafts is true only when every checked row is a draft and at least one is selected", () => {
  const rows = [
    { id: 1, status: "draft" },
    { id: 2, status: "draft" },
    { id: 3, status: "pending" },
  ];
  assert.equal(selectionIsAllDrafts(rows, new Set()), false);
  assert.equal(selectionIsAllDrafts(rows, new Set([1, 2])), true);
  assert.equal(selectionIsAllDrafts(rows, new Set([1, 3])), false);
  assert.equal(selectionIsAllDrafts(rows, new Set([3])), false);
});

test("formatCompletedElsewhereLabel uses runLabel when present, falls back when null", () => {
  assert.equal(
    formatCompletedElsewhereLabel({ submissionId: 5, runId: 7, runLabel: "#7", submittedAt: null }),
    "Already submitted in run #7",
  );
  assert.equal(
    formatCompletedElsewhereLabel({ submissionId: 5, runId: null, runLabel: null, submittedAt: null }),
    "Already submitted elsewhere",
  );
});

test("formatCompletedElsewhereTooltip embeds the formatted submittedAt + click hint", () => {
  const tip = formatCompletedElsewhereTooltip({
    submissionId: 5,
    runId: 7,
    runLabel: "#7",
    submittedAt: "2026-04-15T18:30:00.000Z",
  });
  assert.match(tip, /batch run #7/);
  assert.match(tip, /Apr 15, 2026/);
  assert.match(tip, /Click to open that submission/);
});

test("formatCompletedElsewhereTooltip handles legacy rows without submittedAt or runLabel", () => {
  const tip = formatCompletedElsewhereTooltip({
    submissionId: 5,
    runId: null,
    runLabel: null,
    submittedAt: null,
  });
  assert.match(tip, /another run/);
  assert.doesNotMatch(tip, /batch run/);
  assert.match(tip, /Click to open that submission/);
});

test("makePillClickHandler stops propagation and opens the sibling submission", () => {
  let stopped = 0;
  let openedWith: number | null = null;
  const handler = makePillClickHandler(
    { submissionId: 42, runId: 7, runLabel: "#7", submittedAt: null },
    (id) => { openedWith = id; },
  );
  handler({ stopPropagation: () => { stopped += 1; } });
  assert.equal(stopped, 1, "must stop propagation so the row click doesn't fire");
  assert.equal(openedWith, 42, "must open the sibling submission, not the current row");
});

test("draft discard arm state expires after TTL", () => {
  const t0 = 1_000_000;
  const armed = makeDiscardArmState(t0);
  assert.equal(isDiscardStillArmed(armed, t0 + 1), true);
  assert.equal(isDiscardStillArmed(armed, t0 + DISCARD_ARM_TTL_MS - 1), true);
  assert.equal(isDiscardStillArmed(armed, t0 + DISCARD_ARM_TTL_MS + 1), false);
  assert.equal(isDiscardStillArmed(null), false);
});

test("countDraftsAlreadyDoneElsewhere counts only rows with a completedElsewhere", () => {
  const rows = [
    { completedElsewhere: { submissionId: 1, runId: 1, runLabel: "#1", submittedAt: null } },
    { completedElsewhere: null },
    { completedElsewhere: undefined },
    { completedElsewhere: { submissionId: 2, runId: 2, runLabel: "#2", submittedAt: null } },
  ];
  assert.equal(countDraftsAlreadyDoneElsewhere(rows), 2);
});

// Task #761 — Coverage for the V2 header layout (Task #759).
//
// The V2 header has several conditional render paths the page used to
// rely on a human eyeball to verify:
//
//   * row 2 "toolbar" hides when the inbox is genuinely empty
//     (no rows AND no active filters)
//   * row 3 "Showing / Hiding" state strip collapses when nothing is
//     filtered AND nothing is hidden
//   * the bulk-bar slot replaces the inline HC-shortcut when a
//     selection is present (the duplicate "Select all High-confidence
//     Approvals" button must disappear from the sort row)
//   * the info-icon tooltip in row 1 carries the long
//     "Stage 2 inbox…" copy
//   * sr-only marker spans preserve `hidden-items-strip-loading` and
//     `hidden-items-strip-empty` test ids in the collapsed states
//   * "Clear all" only surfaces when there are 2+ active filter chips
//
// The page itself is a query-and-router-heavy shell (50+ hooks). The
// V2 layout logic was extracted into `responses-awaiting-review-header.tsx`
// so it can be rendered with crafted slot props for each canonical
// state. This mirrors the existing harness pattern (renderToStaticMarkup,
// no jsdom) used by responses-awaiting-review.test.tsx.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ReviewHeader,
  type FilterBarSlots,
  type HiddenItemsSlots,
  type SortOption,
} from "./responses-awaiting-review-header";

void React;

// ── Slot fixtures ──────────────────────────────────────────────────

const SORT_OPTIONS: ReadonlyArray<SortOption> = [
  { value: "oldest_response", label: "Oldest response first", help: "Oldest." },
  { value: "newest_response", label: "Newest response first", help: "Newest." },
  { value: "urgency", label: "Urgent today first", help: "Urgent." },
  { value: "amount", label: "Largest amount first", help: "Largest." },
];

const emptyFilterSlots: FilterBarSlots = {
  trigger: <span data-testid="filter-trigger-stub">filter</span>,
  search: <input data-testid="filter-search-stub" />,
  chips: null,
  chipCount: 0,
  hasActiveChips: false,
};

function filterSlotsWithChips(count: number): FilterBarSlots {
  const chipNodes = (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} data-testid={`active-filter-chip-${i}`}>
          chip-{i}
        </span>
      ))}
    </>
  );
  return {
    ...emptyFilterSlots,
    chips: chipNodes,
    chipCount: count,
    hasActiveChips: count > 0,
  };
}

const hiddenSlotsLoading: HiddenItemsSlots = {
  isLoading: true,
  hasChips: false,
  chips: null,
  activeBucket: null,
  marker: (
    <span className="sr-only" data-testid="hidden-items-strip-loading">
      loading
    </span>
  ),
};

const hiddenSlotsEmpty: HiddenItemsSlots = {
  isLoading: false,
  hasChips: false,
  chips: null,
  activeBucket: null,
  marker: (
    <span className="sr-only" data-testid="hidden-items-strip-empty">
      Nothing hidden from this view.
    </span>
  ),
};

const hiddenSlotsWithChips: HiddenItemsSlots = {
  isLoading: false,
  hasChips: true,
  activeBucket: null,
  chips: (
    <a data-testid="hidden-items-chip-awaitingPayorAgain" href="#">
      3 waiting for payor again
    </a>
  ),
  marker: null,
};

const hiddenSlotsActiveBucket: HiddenItemsSlots = {
  isLoading: false,
  hasChips: true,
  activeBucket: "awaitingPayorAgain",
  chips: (
    <button
      type="button"
      data-testid="hidden-items-chip-awaitingPayorAgain"
      aria-pressed="true"
    >
      3 waiting for payor again
    </button>
  ),
  marker: null,
};

const noop = () => {};

function renderHeader(
  overrides: Partial<React.ComponentProps<typeof ReviewHeader>> = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ReviewHeader
        groupCount={5}
        hasActiveFilters={false}
        sortMode="oldest_response"
        sortOptions={SORT_OPTIONS}
        onSortChange={noop}
        filterSlots={emptyFilterSlots}
        hiddenSlots={hiddenSlotsEmpty}
        clearAllFilters={noop}
        selectionEligibleAllCount={0}
        onSelectAllEligible={noop}
        bulkBar={null}
        {...overrides}
      />
    </TooltipProvider>,
  );
}

// Count occurrences of a substring — used to assert "no duplicate" claims.
function countMatches(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

// ── Canonical states ───────────────────────────────────────────────

test("V2 header (clean): toolbar visible, no state strip, no bulk-bar, sr-only empty marker", () => {
  const html = renderHeader();
  // Title row + count badge + info tooltip always present.
  assert.match(html, /Responses Awaiting Review/);
  assert.match(html, /data-testid="page-count-badge"[^>]*>\s*5 verdict pending/);
  assert.match(html, /data-testid="responses-awaiting-review-info"/);
  // Toolbar visible (rows > 0).
  assert.match(html, /data-testid="responses-awaiting-review-filter-bar"/);
  assert.match(html, /data-testid="sort-mode-select"/);
  // No state strip — nothing filtered, nothing hidden.
  assert.ok(
    !/data-testid="hidden-items-strip"[^-]/.test(html),
    "state strip should not render in the clean state",
  );
  assert.ok(
    !/data-testid="filter-chip-strip-clear-all"/.test(html),
    "Clear all should not surface in the clean state",
  );
  // sr-only marker preserves the empty test id.
  assert.match(html, /data-testid="hidden-items-strip-empty"/);
  // No bulk bar / no HC-shortcut (eligible count is 0).
  assert.ok(!/data-testid="bulk-approve-bar"/.test(html));
  assert.ok(!/data-testid="bulk-approve-header-select-all-eligible"/.test(html));
});

test("V2 header (with-filters): state strip renders chips and 'Showing' header", () => {
  const html = renderHeader({
    hasActiveFilters: true,
    filterSlots: filterSlotsWithChips(2),
  });
  assert.match(html, /data-testid="responses-awaiting-review-filter-bar"/);
  // State strip surfaces the "Showing" label and the chips.
  assert.match(html, /Showing/);
  assert.match(html, /data-testid="active-filter-chip-0"/);
  assert.match(html, /data-testid="active-filter-chip-1"/);
  // 2+ chips -> Clear all surfaces.
  assert.match(html, /data-testid="filter-chip-strip-clear-all"/);
  // No hidden chips -> no "Hiding" segment.
  assert.ok(!/Hiding/.test(html));
});

test("V2 header (with-filters, single chip): Clear all stays hidden", () => {
  const html = renderHeader({
    hasActiveFilters: true,
    filterSlots: filterSlotsWithChips(1),
  });
  assert.match(html, /data-testid="active-filter-chip-0"/);
  assert.ok(
    !/data-testid="filter-chip-strip-clear-all"/.test(html),
    "Clear all should require 2+ chips",
  );
});

test("V2 header (with-selection): bulk-bar replaces the inline HC-shortcut, no duplicate select-all", () => {
  const html = renderHeader({
    selectionEligibleAllCount: 4,
    bulkBar: (
      <div data-testid="bulk-approve-bar">
        <button data-testid="bulk-approve-select-all-eligible">
          Select all High-confidence Approvals
        </button>
      </div>
    ),
  });
  // Bulk-bar slot is rendered.
  assert.match(html, /data-testid="bulk-approve-bar"/);
  // Toolbar still renders…
  assert.match(html, /data-testid="responses-awaiting-review-filter-bar"/);
  assert.match(html, /data-testid="sort-mode-select"/);
  // …but the sort row's HC-shortcut button is suppressed when a
  // selection is present (the bulk-bar carries that affordance instead).
  assert.ok(
    !/data-testid="bulk-approve-header-select-all-eligible"/.test(html),
    "header HC-shortcut must not render alongside the bulk-bar",
  );
  // Defense in depth: the "Select all High-confidence Approvals" copy
  // must appear exactly once in the rendered HTML (the bulk-bar's own
  // button), never twice.
  assert.equal(
    countMatches(html, "Select all High-confidence Approvals"),
    1,
    "duplicate 'Select all High-confidence Approvals' button should not appear",
  );
});

test("V2 header (adverse-selection): bulk-bar still replaces the HC-shortcut even with eligibleAllCount > 0", () => {
  // Operator selected a mix of eligible + ineligible rows. The page
  // would still pass selectionEligibleAllCount > 0 (other rows on the
  // page are eligible), but the bulk-bar must own the header right edge.
  const html = renderHeader({
    selectionEligibleAllCount: 7,
    bulkBar: <div data-testid="bulk-approve-bar">selection bar</div>,
  });
  assert.match(html, /data-testid="bulk-approve-bar"/);
  assert.ok(
    !/data-testid="bulk-approve-header-select-all-eligible"/.test(html),
    "header HC-shortcut must not render alongside the bulk-bar (adverse selection)",
  );
});

test("V2 header (inbox-empty): toolbar hides, no state strip, sr-only empty marker preserved", () => {
  const html = renderHeader({ groupCount: 0, hasActiveFilters: false });
  // Title row stays so the count badge can show "0 verdict pending".
  assert.match(html, /data-testid="page-count-badge"[^>]*>\s*0 verdict pending/);
  // Toolbar is hidden — nothing to filter, nothing to sort.
  assert.ok(
    !/data-testid="responses-awaiting-review-filter-bar"/.test(html),
    "toolbar must be hidden when the inbox is genuinely empty",
  );
  assert.ok(!/data-testid="sort-mode-select"/.test(html));
  // No state strip.
  assert.ok(!/data-testid="hidden-items-strip"[^-]/.test(html));
  // sr-only "empty" marker still resolves.
  assert.match(html, /data-testid="hidden-items-strip-empty"/);
});

test("V2 header (filtered-empty): toolbar still renders so the operator can clear filters", () => {
  const html = renderHeader({
    groupCount: 0,
    hasActiveFilters: true,
    filterSlots: filterSlotsWithChips(2),
  });
  // Toolbar visible despite zero rows — `hasActiveFilters` keeps it on.
  assert.match(html, /data-testid="responses-awaiting-review-filter-bar"/);
  assert.match(html, /data-testid="sort-mode-select"/);
  // State strip surfaces both the chips and the Clear-all action.
  assert.match(html, /Showing/);
  assert.match(html, /data-testid="filter-chip-strip-clear-all"/);
});

test("V2 header (hidden-only): state strip surfaces 'Hiding' chips even with no filters", () => {
  const html = renderHeader({
    hiddenSlots: hiddenSlotsWithChips,
  });
  // State strip is rendered.
  assert.match(html, /data-testid="hidden-items-strip"/);
  assert.match(html, /Hiding/);
  assert.match(html, /data-testid="hidden-items-chip-awaitingPayorAgain"/);
  // No "Showing" half (no active filter chips).
  assert.ok(!/>\s*Showing\s*</.test(html));
  // No Clear-all (no filter chips at all).
  assert.ok(!/data-testid="filter-chip-strip-clear-all"/.test(html));
  // Empty-marker sr-only span is suppressed when chips render.
  assert.ok(!/data-testid="hidden-items-strip-empty"/.test(html));
});

test("V2 header (hidden-loading): sr-only loading marker preserves its test id", () => {
  const html = renderHeader({ hiddenSlots: hiddenSlotsLoading });
  assert.match(html, /data-testid="hidden-items-strip-loading"/);
  // Strip itself does not render while loading (no chips, no filters).
  assert.ok(!/data-testid="hidden-items-strip"[^-]/.test(html));
});

test("V2 header (clean, eligible HC available): inline HC-shortcut renders in the sort row", () => {
  const html = renderHeader({ selectionEligibleAllCount: 3, bulkBar: null });
  assert.match(html, /data-testid="bulk-approve-header-select-all-eligible"/);
  assert.match(html, /Select 3 HC approvals/);
  // Without a selection the bulk-bar slot is empty.
  assert.ok(!/data-testid="bulk-approve-bar"/.test(html));
});

test("V2 header info tooltip trigger is wired with the right aria-label and short caption", () => {
  const html = renderHeader();
  // Radix portals TooltipContent so the long body is not in the SSR
  // output; instead pin the trigger button + aria-label and the short
  // caption that lives next to it on row 1. The actual long-copy
  // string is also asserted directly against the source module to
  // catch a future copy change without needing a portal-aware DOM.
  assert.match(
    html,
    /<button[^>]*aria-label="About Responses Awaiting Review"[^>]*data-testid="responses-awaiting-review-info"/,
    "info tooltip trigger should carry the About aria-label",
  );
  assert.match(html, /Stage 2 inbox · oldest first/);
});

test("V2 header info tooltip source carries the long Stage 2 explainer copy", async () => {
  // Read the module source rather than the SSR HTML — Radix portals
  // TooltipContent so the body string is not in `renderToStaticMarkup`
  // output, but a regression in the copy still needs to be caught.
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = await fs.readFile(
    path.join(here, "responses-awaiting-review-header.tsx"),
    "utf8",
  );
  assert.match(src, /Stage 2 inbox\. The payor responded/);
  assert.match(
    src,
    /Re-attestation work lives on the dedicated Attestation\s+Queue page\./,
  );
});

test("V2 header (bucket-active): state strip label flips to 'Viewing' when a hidden bucket IS the current view", () => {
  // Task #813 — when the operator clicks a hidden-bucket chip the
  // list swaps to show those items in place. The "Hiding" label
  // would be a lie in that mode, so the strip reads "Viewing" while
  // the bucket is active.
  const html = renderHeader({
    activeHiddenBucket: "awaitingPayorAgain",
    hiddenSlots: hiddenSlotsActiveBucket,
  });
  assert.match(html, /data-testid="hidden-items-strip-label"[^>]*>[\s\S]*?Viewing/);
  assert.ok(
    !/data-testid="hidden-items-strip-label"[^>]*>[\s\S]*?Hiding/.test(html),
    "label must not read 'Hiding' when a bucket is the active view",
  );
  assert.match(html, /data-testid="hidden-items-chip-awaitingPayorAgain"/);
});

test("V2 header (no-bucket): state strip label stays 'Hiding' when chips are render-only", () => {
  const html = renderHeader({ hiddenSlots: hiddenSlotsWithChips });
  assert.match(html, /data-testid="hidden-items-strip-label"[^>]*>[\s\S]*?Hiding/);
});

test("V2 header (combined): both 'Showing' and 'Hiding' segments render with a divider", () => {
  const html = renderHeader({
    hasActiveFilters: true,
    filterSlots: filterSlotsWithChips(3),
    hiddenSlots: hiddenSlotsWithChips,
  });
  assert.match(html, /data-testid="hidden-items-strip"/);
  assert.match(html, /Showing/);
  assert.match(html, /Hiding/);
  assert.match(html, /data-testid="active-filter-chip-2"/);
  assert.match(html, /data-testid="hidden-items-chip-awaitingPayorAgain"/);
  // 3 chips -> Clear all surfaces.
  assert.match(html, /data-testid="filter-chip-strip-clear-all"/);
});

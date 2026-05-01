# ClaimClear Filter Pattern: The Faceted Rail

**Status:** Adopted as the standard advanced-filter pattern (Task #245 landed 2026-05-01; extended to Withdrawals + Portal Submissions in Task #247, 2026-05-01)
**Last updated:** 2026-05-01
**Owners:** Adam (product), agent team (engineering)

## Why this document exists

ClaimClear's list pages (Claims, Invoice Groups, and any future inventory-style page) all share the same filtering problem: a small number of always-visible filters that segment the work (the primary tab strip — open vs. closed, status families, lifecycle phase) plus a long tail of less-frequent filters (date ranges, amount ranges, error type, error description, filing deadline). Until now we solved the long tail with a tall single-column popover stuffed with stacked sections. That popover was easy to scan once you knew where things were, but it had three persistent problems:

1. It scrolled. With 7+ categories on Claims, the popover overflowed even on a 14" laptop, hiding the footer's "Done" button and pushing critical filters (Filing Deadline, Amount) below the fold.
2. It did not show what was applied without reading every section. The trigger badge said "5 filters applied" but didn't say which.
3. It used inconsistent controls per category (custom checkbox lists, raw `<Select>` for binary toggles, raw `<Input type="date">` for ranges) that all looked subtly different and required different keyboard interactions.

The mockup-sandbox canvas explored a half-dozen alternative shells (single-column with sticky sections, accordion, tab strip, two-pane, drawer). The two-pane "Faceted Rail" is the one that won, because:

- The left rail makes every category visible at a glance, with a per-category applied-count badge. Operators can see "Status (3), Error Type (2)" without opening anything.
- The right pane gives each category enough room to use its native control (search-filtered checkbox list, date range, numeric range) at full size, without the page-level popover scrolling.
- The popover is fixed height, so the footer's Clear all / Done buttons never move and never hide.
- The category list is the table of contents; clicking through it doesn't lose any in-progress edits because each category's controls are owned by the page and bound to URL params, so switching tabs is a pure visual change.

This document is the contract for that pattern: the components that ship it, the behavioral rules that define "Faceted Rail" (vs. just "any two-pane popover"), and the recipe for adding a new list page or a new filter category.

---

## Anatomy

```
┌───────────────────────────────────────────────────────────────────────┐
│  ListTableHeaderStrip                                                  │
│  ┌─────────────────┐   N matching          [extras]  [Filter (3)] ▼   │
│  │ 🔎 Search...   │   (density, columns, CSV export, etc.)           │
│  └─────────────────┘                                                   │
└───────────────────────────────────────────────────────────────────────┘
                                                  ↓ click Filter
┌───────────────────────┬───────────────────────────────────────────────┐
│  Filters              │                                               │
│  ──────────────────   │   <category content rendered by the page>     │
│  ⚡ Status        (3) │                                               │
│  ✓ Outcome           │   e.g. searchable checkbox list, date range,   │
│  ⚠ Error Type    (2) │   numeric range, exclusive choice, etc.       │
│  ⏱ Filing Deadline   │                                               │
│  📅 Service Date     │                                               │
│  📅 Created Date     │                                               │
│  $  Amount           │                                               │
│                       │                                               │
├───────────────────────┴───────────────────────────────────────────────┤
│  Clear all                              5 applied      [    Done    ] │
└───────────────────────────────────────────────────────────────────────┘
```

The header strip (the always-visible bar above the table) is a separate component from the popover, but they ship as a pair: the strip is what hosts the trigger button and the dim-while-open behavior on the table behind it. Both live under `artifacts/claimclear/src/components/list-table/faceted-filter/`.

### The components

All exported from the barrel `@/components/list-table/faceted-filter`:

- **`<ListTableHeaderStrip>`** — the bar above the table. Renders the search input, the "N matching" count, an `extras` slot for page-specific buttons (density toggle, columns menu, CSV export), and the `<FacetedFilter>` trigger pinned to the right. Wraps `children` in `<DimWhileOpen>` so the table dims while the popover is open. **Pages never instantiate `<FacetedFilter>` directly** — they go through the strip so the dim behavior and layout stay consistent.
- **`<FacetedFilter>`** — the two-pane popover shell. Owns the trigger button (with the total applied-count badge), the left-rail category nav, the right-pane render slot, and the footer (`Clear all` / applied count / `Done`). Categories are passed in as a typed array (`FacetedFilterCategory[]`).
- **`<FacetSearchableCheckboxList>`** — for medium-to-long option lists where the operator might not remember every value (Status, Outcome, Error Type). Has a search input at the top and an optional `pinSelected` flag that pushes selected items to the top of the list as they're added. Always selected-first, then alphabetical (or source order, depending on `pinSelected`).
- **`<FacetCheckboxList>`** — for short option lists (≤ 4) where search would be overkill. Supports an `exclusive` flag that turns it into a single-select (used for Filing Deadline, Error Description). Optional `hint` slot for the small grey caption underneath.
- **`<FacetDateRange>`** — paired date inputs with optional preset chips (Today, Last 7 days, Last 30 days, This month, Last month). Presets are wired up on Claims (Service Date, Created Date) and Invoice Groups (Created Date). The preset list is configured per-category by the page; reusable resolvers live in `artifacts/claimclear/src/lib/date-presets.ts` (`SERVICE_DATE_PRESETS`, `CREATED_DATE_PRESETS`). Presets `resolve()` at click time so "Today" stays correct across midnight, and a chip renders as active when its `{from, to}` exactly matches the current URL state.
- **`<FacetNumericRange>`** — paired numeric inputs with optional `prefix` (`$`), `min`/`max` placeholders, and step control.
- **`<DimWhileOpen>`** — a thin wrapper that applies `opacity-60 pointer-events-none` (with a transition) when `open` is true. Used by the strip on the table; can be reused on any sibling region a page wants to de-emphasize while filtering.

### Types

```ts
export type FacetedFilterCategory = {
  id: string;            // stable key, used as the URL-state-free tab id
  label: string;         // shown in the rail and as the right-pane heading
  icon: LucideIcon;      // shown next to the rail label
  appliedCount: number;  // drives the rail badge AND the trigger total
  render: () => ReactNode; // page-owned right-pane content
};
```

The page is responsible for computing `appliedCount` per category and the `totalApplied` count (sum). The shell does no math of its own; this is intentional, because the definition of "applied" varies per category (a date range with only one bound counts as 1, not 2; an empty multi-select counts as 0). Centralizing the logic in the page keeps the URL semantics single-source-of-truth.

---

## Behavior rules

These are the rules that make a popover "Faceted Rail" rather than just "another two-pane popover". Deviating from them silently is how patterns drift; if a future page genuinely needs a different rule, document the exception here.

1. **Fixed-height popover, no page-level scrolling.** The shell is `420px` tall and `640px` wide. The right-pane content scrolls internally if it exceeds that; the rail and footer never move.
2. **Category rail is always visible.** No accordion. No collapse. The rail width is fixed (180px) so the right pane is predictable.
3. **Per-category badges + total badge are always in sync.** The total on the trigger equals the sum of `appliedCount` across categories. There is no "hidden" applied filter that doesn't show up in a category's count.
4. **Default category on open is the first one with applied filters**, falling back to the first in the list. Operators who already filtered by Error Type land back on Error Type when they reopen, even if Status comes first in the rail.
5. **"Clear all" inside the popover does NOT close the popover.** It only clears every applied filter. The operator stays in context to start over. Closing is reserved for "Done".
6. **"Done" closes the popover.** It is purely a dismissal — every change has already been committed live to URL state as the operator made it. There is no "Apply" step.
7. **Every change writes through to URL params immediately.** Pages use `useUrlParams.set(...)` in their `onChange`/`onToggle` handlers. There is no internal staging or "pending" state in the shell. This preserves deep-linking, back/forward navigation, and shareable URLs.
8. **Page resets `page` to `null` on every filter change.** Every `set(...)` call from the popover's controls includes `page: null` so paginated tables jump back to page 1. This is the pages' responsibility (the shell can't enforce it without taking ownership of the URL params, which it deliberately doesn't).
9. **The table behind the popover is dimmed while open.** This is what `<DimWhileOpen>` provides. It signals modality without blocking, so the operator can still see the table updating live as filters change.
10. **The primary tab strip stays.** The Faceted Rail is the *advanced* filter shell. The first-class segmentation (lifecycle tabs on Claims, group-status tabs on Invoice Groups) is still rendered separately, above the strip, via `<FilterStrip>`. Do not move tab-strip filters into the Faceted Rail.
11. **The chip strip stays.** Applied filters still render as removable chips inside the Card, between the header strip and the table body, via `<FilterChipStrip>`. The chip strip and the popover are two views of the same state; both stay in sync because both read URL params.
12. **The category rail follows the WAI-ARIA tablist keyboard contract.** Inside the rail (`role="tablist"`, `aria-orientation="vertical"`):
    - `Up` / `Down` move focus to the previous / next category, wrapping at the ends. They move focus only — selection is not changed (manual activation).
    - `Home` / `End` move focus to the first / last category.
    - `Enter` / `Space` activate the focused category and forward focus into the right pane's first focusable control, so the operator can keep typing without another Tab.
    - The rail uses a roving `tabindex`: only the active tab is in the page tab order, so `Tab` / `Shift+Tab` enters and leaves the rail as a single stop and continues into the right pane / footer as expected. Clicking a category still works exactly as before.

---

## URL parameter contract

The shell does not own any URL params. Pages own them, and the contract for each page is preserved exactly as it was before the migration:

### Claims (`/claims`)
- `q` — search string
- `status` — comma-separated list (multi-select)
- `outcome` — comma-separated list (multi-select)
- `errorTypeId` — comma-separated list of numeric error-type ids plus optional sentinel `__unassigned__`
- `serviceDateFrom` / `serviceDateTo` — ISO date strings
- `createdFrom` / `createdTo` — ISO date strings
- `amountMin` / `amountMax` — decimal strings
- `expiring` — single value: `soon` | `urgent`
- Plus the lifecycle tab strip's `tab`, sort, paging — unchanged.

### Invoice Groups (`/invoice-groups`)
- `q` — search string
- `status` — comma-separated list
- `outcome` — comma-separated list
- `errorTypeId` — comma-separated list (with `__unassigned__` sentinel)
- `errorDetails` — single value: `empty` | `present`
- `createdFrom` / `createdTo` — ISO date strings
- `amountMin` / `amountMax` — decimal strings (group total)
- `expiring` — single value: `soon` | `urgent`
- Plus the group-status tab strip, sort, paging — unchanged.

The migration was designed so that **any link generated before the migration still works after**. Operators with bookmarked filtered views, deep-linked alerts in Insights, and saved cross-page navigation links don't have to do anything.

---

## Recipe: adding a new list page

1. Compute `appliedCount` and `totalAppliedFilters` from your URL state. Keep the per-category logic small and inline; do not generalize prematurely.
2. Build a `FacetedFilterCategory[]` memo that wraps each category's controls in the appropriate facet primitive (`FacetSearchableCheckboxList`, `FacetCheckboxList`, `FacetDateRange`, `FacetNumericRange`). Each category's `onToggle` / `onChange` writes through to URL state with `page: null`.
3. Render `<ListTableHeaderStrip>` at the top of the list region, passing the search props, matching count + noun, the categories, the total, your existing `clearFilters()` callback, and any page-specific buttons via the `extras` slot. Pass the `<Card>` (with chip strip + table) as `children`.
4. Keep your existing `<FilterChipStrip>` inside the `<Card>` exactly where it was — between the header and the `<CardContent>`. It is unchanged.
5. Keep your existing primary `<FilterStrip>` tab strip exactly where it was, *above* the new header strip. The Faceted Rail is for the long tail; the tab strip is for the always-visible primary segmentation.
6. Verify URL params and chips behave identically to before. The migration target is "pure refactor of the popover shell"; if anything in the URL or the chip strip changed, that's a regression.

## Recipe: adding a new filter category to an existing page

1. Pick the right facet primitive:
   - **Multi-select with > ~4 options:** `FacetSearchableCheckboxList`. Set `pinSelected` if operators frequently come back to the same selections.
   - **Multi-select with ≤ 4 options:** `FacetCheckboxList`.
   - **Single-select choice (binary or short list):** `FacetCheckboxList` with `exclusive`.
   - **Date range:** `FacetDateRange`. Add `presets` if there are obvious common ranges.
   - **Numeric range:** `FacetNumericRange`.
   - **Anything else:** build it inline in the category's `render` and put a comment here once it stabilizes. Do not invent a one-off facet primitive without checking with the team first; the small set is a feature.
2. Add the URL param to the page's `useUrlParams` reads and to the `clearFilters()` reset.
3. Add `appliedCount` for the new category and include it in `totalAppliedFilters`.
4. Add a chip in the page's `chips` memo so the new filter shows up in the chip strip.
5. Append the new category to the `filterCategories` memo. Pick an icon from `lucide-react` that is visually distinct from the others on that page.
6. The applied-count rule of thumb: a range with at least one bound set counts as 1 (regardless of whether one or both bounds are set). A multi-select counts the number of selected values. A single-select counts as 1 if anything is selected, 0 otherwise.

---

## Non-goals

- **Saved filter sets / "My filters".** Out of scope. URL-based deep-linking covers the most common case (share a link, bookmark a view) without the engineering and UX cost of a saved-filters store.
- **Server-side facet counts** (e.g. "Status: Pending (12)" with the count fetched from the API). The current `appliedCount` is the operator-applied count, not the candidate-result count. Adding result counts would require an API endpoint per page that returns category totals; that's a separate project if and when it becomes a clear need.
- **Free-form column filters in the table header.** Different pattern, different ergonomics. Not blocked, but not part of this design.
- **Replacing the primary tab strip.** As called out in rule #10, the tab strip is intentionally separate.

---

## File map

- Shell + primitives: `artifacts/claimclear/src/components/list-table/faceted-filter/`
  - `faceted-filter.tsx` — the popover shell + category rail
  - `list-table-header-strip.tsx` — the always-visible header bar
  - `dim-while-open.tsx` — opacity transition wrapper
  - `facet-searchable-checkbox-list.tsx`
  - `facet-checkbox-list.tsx`
  - `facet-date-range.tsx`
  - `facet-numeric-range.tsx`
  - `index.ts` — barrel
- Reference mockup (kept for design changes): `artifacts/mockup-sandbox/src/components/mockups/filter-redesign/FacetedRail.tsx`
- Pages on the pattern:
  - `artifacts/claimclear/src/pages/claims.tsx` — full pattern: 7 categories.
  - `artifacts/claimclear/src/pages/invoice-groups.tsx` — full pattern: 7 categories.
  - `artifacts/claimclear/src/pages/withdrawals.tsx` — full pattern: 2 categories (Closed Date, Visibility).
  - `artifacts/claimclear/src/pages/portal-submissions.tsx` — uses the strip for search + matching count only; no advanced filter categories yet (the status pill strip above the list is the primary segmentation, which is a tab strip and intentionally stays separate per rule #10). When a real long-tail filter for this page appears, drop a `filterCategories` memo onto the existing `<ListTableHeaderStrip>` and the popover trigger will appear automatically.
- Pages reviewed and intentionally not migrated:
  - `artifacts/claimclear/src/pages/responses-awaiting-review.tsx` — has a primary tab strip (verdict-pending / mas-action / attestation) and a sort dropdown, but no per-list filters. A sort control is not a filter (it changes order, not membership), so there is nothing to put in a Faceted Rail. Re-evaluate if a real filter (e.g. "assigned to me", reviewer, date range) is added here.
- Adjacent components (unchanged, but part of the list-page surface):
  - `artifacts/claimclear/src/components/list-table/filter-chip-strip.tsx`
  - `artifacts/claimclear/src/components/cohesion/filter-strip.tsx` (primary tab strip)

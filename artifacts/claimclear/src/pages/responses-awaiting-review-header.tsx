import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowDownWideNarrow, Eye, HelpCircle } from "lucide-react";

/**
 * Task #759 — V2 header layout ("Controls / State Split").
 *
 * Extracted from `responses-awaiting-review.tsx` so the layout can be
 * unit-tested in isolation (the page module pulls in 50+ hooks; the
 * header itself is pure-presentational and easy to render with crafted
 * slot props). See `responses-awaiting-review-header.test.tsx` for the
 * canonical-state coverage that pins these conditional render paths.
 */

export type SortMode =
  | "oldest_response"
  | "newest_response"
  | "urgency"
  | "amount";

export interface SortOption {
  value: SortMode;
  label: string;
  help: string;
}

export interface FilterBarSlots {
  trigger: ReactNode;
  search: ReactNode;
  /** Active filter chips, ready to render inside the state strip. */
  chips: ReactNode;
  /** Number of chips (incl. the search "q") so the caller can decide
   *  whether the state strip / "Clear all" should appear. */
  chipCount: number;
  hasActiveChips: boolean;
}

export interface HiddenItemsSlots {
  isLoading: boolean;
  hasChips: boolean;
  /** The chips (with click-through tooltips), or null when there are none. */
  chips: ReactNode;
  /** Task #813 — when set, the strip should read "Viewing" (the active
   *  bucket IS the current view) instead of "Hiding". `null` keeps the
   *  default "Hiding" label. */
  activeBucket: string | null;
  /** Sr-only marker spans that preserve loading / empty test ids. */
  marker: ReactNode;
}

export interface ReviewHeaderProps {
  groupCount: number;
  hasActiveFilters: boolean;
  /** Task #813 — passed through so the title row can surface a short
   *  caption explaining the bucketed view ("Viewing items hidden …"),
   *  in addition to the chip already shown in the state strip. */
  activeHiddenBucket?: string | null;
  sortMode: SortMode;
  sortOptions: ReadonlyArray<SortOption>;
  onSortChange: (value: string) => void;
  filterSlots: FilterBarSlots;
  hiddenSlots: HiddenItemsSlots;
  clearAllFilters: () => void;
  selectionEligibleAllCount: number;
  onSelectAllEligible: () => void;
  bulkBar: ReactNode;
}

/**
 * Renders three rows:
 *   1. Title row: page title + verdict-pending count badge + info-icon
 *      tooltip carrying the long "Stage 2 inbox…" copy + a short
 *      "Stage 2 inbox · oldest first" caption.
 *   2. Toolbar row: filter trigger + search + (HC-shortcut OR sort) on
 *      the right. Hidden when the inbox is genuinely empty (no rows AND
 *      no active filters), so the empty-state success card stands alone.
 *   3. Bulk-approve bar (slides in below the toolbar when the operator
 *      has selected rows; replaces the inline HC-shortcut on the right
 *      of the toolbar to avoid duplication).
 *   4. State strip: collapsible "Showing / Hiding" block surfacing
 *      active filter chips and hidden-bucket chips. The whole strip
 *      disappears when there are no chips on either side.
 *
 * The duplicate "Select all High-confidence Approvals" header button has
 * been removed; only the inline toolbar shortcut (when selection = 0)
 * and the bulk-bar instance (when selection > 0) remain.
 */
export function ReviewHeader({
  groupCount,
  hasActiveFilters,
  activeHiddenBucket = null,
  sortMode,
  sortOptions,
  onSortChange,
  filterSlots,
  hiddenSlots,
  clearAllFilters,
  selectionEligibleAllCount,
  onSelectAllEligible,
  bulkBar,
}: ReviewHeaderProps) {
  const hasSelection = bulkBar !== null;
  // Task #813 — when a hidden bucket is the current view, the "Hiding"
  // label in the state strip would be a lie (we ARE viewing it). Swap
  // the label so the strip reads coherently. The chip itself carries
  // the X / "Clear" affordance.
  const isViewingHiddenBucket =
    hiddenSlots.activeBucket !== null && activeHiddenBucket !== null;
  const hiddenLabel = isViewingHiddenBucket ? "Viewing" : "Hiding";
  // Hide the toolbar when there are no rows AND no filters — the
  // inbox-empty success card on its own is the whole UI in that case
  // (V2SplitEmpty mockup).
  const showToolbar = groupCount > 0 || hasActiveFilters;
  // The state strip surfaces "what's narrowing the view" — collapse it
  // when nothing is filtered and nothing is hidden.
  const showStateStrip =
    filterSlots.hasActiveChips || hiddenSlots.hasChips;
  // Task #753 — "Clear all" stays gated on 2+ active filter chips so a
  // single chip's per-chip × is enough.
  const showClearAll = filterSlots.chipCount >= 2;

  return (
    <div className="space-y-3">
      {/* Row 1 — title + count badge + info tooltip + short caption. */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-2xl font-bold tracking-tight">
          Responses Awaiting Review
        </h2>
        <Badge variant="secondary" data-testid="page-count-badge">
          {groupCount} verdict pending
        </Badge>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              aria-label="About Responses Awaiting Review"
              data-testid="responses-awaiting-review-info"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">
            Stage 2 inbox. The payor responded — read what they said,
            weigh the AI hint, and pick the verdict (continue the
            dispute, mark paid, or close as denied). Oldest response
            first. Re-attestation work lives on the dedicated Attestation
            Queue page.
          </TooltipContent>
        </Tooltip>
        <span className="ml-auto text-xs text-muted-foreground">
          Stage 2 inbox · oldest first
        </span>
      </div>

      {/* Row 2 — toolbar (filter, search, HC-shortcut OR nothing, sort). */}
      {showToolbar && (
        <div
          className="flex items-center gap-2 flex-wrap"
          data-testid="responses-awaiting-review-filter-bar"
        >
          {filterSlots.trigger}
          {filterSlots.search}
          <span className="ml-auto flex items-center gap-2">
            {!hasSelection && selectionEligibleAllCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={onSelectAllEligible}
                data-testid="bulk-approve-header-select-all-eligible"
              >
                Select {selectionEligibleAllCount} HC approvals
              </Button>
            )}
            <ArrowDownWideNarrow className="h-4 w-4 text-muted-foreground" />
            <Select value={sortMode} onValueChange={onSortChange}>
              <SelectTrigger
                className="w-[220px] h-8 text-xs"
                data-testid="sort-mode-select"
                aria-label="Sort responses awaiting review"
              >
                <SelectValue placeholder="Sort by…" />
              </SelectTrigger>
              <SelectContent>
                {sortOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="block">
                      <span className="font-medium">{opt.label}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {opt.help}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
        </div>
      )}

      {/* Bulk-approve bar slides in below the toolbar when there's a
          selection (replaces the inline HC-shortcut on the toolbar's
          right edge above). */}
      {bulkBar}

      {/* Row 3 — collapsible state strip. */}
      {showStateStrip && (
        <div
          className="flex items-center gap-2 flex-wrap rounded-md border bg-muted/30 px-3 py-2"
          data-testid={hiddenSlots.hasChips ? "hidden-items-strip" : undefined}
        >
          {filterSlots.hasActiveChips && (
            <>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Showing
              </span>
              {filterSlots.chips}
            </>
          )}
          {filterSlots.hasActiveChips && hiddenSlots.hasChips && (
            <span className="h-4 w-px bg-border" aria-hidden="true" />
          )}
          {hiddenSlots.hasChips && (
            <>
              <span
                className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1"
                data-testid="hidden-items-strip-label"
              >
                <Eye className="h-3 w-3" />
                {hiddenLabel}
              </span>
              {hiddenSlots.chips}
            </>
          )}
          {showClearAll && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="ml-auto text-xs text-muted-foreground h-6 px-2 hover:text-foreground"
              data-testid="filter-chip-strip-clear-all"
            >
              Clear all
            </Button>
          )}
        </div>
      )}

      {/* Sr-only markers preserve `hidden-items-strip-loading` and
          `hidden-items-strip-empty` test ids in the canonical states
          even when the V2 layout collapses the visible strip. */}
      {hiddenSlots.marker}
    </div>
  );
}

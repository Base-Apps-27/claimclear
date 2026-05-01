import { format } from "date-fns";

export interface CompletedElsewhereLike {
  submissionId: number;
  runId?: number | null;
  runLabel?: string | null;
  submittedAt?: string | null;
}

export interface DraftSelectableLike {
  id: number;
  status: string;
}

export const DEFAULT_COLLAPSED_GROUPS: ReadonlySet<string> = new Set([
  "submitted",
  "cancelled",
]);

export function getInitialCollapsedGroups(): Set<string> {
  return new Set(DEFAULT_COLLAPSED_GROUPS);
}

export function getCheckedDraftIds<T extends DraftSelectableLike>(
  rows: readonly T[],
  checkedIds: ReadonlySet<number>,
): number[] {
  return rows.filter((r) => r.status === "draft" && checkedIds.has(r.id)).map((r) => r.id);
}

export function selectionIsAllDrafts<T extends DraftSelectableLike>(
  rows: readonly T[],
  checkedIds: ReadonlySet<number>,
): boolean {
  if (checkedIds.size === 0) return false;
  const checkedRows = rows.filter((r) => checkedIds.has(r.id));
  if (checkedRows.length === 0) return false;
  return checkedRows.every((r) => r.status === "draft");
}

function safeFormatSubmittedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return format(new Date(iso), "MMM d, yyyy h:mm a");
  } catch {
    return null;
  }
}

export function formatCompletedElsewhereLabel(ce: CompletedElsewhereLike): string {
  return ce.runLabel
    ? `Already submitted in run ${ce.runLabel}`
    : "Already submitted elsewhere";
}

export function formatCompletedElsewhereTooltip(ce: CompletedElsewhereLike): string {
  const when = safeFormatSubmittedAt(ce.submittedAt ?? null);
  const where = ce.runLabel ? `batch run ${ce.runLabel}` : "another run";
  const base = when
    ? `This invoice was already submitted to the portal in ${where} on ${when}.`
    : `This invoice was already submitted to the portal in ${where}.`;
  return `${base} Click to open that submission.`;
}

export function countDraftsAlreadyDoneElsewhere<
  T extends { completedElsewhere?: CompletedElsewhereLike | null },
>(rows: readonly T[]): number {
  return rows.filter((r) => !!r.completedElsewhere).length;
}

interface PillClickEventLike {
  stopPropagation(): void;
}

export function makePillClickHandler(
  ce: CompletedElsewhereLike,
  onOpen: (id: number) => void,
): (e: PillClickEventLike) => void {
  return (e) => {
    e.stopPropagation();
    onOpen(ce.submissionId);
  };
}

export interface DiscardArmState {
  armed: boolean;
  expiresAt: number | null;
}

export const DISCARD_ARM_TTL_MS = 4000;

export function makeDiscardArmState(now: number = Date.now()): DiscardArmState {
  return { armed: true, expiresAt: now + DISCARD_ARM_TTL_MS };
}

export function isDiscardStillArmed(state: DiscardArmState | null, now: number = Date.now()): boolean {
  if (!state || !state.armed || state.expiresAt == null) return false;
  return now < state.expiresAt;
}

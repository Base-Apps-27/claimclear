// One-at-a-time worker gate. Extracted so we can unit-test the coalescing
// behavior (concurrent triggers → second is skipped, gate releases on
// completion or failure) without launching Playwright or hitting the DB.
//
// The gate is intentionally process-local (a single boolean). The portal
// worker only ever runs inside the API server process, so a module-level
// variable is sufficient. If we ever scale the API server horizontally, we
// would replace this with an advisory DB lock.
//
// The gate also tracks the *owner* label of whoever currently holds it
// (e.g. "submit" vs "scrape"). The header batch-status pill reads this so
// it can show a distinct label/icon when the read bot is checking the
// portal for responses, instead of mis-labelling every gate hold as
// "Sending batch" (bug surfaced in #495 follow-up).

export type GateOutcome<T> =
  | { kind: "started"; result: Promise<T> }
  | { kind: "skipped"; reason: "already_running" };

export interface WorkerGate<T> {
  isInProgress(): boolean;
  /** Label of the caller currently holding the gate, or null when idle. */
  getCurrentOwner(): string | null;
  /**
   * Run `fn` if the gate is free; otherwise return { kind: "skipped" }.
   * `owner` identifies the caller for observability (UI labels, logs).
   * Always releases the gate when `fn` settles, even on throw.
   */
  run(owner: string, fn: () => Promise<T>): Promise<GateOutcome<T>>;
}

export function createWorkerGate<T>(): WorkerGate<T> {
  let inProgress = false;
  let currentOwner: string | null = null;
  return {
    isInProgress: () => inProgress,
    getCurrentOwner: () => currentOwner,
    async run(owner, fn) {
      if (inProgress) {
        return { kind: "skipped", reason: "already_running" };
      }
      inProgress = true;
      currentOwner = owner;
      const result = fn().finally(() => {
        inProgress = false;
        currentOwner = null;
      });
      // Catch any rejection here so the unhandled-rejection logger doesn't
      // fire when the caller intentionally fire-and-forgets the result.
      result.catch(() => undefined);
      return { kind: "started", result };
    },
  };
}

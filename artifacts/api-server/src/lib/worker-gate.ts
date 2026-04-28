// One-at-a-time worker gate. Extracted so we can unit-test the coalescing
// behavior (concurrent triggers → second is skipped, gate releases on
// completion or failure) without launching Playwright or hitting the DB.
//
// The gate is intentionally process-local (a single boolean). The portal
// worker only ever runs inside the API server process, so a module-level
// variable is sufficient. If we ever scale the API server horizontally, we
// would replace this with an advisory DB lock.

export type GateOutcome<T> =
  | { kind: "started"; result: Promise<T> }
  | { kind: "skipped"; reason: "already_running" };

export interface WorkerGate<T> {
  isInProgress(): boolean;
  /**
   * Run `fn` if the gate is free; otherwise return { kind: "skipped" }.
   * Always releases the gate when `fn` settles, even on throw.
   */
  run(fn: () => Promise<T>): Promise<GateOutcome<T>>;
}

export function createWorkerGate<T>(): WorkerGate<T> {
  let inProgress = false;
  return {
    isInProgress: () => inProgress,
    async run(fn) {
      if (inProgress) {
        return { kind: "skipped", reason: "already_running" };
      }
      inProgress = true;
      const result = fn().finally(() => {
        inProgress = false;
      });
      // Catch any rejection here so the unhandled-rejection logger doesn't
      // fire when the caller intentionally fire-and-forgets the result.
      result.catch(() => undefined);
      return { kind: "started", result };
    },
  };
}

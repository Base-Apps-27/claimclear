interface ActiveBotProcess {
  type: string;
  claimId: number;
  startedAt: string;
}

const activeProcesses = new Map<string, ActiveBotProcess>();
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

function makeKey(type: string, claimId: number): string {
  return `${type}:${claimId}`;
}

export function registerBotProcess(type: string, claimId: number): void {
  activeProcesses.set(makeKey(type, claimId), {
    type,
    claimId,
    startedAt: new Date().toISOString(),
  });
}

export function unregisterBotProcess(type: string, claimId: number): void {
  activeProcesses.delete(makeKey(type, claimId));
}

export function getActiveBotProcesses(claimId: number): ActiveBotProcess[] {
  const result: ActiveBotProcess[] = [];
  for (const proc of activeProcesses.values()) {
    if (proc.claimId === claimId) {
      result.push(proc);
    }
  }
  return result;
}

function purgeStaleProcesses(): void {
  const now = Date.now();
  for (const [key, proc] of activeProcesses) {
    if (now - new Date(proc.startedAt).getTime() > STALE_THRESHOLD_MS) {
      activeProcesses.delete(key);
    }
  }
}

// `unref()` so this housekeeping timer never keeps the Node event loop alive
// on its own. In production the HTTP server holds the loop; in tests that
// only import this module transitively, the runner can exit cleanly.
setInterval(purgeStaleProcesses, 5 * 60 * 1000).unref();

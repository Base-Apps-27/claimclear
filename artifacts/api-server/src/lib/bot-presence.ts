interface ActiveBotProcess {
  type: string;
  claimId: number;
  startedAt: string;
}

const activeProcesses = new Map<string, ActiveBotProcess>();

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

import type { Response } from "express";

export interface ClaimEvent {
  type: string;
  claimId: number;
  userName: string | null;
  userEmail: string | null;
  timestamp: string;
  // For `type: "status_changed"`, the new status the claim was moved into.
  // Lets clients react to specific transitions (e.g. the streak-pip
  // microinteraction in Task #317 that bumps when the actor moves a leg
  // into "Processed") without having to refetch the row first. Optional
  // because not every event carries a meaningful status change.
  toStatus?: string | null;
  // Hierarchical state machine (Wave B placeholder; Wave D will populate).
  // The new disposition the claim was moved into; lets Wave C/D readers
  // react to disposition transitions without a refetch. Optional and purely
  // additive — older clients ignore the field. See spec §2.
  disposition?: string | null;
}

export interface GroupEvent {
  type: string;
  invoiceGroupId: number;
  userName: string | null;
  userEmail: string | null;
  timestamp: string;
  // For `type: "status_changed"`, the new status the group was moved into.
  // Lets clients react to specific transitions (e.g. the streak-pip
  // microinteraction that bumps when the actor moves a group into
  // "Portal Queued") without having to refetch the row first. Optional
  // because not every group event carries a meaningful status change.
  toStatus?: string | null;
  // Hierarchical state machine (Wave B placeholder; Wave D will populate).
  // The new phase the group was moved into; lets Wave C/D readers react to
  // phase transitions without a refetch. Optional and purely additive —
  // older clients ignore the field. See spec §1.
  phase?: string | null;
}

export type PresenceResourceType = "claim" | "invoice_group";

export interface PresenceEvent {
  type: "viewer_joined" | "viewer_left" | "bot_started" | "bot_completed";
  resourceType: PresenceResourceType;
  resourceId: number;
  userName: string | null;
  userEmail: string | null;
  botProcess?: string;
  timestamp: string;
}

type SSEClient = {
  res: Response;
  userEmail: string | null;
};

const claimClients = new Map<number, Set<SSEClient>>();
const globalClients = new Set<SSEClient>();
const groupClients = new Map<number, Set<SSEClient>>();
const globalGroupClients = new Set<SSEClient>();
const globalBatchClients = new Set<SSEClient>();
const globalSystemClients = new Set<SSEClient>();

// Lifecycle event for the shared portal-submission batch run. Pushed on the
// global batch channel so every connected user sees the same in-flight queue,
// the row currently being processed, who triggered the run, and the final
// outcome.
export type BatchEvent =
  | {
      type: "batch_started";
      batchId: string;
      triggeredBy: string;
      startedAt: string;
      total: number;
      submissionIds: number[];
    }
  | {
      type: "batch_progress";
      batchId: string;
      processed: number;
      succeeded: number;
      failed: number;
      total: number;
    }
  | {
      type: "row_status_changed";
      batchId: string;
      submissionId: number;
      // "queued" = pending + claimedByBatchId. The client should refetch the
      // row (or use the optional `submission` payload) to render the badge.
      newStatus: "queued" | "in_progress" | "submitted" | "failed" | "pending";
    }
  | {
      type: "batch_completed" | "batch_failed" | "batch_aborted";
      batchId: string;
      completedAt: string;
      processed: number;
      succeeded: number;
      failed: number;
      total: number;
      message?: string;
    };

function initSSE(res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(":ok\n\n");
}

function sendEvent(client: SSEClient, event: ClaimEvent): void {
  try {
    client.res.write(`event: claim_update\ndata: ${JSON.stringify(event)}\n\n`);
  } catch {
    // client disconnected
  }
}

function sendPresenceEvent(client: SSEClient, event: PresenceEvent): void {
  try {
    client.res.write(`event: presence_update\ndata: ${JSON.stringify(event)}\n\n`);
  } catch {
    // client disconnected
  }
}

export function addClaimClient(claimId: number, res: Response, userEmail: string | null): () => void {
  initSSE(res);

  const client: SSEClient = { res, userEmail };

  if (!claimClients.has(claimId)) {
    claimClients.set(claimId, new Set());
  }
  claimClients.get(claimId)!.add(client);

  const keepAlive = setInterval(() => {
    try {
      res.write(":ping\n\n");
    } catch {
      cleanup();
    }
  }, 25000);

  const cleanup = () => {
    clearInterval(keepAlive);
    const set = claimClients.get(claimId);
    if (set) {
      set.delete(client);
      if (set.size === 0) claimClients.delete(claimId);
    }
  };

  return cleanup;
}

export function addGlobalClient(res: Response, userEmail: string | null): () => void {
  initSSE(res);

  const client: SSEClient = { res, userEmail };
  globalClients.add(client);

  const keepAlive = setInterval(() => {
    try {
      res.write(":ping\n\n");
    } catch {
      cleanup();
    }
  }, 25000);

  const cleanup = () => {
    clearInterval(keepAlive);
    globalClients.delete(client);
  };

  return cleanup;
}

export function broadcastClaimEvent(event: ClaimEvent): void {
  const clients = claimClients.get(event.claimId);
  if (clients) {
    for (const client of clients) {
      sendEvent(client, event);
    }
  }

  for (const client of globalClients) {
    sendEvent(client, event);
  }
}

export function addGroupClient(groupId: number, res: Response, userEmail: string | null): () => void {
  initSSE(res);
  const client: SSEClient = { res, userEmail };
  if (!groupClients.has(groupId)) groupClients.set(groupId, new Set());
  groupClients.get(groupId)!.add(client);

  const keepAlive = setInterval(() => {
    try { res.write(":ping\n\n"); } catch { cleanup(); }
  }, 25000);

  const cleanup = () => {
    clearInterval(keepAlive);
    const set = groupClients.get(groupId);
    if (set) {
      set.delete(client);
      if (set.size === 0) groupClients.delete(groupId);
    }
  };
  return cleanup;
}

export function addGlobalGroupClient(res: Response, userEmail: string | null): () => void {
  initSSE(res);
  const client: SSEClient = { res, userEmail };
  globalGroupClients.add(client);

  const keepAlive = setInterval(() => {
    try { res.write(":ping\n\n"); } catch { cleanup(); }
  }, 25000);

  const cleanup = () => {
    clearInterval(keepAlive);
    globalGroupClients.delete(client);
  };
  return cleanup;
}

function sendGroupEvent(client: SSEClient, event: GroupEvent): void {
  try {
    client.res.write(`event: group_update\ndata: ${JSON.stringify(event)}\n\n`);
  } catch {
    // client disconnected
  }
}

export function broadcastGroupEvent(event: GroupEvent): void {
  const clients = groupClients.get(event.invoiceGroupId);
  if (clients) {
    for (const client of clients) sendGroupEvent(client, event);
  }
  for (const client of globalGroupClients) sendGroupEvent(client, event);
}

export function broadcastPresenceEvent(event: PresenceEvent): void {
  // Route presence updates to whichever SSE channel the resource lives on so
  // viewers of the matching claim or invoice group see the banner update.
  const targetClients = event.resourceType === "invoice_group"
    ? groupClients.get(event.resourceId)
    : claimClients.get(event.resourceId);
  if (targetClients) {
    for (const client of targetClients) {
      sendPresenceEvent(client, event);
    }
  }
}

export function addGlobalBatchClient(res: Response, userEmail: string | null): () => void {
  initSSE(res);
  const client: SSEClient = { res, userEmail };
  globalBatchClients.add(client);

  const keepAlive = setInterval(() => {
    try { res.write(":ping\n\n"); } catch { cleanup(); }
  }, 25000);

  const cleanup = () => {
    clearInterval(keepAlive);
    globalBatchClients.delete(client);
  };
  return cleanup;
}

function sendBatchEvent(client: SSEClient, event: BatchEvent): void {
  try {
    client.res.write(`event: batch_update\ndata: ${JSON.stringify(event)}\n\n`);
  } catch {
    // client disconnected
  }
}

export function broadcastBatchEvent(event: BatchEvent): void {
  for (const client of globalBatchClients) {
    sendBatchEvent(client, event);
  }
}

// App-wide system announcements broadcast to every authenticated client
// (separate from the claim/group/batch channels so a future system event
// can be added without crossing wires with resource-scoped traffic).
//
// `day_completed` is fired exactly once per ISO date when every invoice
// group dated for that day reaches a concluded state. The client uses
// the connection-open timestamp to ignore replays after reconnect, so
// missed celebrations do NOT fire retroactively.
export type SystemEvent = {
  type: "day_completed";
  date: string;        // ISO YYYY-MM-DD
  dateLabel: string;   // "April 15, 2026"
  timestamp: string;   // ISO timestamp of the broadcast
};

export function addGlobalSystemClient(res: Response, userEmail: string | null): () => void {
  initSSE(res);
  const client: SSEClient = { res, userEmail };
  globalSystemClients.add(client);

  const keepAlive = setInterval(() => {
    try { res.write(":ping\n\n"); } catch { cleanup(); }
  }, 25000);

  const cleanup = () => {
    clearInterval(keepAlive);
    globalSystemClients.delete(client);
  };
  return cleanup;
}

function sendSystemEvent(client: SSEClient, event: SystemEvent): void {
  try {
    client.res.write(`event: system_update\ndata: ${JSON.stringify(event)}\n\n`);
  } catch {
    // client disconnected
  }
}

export function broadcastSystemEvent(event: SystemEvent): void {
  for (const client of globalSystemClients) {
    sendSystemEvent(client, event);
  }
}

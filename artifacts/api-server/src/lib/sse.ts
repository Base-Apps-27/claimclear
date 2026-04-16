import type { Response } from "express";

export interface ClaimEvent {
  type: string;
  claimId: number;
  userName: string | null;
  userEmail: string | null;
  timestamp: string;
}

export interface GroupEvent {
  type: string;
  invoiceGroupId: number;
  userName: string | null;
  userEmail: string | null;
  timestamp: string;
}

export interface PresenceEvent {
  type: "viewer_joined" | "viewer_left" | "bot_started" | "bot_completed";
  claimId: number;
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
  const clients = claimClients.get(event.claimId);
  if (clients) {
    for (const client of clients) {
      sendPresenceEvent(client, event);
    }
  }
}

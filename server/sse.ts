import type { Response } from "express";

// ── Connection registry ────────────────────────────────────────────────────────
// Keyed by orgId; each value is the set of currently open SSE response objects
// for that org.  Server restarts clear this map, but EventSource on the client
// reconnects automatically within a few seconds.
const connections = new Map<string, Set<Response>>();

export function addConnection(orgId: string, res: Response): void {
  if (!connections.has(orgId)) connections.set(orgId, new Set());
  connections.get(orgId)!.add(res);
}

export function removeConnection(orgId: string, res: Response): void {
  connections.get(orgId)?.delete(res);
}

// ── Broadcaster ────────────────────────────────────────────────────────────────
/**
 * Push a named SSE event to every client connected under the given org.
 * Dead connections are silently removed.
 */
export function broadcast(orgId: string, event: string, payload?: unknown): void {
  const conns = connections.get(orgId);
  if (!conns || conns.size === 0) return;
  const data = JSON.stringify(payload ?? {});
  const msg  = `event: ${event}\ndata: ${data}\n\n`;
  for (const res of conns) {
    try {
      res.write(msg);
    } catch {
      conns.delete(res);
    }
  }
}

export function connectionCount(): number {
  let total = 0;
  for (const set of connections.values()) total += set.size;
  return total;
}

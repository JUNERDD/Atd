import path from 'node:path';

/** Change listeners by data directory; stores and authorities load per profile. */
const watchers = new Map<string, Set<() => void>>();

/**
 * Calls `listener` after every change clients list from the MCP status of `dataDir`: a write of
 * the user's catalog, whether a route or the agent's `configure_mcp` tool made it, and a server's
 * connection state moving, as when a run connects it. Answers the unsubscribe.
 */
export function onMcpChanged(dataDir: string, listener: () => void): () => void {
  const key = path.resolve(dataDir);
  const listeners = watchers.get(key) ?? new Set();
  listeners.add(listener);
  watchers.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) watchers.delete(key);
  };
}

/** Tells the listeners of `dataDir` that its MCP servers or their states changed. */
export function announceMcpChanged(dataDir: string): void {
  for (const listener of watchers.get(path.resolve(dataDir)) ?? []) listener();
}

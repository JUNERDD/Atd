import type { ProviderCredentialIssue, ServiceConnection } from '@atd/agent-contracts';

const issuesByDataDir = new Map<string, Map<string, ProviderCredentialIssue>>();
const listenersByDataDir = new Map<string, Set<() => void>>();

function issueMap(dataDir: string): Map<string, ProviderCredentialIssue> {
  let map = issuesByDataDir.get(dataDir);
  if (!map) {
    map = new Map();
    issuesByDataDir.set(dataDir, map);
  }
  return map;
}

function notify(dataDir: string): void {
  const listeners = listenersByDataDir.get(dataDir);
  if (!listeners) return;
  for (const listener of listeners) listener();
}

export function onCredentialIssuesChanged(dataDir: string, listener: () => void): () => void {
  let set = listenersByDataDir.get(dataDir);
  if (!set) {
    set = new Set();
    listenersByDataDir.set(dataDir, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listenersByDataDir.delete(dataDir);
  };
}

export function expectsStoredCredential(
  connection: Pick<ServiceConnection, 'connected' | 'hasCredential' | 'authType'>,
): boolean {
  return (
    connection.connected &&
    connection.hasCredential &&
    connection.authType !== 'none' &&
    connection.authType !== 'ambient'
  );
}

/** Records a detected runtime credential issue for a connection and notifies subscribers on change. */
export function recordCredentialIssue(
  dataDir: string,
  connectionId: string,
  issue: ProviderCredentialIssue,
): boolean {
  const map = issueMap(dataDir);
  if (map.get(connectionId) === issue) return false;
  map.set(connectionId, issue);
  notify(dataDir);
  return true;
}

/** Clears a recorded credential issue for a connection and notifies subscribers if one existed. */
export function clearCredentialIssue(dataDir: string, connectionId: string): boolean {
  const map = issuesByDataDir.get(dataDir);
  if (!map?.delete(connectionId)) return false;
  if (map.size === 0) issuesByDataDir.delete(dataDir);
  notify(dataDir);
  return true;
}

/**
 * Returns active credential issues indexed by connectionId for connections whose persisted
 * metadata still claims a usable credential. Prunes entries for removed or disconnected rows.
 */
export function currentCredentialIssues(
  dataDir: string,
  connections: readonly ServiceConnection[],
): Record<string, ProviderCredentialIssue> | undefined {
  const map = issuesByDataDir.get(dataDir);
  if (!map || map.size === 0) return undefined;
  const eligible = new Map(connections.map((item) => [item.connectionId, item]));
  const result: Record<string, ProviderCredentialIssue> = {};
  let hasAny = false;
  for (const [connectionId, issue] of map.entries()) {
    const connection = eligible.get(connectionId);
    if (!connection || !expectsStoredCredential(connection)) {
      map.delete(connectionId);
      continue;
    }
    result[connectionId] = issue;
    hasAny = true;
  }
  if (map.size === 0) issuesByDataDir.delete(dataDir);
  return hasAny ? result : undefined;
}

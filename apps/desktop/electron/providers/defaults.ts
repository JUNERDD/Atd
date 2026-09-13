import type { StoredConnection } from './schema';

/** Initialize from the saved connection, or restore a single configured connection at startup. */
export function initialDefaultConnectionId(
  connections: readonly StoredConnection[],
  preferredConnectionId: string | null,
): string | null {
  const [connection, ...others] = connections.filter(
    (item) =>
      item.connected &&
      item.defaultModel &&
      (preferredConnectionId === null || item.connectionId === preferredConnectionId),
  );
  return connection && others.length === 0 ? connection.connectionId : null;
}

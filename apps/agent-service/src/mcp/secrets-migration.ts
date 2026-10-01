import { errorMessage } from '@ai/agent-contracts';
import { KeyringBackend } from '../credentials/keyring.js';
import type { Logger } from '../logging.js';
import {
  KEYRING_REF,
  readStoredServers,
  secretAccount,
  writeStoredServers,
  type SecretKind,
  type StoredServer,
  type StoredValues,
} from './server-store.js';

/**
 * Moves MCP env and header values that `servers.json` still keeps in plain text (saved before the
 * keyring held them, including plugin duplicates) into the OS keyring. It runs at every service
 * start, before anything reads the servers, and does nothing once no plain value is left.
 *
 * Every value is written to the keyring before the file is rewritten with keyring refs, so an
 * interruption leaves plain values that the next start writes again (the same values, to the same
 * accounts) and converges. Without a usable keyring the values stay in plain text with a warning
 * and startup goes on, as provider credentials fall back when no keyring exists; a later save of a
 * new or changed value still needs the keyring (server-store.ts).
 */
export async function migrateMcpSecrets(
  dataDir: string,
  serviceId: string,
  log: Logger,
): Promise<void> {
  const servers = await readStoredServers(dataDir);
  const pending = servers.flatMap(plainEntries);
  if (!pending.length) return;
  const keyring = new KeyringBackend(serviceId);
  try {
    for (const entry of pending)
      await keyring.set(
        secretAccount(serviceId, entry.server, entry.kind, entry.name),
        entry.value,
      );
  } catch (error) {
    log.warn('MCP env and header values stay in plain text: the OS keyring is unavailable.', {
      values: pending.length,
      error: errorMessage(error),
    });
    return;
  }
  await writeStoredServers(dataDir, servers.map(withKeyringRefs));
  log.info('Moved MCP env and header values into the OS keyring.', {
    servers: new Set(pending.map((entry) => entry.server.serverId)).size,
    values: pending.length,
  });
}

function plainEntries(server: StoredServer) {
  const entries = (kind: SecretKind, values: StoredValues) =>
    Object.entries(values).flatMap(([name, value]) =>
      typeof value === 'string' ? [{ server, kind, name, value }] : [],
    );
  return [
    ...entries('env', server.stdio?.env ?? {}),
    ...entries('header', server.http?.headers ?? {}),
  ];
}

function withKeyringRefs(server: StoredServer): StoredServer {
  const refs = (values: StoredValues): StoredValues =>
    Object.fromEntries(Object.keys(values).map((name) => [name, KEYRING_REF]));
  return {
    ...server,
    stdio: server.stdio && { ...server.stdio, env: refs(server.stdio.env) },
    http: server.http && { ...server.http, headers: refs(server.http.headers) },
  };
}

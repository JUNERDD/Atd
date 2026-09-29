import { createHash } from 'node:crypto';
import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { MigrationCredential } from '@ai/agent-contracts';
import { Type, type Static } from 'typebox';
import { decryptCredential } from '../providers/credentials';
import type { ConnectionConfig } from '../../src/client/providers/schema';
import { parse } from '../../src/client/agent/validation';

/**
 * One-time credential reader for migration. Each connection's safeStorage
 * ciphertext is decrypted exactly once in the main process and handed to the
 * authenticated upload channel; no plaintext temp files are written, and
 * secret values never reach logs. Undecryptable connections resolve to a
 * re-prompt verdict instead of a faked upload.
 */
const StoredConnectionSchema = Type.Object(
  {
    connectionId: Type.String(),
    provider: Type.String(),
    name: Type.String(),
    baseUrl: Type.String(),
    authType: Type.String(),
    options: Type.Record(Type.String(), Type.String()),
    customModels: Type.Array(Type.Object({}, { additionalProperties: true })),
    connected: Type.Boolean(),
    encryptedCredential: Type.String(),
  },
  { additionalProperties: true },
);
const SettingsFileSchema = Type.Object(
  {
    connections: Type.Array(StoredConnectionSchema),
  },
  { additionalProperties: true },
);
type StoredConnection = Static<typeof StoredConnectionSchema>;

export interface DecryptableConnection {
  connectionId: string;
  providerId: string;
  configurationId: string;
  credential: MigrationCredential;
}

export interface UndecryptableConnection {
  connectionId: string;
  providerId: string;
  reason: 'no-credential' | 'undecryptable';
  detail: string;
}

async function loadConnections(): Promise<StoredConnection[]> {
  const file = path.join(app.getPath('userData'), 'settings.json');
  try {
    return parse(SettingsFileSchema, JSON.parse(await readFile(file, 'utf8'))).connections;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw new Error('Desktop settings could not be read for migration.');
  }
}

/**
 * Decrypts every connected connection once. Returns the decryptable set plus
 * truthful per-connection verdicts for the rest (re-prompt path).
 */
export async function decryptConnectionsOnce(): Promise<{
  ready: DecryptableConnection[];
  blocked: UndecryptableConnection[];
}> {
  const ready: DecryptableConnection[] = [];
  const blocked: UndecryptableConnection[] = [];
  for (const connection of await loadConnections()) {
    if (!connection.connected || !connection.encryptedCredential) {
      blocked.push({
        connectionId: connection.connectionId,
        providerId: connection.provider,
        reason: 'no-credential',
        detail: 'No saved credential; reconnect in the service.',
      });
      continue;
    }
    try {
      const credential = decryptCredential(connection.encryptedCredential);
      if (!credential) {
        blocked.push({
          connectionId: connection.connectionId,
          providerId: connection.provider,
          reason: 'no-credential',
          detail: 'Credential is empty; reconnect in the service.',
        });
        continue;
      }
      ready.push({
        connectionId: connection.connectionId,
        providerId: connection.provider,
        configurationId: configurationId({
          provider: connection.provider,
          name: connection.name,
          baseUrl: connection.baseUrl,
          authType: connection.authType as 'api_key',
          defaultModel: '',
          options: connection.options,
          customModels: connection.customModels as never,
        }),
        credential,
      });
    } catch {
      blocked.push({
        connectionId: connection.connectionId,
        providerId: connection.provider,
        reason: 'undecryptable',
        detail: 'The saved credential could not be unlocked. Reconnect this provider.',
      });
    }
  }
  return { ready, blocked };
}

/** The service's configuration fingerprint of a migrated connection (provider, endpoint, auth, options, models). */
export function configurationId(config: ConnectionConfig): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        provider: config.provider,
        baseUrl: config.baseUrl,
        authType: config.authType,
        options: Object.entries(config.options).sort(([a], [b]) => a.localeCompare(b)),
        customModels: config.customModels,
      }),
    )
    .digest('hex');
}

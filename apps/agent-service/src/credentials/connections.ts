import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  parse,
  ServiceConnectionsFileSchema,
  type ServiceConnection,
  type ServiceConnectionsFile,
} from '@ai/agent-contracts';
import { atomicWrite } from '../config.js';

/**
 * Service-owned provider connection metadata (no secrets). Secrets live in
 * the OS keyring under the service namespace; this file carries revision,
 * connectivity and configuration identity so runners can detect stale refs.
 *
 * Path (freeze candidate): `<dataDir>/providers/connections.json`.
 */
export function connectionsFile(dataDir: string): string {
  return path.join(dataDir, 'providers', 'connections.json');
}

export interface ConnectionConfigInput {
  provider: string;
  baseUrl: string;
  authType: string;
  options: Record<string, string>;
  customModels: unknown[];
}

/** Mirrors the desktop configurationId so migrated refs stay comparable. */
export function serviceConfigurationId(config: ConnectionConfigInput): string {
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

function emptyFile(): ServiceConnectionsFile {
  return { version: 1, defaultConnectionId: null, connections: [] };
}

export class ConnectionStore {
  private chain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly file: string,
    public data: ServiceConnectionsFile,
  ) {}

  static async load(dataDir: string): Promise<ConnectionStore> {
    const file = connectionsFile(dataDir);
    try {
      if ((await stat(file)).size > 8 * 1024 * 1024)
        throw new Error('Provider connections file is too large.');
      return new ConnectionStore(
        file,
        parse(ServiceConnectionsFileSchema, JSON.parse(await readFile(file, 'utf8'))),
      );
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        const store = new ConnectionStore(file, emptyFile());
        await atomicWrite(file, store.data);
        return store;
      }
      throw new Error('Saved provider connections could not be read. The file is preserved.');
    }
  }

  /** Serializes metadata mutations; publishes only after the atomic write. */
  change<T>(update: (draft: ServiceConnectionsFile) => T | Promise<T>): Promise<T> {
    const operation = this.chain.then(async () => {
      const draft = structuredClone(this.data);
      const result = await update(draft);
      await atomicWrite(this.file, parse(ServiceConnectionsFileSchema, draft));
      this.data = draft;
      return result;
    });
    this.chain = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  connection(connectionId: string): ServiceConnection {
    const found = this.data.connections.find((item) => item.connectionId === connectionId);
    if (!found) throw new Error(`Connection ${connectionId} no longer exists.`);
    return found;
  }

  /** Upserts migrated metadata; conflicts on changed content fail loudly. */
  async upsertMigrated(connection: ServiceConnection): Promise<'inserted' | 'identical'> {
    return this.change((data) => {
      const existing = data.connections.find(
        (item) => item.connectionId === connection.connectionId,
      );
      if (!existing) {
        data.connections.push(connection);
        data.defaultConnectionId ??= connection.connectionId;
        return 'inserted';
      }
      const { migratedAt: _a, ...rest } = existing;
      const { migratedAt: _b, ...next } = connection;
      if (
        JSON.stringify(rest) !==
        JSON.stringify({
          ...next,
          hasCredential: existing.hasCredential,
          connected: existing.connected,
        })
      ) {
        // A live connection's credential flags win; metadata drift is a conflict.
        const { hasCredential: _c, connected: _d, ...existingMeta } = rest;
        const { hasCredential: _e, connected: _f, ...nextMeta } = next;
        if (JSON.stringify(existingMeta) !== JSON.stringify(nextMeta))
          throw new Error(`Connection ${connection.connectionId} changed since migration.`);
      }
      return 'identical';
    });
  }
}

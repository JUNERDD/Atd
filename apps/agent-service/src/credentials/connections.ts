import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  parse,
  ServiceConnectionsFileSchema,
  type ServiceConnection,
  type ServiceConnectionsFile,
} from '@atd/agent-contracts';
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

async function readConnections(file: string): Promise<ServiceConnectionsFile> {
  if ((await stat(file)).size > 8 * 1024 * 1024)
    throw new Error('Provider connections file is too large.');
  return parse(ServiceConnectionsFileSchema, JSON.parse(await readFile(file, 'utf8')));
}

export class ConnectionStore {
  /**
   * Mutation chains per file, shared by every instance. Requests load their
   * own store, and a catalog refresh or sign-in can finish long after it
   * loaded, so each change runs in file order against the current contents.
   */
  private static readonly chains = new Map<string, Promise<void>>();

  private constructor(
    private readonly file: string,
    public data: ServiceConnectionsFile,
  ) {}

  static async load(dataDir: string): Promise<ConnectionStore> {
    const file = connectionsFile(dataDir);
    try {
      return new ConnectionStore(file, await readConnections(file));
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
    const prior = ConnectionStore.chains.get(this.file) ?? Promise.resolve();
    const operation = prior.then(async () => {
      let draft: ServiceConnectionsFile;
      try {
        draft = await readConnections(this.file);
      } catch {
        throw new Error('Saved provider connections could not be read. The file is preserved.');
      }
      const result = await update(draft);
      await atomicWrite(this.file, parse(ServiceConnectionsFileSchema, draft));
      this.data = draft;
      return result;
    });
    const tail = operation.then(
      () => undefined,
      () => undefined,
    );
    ConnectionStore.chains.set(this.file, tail);
    void tail.then(() => {
      if (ConnectionStore.chains.get(this.file) === tail) ConnectionStore.chains.delete(this.file);
    });
    return operation;
  }

  /** Rereads the file, so a long-lived holder sees connections changed since it loaded. */
  async reload(): Promise<void> {
    this.data = await readConnections(this.file);
  }

  connection(connectionId: string): ServiceConnection {
    const found = this.data.connections.find((item) => item.connectionId === connectionId);
    if (!found) throw new Error(`Connection ${connectionId} no longer exists.`);
    return found;
  }
}

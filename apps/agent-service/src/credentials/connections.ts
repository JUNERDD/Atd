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
import { retireLegacyLogin } from '../providers/auth-policy.js';

const CONNECTIONS_FILE_LIMIT = 8 * 1024 * 1024;

/** Safe to show when a proposed catalog or settings update cannot fit in shared storage. */
export class ConnectionStorageLimitError extends Error {
  constructor() {
    super('The saved model catalogs and connection settings exceed the 8 MiB storage limit.');
    this.name = 'ConnectionStorageLimitError';
  }
}

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

/**
 * Provider ids Pi renamed without keeping an alias, old to new. A stored connection is read under
 * the current id and the next write persists it. Only the id moves: the configuration identity,
 * the keyring entry and saved model selections are keyed by connection, so they stay valid.
 */
const RENAMED_PROVIDERS = new Map([
  // pi-ai 1.0.3 renamed Azure OpenAI's provider.
  ['azure-openai-responses', 'azure'],
]);

async function readConnections(
  file: string,
  migrated?: () => void,
): Promise<ServiceConnectionsFile> {
  if ((await stat(file)).size > CONNECTIONS_FILE_LIMIT)
    throw new Error('Provider connections file is too large.');
  const data = parse(ServiceConnectionsFileSchema, JSON.parse(await readFile(file, 'utf8')));
  for (const connection of data.connections) {
    connection.provider = RENAMED_PROVIDERS.get(connection.provider) ?? connection.provider;
    if (retireLegacyLogin(connection)) {
      migrated?.();
      connection.configurationId = serviceConfigurationId({
        ...connection,
        options: connection.options ?? {},
        customModels: connection.customModels ?? [],
      });
    }
  }
  return data;
}

export class ConnectionStore {
  /**
   * Mutation chains per file, shared by every instance. Requests load their
   * own store, and a catalog refresh or sign-in can finish long after it
   * loaded, so each change runs in file order against the current contents.
   */
  private static readonly chains = new Map<string, Promise<void>>();
  private static readonly watchers = new Map<string, Set<() => void>>();

  /** Login and quota changes can commit outside a request; notify every connected window. */
  static onChanged(dataDir: string, listener: () => void): () => void {
    const file = connectionsFile(dataDir);
    const listeners = ConnectionStore.watchers.get(file) ?? new Set();
    listeners.add(listener);
    ConnectionStore.watchers.set(file, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) ConnectionStore.watchers.delete(file);
    };
  }

  private constructor(
    private readonly file: string,
    public data: ServiceConnectionsFile,
  ) {}

  static async load(dataDir: string): Promise<ConnectionStore> {
    const file = connectionsFile(dataDir);
    try {
      let migrated = false;
      const store = new ConnectionStore(
        file,
        await readConnections(file, () => {
          migrated = true;
        }),
      );
      if (migrated) await store.change(() => undefined);
      return store;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        const store = new ConnectionStore(file, emptyFile());
        await atomicWrite(file, store.data);
        return store;
      }
      throw new Error('Saved provider connections could not be read. The file is preserved.');
    }
  }

  /** Validates the draft before credential side effects; publishes after the atomic write. */
  change<T>(
    update: (draft: ServiceConnectionsFile) => T | Promise<T>,
    beforeWrite?: () => Promise<void>,
  ): Promise<T> {
    const prior = ConnectionStore.chains.get(this.file) ?? Promise.resolve();
    const operation = prior.then(async () => {
      let draft: ServiceConnectionsFile;
      try {
        draft = await readConnections(this.file);
      } catch {
        throw new Error('Saved provider connections could not be read. The file is preserved.');
      }
      const result = await update(draft);
      const validated = parse(ServiceConnectionsFileSchema, draft);
      // Discovery expands compact upstream rows into full models. Bound the exact persisted
      // representation, including the other connections, before replacing the readable file.
      if (Buffer.byteLength(JSON.stringify(validated), 'utf8') > CONNECTIONS_FILE_LIMIT)
        throw new ConnectionStorageLimitError();
      await beforeWrite?.();
      await atomicWrite(this.file, validated);
      this.data = draft;
      for (const listener of ConnectionStore.watchers.get(this.file) ?? []) listener();
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

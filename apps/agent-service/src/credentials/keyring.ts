/**
 * Persistent credential backend on `@napi-rs/keyring` AsyncEntry.
 *
 * Namespace (freeze candidate `keyring-namespace v1`):
 * - keyring service: `ai-agent-service:<serviceId>`
 * - keyring account: `provider:<connectionId>`
 * - MCP server entries: account `mcp:<serverKey>` (see server-keys.ts), the server's bearer token
 * - MCP stdio env and HTTP header values: `mcp:<serverKey>:env:<NAME>` and
 *   `mcp:<serverKey>:header:<Name>` (mcp/server-store.ts)
 * - MCP OAuth sign-in: account `mcp:<serverKey>:oauth`, one JSON document per server with its
 *   client registration and tokens (mcp/oauth-store.ts); it sits under the server's own account
 *   prefix, so removing the server deletes it
 * - sensitive plugin config: account `plugin:<pluginId>:<key>` (plugins/secrets.ts); plugin ids
 *   never contain `:` and config keys are identifiers, so accounts cannot collide
 * - launch approval key: account `security:launch-approval-key` (mcp/launch-key.ts), the profile's
 *   random HMAC key for MCP launch fingerprints, never written to the data dir
 *
 * Linux pins `secret-service`; keyutils is kernel memory and must never be
 * reported as persistent storage. When no durable backend exists the backend
 * reports unavailable truthfully and the service keeps running on explicit
 * temporary credentials (see credentials.ts TempCredentialStore).
 *
 * Only `readKeyringItem` reaches outside this service's namespace: the one-time import of
 * pi-mcp-adapter's OAuth credentials reads that product's own keychain service, and nothing here
 * writes to or deletes from it.
 */
import { randomUUID } from 'node:crypto';
import {
  dedupeInflight,
  getCachedSecret,
  hasCachedSecret,
  inflightGets,
  invalidateSecretCache,
  isTestMode,
  resetKeyringCache,
  runCachedStatus,
  secretCache,
  withKeyringGate,
} from './keyring-cache.js';

export interface KeyringStatus {
  available: boolean;
  backend: 'keychain' | 'credential-manager' | 'secret-service' | 'unavailable';
  detail: string;
}

export function keyringServiceName(serviceId: string): string {
  return `ai-agent-service:${serviceId}`;
}

export function keyringAccount(connectionId: string): string {
  return `provider:${connectionId}`;
}

export function keyringMcpAccount(serverKey: string): string {
  return `mcp:${serverKey}`;
}

/**
 * One stdio env or HTTP header value of an MCP server. The server key has a fixed shape
 * (`mcp:<serviceId>:<serverId>:<hash8>`, see server-keys.ts) and the name is everything after the
 * kind, so each (server, kind, name) has its own account, and the server's own `mcp:<serverKey>`
 * account (its bearer token) prefixes all of them.
 */
export function keyringMcpSecretAccount(
  serverKey: string,
  kind: 'env' | 'header',
  name: string,
): string {
  return `${keyringMcpAccount(serverKey)}:${kind}:${name}`;
}

/** The OAuth sign-in of one MCP server (client registration and tokens); see mcp/oauth-store.ts. */
export function keyringMcpOAuthAccount(serverKey: string): string {
  return `${keyringMcpAccount(serverKey)}:oauth`;
}

export const LAUNCH_APPROVAL_KEY_ACCOUNT = 'security:launch-approval-key';

export function keyringPluginAccount(pluginId: string, key: string): string {
  return `plugin:${pluginId}:${key}`;
}

interface AsyncEntryLike {
  setPassword(password: string, signal?: AbortSignal | null): Promise<void>;
  getPassword(signal?: AbortSignal | null): Promise<string | undefined>;
  deleteCredential(signal?: AbortSignal | null): Promise<boolean>;
}

interface KeyringModule {
  AsyncEntry: new (
    service: string,
    username: string,
    options?: { linux?: { store?: 'secret-service' | 'keyutils' } } | null,
  ) => AsyncEntryLike;
  findCredentialsAsync?: (
    service: string,
    target?: string | null,
    signal?: AbortSignal | null,
  ) => Promise<Array<{ account: string; password: string }>>;
}

let cachedModule: KeyringModule | null | undefined;

async function loadKeyring(): Promise<KeyringModule | null> {
  if (cachedModule !== undefined) return cachedModule;
  try {
    cachedModule = (await import('@napi-rs/keyring')) as unknown as KeyringModule;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

/** For tests and runtime probes that must not touch the real OS keyring. */
export function __setKeyringModuleForTests(module: KeyringModule | null | undefined): void {
  cachedModule = module;
  resetKeyringCache(module !== undefined);
}

function entryOptions(): { linux?: { store?: 'secret-service' | 'keyutils' } } | undefined {
  // Linux-only pin; ignored on macOS/Windows. Requiring secret-service throws
  // instead of silently falling back to the in-memory keyutils store.
  return process.platform === 'linux' ? { linux: { store: 'secret-service' } } : undefined;
}

export class KeyringUnavailable extends Error {
  constructor(detail = 'No persistent credential backend is available.') {
    super(detail);
    this.name = 'KeyringUnavailable';
  }
}

function asKeyringUnavailable(action: string, error: unknown): KeyringUnavailable {
  if (error instanceof KeyringUnavailable) return error;
  return new KeyringUnavailable(
    `The credential could not be ${action}: ${error instanceof Error ? error.message : 'unknown'}`,
  );
}

/** Persistent keyring partitioned by service identity. */
export class KeyringBackend {
  private readonly service: string;

  constructor(serviceId: string) {
    if (!serviceId) throw new Error('KeyringBackend requires a serviceId.');
    this.service = keyringServiceName(serviceId);
  }

  private async entry(account: string): Promise<AsyncEntryLike> {
    const module = await loadKeyring();
    if (!module) throw new KeyringUnavailable('The OS keyring module is not installed.');
    try {
      return new module.AsyncEntry(this.service, account, entryOptions());
    } catch (error) {
      throw new KeyringUnavailable(
        error instanceof Error ? error.message : 'The OS keyring entry is unavailable.',
      );
    }
  }

  /** Probe with a throwaway entry; never reports keyutils as persistent. */
  async status(signal?: AbortSignal): Promise<KeyringStatus> {
    return runCachedStatus(this.service, signal, () =>
      withKeyringGate<KeyringStatus>(async () => {
        const module = await loadKeyring();
        if (!module) return { available: false, backend: 'unavailable', detail: 'Module missing.' };
        try {
          const entry = new module.AsyncEntry(this.service, 'probe:availability', entryOptions());
          await entry.setPassword(`probe-${Date.now()}`, signal ?? null);
          await entry.getPassword(signal ?? null);
          await entry.deleteCredential(signal ?? null);
          return {
            available: true,
            backend:
              process.platform === 'darwin'
                ? 'keychain'
                : process.platform === 'win32'
                  ? 'credential-manager'
                  : 'secret-service',
            detail: 'Probe write/read/delete succeeded.',
          };
        } catch (error) {
          return {
            available: false,
            backend: 'unavailable',
            detail: error instanceof Error ? error.message : 'Probe failed.',
          };
        }
      }),
    );
  }

  async set(account: string, secret: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const key = `${this.service}\0${account}`;
    invalidateSecretCache(key);
    try {
      await withKeyringGate(async () => {
        signal?.throwIfAborted();
        try {
          await (await this.entry(account)).setPassword(secret, signal ?? null);
        } catch (error) {
          if (signal?.aborted || process.platform !== 'darwin' || isTestMode()) throw error;
          // Prove the keychain is unlocked and accepts `secret` before deleting a legacy ACL item.
          const probe = await this.entry(`probe:replace:${randomUUID()}`);
          await probe.setPassword(secret, signal ?? null);
          await probe.deleteCredential(null).catch(() => false);
          await (await this.entry(account)).deleteCredential(signal ?? null);
          await (await this.entry(account)).setPassword(secret, signal ?? null);
        }
        if (!isTestMode()) secretCache.set(key, secret);
      });
    } catch (error) {
      secretCache.delete(key);
      throw asKeyringUnavailable('stored', error);
    }
  }

  async get(account: string, signal?: AbortSignal): Promise<string | undefined> {
    signal?.throwIfAborted();
    const key = `${this.service}\0${account}`;
    if (!isTestMode() && hasCachedSecret(key)) return getCachedSecret(key);
    const read = async (): Promise<string | undefined> => {
      try {
        return await withKeyringGate(async () => {
          signal?.throwIfAborted();
          if (!isTestMode() && hasCachedSecret(key)) return getCachedSecret(key);
          const value =
            (await (await this.entry(account)).getPassword(signal ?? null)) ?? undefined;
          if (typeof value === 'string' && !isTestMode()) secretCache.set(key, value);
          else if (value === undefined) secretCache.delete(key);
          return value;
        });
      } catch (error) {
        secretCache.delete(key);
        throw asKeyringUnavailable('read', error);
      }
    };
    return signal ? read() : dedupeInflight(inflightGets, key, read);
  }

  async delete(account: string, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    const key = `${this.service}\0${account}`;
    invalidateSecretCache(key);
    try {
      return await withKeyringGate(async () => {
        signal?.throwIfAborted();
        return await (await this.entry(account)).deleteCredential(signal ?? null);
      });
    } catch (error) {
      throw asKeyringUnavailable('deleted', error);
    } finally {
      secretCache.delete(key);
    }
  }

  /** Lists accounts in this service namespace; secret values are never returned. */
  async listAccounts(signal?: AbortSignal): Promise<string[]> {
    signal?.throwIfAborted();
    return withKeyringGate(async () => {
      signal?.throwIfAborted();
      const module = await loadKeyring();
      if (!module?.findCredentialsAsync) return [];
      try {
        const found = await module.findCredentialsAsync(this.service, null, signal ?? null);
        return found.map((item) => item.account);
      } catch {
        return [];
      }
    });
  }
}

/**
 * Reads one item of another keychain service by its exact name (not prefixed with
 * `ai-agent-service:`): the one-time import of pi-mcp-adapter's OAuth credentials
 * (mcp/oauth-migration.ts). Answers undefined when the item does not exist and throws
 * `KeyringUnavailable` when the keychain cannot be read. There is deliberately no way to write or
 * delete a foreign item.
 */
export async function readKeyringItem(
  service: string,
  account: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  signal?.throwIfAborted();
  return withKeyringGate(async () => {
    signal?.throwIfAborted();
    const module = await loadKeyring();
    if (!module) throw new KeyringUnavailable('The OS keyring module is not installed.');
    try {
      const entry = new module.AsyncEntry(service, account, entryOptions());
      return (await entry.getPassword(signal ?? null)) ?? undefined;
    } catch (error) {
      throw asKeyringUnavailable('read', error);
    }
  });
}

/**
 * Persistent credential backend on `@napi-rs/keyring` AsyncEntry.
 *
 * Namespace (freeze candidate `keyring-namespace v1`):
 * - keyring service: `ai-agent-service:<serviceId>`
 * - keyring account: `provider:<connectionId>`
 * - MCP server entries: account `mcp:<serverKey>` (see server-keys.ts)
 *
 * Linux pins `secret-service`; keyutils is kernel memory and must never be
 * reported as persistent storage. When no durable backend exists the backend
 * reports unavailable truthfully and the service keeps running on explicit
 * temporary credentials (see credentials.ts TempCredentialStore).
 */
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
    const module = await loadKeyring();
    if (!module) return { available: false, backend: 'unavailable', detail: 'Module missing.' };
    try {
      const probe = new module.AsyncEntry(this.service, 'probe:availability', entryOptions());
      await probe.setPassword(`probe-${Date.now()}`, signal ?? null);
      await probe.getPassword(signal ?? null);
      await probe.deleteCredential(signal ?? null);
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
  }

  async set(account: string, secret: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    try {
      await (await this.entry(account)).setPassword(secret, signal ?? null);
    } catch (error) {
      if (error instanceof KeyringUnavailable) throw error;
      throw new KeyringUnavailable(
        `The credential could not be stored: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  async get(account: string, signal?: AbortSignal): Promise<string | undefined> {
    signal?.throwIfAborted();
    try {
      return (await (await this.entry(account)).getPassword(signal ?? null)) ?? undefined;
    } catch (error) {
      if (error instanceof KeyringUnavailable) throw error;
      throw new KeyringUnavailable(
        `The credential could not be read: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  async delete(account: string, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    try {
      return await (await this.entry(account)).deleteCredential(signal ?? null);
    } catch (error) {
      if (error instanceof KeyringUnavailable) throw error;
      throw new KeyringUnavailable(
        `The credential could not be deleted: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /** Lists accounts in this service namespace; secret values are never returned. */
  async listAccounts(signal?: AbortSignal): Promise<string[]> {
    signal?.throwIfAborted();
    const module = await loadKeyring();
    if (!module?.findCredentialsAsync) return [];
    try {
      const found = await module.findCredentialsAsync(this.service, null, signal ?? null);
      return found.map((item) => item.account);
    } catch {
      return [];
    }
  }
}

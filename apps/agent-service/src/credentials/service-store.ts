import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from '@earendil-works/pi-ai';
import { parse, ProviderCredentialSchema } from '@ai/agent-contracts';
import { TempCredentialStore } from '../credentials.js';
import { ConnectionStore } from './connections.js';
import { keyringAccount, KeyringBackend, KeyringUnavailable } from './keyring.js';

/**
 * Service CredentialStore: one instance per provider connection, mirroring the
 * desktop ConnectionCredentials contract (connection/revision/modify-txn).
 * Secrets persist in the OS keyring; metadata (connected/hasCredential) lives
 * in the ConnectionStore. Modify transactions serialize per connection.
 */
export class ServiceCredentialStore implements CredentialStore {
  /** Per-connection modify chains; the transaction lock for refresh races. */
  private static readonly transactions = new Map<string, Promise<void>>();

  constructor(
    private readonly keyring: KeyringBackend,
    private readonly connections: ConnectionStore,
    private readonly connectionId: string,
    private readonly providerId: string,
    private readonly configurationId: string,
  ) {}

  private get account(): string {
    return keyringAccount(this.connectionId);
  }

  private assertConnection(): void {
    const connection = this.connections.connection(this.connectionId);
    if (connection.configurationId !== this.configurationId)
      throw new Error('The connection configuration changed.');
  }

  private static decode(raw: string | undefined): Credential | undefined {
    if (!raw) return undefined;
    return parse(ProviderCredentialSchema, JSON.parse(raw)) as Credential;
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    if (providerId !== this.providerId) return undefined;
    this.assertConnection();
    const connection = this.connections.connection(this.connectionId);
    if (!connection.connected || !connection.hasCredential) {
      // Explicit temporary injection stays available when no persisted
      // credential exists; it is never mistaken for persisted OAuth state.
      return new TempCredentialStore().read(providerId, options);
    }
    try {
      return ServiceCredentialStore.decode(await this.keyring.get(this.account, options?.signal));
    } catch (error) {
      if (error instanceof KeyringUnavailable)
        return new TempCredentialStore().read(providerId, options);
      throw error;
    }
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    const value = await this.read(this.providerId, options);
    return value ? [{ providerId: this.providerId, type: value.type }] : [];
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    if (providerId !== this.providerId) throw new Error('Credential connection mismatch.');
    const prior = ServiceCredentialStore.transactions.get(this.connectionId) ?? Promise.resolve();
    const gate = Promise.withResolvers<void>();
    const tail = prior.then(() => gate.promise);
    // Unhandled tail rejections must not surface; modify awaits prior only.
    tail.catch(() => undefined);
    ServiceCredentialStore.transactions.set(this.connectionId, tail);
    await prior;
    try {
      options?.signal?.throwIfAborted();
      const connection = this.connections.connection(this.connectionId);
      if (connection.configurationId !== this.configurationId)
        throw new Error('The connection configuration changed.');
      const stored = connection.hasCredential
        ? ServiceCredentialStore.decode(await this.keyring.get(this.account, options?.signal))
        : undefined;
      const next = await fn(stored);
      options?.signal?.throwIfAborted();
      if (next) {
        await this.keyring.set(this.account, JSON.stringify(next), options?.signal);
        await this.connections.change((data) => {
          const item = data.connections.find((entry) => entry.connectionId === this.connectionId);
          if (!item) throw new Error('This connection no longer exists.');
          if (item.configurationId !== this.configurationId)
            throw new Error('The connection configuration changed.');
          item.hasCredential = true;
          item.connected = true;
        });
      }
      return next ?? stored;
    } finally {
      gate.resolve();
      if (ServiceCredentialStore.transactions.get(this.connectionId) === tail)
        ServiceCredentialStore.transactions.delete(this.connectionId);
    }
  }

  async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    if (providerId !== this.providerId) throw new Error('Credential connection mismatch.');
    options?.signal?.throwIfAborted();
    await this.keyring.delete(this.account, options?.signal);
    await this.connections.change((data) => {
      const item = data.connections.find((entry) => entry.connectionId === this.connectionId);
      if (item) {
        item.hasCredential = false;
        item.connected = false;
      }
    });
  }
}

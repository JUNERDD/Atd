import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from '@earendil-works/pi-ai';
import { parse, ProviderCredentialSchema } from '@atd/agent-contracts';
import { assertCredential } from '../providers/auth-policy.js';
import { revokeChatGPT } from '../providers/chatgpt-oauth.js';
import {
  CHATGPT_RECONNECT_NOTICE,
  isChatGPTRefreshInvalidation,
} from '../providers/chatgpt-refresh-error.js';
import { ChatGPTCredentialSchema } from '../providers/chatgpt-storage.js';
import { ConflictError } from '../errors.js';
import { ConnectionStore } from './connections.js';
import { keyringAccount, KeyringBackend, KeyringUnavailable } from './keyring.js';

const transactions = new Map<string, Promise<void>>();
const REVOCATION_NOTICE =
  'Signed out locally. Remote disconnection could not be confirmed. Disconnect Atd in ChatGPT settings.';

interface DisconnectOptions extends AuthOperationOptions {
  expectedRevision?: number;
}

/** Creation pins its initial row and remembers only revisions committed by that operation. */
export interface CredentialWriteOptions extends AuthOperationOptions {
  expectedRevision?: number;
  onCommitted?: (revision: number) => void;
}

/** Login, refresh, edit and deletion all share the same connection lock. */
export async function withCredentialLock<T>(
  connectionId: string,
  action: () => Promise<T>,
): Promise<T> {
  const prior = transactions.get(connectionId) ?? Promise.resolve();
  const operation = prior.then(action);
  const tail = operation.then(
    () => undefined,
    () => undefined,
  );
  transactions.set(connectionId, tail);
  try {
    return await operation;
  } finally {
    if (transactions.get(connectionId) === tail) transactions.delete(connectionId);
  }
}

/** Secrets persist in the OS keyring; writes check fresh connection metadata under the lock. */
export class ServiceCredentialStore implements CredentialStore {
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
    return raw ? (parse(ProviderCredentialSchema, JSON.parse(raw)) as Credential) : undefined;
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    if (providerId !== this.providerId) return undefined;
    return withCredentialLock(this.connectionId, async () => {
      options?.signal?.throwIfAborted();
      await this.connections.reload();
      this.assertConnection();
      const connection = this.connections.connection(this.connectionId);
      if (!connection.connected || !connection.hasCredential) return undefined;
      // Keep endpoint validation and secret selection together: an edit cannot substitute its
      // new key after an older runtime has checked the old endpoint configuration.
      const credential = ServiceCredentialStore.decode(
        await this.keyring.get(this.account, options?.signal),
      );
      if (credential) assertCredential(connection, credential);
      return credential;
    });
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    const value = await this.read(this.providerId, options);
    return value ? [{ providerId: this.providerId, type: value.type }] : [];
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: CredentialWriteOptions,
  ): Promise<Credential | undefined> {
    if (providerId !== this.providerId) throw new Error('Credential connection mismatch.');
    return withCredentialLock(this.connectionId, async () => {
      options?.signal?.throwIfAborted();
      await this.connections.reload();
      this.assertConnection();
      const connection = this.connections.connection(this.connectionId);
      if (
        options?.expectedRevision !== undefined &&
        connection.revision !== options.expectedRevision
      )
        throw new ConflictError('This connection changed. Reload before connecting.');
      const stored = connection.hasCredential
        ? ServiceCredentialStore.decode(await this.keyring.get(this.account, options?.signal))
        : undefined;
      let next: Credential | undefined;
      try {
        next = await fn(stored);
      } catch (error) {
        if (
          stored?.type === 'oauth' &&
          connection.provider === 'openai' &&
          connection.authType === 'oauth' &&
          isChatGPTRefreshInvalidation(error)
        )
          await this.invalidateChatGPTCredential();
        throw error;
      }
      options?.signal?.throwIfAborted();
      if (next) {
        const revision = await this.connections.change(
          (data) => {
            const item = data.connections.find((entry) => entry.connectionId === this.connectionId);
            if (!item || item.configurationId !== this.configurationId)
              throw new Error('The connection configuration changed.');
            if (
              options?.expectedRevision !== undefined &&
              item.revision !== options.expectedRevision
            )
              throw new ConflictError('This connection changed. Reload before connecting.');
            assertCredential(item, next);
            item.hasCredential = true;
            item.connected = true;
            item.revision += 1;
            item.verifiedModel = '';
            delete item.credentialCleanupPending;
            delete item.authNotice;
            if (item.provider === 'openai' && item.authType === 'oauth') {
              const chatgpt = parse(ChatGPTCredentialSchema, next);
              item.accountLabel = chatgpt.email ?? 'ChatGPT';
              item.chatgptPlanEnabled = chatgpt.scopes.includes('chatgpt.tokens.use.direct');
              if (!item.chatgptPlanEnabled) {
                item.catalog = [];
                item.defaultModel = '';
                if (data.defaultConnectionId === item.connectionId) data.defaultConnectionId = null;
              }
            }
            return item.revision;
          },
          async () => {
            options?.signal?.throwIfAborted();
            // Once keyring persistence starts, complete the matching metadata commit even if
            // sign-in is cancelled while the OS keyring is writing.
            await this.keyring.set(this.account, JSON.stringify(next));
          },
        );
        options?.onCommitted?.(revision);
      }
      return next ?? stored;
    });
  }

  async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    await this.disconnect(providerId, options);
  }

  /** Revocation and local deletion cannot race a rotating refresh token. */
  async disconnect(providerId: string, options?: DisconnectOptions): Promise<string | undefined> {
    return this.clear(providerId, options, false);
  }

  /** Revision validation, secret deletion and record removal share one transaction. */
  async remove(providerId: string, expectedRevision: number): Promise<string | undefined> {
    return this.clear(providerId, { expectedRevision }, true);
  }

  /** The modify lock still owns this rejected token; do not reacquire it through disconnect. */
  private async invalidateChatGPTCredential(): Promise<void> {
    let cleanup = async (): Promise<void> => {};
    await this.connections.change(
      (data) => {
        const item = data.connections.find((entry) => entry.connectionId === this.connectionId);
        if (!item || item.configurationId !== this.configurationId)
          throw new Error('The connection configuration changed.');
        item.hasCredential = false;
        item.connected = false;
        item.credentialCleanupPending = true;
        item.authNotice = CHATGPT_RECONNECT_NOTICE;
        item.revision += 1;
        item.verifiedModel = '';
        delete item.accountLabel;
        delete item.chatgptPlanEnabled;
        delete item.chatgptUsagePaused;
        cleanup = async () => {
          try {
            await this.keyring.delete(this.account);
            // The pending flag only shrinks the already validated metadata when cleanup succeeds.
            delete item.credentialCleanupPending;
          } catch (error) {
            // Persist the disconnected state even while the OS keyring cannot remove the token.
            if (!(error instanceof KeyringUnavailable)) throw error;
          }
        };
      },
      () => cleanup(),
    );
  }

  private async clear(
    providerId: string,
    options: DisconnectOptions | undefined,
    remove: boolean,
  ): Promise<string | undefined> {
    if (providerId !== this.providerId) throw new Error('Credential connection mismatch.');
    return withCredentialLock(this.connectionId, async () => {
      options?.signal?.throwIfAborted();
      let notice: string | undefined;
      let commit = async (): Promise<void> => {};
      await this.connections.change(
        (data) => {
          const item = data.connections.find((entry) => entry.connectionId === this.connectionId);
          if (
            options?.expectedRevision !== undefined &&
            item?.revision !== options.expectedRevision
          )
            throw new ConflictError(
              'This connection changed. Reload before disconnecting or removing it.',
            );
          if (!item || item.configurationId !== this.configurationId)
            throw new Error('The connection configuration changed.');
          const hasSecret = item.hasCredential || item.credentialCleanupPending;
          const revoke =
            item.hasCredential && item.provider === 'openai' && item.authType === 'oauth';
          item.hasCredential = false;
          item.connected = false;
          item.revision += 1;
          item.verifiedModel = '';
          delete item.accountLabel;
          delete item.chatgptPlanEnabled;
          delete item.chatgptUsagePaused;
          delete item.credentialCleanupPending;
          delete item.authNotice;
          // Reserve the longest possible result before storage validation. A successful revoke
          // only removes this field during commit, so it cannot exceed the validated size.
          if (revoke) item.authNotice = REVOCATION_NOTICE;
          if (remove) {
            data.connections = data.connections.filter((entry) => entry !== item);
            if (data.defaultConnectionId === this.connectionId) data.defaultConnectionId = null;
          }
          commit = async () => {
            options?.signal?.throwIfAborted();
            if (revoke) {
              const stored = ServiceCredentialStore.decode(await this.keyring.get(this.account));
              if (stored && !(await revokeChatGPT(stored))) notice = REVOCATION_NOTICE;
              else delete item.authNotice;
            }
            if (hasSecret) await this.keyring.delete(this.account);
          };
        },
        () => commit(),
      );
      return notice;
    });
  }
}

import { safeStorage } from 'electron';
import type { AuthOperationOptions, Credential, CredentialStore } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { parse } from '../agent/validation';
import type { SettingsStore } from '../settings-store';
import { configurationId } from './configuration';
import { initialDefaultConnectionId } from './defaults';

const CredentialSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal('api_key'),
      key: Type.Optional(Type.String()),
      env: Type.Optional(Type.Record(Type.String(), Type.String())),
    },
    { additionalProperties: false },
  ),
  Type.Object({
    type: Type.Literal('oauth'),
    access: Type.String(),
    refresh: Type.String(),
    expires: Type.Number(),
  }),
]);
function secureStorage() {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  )
    throw new Error('Secure credential storage is unavailable on this device.');
}
export function encryptCredential(credential: Credential): string {
  secureStorage();
  return safeStorage.encryptString(JSON.stringify(credential)).toString('base64');
}
export function decryptCredential(encrypted: string): Credential | undefined {
  if (!encrypted) return undefined;
  secureStorage();
  try {
    if (encrypted.startsWith('legacy:'))
      return {
        type: 'api_key',
        key: safeStorage.decryptString(Buffer.from(encrypted.slice(7), 'base64')),
      };
    return parse(
      CredentialSchema,
      JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))),
    );
  } catch {
    throw new Error('The saved credentials could not be unlocked. Reconnect this provider.');
  }
}

/** A Pi provider ID is scoped to exactly one application connection, including refresh writes. */
export class ConnectionCredentials implements CredentialStore {
  constructor(
    private store: SettingsStore,
    private connectionId: string,
    private providerId: string,
    private configuration: string,
  ) {}
  async read(providerId: string, options?: AuthOperationOptions) {
    options?.signal?.throwIfAborted();
    if (providerId !== this.providerId) return undefined;
    const connection = this.store.current.connections.find(
      (item) => item.connectionId === this.connectionId,
    );
    if (connection && configurationId(connection) !== this.configuration)
      throw new Error('The connection configuration changed.');
    return connection?.connected ? decryptCredential(connection.encryptedCredential) : undefined;
  }
  async list(options?: AuthOperationOptions) {
    options?.signal?.throwIfAborted();
    const value = await this.read(this.providerId);
    return value ? [{ providerId: this.providerId, type: value.type }] : [];
  }
  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ) {
    if (providerId !== this.providerId) throw new Error('Credential connection mismatch.');
    return this.store.change(async (data) => {
      options?.signal?.throwIfAborted();
      const connection = data.connections.find((item) => item.connectionId === this.connectionId);
      if (!connection) throw new Error('This connection no longer exists.');
      if (configurationId(connection) !== this.configuration)
        throw new Error('The connection configuration changed.');
      const current = decryptCredential(connection.encryptedCredential);
      const next = await fn(current);
      options?.signal?.throwIfAborted();
      if (next) {
        connection.encryptedCredential = encryptCredential(next);
        connection.connected = true;
        data.defaultConnectionId ??= initialDefaultConnectionId(
          data.connections,
          connection.connectionId,
        );
      }
      return next ?? current;
    });
  }
  async delete(providerId: string, options?: AuthOperationOptions) {
    if (providerId !== this.providerId) throw new Error('Credential connection mismatch.');
    await this.store.change((data) => {
      options?.signal?.throwIfAborted();
      const connection = data.connections.find((item) => item.connectionId === this.connectionId);
      if (connection) {
        connection.encryptedCredential = '';
        connection.connected = false;
      }
    });
  }
}

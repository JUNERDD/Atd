import { createHash } from 'node:crypto';
import { __setKeyringModuleForTests } from '../dist/credentials/keyring.js';

type Operation = 'set' | 'get' | 'delete';

/**
 * An in-memory stand-in for `@napi-rs/keyring`, installed through the keyring test seam so a test
 * never writes to the real OS keyring. `fail` makes chosen operations throw like an unavailable
 * keyring; `accounts` lists what one service namespace holds.
 */
export function installMemoryKeyring() {
  const items = new Map<string, Map<string, string>>();
  const state: { fail: (operation: Operation, account: string) => boolean } = {
    fail: () => false,
  };
  const namespace = (service: string) => {
    const found = items.get(service) ?? new Map<string, string>();
    items.set(service, found);
    return found;
  };
  const check = (operation: Operation, account: string) => {
    if (state.fail(operation, account)) throw new Error(`simulated keyring ${operation} failure`);
  };

  class AsyncEntry {
    private readonly service: string;
    private readonly account: string;

    constructor(service: string, account: string) {
      this.service = service;
      this.account = account;
    }

    async setPassword(password: string): Promise<void> {
      check('set', this.account);
      namespace(this.service).set(this.account, password);
    }

    async getPassword(): Promise<string | undefined> {
      check('get', this.account);
      return namespace(this.service).get(this.account);
    }

    async deleteCredential(): Promise<boolean> {
      check('delete', this.account);
      return namespace(this.service).delete(this.account);
    }
  }

  __setKeyringModuleForTests({
    AsyncEntry,
    findCredentialsAsync: async (service: string) =>
      [...namespace(service)].map(([account, password]) => ({ account, password })),
  });

  return {
    state,
    /** Every account one keyring service holds, with its value. */
    accounts: (serviceId: string) => new Map(namespace(`ai-agent-service:${serviceId}`)),
    set: (serviceId: string, account: string, value: string) =>
      namespace(`ai-agent-service:${serviceId}`).set(account, value),
    remove: (serviceId: string, account: string) =>
      namespace(`ai-agent-service:${serviceId}`).delete(account),
    /** The items of any keychain service by its exact name, e.g. another product's (see below). */
    service: (name: string): KeychainService => keychainService(namespace(name)),
  };
}

/** Live view of one keychain service in the memory keyring. */
export interface KeychainService {
  get(account: string): string | undefined;
  set(account: string, value: string): void;
  remove(account: string): boolean;
  /** Every account with its value, as a copy. */
  entries(): Map<string, string>;
}

const keychainService = (items: Map<string, string>): KeychainService => ({
  get: (account) => items.get(account),
  set: (account, value) => void items.set(account, value),
  remove: (account) => items.delete(account),
  entries: () => new Map(items),
});

/*
 * Fixtures for the one-time migration of pi-mcp-adapter OAuth credentials. They restate the
 * adapter's storage format (pi-mcp-adapter 3.1.0 `mcp-auth.ts`) instead of importing the service's
 * own constants, so a wrong constant in the service cannot hide behind a matching fixture.
 */

/** The keychain service the adapter kept OAuth credentials under (`AUTH_SECRET_SERVICE`). */
export const ADAPTER_OAUTH_SERVICE = 'pi-mcp-adapter.oauth';

const ADAPTER_CHUNK_MARKER = '__piMcpAdapterOAuthChunked';

/** The adapter's stored record (`AuthEntry`); expiry is in unix seconds. */
export interface AdapterAuthEntry {
  tokens?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    scope?: string;
    issuer?: string;
  };
  clientInfo?: {
    clientId: string;
    clientSecret?: string;
    clientIdIssuedAt?: number;
    clientSecretExpiresAt?: number;
    redirectUris?: string[];
    issuer?: string;
    configPreRegistered?: boolean;
  };
  codeVerifier?: string;
  oauthState?: string;
  serverUrl?: string;
}

export interface SeededAdapterEntry {
  /** The main item: the record itself, or the chunk manifest. */
  account: string;
  /** The compact JSON the adapter would have stored. */
  payload: string;
  /** The chunk items in order; empty when the record is stored whole. */
  chunkAccounts: string[];
}

/** The account for a physical server name: `sha256-<hex of the name>` (`getAuthEntryAccount`). */
export function adapterOAuthAccount(serverName: string): string {
  return `sha256-${createHash('sha256').update(serverName, 'utf8').digest('hex')}`;
}

/** The adapter's `splitAuthPayload`: never cuts between the halves of a surrogate pair. */
function splitPayload(payload: string, size: number): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < payload.length;) {
    let end = Math.min(start + size, payload.length);
    const last = payload.charCodeAt(end - 1);
    if (end < payload.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(payload.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * Stores an adapter record for `serverName` as the adapter did: whole and compact, or, when
 * `chunkSize` is given and the payload is longer, as a manifest
 * `{"__piMcpAdapterOAuthChunked":1,"chunkCount":n,"chunkDigest":<16 hex of sha256(payload)>}` at
 * the account plus items `<account>.chunk.<digest>.<i>` (the adapter used 1000 on Windows). A
 * string `entry` is stored as given, for malformed-record cases.
 */
export function seedAdapterOAuth(
  service: KeychainService,
  serverName: string,
  entry: AdapterAuthEntry | string,
  options: { chunkSize?: number } = {},
): SeededAdapterEntry {
  const account = adapterOAuthAccount(serverName);
  const payload = typeof entry === 'string' ? entry : JSON.stringify(entry);
  const { chunkSize } = options;
  if (chunkSize === undefined || payload.length <= chunkSize) {
    service.set(account, payload);
    return { account, payload, chunkAccounts: [] };
  }
  const digest = createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 16);
  const chunkAccounts = splitPayload(payload, chunkSize).map((chunk, index) => {
    const chunkAccount = `${account}.chunk.${digest}.${index}`;
    service.set(chunkAccount, chunk);
    return chunkAccount;
  });
  const manifest = {
    [ADAPTER_CHUNK_MARKER]: 1,
    chunkCount: chunkAccounts.length,
    chunkDigest: digest,
  };
  service.set(account, JSON.stringify(manifest));
  return { account, payload, chunkAccounts };
}

/**
 * The record's text as the adapter would read it back: the item itself, or the chunks joined after
 * checking the manifest's digest. Undefined when the server has no item; throws like the adapter
 * on a missing chunk or a digest mismatch.
 */
export function readAdapterOAuth(service: KeychainService, serverName: string): string | undefined {
  const account = adapterOAuthAccount(serverName);
  const stored = service.get(account);
  if (stored === undefined) return undefined;
  let manifest: unknown;
  try {
    manifest = JSON.parse(stored);
  } catch {
    return stored; // A malformed record is returned as stored.
  }
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !(ADAPTER_CHUNK_MARKER in manifest) ||
    !('chunkCount' in manifest) ||
    typeof manifest.chunkCount !== 'number' ||
    !('chunkDigest' in manifest)
  ) {
    return stored;
  }
  const parts = Array.from({ length: manifest.chunkCount }, (_, index) => {
    const part = service.get(`${account}.chunk.${String(manifest.chunkDigest)}.${index}`);
    if (part === undefined)
      throw new Error(`Missing OAuth credential chunk ${index} for ${serverName}`);
    return part;
  });
  const payload = parts.join('');
  const digest = createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 16);
  if (digest !== manifest.chunkDigest)
    throw new Error('OAuth credential chunk integrity check failed');
  return payload;
}

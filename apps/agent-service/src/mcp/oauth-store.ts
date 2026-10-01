import { errorMessage, parse, type McpServerConfig } from '@ai/agent-contracts';
import type { McpOAuthState, McpOAuthStateStore } from '@earendil-works/pi-mcp/oauth';
import { Type } from 'typebox';
import { keyringMcpOAuthAccount, type KeyringBackend } from '../credentials/keyring.js';
import type { Logger } from '../logging.js';
import { credentialIdentity } from './servers.js';

/**
 * The OAuth sign-in of one MCP server (client registration, tokens, discovery and the PKCE
 * verifier of a sign-in in progress) as pi-mcp's `McpOAuthState`, in one keychain item of the
 * service: `{"v":1,"state":<McpOAuthState>}`. `v` lets a later pi-mcp shape be migrated.
 *
 * The item is keyed by the server, not by its URL; the state names the URL it belongs to, and
 * pi-mcp's `McpOAuthProvider` and `createOAuthConnectionAuth` ignore a state of another URL, so
 * credentials never reach a server they were not issued for.
 */

const Tokens = Type.Object({
  access_token: Type.String(),
  token_type: Type.String(),
  expires_in: Type.Optional(Type.Number()),
  scope: Type.Optional(Type.String()),
  refresh_token: Type.Optional(Type.String()),
  id_token: Type.Optional(Type.String()),
});

const Client = Type.Object({
  client_id: Type.String(),
  client_secret: Type.Optional(Type.String()),
  client_id_issued_at: Type.Optional(Type.Number()),
  client_secret_expires_at: Type.Optional(Type.Number()),
  redirect_uris: Type.Optional(Type.Array(Type.String())),
});

const Discovery = Type.Object({
  authorizationServerUrl: Type.String(),
  authorizationServerMetadata: Type.Optional(
    Type.Object({
      issuer: Type.String(),
      authorization_endpoint: Type.String(),
      token_endpoint: Type.String(),
      response_types_supported: Type.Array(Type.String()),
    }),
  ),
  resourceMetadata: Type.Optional(Type.Object({ resource: Type.String() })),
  resourceMetadataUrl: Type.Optional(Type.String()),
});

/** Objects allow more properties than listed, so metadata pi-mcp keeps beyond these survives. */
const StoredSchema = Type.Object({
  v: Type.Literal(1),
  state: Type.Object({
    serverUrl: Type.String(),
    clientInformation: Type.Optional(Client),
    tokens: Type.Optional(Tokens),
    tokensExpireAt: Type.Optional(Type.Number()),
    codeVerifier: Type.Optional(Type.String()),
    oauthState: Type.Optional(Type.String()),
    discovery: Type.Optional(Discovery),
  }),
});

/** The keychain account of a server's sign-in: under its credential identity (server-keys.ts). */
export function oauthAccount(
  serviceId: string,
  record: Pick<McpServerConfig, 'serverId' | 'principal'>,
): string {
  return keyringMcpOAuthAccount(credentialIdentity(serviceId, record));
}

/** The URL a state is keyed by: the normalized form pi-mcp compares. */
export function oauthServerUrl(url: string): string {
  return String(new URL(url));
}

/**
 * `McpOAuthStateStore` on the service keychain. One live instance serves a credential identity
 * (`OAuthProviders.storeFor`): the state is read once and kept, writes go through a queue in call
 * order, and a retired instance drops later writes, so a refresh that outlives a sign-in, logout
 * or removal cannot bring old tokens back.
 */
export class KeychainOAuthStore implements McpOAuthStateStore {
  /** The state as last read or written; absent until the first of either. */
  private cache: { state: McpOAuthState | undefined } | undefined;
  private reading: Promise<McpOAuthState | undefined> | undefined;
  private retired = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly keyring: KeyringBackend,
    private readonly account: string,
    private readonly log: Logger,
  ) {}

  /** A malformed item reads as no state; an unreadable keychain throws, so nothing is misjudged. */
  async load(): Promise<McpOAuthState | undefined> {
    if (this.retired) return undefined;
    if (!this.cache) {
      this.reading ??= this.read().finally(() => {
        this.reading = undefined;
      });
      const state = await this.reading;
      // A save that landed while the keychain was read is newer.
      this.cache ??= { state };
    }
    const { state } = this.cache;
    return this.retired || !state ? undefined : structuredClone(state);
  }

  /** Later loads see the state at once; the keychain follows in call order. */
  save(state: McpOAuthState): Promise<void> {
    if (this.retired) {
      this.log.debug('A retired MCP OAuth store dropped a late write.', { account: this.account });
      return Promise.resolve();
    }
    const stored = structuredClone(state);
    this.cache = { state: stored };
    return this.enqueue(() =>
      this.keyring.set(this.account, JSON.stringify({ v: 1, state: stored })),
    );
  }

  /**
   * Deletes the item after the writes already queued, then retires the store: a write queued
   * before this call cannot outlive the deletion, and none is accepted after it.
   */
  remove(): Promise<void> {
    this.retired = true;
    this.cache = undefined;
    return this.enqueue(async () => {
      await this.keyring.delete(this.account);
    });
  }

  /** Later saves are dropped and loads answer nothing; the item itself stays as it is. */
  retire(): void {
    this.retired = true;
  }

  private async read(): Promise<McpOAuthState | undefined> {
    const raw = await this.keyring.get(this.account);
    if (raw === undefined) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return this.unreadable('not JSON');
    }
    try {
      return parse(StoredSchema, value).state;
    } catch (error) {
      return this.unreadable(errorMessage(error));
    }
  }

  /** Never logs the value (a JSON error quotes part of it); a new sign-in replaces the item. */
  private unreadable(reason: string): undefined {
    this.log.warn('The saved MCP sign-in could not be read; sign in again.', {
      account: this.account,
      reason,
    });
    return undefined;
  }

  private enqueue(write: () => Promise<void>): Promise<void> {
    const done = this.queue.then(write);
    this.queue = done.catch(() => undefined);
    return done;
  }
}

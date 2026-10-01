import type { McpServerConfig } from '@ai/agent-contracts';
import type { McpFetch } from '@earendil-works/pi-mcp';
import {
  authorizeMcp,
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  OAuthError,
  parseWwwAuthenticate,
  type OAuthChallenge,
  type OAuthClientProvider,
} from '@earendil-works/pi-mcp/oauth';
import type { KeyringBackend } from '../credentials/keyring.js';
import type { Logger } from '../logging.js';
import {
  MCP_OAUTH_CLIENT_NAME,
  MCP_OAUTH_FALLBACK_REDIRECT_URL,
  MCP_OAUTH_REFRESH_SKEW_MS,
} from './constants.js';
import { registeredRedirects } from './oauth-callback.js';
import { oauthFlowFetch, type OAuthFlowFetch, type ServiceHeaders } from './oauth-fetch.js';
import { KeychainOAuthStore, oauthAccount, oauthServerUrl } from './oauth-store.js';
import type { McpCredentialAuth, OAuthConnectionAuth } from './types.js';

/**
 * OAuth at connection time. A connection never signs anyone in: it sends the stored access token,
 * renews it from the stored refresh token shortly before it expires or after a 401, and when only
 * a new sign-in helps fails with `McpOAuthAuthorizationRequiredError`, which connections report as
 * "needs authentication". A renewal that could not reach the server fails with that instead, an
 * error to try again. Signing in is the user-started flow (oauth-flow.ts), which renews through
 * the same auth before it asks for the browser. Both send the server's own HTTP headers to its
 * origin (oauth-fetch.ts).
 */

/** The scope a record configures for its OAuth sign-in, if any. */
export function configuredScope(record: McpServerConfig): string | undefined {
  return record.http?.auth.type === 'oauth' ? (record.http.auth.scope ?? undefined) : undefined;
}

/** Each scope of the lists once, or nothing. */
export function mergeScopes(...scopes: Array<string | undefined>): string | undefined {
  const merged = new Set(scopes.flatMap((scope) => scope?.split(/\s+/).filter(Boolean) ?? []));
  return merged.size > 0 ? [...merged].join(' ') : undefined;
}

/**
 * pi-mcp's stateful provider seen through the one interface a refresh needs. It has no
 * `saveClientInformation`, so a flow that finds no client fails instead of registering one
 * (`adaptOAuthProvider` would register at connect), and nothing of a sign-in in progress is
 * touched: no verifier or state parameter is stored, and invalidating what the server just
 * refused leaves them alone.
 */
function refreshOnly(provider: McpOAuthProvider, onMissingClient: () => void): OAuthClientProvider {
  return {
    redirectUrl: provider.redirectUrl,
    clientMetadata: provider.clientMetadata,
    clientInformation: async () => {
      const client = await provider.clientInformation();
      if (!client) onMissingClient();
      return client;
    },
    tokens: () => provider.tokens(),
    saveTokens: (tokens) => provider.saveTokens(tokens),
    redirectToAuthorization: () => undefined,
    saveCodeVerifier: () => undefined,
    codeVerifier: () => {
      throw new Error('A token refresh has no authorization code to exchange.');
    },
    invalidateCredentials: async (kind) => {
      for (const part of kind === 'all' ? (['client', 'tokens', 'discovery'] as const) : [kind]) {
        if (part !== 'verifier') await provider.invalidateCredentials(part);
      }
    },
    saveDiscoveryState: (discovery) => provider.saveDiscoveryState(discovery),
    discoveryState: () => provider.discoveryState(),
  };
}

export interface ConnectionAuthOptions {
  serverUrl: string;
  store: KeychainOAuthStore;
  /** The configured scope, sent along with a refresh. */
  scope: string | undefined;
  log: Logger;
  /** Sees the challenge of every 401 or step-up 403, for the sign-in that may follow. */
  onChallenge?: (challenge: OAuthChallenge) => void;
  /** The record's HTTP headers for requests to the server's origin. */
  service: ServiceHeaders;
}

/**
 * The auth of one OAuth server's connections (modeled on pi's `createMcpAuthProvider`). Many
 * servers rotate refresh tokens, so requests share one refresh, and a token that changed
 * meanwhile (another request refreshed it, or the user signed in) is used as it is. It never
 * takes the credential transaction lock: it runs inside connects that hold it.
 */
export function createOAuthConnectionAuth(options: ConnectionAuthOptions): OAuthConnectionAuth {
  const { store, scope, log } = options;
  const serverUrl = oauthServerUrl(options.serverUrl);
  let refreshing: Promise<void> | undefined;
  /** What the server last asked for when it refused a request; a renewal asks its way. */
  let challenged: OAuthChallenge | undefined;

  /** The stored state, unless it belongs to another URL: its tokens are not for this server. */
  const load = async () => {
    const state = await store.load();
    return state?.serverUrl === serverUrl ? state : undefined;
  };

  /** Replaces `stale`, the access token that expired or was rejected, unless someone did. */
  const replace = async (
    stale: string | undefined,
    fetch?: McpFetch,
    challenge?: OAuthChallenge,
  ) => {
    const state = await load();
    if (state?.tokens?.access_token !== stale) return;
    if (!state?.tokens?.refresh_token || !state.clientInformation) {
      throw new McpOAuthAuthorizationRequiredError();
    }
    let missingClient = false;
    const flow = oauthFlowFetch({ serverUrl, service: options.service, base: fetch });
    const provider = new McpOAuthProvider({
      serverUrl,
      redirectUrl: registeredRedirects(state)[0] ?? MCP_OAUTH_FALLBACK_REDIRECT_URL,
      clientMetadata: { client_name: MCP_OAUTH_CLIENT_NAME },
      store,
      onRedirect: () => undefined,
    });
    try {
      const result = await authorizeMcp(
        refreshOnly(provider, () => {
          missingClient = true;
        }),
        {
          serverUrl,
          resourceMetadataUrl: challenge?.resourceMetadataUrl,
          scope: challenge?.scope ?? scope,
          fetch: flow.fetch,
        },
      );
      if (result === 'AUTHORIZED') return;
    } catch (error) {
      // The server turned the saved sign-in down (or the client is gone): only a new sign-in helps.
      if (missingClient || error instanceof OAuthError) {
        log.info('An MCP server refused the saved OAuth sign-in.', {
          reason: error instanceof OAuthError ? error.code : 'client registration missing',
        });
        throw new McpOAuthAuthorizationRequiredError();
      }
      throw error;
    }
    // pi-mcp sends the browser redirect for a refresh it could not ask (network, timeout, server
    // error). What stopped the request says more than "sign in": an authorization server that is
    // down is tried again, and signing in anew would not help.
    flow.check();
    throw flow.unreachable() ?? new McpOAuthAuthorizationRequiredError();
  };

  const refresh = (stale: string | undefined, fetch?: McpFetch, challenge?: OAuthChallenge) =>
    (refreshing ??= replace(stale, fetch, challenge).finally(() => {
      refreshing = undefined;
    }));

  return {
    token: async () => {
      await refreshing?.catch(() => undefined);
      const state = await load();
      const token = state?.tokens?.access_token;
      const expired =
        state?.tokensExpireAt !== undefined &&
        state.tokensExpireAt - MCP_OAUTH_REFRESH_SKEW_MS <= Date.now();
      if (!expired || !state?.tokens?.refresh_token) return token;
      // A failure falls through: the request goes out with the old token and its 401 decides.
      await refresh(token).catch((error: unknown) => {
        log.debug('Renewing an MCP access token before a request failed.', {
          reason: error instanceof Error ? error.name : 'unknown',
        });
      });
      return (await load())?.tokens?.access_token;
    },
    onUnauthorized: async (context) => {
      const challenge = parseWwwAuthenticate(context.response.headers.get('www-authenticate'));
      challenged = challenge;
      options.onChallenge?.(challenge);
      // A refresh keeps the granted scope, so a server that wants more needs a new sign-in.
      if (challenge.error === 'insufficient_scope') throw new McpOAuthAuthorizationRequiredError();
      await refresh(context.token, context.fetch, challenge);
    },
    renew: async () => refresh((await load())?.tokens?.access_token, undefined, challenged),
    settled: async () => {
      while (refreshing) await refreshing.catch(() => undefined);
    },
  };
}

interface ServerAuth {
  account: string;
  /** The latest record seen, so a header edit reaches the next flow of a cached auth. */
  record: McpServerConfig;
  store: KeychainOAuthStore;
  auth?: { serverUrl: string; scope: string | undefined; provider: OAuthConnectionAuth };
  challenge?: { serverUrl: string; value: OAuthChallenge };
}

/**
 * The OAuth credentials of the servers: per server one live store and one connection auth that
 * all its connections (base and task aliases) share, so concurrent 401s share one refresh.
 * Signing in, logging out and removing a server `forget` it, which retires the store, so an old
 * refresh cannot write tokens back.
 */
export class OAuthProviders implements McpCredentialAuth {
  private readonly servers = new Map<string, ServerAuth>();
  /** Replaced or forgotten auths that may still be saving a refresh. */
  private readonly retired = new Set<OAuthConnectionAuth>();

  constructor(
    private readonly deps: {
      serviceId: string;
      keyring: KeyringBackend;
      log: Logger;
      /** The HTTP headers a record's OAuth requests carry to its server (launch resolution's rules). */
      headersFor: (record: McpServerConfig) => Promise<Readonly<Record<string, string>>>;
    },
  ) {}

  /** The live store of the server's credential identity. */
  storeFor(record: McpServerConfig): KeychainOAuthStore {
    return this.entryFor(record).store;
  }

  authFor(record: McpServerConfig, serverUrl: string): OAuthConnectionAuth {
    const entry = this.entryFor(record);
    const url = oauthServerUrl(serverUrl);
    const scope = configuredScope(record);
    if (entry.auth?.serverUrl === url && entry.auth.scope === scope) return entry.auth.provider;
    if (entry.auth) this.retire(entry.auth.provider);
    const provider = createOAuthConnectionAuth({
      serverUrl: url,
      store: entry.store,
      scope,
      log: this.deps.log,
      onChallenge: (value) => {
        entry.challenge = { serverUrl: url, value };
      },
      service: this.serviceHeaders(record.serverId, () => entry.record),
    });
    entry.auth = { serverUrl: url, scope, provider };
    return provider;
  }

  /** The fetch of one sign-in flow: bounded, and carrying the record's headers to its origin. */
  flowFetch(record: McpServerConfig, serverUrl: string, signal?: AbortSignal): OAuthFlowFetch {
    const service = this.serviceHeaders(record.serverId, () => record);
    return oauthFlowFetch({ serverUrl, service, signal });
  }

  /** What the server last asked for when it refused a request, if it was for this URL. */
  challengeFor(serverId: string, serverUrl: string): OAuthChallenge | undefined {
    const challenge = this.servers.get(serverId)?.challenge;
    return challenge?.serverUrl === oauthServerUrl(serverUrl) ? challenge.value : undefined;
  }

  forget(serverId: string): void {
    const entry = this.servers.get(serverId);
    if (!entry) return;
    this.servers.delete(serverId);
    entry.store.retire();
    if (entry.auth) this.retire(entry.auth.provider);
  }

  async settled(): Promise<void> {
    const live = [...this.servers.values()].flatMap(({ auth }) => (auth ? [auth.provider] : []));
    await Promise.all([...live, ...this.retired].map((auth) => auth.settled()));
  }

  private entryFor(record: McpServerConfig): ServerAuth {
    const account = oauthAccount(this.deps.serviceId, record);
    const known = this.servers.get(record.serverId);
    if (known?.account === account) {
      known.record = record;
      return known;
    }
    // Another principal is another credential identity: the old store must not write again.
    if (known) this.forget(record.serverId);
    const entry: ServerAuth = {
      account,
      record,
      store: new KeychainOAuthStore(this.deps.keyring, account, this.deps.log),
    };
    this.servers.set(record.serverId, entry);
    return entry;
  }

  private serviceHeaders(serverId: string, record: () => McpServerConfig): ServiceHeaders {
    return { serverId, resolve: () => this.deps.headersFor(record()) };
  }

  private retire(auth: OAuthConnectionAuth): void {
    this.retired.add(auth);
    void auth.settled().finally(() => this.retired.delete(auth));
  }
}

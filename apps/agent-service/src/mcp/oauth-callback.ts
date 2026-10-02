import type { McpServerConfig } from '@atd/agent-contracts';
import { OAuthCallbackServer, type McpOAuthState } from '@earendil-works/pi-mcp/oauth';
import {
  MCP_OAUTH_CALLBACK_HOST,
  MCP_OAUTH_CALLBACK_PATH,
  MCP_OAUTH_FLOW_TTL_MS,
  MCP_OAUTH_REDIRECT_HOST,
} from './constants.js';
import { McpError } from './errors.js';
import { oauthAuthOf } from './oauth-client.js';
import type { KeychainOAuthStore } from './oauth-store.js';
import { classifyRedirect } from './servers.js';

/**
 * Where a sign-in's browser redirect lands and how the answer is read (a callback, or a pasted URL
 * or code); pi-mcp checks its RFC 9207 issuer during the exchange. The service never opens a browser: it publishes the
 * authorization URL, and the loopback callback server or the paste brings the answer back.
 */

export type CallbackPlan =
  | {
      kind: 'loopback';
      /** The address the callback server listens on. */
      host: string;
      /** The host the redirect URI names (`localhost` is served on 127.0.0.1). */
      redirectHost: string;
      /** The preferred port; 0 lets the OS choose. */
      port: number;
      /** A busy port fails the sign-in instead of falling back to another one. */
      strictPort: boolean;
      path: string;
      /** The configured redirect URI, sent exactly as written since servers compare it as text. */
      exact?: string;
      /** The configured redirect URI with a `{port}` placeholder for the port the OS chose. */
      template?: string;
    }
  | { kind: 'manual'; redirectUrl: string };

/** The redirect URIs a stored client registered, none without one. */
export function registeredRedirects(state: McpOAuthState | undefined): string[] {
  const client = state?.clientInformation;
  return client && 'redirect_uris' in client ? [...client.redirect_uris] : [];
}

/** In a configured redirect URI: the port the OS chooses when the callback server starts. */
const PORT_PLACEHOLDER = '{port}';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Plans the redirect of a sign-in. Without a configured `redirectUri` the callback listens on the
 * configured `callbackPort` (strict: a pre-registered client's redirect URI names it), else on the
 * port of the client's registered loopback redirect, so the registration stays valid, else on any
 * free port. A configured loopback URI keeps its port (strict) or, with `{port}`, gets a free one;
 * an https URI on another host is completed by pasting its URL (no server).
 */
export function callbackPlan(record: McpServerConfig, registered: readonly string[]): CallbackPlan {
  const auth = oauthAuthOf(record);
  const configured = auth?.redirectUri?.trim() ?? '';
  if (!configured) {
    const remembered = registered.find((uri) => classifyRedirect(uri) === 'loopback');
    const fixed = auth?.callbackPort;
    return {
      kind: 'loopback',
      host: MCP_OAUTH_CALLBACK_HOST,
      redirectHost: MCP_OAUTH_REDIRECT_HOST,
      port: fixed ?? (remembered ? Number(new URL(remembered).port) || 0 : 0),
      strictPort: fixed !== undefined,
      path: MCP_OAUTH_CALLBACK_PATH,
    };
  }
  return configuredPlan(record.serverId, configured);
}

/** The rules pi-mcp-adapter applied to a configured redirect URI (mcp-auth-flow.ts). */
function configuredPlan(serverId: string, redirectUri: string): CallbackPlan {
  const refuse = (message: string) => new McpError('bad_request', serverId, message);
  const dynamic = redirectUri.includes(PORT_PLACEHOLDER);
  if (redirectUri.split(PORT_PLACEHOLDER).length > 2) {
    throw refuse('OAuth redirectUri may contain at most one {port} placeholder');
  }
  if (dynamic && !/^https?:\/\/[^/?#@]*:\{port\}(?:[/?#]|$)/i.test(redirectUri)) {
    throw refuse('OAuth redirectUri {port} placeholder must be the loopback URI port');
  }
  let url: URL;
  try {
    // A real port stands in for the placeholder until the OS has chosen one.
    url = new URL(dynamic ? redirectUri.replace(PORT_PLACEHOLDER, '1') : redirectUri);
  } catch {
    throw refuse('OAuth redirectUri is not a valid URI');
  }
  if (url.username || url.password)
    throw refuse('OAuth redirectUri must not include username or password');
  if (url.hash) throw refuse('OAuth redirectUri must not include a fragment');
  const loopback = LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  if (dynamic && (url.protocol !== 'http:' || !loopback)) {
    throw refuse(
      'OAuth redirectUri {port} placeholder is allowed only for an http:// localhost or loopback URI',
    );
  }
  if (url.protocol === 'https:' && !loopback) return { kind: 'manual', redirectUrl: redirectUri };
  if (url.protocol !== 'http:' || !loopback) {
    throw refuse(
      'OAuth redirectUri must be an https:// URI or an http:// localhost or loopback URI',
    );
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port <= 0) {
    throw refuse('OAuth localhost redirectUri must include an explicit numeric port');
  }
  // `localhost` is served on 127.0.0.1; a browser falls back to it when ::1 refuses.
  const redirectHost = url.hostname.replace(/^\[|\]$/g, '');
  return {
    kind: 'loopback',
    host: redirectHost.toLowerCase() === 'localhost' ? MCP_OAUTH_CALLBACK_HOST : redirectHost,
    redirectHost,
    port: dynamic ? 0 : port,
    strictPort: !dynamic,
    path: url.pathname,
    ...(dynamic ? { template: redirectUri } : { exact: redirectUri }),
  };
}

/**
 * Starts the callback server of a plan and answers the redirect URI to register and send. A busy
 * preferred port falls back to a free one unless the plan is strict. The server answers the
 * browser with pi-mcp's plain "Authorization complete" page and resolves `waitForCallback`.
 */
export async function openCallback(
  plan: CallbackPlan,
): Promise<{ redirectUrl: string; server: OAuthCallbackServer | null }> {
  if (plan.kind === 'manual') return { redirectUrl: plan.redirectUrl, server: null };
  const options = {
    host: plan.host,
    redirectHost: plan.redirectHost,
    path: plan.path,
    timeoutMs: MCP_OAUTH_FLOW_TTL_MS,
  };
  let server: OAuthCallbackServer;
  try {
    server = await OAuthCallbackServer.listen({ ...options, port: plan.port });
  } catch (error) {
    if (plan.strictPort || plan.port === 0) throw error;
    server = await OAuthCallbackServer.listen({ ...options, port: 0 });
  }
  const assigned = new URL(server.redirectUrl).port;
  const redirectUrl = plan.exact ?? plan.template?.replace(PORT_PLACEHOLDER, assigned);
  return { redirectUrl: redirectUrl ?? server.redirectUrl, server };
}

/** What a redirect carries besides `state`: the code and, if sent, RFC 9207's `iss`. */
export interface AuthorizationInput {
  code: string;
  iss?: string;
}

/**
 * The paste asks for the full callback URL (or a bare code, on loopback flows) but takes a query
 * string or a `#` fragment too. Problems are TypeErrors, which the HTTP layer answers as a 400
 * with the message.
 */
export function parseAuthorizationInput(
  input: string,
  expectedState: string,
  requireUrl: boolean,
): AuthorizationInput {
  const text = input.trim();
  if (!text) throw new TypeError('Authorization code or redirect URL is required');
  const params = redirectParams(text);
  if (requireUrl && !params) {
    throw new TypeError(
      'Paste the full OAuth callback URL, including its code and state parameters',
    );
  }
  if (params) {
    const error = params.get('error');
    if (error) {
      const description = params.get('error_description');
      throw new TypeError(description ? `${error}: ${description}` : error);
    }
    const state = params.get('state');
    if (!state) throw new TypeError('OAuth state missing from redirect URL');
    if (state !== expectedState)
      throw new TypeError('OAuth state mismatch - potential CSRF attack');
    const code = params.get('code');
    if (code) {
      const iss = params.get('iss');
      return { code, ...(iss !== null ? { iss } : {}) };
    }
  } else if (/^[A-Za-z0-9._~+/=-]+$/.test(text)) {
    return { code: text };
  }
  throw new TypeError('Could not find an OAuth authorization code in the provided input');
}

/** The query (and `#` fragment) parameters of a URL, or of a bare query string that has any. */
function redirectParams(text: string): URLSearchParams | undefined {
  try {
    const url = new URL(text);
    const params = new URLSearchParams(url.search);
    for (const [key, value] of new URLSearchParams(url.hash.replace(/^#/, ''))) {
      if (!params.has(key)) params.set(key, value);
    }
    return params;
  } catch {
    const query = text.includes('?') ? text.slice(text.indexOf('?') + 1) : text;
    const params = new URLSearchParams(query.replace(/^#/, ''));
    return params.has('code') || params.has('state') || params.has('error') ? params : undefined;
  }
}

/**
 * The stored state as a new sign-in starts from it: a fresh `state` parameter each time, and no
 * client (nor the tokens that belong to it) when the redirect differs from the registered one,
 * since a registered client cannot use another redirect URI.
 */
export function forSignIn(stored: McpOAuthState, redirectUrl: string): McpOAuthState {
  const { oauthState: _state, ...next } = stored;
  if (registeredRedirects(stored).includes(redirectUrl)) return next;
  const { clientInformation: _client, tokens: _tokens, tokensExpireAt: _expires, ...rest } = next;
  return rest;
}

/**
 * Opens the callback of a new sign-in of `record` and readies the stored state for its redirect.
 * The state is read again once the server listens and written back with nothing awaited in
 * between, so a refresh that landed while it started is not overwritten with the older state. A
 * failure closes the server it opened.
 */
export async function openRedirect(
  record: McpServerConfig,
  serverUrl: string,
  store: KeychainOAuthStore,
): Promise<{ redirectUrl: string; server: OAuthCallbackServer | null }> {
  const known = await store.load();
  const registered = known?.serverUrl === serverUrl ? registeredRedirects(known) : [];
  const opened = await openCallback(callbackPlan(record, registered));
  try {
    const stored = await store.load();
    if (stored?.serverUrl === serverUrl) await store.save(forSignIn(stored, opened.redirectUrl));
    return opened;
  } catch (error) {
    await opened.server?.close().catch(() => undefined);
    throw error;
  }
}

/** The server wants `iss` and only a full redirect URL can carry it; the sign-in stays open. */
export class IssuerRequiredError extends TypeError {
  constructor(serverId: string) {
    super(
      `The authorization server for ${serverId} requires the RFC 9207 "iss" parameter. ` +
        'Paste the full redirect URL from the browser address bar (not just the authorization code).',
    );
    this.name = 'IssuerRequiredError';
  }
}

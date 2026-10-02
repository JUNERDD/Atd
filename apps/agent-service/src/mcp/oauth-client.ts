import type { McpHttp, McpOAuthAuth, McpOAuthClient, McpServerConfig } from '@ai/agent-contracts';
import type { OAuthChallenge, OAuthFlowOptions } from '@earendil-works/pi-mcp/oauth';
import { MCP_OAUTH_CLIENT_NAME } from './constants.js';

/**
 * Which HTTP servers sign in with OAuth, and with which client. A server configured for OAuth
 * does; so does one with no auth and no `Authorization` header, which is offered a sign-in when it
 * answers 401 (as pi's MCP client does): its connections carry the OAuth connection auth, which
 * sends nothing until a sign-in stored a token. A bearer server, or one whose own headers carry
 * `Authorization`, never does: its credential is the user's, and OAuth would replace it.
 */

/** Whether a record signs in with OAuth (configured, or offered on a 401). */
export function usesOAuth(record: McpServerConfig): boolean {
  return record.http !== null && httpUsesOAuth(record.http);
}

/** `usesOAuth` for the HTTP part of a record. */
export function httpUsesOAuth(http: McpHttp): boolean {
  if (http.auth.type === 'oauth') return true;
  if (http.auth.type !== 'none') return false;
  return !Object.keys(http.headers).some((name) => name.toLowerCase() === 'authorization');
}

/** The record's OAuth auth when it configures one; a 401-offered sign-in has none. */
export function oauthAuthOf(record: McpServerConfig): McpOAuthAuth | null {
  return record.http?.auth.type === 'oauth' ? record.http.auth : null;
}

/** What a sign-in or refresh of the record passes to pi-mcp about its client. */
export interface OAuthClientSettings {
  clientName: string;
  clientId?: string;
  clientSecret?: string;
  authorizationServerMetadataUrl?: URL;
}

/** The client settings of a record; a server without a configured client registers one itself. */
export function oauthClientSettings(record: McpServerConfig): OAuthClientSettings {
  const auth = oauthAuthOf(record);
  return {
    clientName: auth?.clientName ?? MCP_OAUTH_CLIENT_NAME,
    ...(auth?.clientId ? { clientId: auth.clientId } : {}),
    ...(auth?.clientId && auth.clientSecret ? { clientSecret: auth.clientSecret } : {}),
    ...(auth?.authServerMetadataUrl
      ? { authorizationServerMetadataUrl: new URL(auth.authServerMetadataUrl) }
      : {}),
  };
}

/** The pi-mcp `McpOAuthProvider` options a record's client adds to a sign-in or refresh. */
export function providerClientOptions(settings: OAuthClientSettings): {
  clientId?: string;
  clientSecret?: string;
} {
  return {
    ...(settings.clientId ? { clientId: settings.clientId } : {}),
    ...(settings.clientSecret ? { clientSecret: settings.clientSecret } : {}),
  };
}

/**
 * The `authorizeMcp` targets of one flow, each only when known: the scope to ask for, the resource
 * metadata the server's challenge named, and the authorization server the record's client pins.
 */
export function flowTargets(
  settings: OAuthClientSettings,
  scope: string | undefined,
  challenge: OAuthChallenge | undefined,
): Pick<OAuthFlowOptions, 'scope' | 'resourceMetadataUrl' | 'authorizationServerMetadataUrl'> {
  const resourceMetadataUrl = challenge?.resourceMetadataUrl;
  const metadataUrl = settings.authorizationServerMetadataUrl;
  return {
    ...(scope ? { scope } : {}),
    ...(resourceMetadataUrl ? { resourceMetadataUrl } : {}),
    ...(metadataUrl ? { authorizationServerMetadataUrl: metadataUrl } : {}),
  };
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Why a configured OAuth client is unusable, or null. pi-mcp trusts the authorization server
 * metadata URL as configured and sends codes, tokens and the client secret where it says, so it
 * must be https, or http on a loopback host only.
 */
export function oauthClientProblem(client: McpOAuthClient): string | null {
  const metadata = client.authServerMetadataUrl;
  if (metadata === undefined) return null;
  let url: URL;
  try {
    url = new URL(metadata);
  } catch {
    return 'its OAuth authorization server metadata URL is invalid';
  }
  if (url.username || url.password)
    return 'its OAuth authorization server metadata URL carries credentials';
  const loopback = LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return null;
  return 'its OAuth authorization server metadata URL must use https (http only on a loopback host)';
}

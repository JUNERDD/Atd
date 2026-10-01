import { createHash, randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { echoServerResult, isRecord, parseRecord, readBody, reply } from './mcp-http-kit.ts';

/**
 * A loopback OAuth 2.1 authorization server plus the MCP resource it protects, for node:test, with
 * what pi-mcp's OAuth client needs: protected-resource and authorization-server metadata, dynamic
 * client registration, an /authorize that approves at once (302 to the redirect URI with code,
 * state and iss), /token for authorization_code (PKCE S256 checked) and rotating refresh_token,
 * and /revoke. `<base>/mcp` is a Streamable HTTP endpoint with one `echo` tool; it answers 401
 * with a resource_metadata challenge until the request carries a live access token.
 */

export interface OAuthMockOptions {
  /**
   * Lifetime in seconds (fractions work), reported as `expires_in` and enforced; default 3600. A
   * client that refreshes early (the service: 30 s) refreshes on every request below that, so use
   * `expireAccessTokens` for one deterministic refresh.
   */
  tokenTtlSeconds?: number;
  /** A refresh returns a new refresh token and retires the old one. Default true. */
  rotateRefreshTokens?: boolean;
  /** Advertise `authorization_response_iss_parameter_supported`. Default false. */
  advertiseIss?: boolean;
  /** The `iss` of the /authorize redirect: undefined is the issuer, null leaves it out. */
  redirectIss?: string | null;
  /**
   * Another mock that is this resource's authorization server: the protected-resource metadata
   * names its origin and it validates the tokens, so OAuth requests cross origins.
   */
  trustedIssuer?: OAuthMock;
  /** The `resource` its protected-resource metadata names; default the MCP URL. */
  resource?: string;
}

/**
 * Live counts. `registrations` are POST /register (seeded clients excluded), `authorizations`
 * approved /authorize requests, `mcpRequests` authorized POSTs to /mcp, `unauthorized` its 401s.
 */
export interface OAuthMockCounters {
  registrations: number;
  authorizations: number;
  tokenRequests: number;
  codeGrants: number;
  refreshGrants: number;
  revocations: number;
  mcpRequests: number;
  unauthorized: number;
}

export interface AuthorizationRecord {
  clientId: string;
  redirectUri: string;
  state: string | null;
  scope: string | null;
  resource: string | null;
}

/** A client and tokens issued without a sign-in, as an earlier session would have left them. */
export interface SeededGrant {
  clientId: string;
  redirectUris: string[];
  accessToken: string;
  refreshToken: string;
  /** Access token expiry in unix seconds, the unit pi-mcp-adapter stored. */
  expiresAt: number;
  ttlSeconds: number;
}

/** A request the mock received, before any auth check. */
export interface MockRequest {
  method: string;
  /** Path and query, as sent. */
  target: string;
  headers: IncomingHttpHeaders;
}

export interface OAuthMock {
  /** The protected MCP endpoint, `<base>/mcp`. */
  url: string;
  /** Origin and issuer, without a trailing slash. */
  base: string;
  counters: OAuthMockCounters;
  /** Registered clients by id, with the metadata they sent. */
  clients: Map<string, Record<string, unknown>>;
  authorizations: AuthorizationRecord[];
  /** Every request in the order it arrived. */
  requests: MockRequest[];
  /** Whether `token` is a live access token this mock issued. */
  accepts(token: string): boolean;
  setTokenTtl(seconds: number): void;
  seedGrant(options?: { redirectUris?: string[]; ttlSeconds?: number }): SeededGrant;
  /** Issued access tokens stop working; refresh tokens still do. */
  expireAccessTokens(): void;
  /** Every issued token stops working: only a new sign-in helps. */
  revokeEverything(): void;
  /** Holds the answer to code and refresh grants (the request is counted) until it is called. */
  holdGrants(): () => void;
  close(): Promise<void>;
}

const oauthError = (res: ServerResponse, status: number, error: string, description: string) =>
  reply(res, status, { error, error_description: description });

export async function startOAuthMock(options: OAuthMockOptions = {}): Promise<OAuthMock> {
  let ttlSeconds = options.tokenTtlSeconds ?? 3600;
  const rotate = options.rotateRefreshTokens ?? true;
  let base = '';
  const counters: OAuthMockCounters = {
    registrations: 0,
    authorizations: 0,
    tokenRequests: 0,
    codeGrants: 0,
    refreshGrants: 0,
    revocations: 0,
    mcpRequests: 0,
    unauthorized: 0,
  };
  const clients = new Map<string, Record<string, unknown>>();
  const authorizations: AuthorizationRecord[] = [];
  const requests: MockRequest[] = [];
  const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string }>();
  const accessTokens = new Map<string, { expiresAt: number }>();
  const refreshTokens = new Map<string, string>();
  let held: Promise<void> | undefined;

  const issueAccess = (ttl: number): string => {
    const token = `at-${randomUUID()}`;
    accessTokens.set(token, { expiresAt: Date.now() + ttl * 1000 });
    return token;
  };
  const issueRefresh = (clientId: string): string => {
    const token = `rt-${randomUUID()}`;
    refreshTokens.set(token, clientId);
    return token;
  };

  function authorize(url: URL, res: ServerResponse): void {
    const query = url.searchParams;
    const clientId = query.get('client_id') ?? '';
    const redirectUri = query.get('redirect_uri') ?? '';
    const challenge = query.get('code_challenge');
    const redirects = clients.get(clientId)?.redirect_uris;
    if (
      query.get('response_type') !== 'code' ||
      !Array.isArray(redirects) ||
      !redirects.includes(redirectUri) ||
      query.get('code_challenge_method') !== 'S256' ||
      !challenge
    ) {
      return oauthError(res, 400, 'invalid_request', 'Unknown client, redirect or PKCE method');
    }
    const code = `code-${randomUUID()}`;
    codes.set(code, { clientId, redirectUri, challenge });
    counters.authorizations += 1;
    const state = query.get('state');
    const scope = query.get('scope');
    authorizations.push({ clientId, redirectUri, state, scope, resource: query.get('resource') });
    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    if (state !== null) target.searchParams.set('state', state);
    const iss = options.redirectIss === undefined ? base : options.redirectIss;
    if (iss !== null) target.searchParams.set('iss', iss);
    reply(res, 302, undefined, { location: target.href });
  }

  async function token(request: IncomingMessage, res: ServerResponse): Promise<void> {
    counters.tokenRequests += 1;
    const form = new URLSearchParams(await readBody(request));
    const clientId = form.get('client_id') ?? '';
    if (!clients.has(clientId)) return oauthError(res, 401, 'invalid_client', 'Unknown client');
    const answer = (refreshToken: string | undefined) =>
      reply(res, 200, {
        access_token: issueAccess(ttlSeconds),
        token_type: 'Bearer',
        expires_in: ttlSeconds,
        ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
      });
    if (form.get('grant_type') === 'authorization_code') {
      await held;
      const code = form.get('code') ?? '';
      const pending = codes.get(code);
      codes.delete(code);
      const verified = createHash('sha256')
        .update(form.get('code_verifier') ?? '')
        .digest('base64url');
      if (
        pending?.clientId !== clientId ||
        pending.redirectUri !== form.get('redirect_uri') ||
        pending.challenge !== verified
      ) {
        return oauthError(res, 400, 'invalid_grant', 'Invalid authorization code or verifier');
      }
      counters.codeGrants += 1;
      return answer(issueRefresh(clientId));
    }
    if (form.get('grant_type') === 'refresh_token') {
      await held;
      const refresh = form.get('refresh_token') ?? '';
      if (refreshTokens.get(refresh) !== clientId) {
        return oauthError(res, 400, 'invalid_grant', 'Invalid refresh token');
      }
      counters.refreshGrants += 1;
      if (rotate) refreshTokens.delete(refresh);
      return answer(rotate ? issueRefresh(clientId) : undefined);
    }
    return oauthError(res, 400, 'unsupported_grant_type', 'Only code and refresh grants');
  }

  const accepts = (token: string) => {
    const grant = accessTokens.get(token);
    return grant !== undefined && grant.expiresAt > Date.now();
  };

  async function mcp(request: IncomingMessage, res: ServerResponse): Promise<void> {
    const presented = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
    if (!(options.trustedIssuer?.accepts ?? accepts)(presented)) {
      counters.unauthorized += 1;
      const metadataUrl = `${base}/.well-known/oauth-protected-resource/mcp`;
      return reply(res, 401, undefined, {
        'www-authenticate': `Bearer resource_metadata="${metadataUrl}"`,
      });
    }
    if (request.method !== 'POST') return reply(res, request.method === 'GET' ? 405 : 200);
    counters.mcpRequests += 1;
    const message = parseRecord(await readBody(request));
    const { id, method } = message;
    if (id === undefined || typeof method !== 'string') return reply(res, 202);
    const result = echoServerResult(method, isRecord(message.params) ? message.params : {});
    const error = { code: -32601, message: 'Method not found' };
    const body = { jsonrpc: '2.0', id, ...(result === undefined ? { error } : { result }) };
    reply(res, 200, body, method === 'initialize' ? { 'mcp-session-id': randomUUID() } : {});
  }

  async function route(request: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', base);
    const { pathname } = url;
    const post = request.method === 'POST';
    requests.push({
      method: request.method ?? '',
      target: url.pathname + url.search,
      headers: request.headers,
    });
    if (pathname === '/mcp') return mcp(request, res);
    if (pathname.startsWith('/.well-known/oauth-protected-resource')) {
      const authorizationServers = [options.trustedIssuer?.base ?? base];
      return reply(res, 200, {
        resource: options.resource ?? `${base}/mcp`,
        authorization_servers: authorizationServers,
      });
    }
    if (pathname === '/.well-known/oauth-authorization-server') {
      return reply(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        revocation_endpoint: `${base}/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        ...(options.advertiseIss ? { authorization_response_iss_parameter_supported: true } : {}),
      });
    }
    if (pathname === '/authorize') return authorize(url, res);
    if (pathname === '/token' && post) return token(request, res);
    if (pathname === '/register' && post) {
      counters.registrations += 1;
      const sent = parseRecord(await readBody(request));
      const client_id = `client-${randomUUID()}`;
      const client = { ...sent, client_id, client_id_issued_at: Math.floor(Date.now() / 1000) };
      clients.set(client_id, client);
      return reply(res, 201, client);
    }
    if (pathname === '/revoke' && post) {
      counters.revocations += 1;
      const revoked = new URLSearchParams(await readBody(request)).get('token') ?? '';
      accessTokens.delete(revoked);
      refreshTokens.delete(revoked);
      return reply(res, 200, {});
    }
    reply(res, 404);
  }

  const server = createServer((request, res) => {
    route(request, res).catch((error: unknown) => {
      if (res.headersSent) res.end();
      else oauthError(res, 500, 'server_error', String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('the OAuth mock did not bind to TCP');
  base = `http://127.0.0.1:${address.port}`;

  return {
    url: `${base}/mcp`,
    base,
    counters,
    clients,
    authorizations,
    requests,
    accepts,
    setTokenTtl: (seconds) => {
      ttlSeconds = seconds;
    },
    seedGrant: (grant = {}) => {
      const redirectUris = grant.redirectUris ?? ['http://localhost:1/callback'];
      const clientId = `client-${randomUUID()}`;
      clients.set(clientId, { client_id: clientId, redirect_uris: redirectUris });
      const ttl = grant.ttlSeconds ?? ttlSeconds;
      const expiresAt = Math.floor(Date.now() / 1000 + ttl);
      const accessToken = issueAccess(ttl);
      const refreshToken = issueRefresh(clientId);
      return { clientId, redirectUris, accessToken, refreshToken, expiresAt, ttlSeconds: ttl };
    },
    expireAccessTokens: () => {
      for (const grant of accessTokens.values()) grant.expiresAt = 0;
    },
    revokeEverything: () => {
      accessTokens.clear();
      refreshTokens.clear();
    },
    holdGrants: () => {
      let release = () => {};
      held = new Promise<void>((resolve) => (release = resolve));
      return () => {
        held = undefined;
        release();
      };
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

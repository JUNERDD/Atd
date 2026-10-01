import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { McpFetch } from '@earendil-works/pi-mcp';
import {
  McpOAuthAuthorizationRequiredError,
  type McpOAuthState,
  type OAuthChallenge,
} from '@earendil-works/pi-mcp/oauth';
import { KeyringBackend } from '../dist/credentials/keyring.js';
import { MCP_OAUTH_REFRESH_SKEW_MS } from '../dist/mcp/constants.js';
import type { ServiceHeaders } from '../dist/mcp/oauth-fetch.js';
import { createOAuthConnectionAuth, OAuthProviders } from '../dist/mcp/oauth-provider.js';
import { KeychainOAuthStore } from '../dist/mcp/oauth-store.js';
import type { OAuthConnectionAuth } from '../dist/mcp/types.js';
import { sleep } from './mcp-fake-server.ts';
import { at, httpRecord, memoryLog, waitFor } from './mcp-kit.ts';
import { startOAuthMock, type OAuthMock } from './mcp-oauth-mock.ts';
import { installMemoryKeyring } from './memory-keyring.ts';

/**
 * The auth a connection carries: which store and auth a server has, when a token is renewed (by a
 * connection, or by a sign-in start that shares the refresh), and when only a new sign-in helps.
 */

const SERVICE = 'oauth-auth';
installMemoryKeyring();
const backend = new KeyringBackend(SERVICE);
let mock: OAuthMock;
before(async () => {
  mock = await startOAuthMock();
});
after(() => mock.close());

const noHeaders: ServiceHeaders = { serverId: 'srv', resolve: async () => ({}) };
const state = (extra: Partial<McpOAuthState> = {}): McpOAuthState => ({
  serverUrl: 'https://mcp.example/mcp',
  tokens: { access_token: 'at-1', token_type: 'Bearer', refresh_token: 'rt-1' },
  ...extra,
});

let accounts = 0;
const nextAccount = () => `mcp:auth-${(accounts += 1)}:oauth`;

test('providers keep one store and one auth per server; forgetting retires them', async () => {
  const providers = new OAuthProviders({
    serviceId: SERVICE,
    keyring: backend,
    log: memoryLog().log,
    headersFor: async () => ({}),
  });
  const record = httpRecord('p1', {}, { auth: { type: 'oauth', scope: null, redirectUri: null } });
  const url = 'https://mcp.example/mcp';
  const store = providers.storeFor(record);
  assert.equal(providers.storeFor(record), store);
  const auth = providers.authFor(record, url);
  assert.equal(providers.authFor(record, url), auth, 'the connections share it');

  const header = 'Bearer error="insufficient_scope", scope="write"';
  await assert.rejects(rejectedBy(auth, 'tok', header), McpOAuthAuthorizationRequiredError);
  assert.equal(providers.challengeFor('p1', url)?.scope, 'write');
  assert.equal(providers.challengeFor('p1', 'https://mcp.example/other'), undefined);
  assert.notEqual(providers.authFor(record, 'https://mcp.example/other'), auth, 'another URL');

  await store.save(state());
  providers.forget('p1');
  await store.save(state({ oauthState: 'late' }));
  assert.equal(await store.load(), undefined, 'the forgotten store is retired');
  const renamed = providers.storeFor({ ...record, principal: 'someone' });
  assert.notEqual(providers.storeFor(record), renamed, 'a principal is another identity');
  await providers.settled();
});

/** A 401 that carried `token`, as the transport hands it to the auth. */
async function rejectedBy(
  auth: OAuthConnectionAuth,
  token: string | undefined,
  header = 'Bearer',
  fetch: McpFetch = globalThis.fetch,
) {
  assert.ok(auth.onUnauthorized, 'the auth reacts to a 401');
  await auth.onUnauthorized({
    response: new Response(null, { status: 401, headers: { 'www-authenticate': header } }),
    serverUrl: new URL(mock.url),
    fetch,
    ...(token ? { token } : {}),
  });
}

interface SignInOptions {
  /** When the access token expires (ms); a day from now by default. */
  expiresAt?: number;
  without?: 'refresh' | 'client';
  server?: OAuthMock;
}

/** An auth over a sign-in the mock (or `server`) issued without a browser. */
async function signedIn(options: SignInOptions = {}) {
  const server = options.server ?? mock;
  const grant = server.seedGrant({ ttlSeconds: 3600 });
  const store = new KeychainOAuthStore(backend, nextAccount(), memoryLog().log);
  await store.save({
    serverUrl: server.url,
    tokens: {
      access_token: grant.accessToken,
      token_type: 'Bearer',
      ...(options.without === 'refresh' ? {} : { refresh_token: grant.refreshToken }),
    },
    tokensExpireAt: options.expiresAt ?? grant.expiresAt * 1000,
    ...(options.without === 'client'
      ? {}
      : { clientInformation: { client_id: grant.clientId, redirect_uris: grant.redirectUris } }),
  });
  const challenges: OAuthChallenge[] = [];
  const auth = createOAuthConnectionAuth({
    serverUrl: server.url,
    store,
    scope: undefined,
    log: memoryLog().log,
    onChallenge: (challenge) => void challenges.push(challenge),
    service: noHeaders,
  });
  return { grant, store, auth, challenges };
}

test('a token close to its expiry is renewed before it is sent, once for concurrent requests', async () => {
  const live = await signedIn();
  assert.equal(await live.auth.token(), live.grant.accessToken, 'a live token is sent as it is');
  const refreshed = mock.counters.refreshGrants;

  const soon = Date.now() + MCP_OAUTH_REFRESH_SKEW_MS - 1_000;
  const expiring = await signedIn({ expiresAt: soon });
  const tokens = await Promise.all([1, 2, 3].map(() => expiring.auth.token()));
  assert.equal(mock.counters.refreshGrants, refreshed + 1);
  assert.equal(new Set(tokens).size, 1);
  assert.notEqual(at(tokens), expiring.grant.accessToken);
  assert.equal((await expiring.store.load())?.tokens?.access_token, at(tokens));
  await expiring.auth.settled();
});

test('a revoked refresh token drops the tokens; the next 401 asks for a new sign-in at once', async () => {
  const session = await signedIn({ expiresAt: Date.now() + 1_000 });
  mock.revokeEverything();
  assert.equal(await session.auth.token(), undefined, 'the refused sign-in is not sent again');
  const kept = await session.store.load();
  assert.equal(kept?.tokens, undefined);
  assert.equal(kept?.clientInformation?.client_id, session.grant.clientId, 'the client stays');

  const requests = mock.counters.tokenRequests;
  await assert.rejects(rejectedBy(session.auth, undefined), McpOAuthAuthorizationRequiredError);
  assert.equal(mock.counters.tokenRequests, requests, 'nothing to refresh with');
});

test('an unreachable server is an error to try again, not a sign-in to redo', async () => {
  // Cached discovery is the steady state: then the token endpoint is the only thing asked, and
  // pi-mcp turns its failure into a browser redirect, which the auth must not read as "sign in".
  for (const cached of [false, true]) {
    const down = await startOAuthMock();
    const session = await signedIn({ server: down, expiresAt: Date.now() + 1_000 });
    if (cached) {
      assert.notEqual(await session.auth.token(), session.grant.accessToken, 'renewed while up');
      assert.ok((await session.store.load())?.discovery, 'the renewal left discovery behind');
    }
    const carried = (await session.store.load())?.tokens;
    await down.close();
    if (!cached) {
      assert.equal(await session.auth.token(), carried?.access_token, 'the request still goes out');
    }
    await assert.rejects(rejectedBy(session.auth, carried?.access_token), (error) => {
      assert.ok(!(error instanceof McpOAuthAuthorizationRequiredError), `${cached}: ${error}`);
      return true;
    });
    assert.equal((await session.store.load())?.tokens?.refresh_token, carried?.refresh_token);
  }
});

test('a renewal that authorized ignores a request that failed on the way', async () => {
  const session = await signedIn();
  // The first probe for the resource metadata times out; discovery goes on without it.
  const timedOut = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  let requests = 0;
  const flaky: McpFetch = (input, init) =>
    (requests += 1) === 1 ? Promise.reject(timedOut) : fetch(input, init);
  await rejectedBy(session.auth, session.grant.accessToken, 'Bearer', flaky);
  assert.ok(requests > 1, 'the renewal went on after the failed request');
  assert.notEqual((await session.store.load())?.tokens?.access_token, session.grant.accessToken);
});

test('a 401 renews the token it carried, and only if nobody else has', async () => {
  const session = await signedIn();
  const before = { ...mock.counters };
  await rejectedBy(session.auth, 'an-older-token');
  assert.deepEqual(mock.counters, before, 'somebody else already renewed it: nothing is asked');
  await rejectedBy(session.auth, session.grant.accessToken);
  assert.equal(mock.counters.refreshGrants, before.refreshGrants + 1);
  assert.notEqual((await session.store.load())?.tokens?.access_token, session.grant.accessToken);
});

test('only a new sign-in helps without a refresh token or a client, or when more scope is wanted', async () => {
  for (const without of ['refresh', 'client'] as const) {
    const session = await signedIn({ without });
    const before = { ...mock.counters };
    const rejected = rejectedBy(session.auth, session.grant.accessToken);
    await assert.rejects(rejected, McpOAuthAuthorizationRequiredError, without);
    await assert.rejects(session.auth.renew(), McpOAuthAuthorizationRequiredError, without);
    assert.deepEqual(mock.counters, before, `${without}: nothing was sent, no client registered`);
  }
  const session = await signedIn();
  const header = 'Bearer error="insufficient_scope", scope="read write"';
  await assert.rejects(
    rejectedBy(session.auth, session.grant.accessToken, header),
    McpOAuthAuthorizationRequiredError,
  );
  const challenge = at(session.challenges);
  assert.equal(challenge.error, 'insufficient_scope');
  assert.equal(challenge.scope, 'read write');
});

test('renew() renews now, and shares the refresh a connection has in flight', async () => {
  const session = await signedIn(); // a day of life left: nothing else would refresh it
  const before = { ...mock.counters };
  await session.auth.renew();
  assert.equal(mock.counters.refreshGrants, before.refreshGrants + 1);
  assert.equal(mock.counters.registrations, before.registrations, 'a renewal registers nothing');
  assert.notEqual((await session.store.load())?.tokens?.access_token, session.grant.accessToken);

  const soon = Date.now() + MCP_OAUTH_REFRESH_SKEW_MS - 1_000;
  const expiring = await signedIn({ expiresAt: soon });
  const release = mock.holdGrants();
  const { tokenRequests, refreshGrants } = mock.counters;
  const sending = expiring.auth.token(); // about to expire: renewed before it is sent
  await waitFor(() => mock.counters.tokenRequests > tokenRequests);
  const renewing = expiring.auth.renew();
  await sleep(100); // long enough for a renewal of its own to have reached the server
  assert.equal(mock.counters.tokenRequests, tokenRequests + 1, 'the renewal joined that refresh');
  release();
  await renewing;
  assert.equal(mock.counters.refreshGrants, refreshGrants + 1);
  assert.equal(await sending, (await expiring.store.load())?.tokens?.access_token);
});

import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';
import { Type } from 'typebox';
import { ErrorEnvelopeSchema, parse } from '@ai/agent-contracts';
import { approveAuthorization } from './mcp-http-kit.ts';
import { sleep } from './mcp-fake-server.ts';
import { at, waitFor } from './mcp-kit.ts';
import { oauthApi } from './mcp-oauth-kit.ts';
import { startOAuthMock, type OAuthMock } from './mcp-oauth-mock.ts';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * A sign-in start on a server that holds a refresh token tries the refresh before it asks for the
 * browser, and never costs the stored sign-in: the redirect port being busy does not matter, a
 * refresh that cannot be tried is an internal error that leaves everything as it was, and a
 * refresh a connection already has in flight is joined instead of spending the rotating token
 * twice.
 */

const keyring = installMemoryKeyring();
let harness: Awaited<ReturnType<typeof startTestService>>;
let mock: OAuthMock;
const oauth = oauthApi(
  () => harness,
  keyring,
  () => mock.url,
);

before(async () => {
  harness = await startTestService();
  mock = await startOAuthMock();
});
after(async () => {
  await harness.stop();
  await mock.close();
});

const Stored = Type.Object({
  state: Type.Object({
    tokens: Type.Optional(
      Type.Object({ access_token: Type.String(), refresh_token: Type.Optional(Type.String()) }),
    ),
    clientInformation: Type.Optional(
      Type.Object({
        client_id: Type.String(),
        redirect_uris: Type.Optional(Type.Array(Type.String())),
      }),
    ),
  }),
});

/** What the keychain holds of a server's sign-in. */
const stateOf = (serverId: string) =>
  parse(Stored, JSON.parse(oauth().stored(serverId) ?? '{"state":{}}')).state;

/** The port the server's client registered its redirect on. */
const registeredPort = (serverId: string) =>
  Number(new URL(at(stateOf(serverId).clientInformation?.redirect_uris ?? [])).port);

/** Puts the server through a browser sign-in and connects it. */
async function signedIn(serverId: string, url?: string) {
  const { put, signIn, post } = oauth();
  await put(serverId, url ? { url } : {});
  await signIn(serverId);
  assert.equal((await post('/v1/mcp/connect', serverId)).status, 200);
}

/** Listens on `port`, as another program on the machine might. */
async function occupy(port: number) {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}

test('a busy callback port does not stop a refresh token from signing in', async () => {
  const { post } = oauth();
  await signedIn('busy');
  const before = stateOf('busy');
  const release = await occupy(registeredPort('busy'));
  try {
    const counters = { ...mock.counters };
    const started = await post('/v1/mcp/auth/start', 'busy');
    assert.deepEqual(started.json, {
      serverId: 'busy',
      authenticated: true,
      authorizationUrl: null,
      mode: 'oauth',
    });
    assert.equal(mock.counters.refreshGrants, counters.refreshGrants + 1, 'one refresh grant');
    assert.equal(mock.counters.registrations, counters.registrations, 'no new client');
    assert.equal(mock.counters.authorizations, counters.authorizations, 'no browser round trip');
    const now = stateOf('busy');
    assert.equal(now.clientInformation?.client_id, before.clientInformation?.client_id);
    assert.notEqual(now.tokens?.access_token, before.tokens?.access_token, 'renewed');
    assert.equal((await post('/v1/mcp/connect', 'busy')).status, 200);
  } finally {
    await release();
  }
});

test('a refresh token the server turns down falls back to the browser, with a client for the new redirect', async () => {
  const { post, row } = oauth();
  await signedIn('refused');
  const before = stateOf('refused');
  const port = registeredPort('refused');
  const release = await occupy(port);
  try {
    mock.revokeEverything();
    const counters = { ...mock.counters };
    const started = await post('/v1/mcp/auth/start', 'refused');
    assert.equal(started.status, 200, started.text);
    const { authenticated, authorizationUrl } = parse(
      Type.Object({ authenticated: Type.Boolean(), authorizationUrl: Type.String() }),
      started.json,
    );
    assert.equal(authenticated, false);
    const query = new URL(authorizationUrl).searchParams;
    assert.notEqual(query.get('client_id'), before.clientInformation?.client_id, 'a new client');
    assert.notEqual(new URL(query.get('redirect_uri') ?? '').port, String(port), 'another port');
    assert.equal(mock.counters.registrations, counters.registrations + 1);
    assert.equal(mock.counters.refreshGrants, counters.refreshGrants, 'nothing was renewed');

    await approveAuthorization(authorizationUrl, { visit: true });
    await waitFor(async () => (await row('refused')).state === 'disconnected');
    assert.equal((await post('/v1/mcp/connect', 'refused')).status, 200);
  } finally {
    await release();
  }
});

test('a refresh that cannot be tried is an internal error, and the stored sign-in is left as it was', async () => {
  const down = await startOAuthMock();
  const { post, row } = oauth();
  await signedIn('down', down.url);
  const before = stateOf('down');
  await down.close();

  // undici's `fetch failed` is a TypeError, which would answer as the client's fault (400).
  const started = await post('/v1/mcp/auth/start', 'down');
  assert.equal(started.status, 500, started.text);
  const { code, message } = parse(ErrorEnvelopeSchema, started.json).error;
  assert.equal(code, 'internal');
  const failed = await row('down');
  assert.equal(failed.state, 'error');
  assert.notEqual(message, '');
  assert.equal(failed.lastError, message, 'the row says what the response says');
  const now = stateOf('down');
  assert.deepEqual(now.tokens, before.tokens, 'the refresh token is kept');
  assert.deepEqual(now.clientInformation, before.clientInformation);
});

test('a start that meets a refresh in flight joins it instead of spending the token twice', async () => {
  const { post } = oauth();
  await signedIn('joined');
  mock.expireAccessTokens();
  const release = mock.holdGrants();
  const { tokenRequests, refreshGrants } = mock.counters;
  // The open connection's next request is refused with a 401 and refreshes the token.
  const listing = post('/v1/mcp/tools/list', 'joined');
  await waitFor(() => mock.counters.tokenRequests > tokenRequests);

  const started = post('/v1/mcp/auth/start', 'joined');
  await sleep(150); // long enough for a refresh of the start's own to have reached the server
  assert.equal(mock.counters.tokenRequests, tokenRequests + 1, 'the start asked for nothing');
  release();
  assert.deepEqual((await started).json, {
    serverId: 'joined',
    authenticated: true,
    authorizationUrl: null,
    mode: 'oauth',
  });
  assert.equal(mock.counters.refreshGrants, refreshGrants + 1, 'one refresh grant');
  await listing; // the sign-in moved the connection meanwhile; how the request ends is not the point
});

import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { approveAuthorization } from './mcp-http-kit.ts';
import { waitFor } from './mcp-kit.ts';
import { oauthApi } from './mcp-oauth-kit.ts';
import { startOAuthMock, type OAuthMock } from './mcp-oauth-mock.ts';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * Which servers sign in with OAuth and as which client, through a real service and a loopback
 * authorization server: a server without auth is offered a sign-in when it answers 401, as pi's
 * MCP client offers one, unless it sends its own Authorization header; a pre-registered client
 * signs in as itself on its fixed callback port, without registering a client.
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

/** A port nothing listens on right now. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address: string | AddressInfo | null = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  assert.ok(address && typeof address === 'object');
  return address.port;
}

const putHttp = (serverId: string, fields: Record<string, unknown>) =>
  oauth().api.send(`/v1/mcp/servers/${serverId}`, 'PUT', {
    transport: 'streamable-http',
    url: mock.url,
    ...fields,
  });

test('a server without auth is offered a sign-in on 401, unless it sends its own Authorization', async () => {
  const { post, row, signIn } = oauth();
  assert.equal((await putHttp('open', { auth: { type: 'none' } })).status, 200);
  assert.equal((await post('/v1/mcp/connect', 'open')).status, 401);
  assert.equal((await row('open')).state, 'auth_required');
  await signIn('open');
  assert.equal((await post('/v1/mcp/connect', 'open')).status, 200);
  assert.equal((await row('open')).state, 'ready');

  const own = { auth: { type: 'none' }, headers: { Authorization: 'Bearer not-a-token' } };
  assert.equal((await putHttp('own', own)).status, 200);
  assert.equal((await post('/v1/mcp/connect', 'own')).status, 401);
  const start = await post('/v1/mcp/auth/start', 'own');
  assert.equal(start.status, 400);
  assert.match(start.text, /does not sign in with OAuth/);
});

test('a pre-registered client signs in as itself on its callback port, registering nothing', async () => {
  const { post, row, start } = oauth();
  const port = await freePort();
  const redirect = `http://localhost:${port}/callback`;
  const { clientId } = mock.seedGrant({ redirectUris: [redirect] });
  const registrations = mock.counters.registrations;
  const client = { clientId, callbackPort: port, clientName: 'Preset' };
  const saved = await putHttp('preset', { auth: { type: 'oauth', client } });
  assert.equal(saved.status, 200, saved.text);

  const url = new URL(await start('preset'));
  assert.equal(url.searchParams.get('client_id'), clientId);
  assert.equal(url.searchParams.get('redirect_uri'), redirect);
  await approveAuthorization(url, { visit: true });
  await waitFor(async () => (await row('preset')).state === 'disconnected');
  assert.equal((await post('/v1/mcp/connect', 'preset')).status, 200);
  assert.equal(mock.counters.registrations, registrations, 'no client was registered');
});

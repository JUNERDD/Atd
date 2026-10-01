import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { errorCode } from './launch-helpers.ts';
import { approveAuthorization } from './mcp-http-kit.ts';
import { waitFor } from './mcp-kit.ts';
import { oauthApi } from './mcp-oauth-kit.ts';
import { startOAuthMock, type OAuthMock } from './mcp-oauth-mock.ts';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * Revoking a server while its sign-in is being finished: the exchange with the authorization
 * server is cancelled, nothing is saved, and the server can be enabled and signed in again.
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

test('a revoke while the code is being exchanged saves no tokens and ends the sign-in', async () => {
  const { put, post, start, row, stored, api } = oauth();
  await put('rev');
  const url = await start('rev');
  const release = mock.holdGrants();
  const requests = mock.counters.tokenRequests;
  await approveAuthorization(url, { visit: true });
  await waitFor(() => mock.counters.tokenRequests > requests);

  const revoked = await post('/v1/mcp/revoke', 'rev');
  assert.equal(revoked.status, 200, revoked.text);
  release();
  await waitFor(async () => {
    const answer = await post('/v1/mcp/auth/complete', 'rev', { input: 'code' });
    return answer.status === 409 && errorCode(answer.json) === 'conflict';
  });
  assert.ok(!(stored('rev') ?? '').includes('access_token'), 'nothing was saved');
  assert.equal((await row('rev')).state, 'disabled', 'the server is revoked');

  const enabled = await api.send('/v1/mcp/servers/rev/enabled', 'POST', { enabled: true });
  assert.equal(enabled.status, 200, enabled.text);
  const refused = await post('/v1/mcp/connect', 'rev');
  assert.deepEqual([refused.status, errorCode(refused.json)], [401, 'auth_required']);
});

test('after a revoke the same server signs in again', async () => {
  const { post, signIn, row } = oauth();
  await signIn('rev');
  assert.equal((await post('/v1/mcp/connect', 'rev')).status, 200);
  assert.equal((await row('rev')).state, 'ready');
});

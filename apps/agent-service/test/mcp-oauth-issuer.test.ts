import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Type } from 'typebox';
import { parse } from '@ai/agent-contracts';
import { errorCode } from './launch-helpers.ts';
import { approveAuthorization } from './mcp-http-kit.ts';
import { waitFor } from './mcp-kit.ts';
import { oauthApi } from './mcp-oauth-kit.ts';
import { startOAuthMock, type OAuthMock } from './mcp-oauth-mock.ts';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * RFC 9207 through a real service: an authorization server that says it sends `iss` must have,
 * and the issuer of a response must be the one the sign-in discovered, checked before the code is
 * used for anything.
 */

const Completed = Type.Object({ authenticated: Type.Boolean() });
const keyring = installMemoryKeyring();
let harness: Awaited<ReturnType<typeof startTestService>>;
let good: OAuthMock;
let other: OAuthMock;
const oauth = oauthApi(
  () => harness,
  keyring,
  () => good.url,
);

before(async () => {
  harness = await startTestService();
  good = await startOAuthMock({ advertiseIss: true });
  other = await startOAuthMock({ advertiseIss: true, redirectIss: 'https://elsewhere.example' });
});
after(async () => {
  await harness.stop();
  await Promise.all([good.close(), other.close()]);
});

const complete = (serverId: string, input: string) =>
  oauth().post('/v1/mcp/auth/complete', serverId, { input });

test('a server that sends its issuer needs the whole redirect URL, not just the code', async () => {
  const { put, start } = oauth();
  await put('iss-paste');
  const { location } = await approveAuthorization(await start('iss-paste'));
  assert.equal(new URL(location).searchParams.get('iss'), good.base);
  const code = new URL(location).searchParams.get('code');
  assert.ok(code);

  const bare = await complete('iss-paste', code);
  assert.equal(bare.status, 400);
  assert.match(bare.text, /requires the RFC 9207/);
  assert.equal(good.counters.codeGrants, 0, 'the code was not used');

  const whole = await complete('iss-paste', location);
  assert.equal(whole.status, 200, whole.text);
  assert.equal(parse(Completed, whole.json).authenticated, true);
  assert.equal(good.counters.codeGrants, 1, 'the sign-in stayed open for the second answer');
});

test('a response from another issuer is refused before its code is used; the sign-in ends', async () => {
  const { put, start } = oauth();
  await put('iss-other', { url: other.url });
  const { location } = await approveAuthorization(await start('iss-other'));
  assert.equal(new URL(location).searchParams.get('iss'), 'https://elsewhere.example');

  const refused = await complete('iss-other', location);
  assert.deepEqual([refused.status, errorCode(refused.json)], [400, 'bad_request']);
  assert.match(refused.text, /issuer does not match the discovered issuer for iss-other/);
  assert.equal(other.counters.codeGrants, 0);
  const again = await complete('iss-other', location);
  assert.deepEqual([again.status, errorCode(again.json)], [409, 'conflict']);
});

test('the same check runs when the browser reaches the callback; the failure shows on the row', async () => {
  const { put, start, row, stored } = oauth();
  await put('iss-callback', { url: other.url });
  await approveAuthorization(await start('iss-callback'), { visit: true });
  const mismatch = /issuer does not match/;
  await waitFor(async () => mismatch.test((await row('iss-callback')).lastError));
  assert.equal((await row('iss-callback')).state, 'auth_required', 'signing in is still needed');
  assert.equal(other.counters.codeGrants, 0);
  assert.ok(!(stored('iss-callback') ?? '').includes('access_token'), 'no tokens were saved');
});

test('a matching issuer signs in through the callback', async () => {
  const { put, post, signIn, row } = oauth();
  await put('iss-good');
  await signIn('iss-good');
  assert.equal((await post('/v1/mcp/connect', 'iss-good')).status, 200);
  assert.equal((await row('iss-good')).state, 'ready');
});

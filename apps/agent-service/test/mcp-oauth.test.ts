import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { McpAuthUrlNotice } from '@ai/agent-contracts';
import { oauthAccount } from '../dist/mcp/oauth-store.js';
import { serversFile } from '../dist/mcp/servers.js';
import { approveAuthorization, isRecord } from './mcp-http-kit.ts';
import { startOAuthMock, type OAuthMock } from './mcp-oauth-mock.ts';
import { oauthApi } from './mcp-oauth-kit.ts';
import { at, httpRecord, waitFor } from './mcp-kit.ts';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * OAuth sign-in, refresh and logout through a real service and a loopback authorization server:
 * the URL the service hands out, the callback that completes a sign-in by itself, pasting the
 * redirect or its code, transparent token renewal, and what logout leaves behind.
 */

const keyring = installMemoryKeyring();
let harness: Awaited<ReturnType<typeof startTestService>>;
const oauth = oauthApi(
  () => harness,
  keyring,
  () => mock.url,
);
let mock: OAuthMock;
const notices: McpAuthUrlNotice[] = [];
const isAuthNotice = (data: unknown): data is McpAuthUrlNotice =>
  isRecord(data) && isRecord(data.mcp) && data.mcp.type === 'auth_url';

/** Servers with a configured redirect URI, which the upsert route cannot set: seeded before first use. */
const redirects: Record<string, string> = {
  'oauth-loopback': 'http://127.0.0.1:{port}/callback',
  'oauth-https': 'https://app.example/oauth/callback',
  'oauth-bad-redirect': 'http://example.com/callback',
};

before(async () => {
  harness = await startTestService();
  mock = await startOAuthMock();
  const servers = Object.entries(redirects).map(([serverId, redirectUri]) =>
    httpRecord(serverId, {}, { url: mock.url, auth: { type: 'oauth', scope: null, redirectUri } }),
  );
  const file = serversFile(harness.config.paths.root);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ version: 1, servers }));
  harness.service.events.onPublish((event) => {
    if (event.type === 'notice' && isAuthNotice(event.data)) notices.push(event.data);
  });
});
after(async () => {
  await harness.stop();
  await mock.close();
});

/** The files under `dir` whose text contains `needle`. */
async function filesContaining(dir: string, needle: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    if ((await readFile(file, 'utf8').catch(() => '')).includes(needle)) found.push(file);
  }
  return found;
}

test('a server that needs a sign-in says so; the callback completes it by itself', async () => {
  const { put, post, row } = oauth();
  assert.equal((await put('oauth-main')).status, 200);
  const refused = await post('/v1/mcp/connect', 'oauth-main');
  assert.equal(refused.status, 401);
  assert.deepEqual(
    [(await row('oauth-main')).state, mock.counters.unauthorized],
    ['auth_required', 1],
  );

  const started = await post('/v1/mcp/auth/start', 'oauth-main');
  assert.deepEqual(
    { ...(started.json as object), authorizationUrl: undefined },
    {
      serverId: 'oauth-main',
      authenticated: false,
      authorizationUrl: undefined,
      mode: 'manual-redirect',
    },
  );
  const { authorizationUrl } = started.json as { authorizationUrl: string };
  assert.ok(authorizationUrl.startsWith(`${mock.base}/authorize?`));
  assert.deepEqual(notices.at(-1)?.mcp, {
    type: 'auth_url',
    serverId: 'oauth-main',
    authorizationUrl,
  });

  const visited = await approveAuthorization(authorizationUrl, { visit: true });
  assert.deepEqual(visited.callback, {
    status: 200,
    text: 'Authorization complete. You may close this window.',
  });
  await waitFor(async () => (await row('oauth-main')).state === 'disconnected');
  assert.equal((await post('/v1/mcp/connect', 'oauth-main')).status, 200);
  const ready = await row('oauth-main');
  assert.deepEqual([ready.state, ready.toolCount], ['ready', 1]);
  assert.deepEqual(
    [mock.counters.registrations, mock.counters.authorizations, mock.counters.codeGrants],
    [1, 1, 1],
  );
  const [client_] = [...mock.clients.values()];
  assert.equal(client_?.client_name, 'Agent Service');
  const redirects = client_?.redirect_uris;
  assert.ok(Array.isArray(redirects));
  assert.match(String(redirects[0]), /^http:\/\/localhost:\d+\/callback$/);
  assert.equal(at(mock.authorizations).resource, mock.url, 'the token is bound to the server');
});

test('the sign-in is kept in the service keychain, and nowhere else', async () => {
  const { stored } = oauth();
  const { serviceId, paths } = harness.config;
  const account = oauthAccount(serviceId, { serverId: 'oauth-main', principal: '' });
  assert.match(account, /^mcp:mcp:.+:oauth-main:[0-9a-f]{8}:oauth$/);
  const item: unknown = JSON.parse(stored('oauth-main') ?? 'null');
  assert.ok(isRecord(item) && item.v === 1 && isRecord(item.state));
  const { serverUrl, tokens, clientInformation } = item.state;
  assert.equal(serverUrl, mock.url);
  assert.ok(isRecord(tokens) && typeof tokens.access_token === 'string');
  assert.ok(isRecord(clientInformation) && typeof clientInformation.client_id === 'string');
  const secret = String(tokens.access_token);
  assert.deepEqual(await filesContaining(paths.root, secret), [], 'no file of the data dir has it');
  assert.equal(
    keyring.service('pi-mcp-adapter.oauth').entries().size,
    0,
    'the adapter keychain is left alone',
  );
});

test('asking again while a sign-in waits answers the same URL', async () => {
  const { put, row, start } = oauth();
  await put('oauth-twice');
  const first = await start('oauth-twice');
  assert.equal(await start('oauth-twice'), first);
  await approveAuthorization(first, { visit: true });
  await waitFor(async () => (await row('oauth-twice')).state === 'disconnected');
});

test('the redirect URL, or just its code, can be pasted instead', async () => {
  const { put, post, row, start } = oauth();
  await put('oauth-paste');
  const url = await start('oauth-paste');
  const { location } = await approveAuthorization(url);
  const state = new URL(url).searchParams.get('state') ?? '';
  const tampered = location.replace(`state=${state}`, 'state=someone-elses');
  const refused = await post('/v1/mcp/auth/complete', 'oauth-paste', { input: tampered });
  assert.equal(refused.status, 400);
  assert.match(refused.text, /state mismatch/);
  const denied = await post('/v1/mcp/auth/complete', 'oauth-paste', {
    input: `?error=access_denied&error_description=nope&state=${state}`,
  });
  assert.match(denied.text, /access_denied: nope/);
  const done = await post('/v1/mcp/auth/complete', 'oauth-paste', { input: location });
  assert.deepEqual(done.json, { serverId: 'oauth-paste', authenticated: true });
  assert.equal((await row('oauth-paste')).state, 'disconnected');
  assert.equal(
    (await post('/v1/mcp/auth/complete', 'oauth-paste', { input: location })).status,
    200,
  );
  assert.equal((await post('/v1/mcp/connect', 'oauth-paste')).status, 200);

  await put('oauth-code');
  const code = new URL(
    (await approveAuthorization(await start('oauth-code'))).location,
  ).searchParams.get('code');
  const bare = await post('/v1/mcp/auth/complete', 'oauth-code', { input: code ?? '' });
  assert.equal(bare.status, 200, bare.text);
  assert.equal((await post('/v1/mcp/connect', 'oauth-code')).status, 200);
});

test('completing a sign-in that was never started is a conflict', async () => {
  const { put, post } = oauth();
  await put('oauth-idle');
  const response = await post('/v1/mcp/auth/complete', 'oauth-idle', { input: 'a-code' });
  assert.equal(response.status, 409);
  assert.match(response.text, /No MCP sign-in is in progress for oauth-idle/);
});

test('an expired access token is renewed without a new sign-in or registration', async () => {
  const { post, stored } = oauth();
  await post('/v1/mcp/connect', 'oauth-main');
  const before = { ...mock.counters };
  const refreshToken = () =>
    JSON.parse(stored('oauth-main') ?? '{}').state.tokens.refresh_token as string;
  const first = refreshToken();
  mock.expireAccessTokens();
  const listed = await post('/v1/mcp/tools/list', 'oauth-main');
  assert.equal(listed.status, 200, listed.text);
  assert.equal(mock.counters.refreshGrants, before.refreshGrants + 1);
  assert.equal(mock.counters.registrations, before.registrations, 'no client was registered');
  assert.equal(mock.counters.codeGrants, before.codeGrants, 'nobody signed in again');
  assert.notEqual(refreshToken(), first, 'the rotated refresh token was saved');

  // Requests that fail together share one renewal: a second refresh with the old token would fail.
  mock.expireAccessTokens();
  const parallel = await Promise.all([1, 2, 3].map(() => post('/v1/mcp/tools/list', 'oauth-main')));
  assert.deepEqual(
    parallel.map((response) => response.status),
    [200, 200, 200],
  );
  assert.equal(mock.counters.refreshGrants, before.refreshGrants + 2);
});

test('a token that is about to expire is renewed before it is sent', async () => {
  const { post } = oauth();
  mock.setTokenTtl(5);
  mock.expireAccessTokens();
  await post('/v1/mcp/tools/list', 'oauth-main'); // renews, and gets a token that lasts 5 s
  const { refreshGrants, unauthorized } = mock.counters;
  assert.equal((await post('/v1/mcp/tools/list', 'oauth-main')).status, 200);
  assert.equal(mock.counters.refreshGrants, refreshGrants + 1, 'renewed on the way out');
  assert.equal(mock.counters.unauthorized, unauthorized, 'the server never had to say no');
  mock.setTokenTtl(3600);
});

test('refresh reconnects, renewing the token on the way', async () => {
  const { post, row } = oauth();
  const before = mock.counters.mcpRequests;
  mock.expireAccessTokens();
  const refreshed = await post('/v1/mcp/refresh', 'oauth-main');
  assert.equal(refreshed.status, 200, refreshed.text);
  assert.equal((await row('oauth-main')).state, 'ready');
  assert.ok(mock.counters.mcpRequests > before);
});

test('a refresh token that still works signs in without a URL', async () => {
  const { post } = oauth();
  mock.expireAccessTokens();
  const before = { ...mock.counters };
  const started = await post('/v1/mcp/auth/start', 'oauth-main');
  assert.deepEqual(started.json, {
    serverId: 'oauth-main',
    authenticated: true,
    authorizationUrl: null,
    mode: 'oauth',
  });
  assert.equal(mock.counters.refreshGrants, before.refreshGrants + 1);
  assert.equal(mock.counters.authorizations, before.authorizations, 'no browser round trip');
});

test('a refresh the server turns down leaves the server signed out until the next sign-in', async () => {
  const { put, post, row, signIn } = oauth();
  await put('oauth-revoked');
  await signIn('oauth-revoked');
  await post('/v1/mcp/connect', 'oauth-revoked');
  mock.revokeEverything();
  const listed = await post('/v1/mcp/tools/list', 'oauth-revoked');
  assert.equal(listed.status, 401);
  assert.equal((await row('oauth-revoked')).state, 'auth_required');
  await signIn('oauth-revoked');
  assert.equal((await post('/v1/mcp/connect', 'oauth-revoked')).status, 200);
});

test('logout removes the sign-in; removing the server does too', async () => {
  const { api, put, post, row, stored, signIn } = oauth();
  assert.ok(stored('oauth-main'));
  const out = await post('/v1/mcp/logout', 'oauth-main');
  assert.equal(out.status, 200, out.text);
  assert.equal(stored('oauth-main'), undefined, 'the keychain item is gone');
  assert.equal((await row('oauth-main')).state, 'disconnected');
  const again = await post('/v1/mcp/connect', 'oauth-main');
  assert.equal(again.status, 401);
  assert.equal((await row('oauth-main')).state, 'auth_required');

  await put('oauth-gone');
  await signIn('oauth-gone');
  assert.ok(stored('oauth-gone'));
  assert.equal((await api.send('/v1/mcp/servers/oauth-gone', 'DELETE')).status, 200);
  assert.equal(stored('oauth-gone'), undefined);
});

test('a configured loopback redirect completes by itself; an https one only by pasting', async () => {
  const { post, row } = oauth();
  const started = await post('/v1/mcp/auth/start', 'oauth-loopback');
  assert.equal((started.json as { mode: string }).mode, 'oauth');
  const url = (started.json as { authorizationUrl: string }).authorizationUrl;
  const redirect = new URL(url).searchParams.get('redirect_uri') ?? '';
  assert.match(
    redirect,
    /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
    'the {port} placeholder got a port',
  );
  await approveAuthorization(url, { visit: true });
  await waitFor(async () => (await row('oauth-loopback')).state === 'disconnected');

  const manual = await post('/v1/mcp/auth/start', 'oauth-https');
  assert.equal((manual.json as { mode: string }).mode, 'manual-redirect');
  const { authorizationUrl } = manual.json as { authorizationUrl: string };
  assert.equal(
    new URL(authorizationUrl).searchParams.get('redirect_uri'),
    redirects['oauth-https'],
  );
  const { location } = await approveAuthorization(authorizationUrl);
  assert.ok(
    location.startsWith('https://app.example/oauth/callback?'),
    'no server is listening there',
  );
  const code = new URL(location).searchParams.get('code') ?? '';
  const bare = await post('/v1/mcp/auth/complete', 'oauth-https', { input: code });
  assert.equal(bare.status, 400, 'a bare code cannot be checked against a state');
  assert.match(bare.text, /Paste the full OAuth callback URL/);
  assert.equal(
    (await post('/v1/mcp/auth/complete', 'oauth-https', { input: location })).status,
    200,
  );
  assert.equal((await post('/v1/mcp/connect', 'oauth-https')).status, 200);

  const refused = await post('/v1/mcp/auth/start', 'oauth-bad-redirect');
  assert.equal(refused.status, 400);
  assert.match(
    refused.text,
    /redirectUri must be an https:\/\/ URI or an http:\/\/ localhost or loopback URI/,
  );
});

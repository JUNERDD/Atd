import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import type { McpOAuthState } from '@earendil-works/pi-mcp/oauth';
import { KeyringBackend } from '../dist/credentials/keyring.js';
import { McpError } from '../dist/mcp/errors.js';
import {
  callbackPlan,
  forSignIn,
  openRedirect,
  parseAuthorizationInput,
} from '../dist/mcp/oauth-callback.js';
import { KeychainOAuthStore } from '../dist/mcp/oauth-store.js';
import { httpRecord, memoryLog } from './mcp-kit.ts';
import { installMemoryKeyring } from './memory-keyring.ts';

/**
 * What a sign-in's redirect may look like: where it lands, how a pasted answer is read, what is
 * checked on it, and what a new sign-in keeps of the last one. Only the in-memory keyring is used.
 */

const state = (extra: Partial<McpOAuthState> = {}): McpOAuthState => ({
  serverUrl: 'https://mcp.example/mcp',
  tokens: { access_token: 'at-1', token_type: 'Bearer', refresh_token: 'rt-1' },
  ...extra,
});

test('a pasted answer is read from a URL, a query, a fragment or a bare code', () => {
  const parse = (input: string, requireUrl = false) =>
    parseAuthorizationInput(input, 'st', requireUrl);
  const callback = 'http://localhost:1/callback';
  assert.deepEqual(parse(`${callback}?code=abc&state=st&iss=https%3A%2F%2Fas.example`), {
    code: 'abc',
    iss: 'https://as.example',
  });
  for (const input of [
    '?code=abc&state=st',
    '#code=abc&state=st',
    `${callback}#code=abc&state=st`,
  ]) {
    assert.deepEqual(parse(input), { code: 'abc' }, input);
  }
  assert.deepEqual(parse('  abc.DEF_123~+/=-  '), { code: 'abc.DEF_123~+/=-' });

  const refuses = (input: string, pattern: RegExp, requireUrl = false) =>
    assert.throws(
      () => parse(input, requireUrl),
      (error) => error instanceof TypeError && pattern.test(error.message),
      input,
    );
  refuses('', /required/);
  refuses('?code=abc', /state missing/);
  refuses('?code=abc&state=other', /state mismatch/);
  refuses(
    '?error=access_denied&error_description=No+thanks&state=st',
    /^access_denied: No thanks$/,
  );
  refuses('?state=st', /Could not find an OAuth authorization code/);
  refuses('not a code!', /Could not find an OAuth authorization code/);
  refuses('abc', /full OAuth callback URL/, true);
});

test('where the redirect lands follows the record: loopback, a port of its own, or a page elsewhere', () => {
  const plan = (redirectUri: string | null, registered: string[] = []) =>
    callbackPlan(
      httpRecord('r', {}, { auth: { type: 'oauth', scope: null, redirectUri } }),
      registered,
    );
  const loopback = (redirectUri: string | null, registered: string[] = []) => {
    const found = plan(redirectUri, registered);
    assert.ok(found.kind === 'loopback', String(redirectUri));
    return found;
  };
  assert.deepEqual(loopback(null), {
    kind: 'loopback',
    host: '127.0.0.1',
    redirectHost: 'localhost',
    port: 0,
    strictPort: false,
    path: '/callback',
  });
  const remembered = loopback(null, ['https://x.example/cb', 'http://localhost:4567/callback']);
  assert.deepEqual([remembered.port, remembered.strictPort], [4567, false], 'kept registered');
  assert.deepEqual(loopback('http://localhost:5000/cb'), {
    kind: 'loopback',
    host: '127.0.0.1',
    redirectHost: 'localhost',
    port: 5000,
    strictPort: true,
    path: '/cb',
    exact: 'http://localhost:5000/cb',
  });
  const dynamic = loopback('http://127.0.0.1:{port}/cb');
  assert.deepEqual([dynamic.port, dynamic.strictPort], [0, false]);
  assert.equal(dynamic.template, 'http://127.0.0.1:{port}/cb');
  assert.deepEqual(plan('https://app.example/cb'), {
    kind: 'manual',
    redirectUrl: 'https://app.example/cb',
  });

  const refuses = (redirectUri: string, pattern: RegExp) =>
    assert.throws(
      () => plan(redirectUri),
      (error) =>
        error instanceof McpError && error.code === 'bad_request' && pattern.test(error.message),
      redirectUri,
    );
  refuses(
    'http://example.com/cb',
    /must be an https:\/\/ URI or an http:\/\/ localhost or loopback/,
  );
  refuses('http://localhost/cb', /explicit numeric port/);
  refuses('https://app.example:{port}/cb', /allowed only for an http:\/\/ localhost or loopback/);
  refuses('http://localhost:{port}/a/{port}', /at most one \{port\} placeholder/);
  refuses('http://user:pw@localhost:5000/cb', /username or password/);
  refuses('http://localhost:5000/cb#frag', /fragment/);
});

test('a new sign-in keeps the client only for the redirect it was registered with', () => {
  const registered = state({
    oauthState: 'old',
    clientInformation: { client_id: 'c', redirect_uris: ['http://localhost:9/callback'] },
    tokensExpireAt: 5,
  });
  const same = forSignIn(registered, 'http://localhost:9/callback');
  assert.deepEqual([same.oauthState, same.clientInformation?.client_id], [undefined, 'c']);
  assert.equal(same.tokens?.access_token, 'at-1');
  const other = forSignIn(registered, 'http://localhost:10/callback');
  assert.equal(other.clientInformation, undefined);
  assert.equal(other.tokens, undefined);
  assert.equal(other.tokensExpireAt, undefined);
  assert.equal(other.serverUrl, registered.serverUrl);
});

test('a sign-in start saves the state as it is once the callback listens, not as it was before', async () => {
  installMemoryKeyring();
  // A free port the client was registered on: the callback listens on it again.
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const client = {
    client_id: 'c',
    redirect_uris: [`http://localhost:${address.port}/callback`],
  };
  const store = new KeychainOAuthStore(
    new KeyringBackend('oauth-callback'),
    'mcp:cb:oauth',
    memoryLog().log,
  );
  await store.save(state({ clientInformation: client }));

  const url = 'https://mcp.example/mcp';
  const record = httpRecord(
    'cb',
    {},
    { url, auth: { type: 'oauth', scope: null, redirectUri: null } },
  );
  const opening = openRedirect(record, url, store);
  // A refresh lands while the callback server starts.
  const refreshed = { access_token: 'at-2', token_type: 'Bearer', refresh_token: 'rt-2' };
  await store.save(state({ clientInformation: client, tokens: refreshed }));
  const { server } = await opening;
  try {
    const saved = await store.load();
    assert.equal(saved?.tokens?.refresh_token, 'rt-2', 'the rotated refresh token is not lost');
    assert.equal(saved?.clientInformation?.client_id, 'c', 'the registered redirect still fits');
  } finally {
    await server?.close();
  }
});

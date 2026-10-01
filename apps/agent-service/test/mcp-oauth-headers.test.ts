import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { McpFetch } from '@earendil-works/pi-mcp';
import { ErrorEnvelopeSchema, parse } from '@ai/agent-contracts';
import { McpError } from '../dist/mcp/errors.js';
import { oauthFlowFetch, type ServiceHeaders } from '../dist/mcp/oauth-fetch.js';
import { shownError } from '../dist/mcp/oauth-signin.js';
import { approveAuthorization } from './mcp-http-kit.ts';
import { oauthApi } from './mcp-oauth-kit.ts';
import { startOAuthMock, type MockRequest, type OAuthMock } from './mcp-oauth-mock.ts';
import { at, httpRecord, waitFor } from './mcp-kit.ts';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * The HTTP layer of OAuth flows. The server's own headers go to its origin and to no other, the
 * OAuth library's headers win, a redirect never carries them, and a failure never quotes them; a
 * request that failed at the network is remembered, and error text never quotes the URL's
 * environment values. First on the fetch itself, then through sign-ins against loopback servers.
 */

const MISSING = 'Missing environment credential in OAuth HTTP headers';
const noHeaders: ServiceHeaders = { serverId: 'srv', resolve: async () => ({}) };

/** A `fetch` that records what it was called with. */
function recorder() {
  const calls: { url: string; init: RequestInit }[] = [];
  const base: McpFetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response('{}');
  };
  return { calls, base };
}
const headersOf = (call: { init: RequestInit }) => new Headers(call.init.headers);

test("the server headers go to its origin and to no other; the library's headers win", async () => {
  const { calls, base } = recorder();
  let resolved = 0;
  const service: ServiceHeaders = {
    serverId: 'srv',
    resolve: async () => ((resolved += 1), { 'X-Tenant': 'acme', Authorization: 'Bearer service' }),
  };
  const { fetch } = oauthFlowFetch({ serverUrl: 'https://mcp.example/mcp', service, base });
  await fetch('https://auth.other/token');
  assert.equal(resolved, 0, 'nothing is resolved for a request that would not carry it');
  await fetch('https://mcp.example/.well-known/oauth-protected-resource', {
    headers: { Authorization: 'Bearer library' },
  });
  await fetch('https://mcp.example/register');
  const [other, discovery, register] = [at(calls, 0), at(calls, 1), at(calls, 2)];
  assert.equal(headersOf(other).get('x-tenant'), null);
  assert.equal(other.init.redirect, undefined);
  assert.equal(headersOf(discovery).get('x-tenant'), 'acme');
  assert.equal(headersOf(discovery).get('authorization'), 'Bearer library', 'the library wins');
  assert.equal(headersOf(register).get('authorization'), 'Bearer service');
  assert.equal(discovery.init.redirect, 'error', 'a redirect could take the headers elsewhere');
  assert.equal(resolved, 1, 'resolved once for the flow');
});

test('a request with the headers fails without quoting why; resolution failures are two fixed words', async () => {
  const cause = new Error('connect ECONNREFUSED with X-Tenant: secret-tenant');
  const throwing: McpFetch = async (input) => {
    if (String(input).startsWith('https://mcp.example')) throw cause;
    throw new Error('the authorization server is down');
  };
  const service: ServiceHeaders = {
    serverId: 'srv',
    resolve: async () => ({ 'X-Tenant': 'secret-tenant' }),
  };
  const flow = oauthFlowFetch({ serverUrl: 'https://mcp.example/mcp', service, base: throwing });
  await assert.rejects(flow.fetch('https://mcp.example/x'), (error) => {
    assert.ok(error instanceof TypeError);
    assert.equal(error.message, 'OAuth HTTP request failed');
    assert.notEqual(error, cause);
    return true;
  });
  assert.throws(() => flow.check(), { message: 'OAuth HTTP request failed' });
  await assert.rejects(flow.fetch('https://auth.other/x'), {
    message: 'the authorization server is down',
  });

  const failing = (error: Error): ServiceHeaders => ({
    serverId: 'srv',
    resolve: () => Promise.reject(error),
  });
  const known = new McpError('internal', 'srv', MISSING);
  const first = oauthFlowFetch({
    serverUrl: 'https://mcp.example/mcp',
    service: failing(known),
    base: recorder().base,
  });
  await assert.rejects(first.fetch('https://mcp.example/x'), { message: MISSING });
  assert.throws(() => first.check(), { message: MISSING });
  const unknown = failing(new Error('the value is hunter2'));
  const second = oauthFlowFetch({
    serverUrl: 'https://mcp.example/mcp',
    service: unknown,
    base: recorder().base,
  });
  await assert.rejects(second.fetch('https://mcp.example/x'), {
    message: 'Failed to resolve OAuth HTTP headers',
  });
});

test('every OAuth request is bounded, and the caller can still cancel it', async () => {
  const { calls, base } = recorder();
  const caller = new AbortController();
  const { fetch } = oauthFlowFetch({
    serverUrl: 'https://mcp.example/mcp',
    service: noHeaders,
    base,
  });
  await fetch('https://mcp.example/x', { signal: caller.signal });
  const signal = at(calls).init.signal;
  assert.ok(signal && !signal.aborted);
  caller.abort();
  assert.equal(signal.aborted, true);
});

test('a request that failed at the network is remembered; one its caller cancelled did not fail', async () => {
  const flowOf = (base: McpFetch, service = noHeaders, signal?: AbortSignal) =>
    oauthFlowFetch({
      serverUrl: 'https://mcp.example/mcp',
      service,
      base,
      ...(signal ? { signal } : {}),
    });
  const down = new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND auth') });
  const timedOut = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  for (const failure of [down, timedOut]) {
    const flow = flowOf(() => Promise.reject(failure));
    await assert.rejects(flow.fetch('https://auth.other/token'), (error) => error === failure);
    assert.equal(flow.unreachable(), failure, 'DNS, TCP, TLS and the time limit alike');
    assert.doesNotThrow(() => flow.check(), 'a sign-in reads only what carried the headers');
  }

  const hanging: McpFetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
  for (const canceller of ['pi-mcp', 'the flow']) {
    const controller = new AbortController();
    const own = canceller === 'the flow' ? controller.signal : undefined;
    const flow = flowOf(hanging, noHeaders, own);
    const request = canceller === 'pi-mcp' ? { signal: controller.signal } : {};
    const pending = flow.fetch('https://auth.other/token', request);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(flow.unreachable(), undefined, `${canceller} cancelled it: no failure`);
  }

  // A request that carried the headers keeps only the fixed words, a timeout included: the cause
  // could quote a header.
  const tenant: ServiceHeaders = { serverId: 'srv', resolve: async () => ({ 'X-Tenant': 'acme' }) };
  const flow = flowOf(() => Promise.reject(timedOut), tenant);
  await assert.rejects(flow.fetch('https://mcp.example/x'), {
    message: 'OAuth HTTP request failed',
  });
  assert.throws(() => flow.check(), { message: 'OAuth HTTP request failed' });
  assert.equal(flow.unreachable(), undefined);
});

const keyring = installMemoryKeyring();
let harness: Awaited<ReturnType<typeof startTestService>>;
let mock: OAuthMock;
let authorizationMock: OAuthMock;
let splitMock: OAuthMock;
let foreignMock: OAuthMock;
const oauth = oauthApi(
  () => harness,
  keyring,
  () => mock.url,
);

before(async () => {
  harness = await startTestService();
  mock = await startOAuthMock();
  authorizationMock = await startOAuthMock();
  splitMock = await startOAuthMock({ trustedIssuer: authorizationMock });
  // Its resource metadata names another resource, which pi-mcp refuses by quoting the server URL.
  foreignMock = await startOAuthMock({ resource: 'https://resource.other.example/mcp' });
});
after(async () => {
  await harness.stop();
  await Promise.all([mock, splitMock, authorizationMock, foreignMock].map((each) => each.close()));
});

/** What the service asked an OAuth server, apart from the browser's visit and the MCP traffic. */
const flowRequests = (requests: MockRequest[]) =>
  requests.filter((request) => !/^\/(mcp|authorize)/.test(request.target));

test('a sign-in and a refresh send the headers to the server, wherever the flow goes', async () => {
  const { put, post, signIn, row } = oauth();
  await put('h-same', { headers: { 'X-Tenant': 'acme' } });
  await signIn('h-same');
  mock.expireAccessTokens();
  await post('/v1/mcp/connect', 'h-same');
  const seen = flowRequests(mock.requests).map((r) => r.target.split('?')[0]);
  for (const path of ['/.well-known/oauth-authorization-server', '/register', '/token']) {
    assert.ok(seen.includes(path), `${path} was asked`);
  }
  assert.ok(seen.some((path) => path?.startsWith('/.well-known/oauth-protected-resource')));
  for (const request of flowRequests(mock.requests)) {
    assert.equal(request.headers['x-tenant'], 'acme', request.target);
  }
  assert.equal((await row('h-same')).state, 'ready');
});

test("with the authorization server elsewhere, only the MCP server's origin gets them", async () => {
  const { put, post, row } = oauth();
  await put('h-split', { url: splitMock.url, headers: { 'X-Tenant': 'acme' } });
  const started = await post('/v1/mcp/auth/start', 'h-split');
  const url = (started.json as { authorizationUrl: string }).authorizationUrl;
  assert.ok(
    url.startsWith(`${authorizationMock.base}/authorize?`),
    'the sign-in is at the other origin',
  );
  await approveAuthorization(url, { visit: true });
  await waitFor(async () => (await row('h-split')).state === 'disconnected');
  assert.equal((await post('/v1/mcp/connect', 'h-split')).status, 200);

  const atServer = flowRequests(splitMock.requests);
  assert.ok(atServer.length > 0 && atServer.every((r) => r.headers['x-tenant'] === 'acme'));
  const atAuthorization = flowRequests(authorizationMock.requests);
  assert.ok(atAuthorization.some((r) => r.target === '/token'));
  for (const request of atAuthorization)
    assert.equal(request.headers['x-tenant'], undefined, request.target);
  authorizationMock.expireAccessTokens();
  assert.equal((await post('/v1/mcp/tools/list', 'h-split')).status, 200);
  const refresh = flowRequests(authorizationMock.requests).at(-1);
  assert.equal(refresh?.target, '/token');
  assert.equal(refresh?.headers['x-tenant'], undefined);
});

test('a header that reads the environment needs approval first, and is never quoted', async () => {
  const { api, put, post } = oauth();
  await put('h-env', { headers: { 'X-Tenant': '${AI_TEST_OAUTH_TENANT}' } });
  const before = mock.requests.length;
  const refused = await post('/v1/mcp/auth/start', 'h-env');
  assert.equal(refused.status, 403);
  assert.match(refused.text, /approval_required/);
  assert.equal(mock.requests.length, before, 'nothing was sent before the approval');

  await api.approveNow('h-env');
  delete process.env.AI_TEST_OAUTH_TENANT;
  const missing = await post('/v1/mcp/auth/start', 'h-env');
  assert.equal(missing.status, 500);
  assert.match(missing.text, new RegExp(MISSING));
  process.env.AI_TEST_OAUTH_TENANT = 'tenant-from-env';
  try {
    assert.equal((await post('/v1/mcp/auth/start', 'h-env')).status, 200);
    const sent = flowRequests(mock.requests.slice(before));
    assert.ok(sent.length > 0 && sent.every((r) => r.headers['x-tenant'] === 'tenant-from-env'));
  } finally {
    delete process.env.AI_TEST_OAUTH_TENANT;
  }
});

const SECRET = 'key-from-env-4711';

test('error text shows the URL as configured, and the error keeps its class', () => {
  process.env.AI_TEST_OAUTH_URL_KEY = SECRET;
  try {
    const record = httpRecord(
      'quoted',
      {},
      { url: 'https://mcp.example/mcp?key=$env:AI_TEST_OAUTH_URL_KEY' },
    );
    const text = `Protected resource https://x.example/mcp does not match MCP server https://mcp.example/mcp?key=${SECRET}`;
    for (const error of [
      new Error(text),
      new TypeError(text),
      new McpError('conflict', 'q', text),
    ]) {
      const shown = shownError(error, record);
      assert.equal(shown, error, 'the same error, so its class and its HTTP status stay');
      assert.equal(shown.message.endsWith('?key=$env:AI_TEST_OAUTH_URL_KEY'), true, shown.message);
      assert.ok(!(shown.stack ?? '').includes(SECRET));
    }
    assert.equal(shownError('boom', record).message, 'The operation could not be completed.');
  } finally {
    delete process.env.AI_TEST_OAUTH_URL_KEY;
  }
});

test('a sign-in that fails quoting the server URL shows it as configured', async () => {
  const { api, put, post, row } = oauth();
  process.env.AI_TEST_OAUTH_URL_KEY = SECRET;
  try {
    await put('u-env', { url: `${foreignMock.url}?key=$env:AI_TEST_OAUTH_URL_KEY` });
    await api.approveNow('u-env');
    const started = await post('/v1/mcp/auth/start', 'u-env');
    assert.equal(started.status, 500, 'a library error is an internal error');
    const { code, message } = parse(ErrorEnvelopeSchema, started.json).error;
    assert.equal(code, 'internal');
    const { state, lastError } = await row('u-env');
    assert.equal(state, 'error');
    assert.equal(message, lastError, 'the response says what the row says');
    assert.match(lastError, /does not match MCP server .*\?key=\$env:AI_TEST_OAUTH_URL_KEY$/);
    assert.ok(!started.text.includes(SECRET), 'the response quotes no environment value');
  } finally {
    delete process.env.AI_TEST_OAUTH_URL_KEY;
  }
});

test('a sign-in start that cannot reach the server answers 500, whether or not it sent headers', async () => {
  const down = await startOAuthMock();
  const { put, post, row } = oauth();
  await put('n-down', { url: down.url });
  await put('h-down', { url: down.url, headers: { 'X-Tenant': 'acme' } });
  await down.close();
  // Both fail with a TypeError: undici's own, and the fixed words of a request that had headers.
  for (const serverId of ['n-down', 'h-down']) {
    const started = await post('/v1/mcp/auth/start', serverId);
    assert.equal(started.status, 500, `${serverId}: ${started.text}`);
    const { code, message } = parse(ErrorEnvelopeSchema, started.json).error;
    assert.equal(code, 'internal', serverId);
    assert.notEqual(message, '');
    assert.equal((await row(serverId)).lastError, message);
    if (serverId === 'h-down') assert.equal(message, 'OAuth HTTP request failed');
  }
});

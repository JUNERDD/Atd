import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import {
  McpAuthRequiredError,
  McpClient,
  McpConnectionClosedError,
  McpHttpError,
  type AuthProvider,
  type UnauthorizedContext,
} from '@earendil-works/pi-mcp';
import { LegacySseTransport } from '../dist/mcp/legacy-sse.js';
import { createTransport } from '../dist/mcp/transports.js';
import { waitFor } from './mcp-fake-server.ts';
import { at, httpRecord, kitFor } from './mcp-kit.ts';
import { startSseServer, type SseServerOptions } from './mcp-sse-server.ts';

/**
 * The legacy HTTP+SSE transport against a local event-stream server: the endpoint event, requests
 * POSTed to it and answered on the stream, a 401 handed to the auth provider once, and a stream that
 * drops.
 */

async function serve(t: TestContext, options?: SseServerOptions) {
  const server = await startSseServer(options);
  t.after(() => server.close());
  return server;
}

const client = () =>
  new McpClient({ name: 'pi-mcp-sse', version: '1.0.0', requestTimeoutMs: 5_000 });

test('a client connects, lists and calls over the stream and its endpoint', async (t) => {
  const server = await serve(t);
  const headers = { 'X-Team': 'blue' };
  const mcp = client();
  t.after(() => mcp.close());
  await mcp.connect(new LegacySseTransport({ url: server.url, headers }));
  assert.equal(mcp.protocolVersion, '2024-11-05');
  assert.deepEqual(
    (await mcp.listTools()).map((tool) => tool.name),
    ['echo'],
  );
  assert.deepEqual((await mcp.callTool('echo', { text: 'over sse' })).content, [
    { type: 'text', text: 'over sse' },
  ]);
  assert.deepEqual(server.received, [
    'initialize',
    'notifications/initialized',
    'tools/list',
    'tools/call',
  ]);

  const [stream, ...posts] = server.requests;
  assert.ok(stream);
  assert.equal(stream.method, 'GET');
  assert.equal(stream.headers.accept, 'text/event-stream');
  assert.ok(
    posts.every((post) => post.method === 'POST' && post.target.startsWith('/messages?sessionId=')),
  );
  for (const request of server.requests)
    assert.equal(request.headers['x-team'], 'blue', 'configured headers ride every request');
  const afterInit = posts.at(-1);
  assert.equal(afterInit?.headers['mcp-protocol-version'], '2024-11-05');
});

test('the token goes out as a bearer header on the stream and on every POST', async (t) => {
  const server = await serve(t, { token: 'tok-1' });
  const mcp = client();
  t.after(() => mcp.close());
  const authProvider: AuthProvider = { token: async () => 'tok-1' };
  await mcp.connect(
    new LegacySseTransport({
      url: server.url,
      headers: { Authorization: 'Bearer configured' },
      authProvider,
    }),
  );
  await mcp.ping();
  assert.ok(server.requests.length >= 3);
  for (const request of server.requests)
    assert.equal(request.headers.authorization, 'Bearer tok-1');
});

test('a 401 is handed to the auth provider once, then the request goes again', async (t) => {
  const server = await serve(t, { token: 'fresh' });
  let current = 'stale';
  const seen: UnauthorizedContext[] = [];
  const authProvider: AuthProvider = {
    token: async () => current,
    onUnauthorized: async (context) => {
      seen.push(context);
      current = 'fresh';
    },
  };
  const mcp = client();
  t.after(() => mcp.close());
  await mcp.connect(new LegacySseTransport({ url: server.url, headers: {}, authProvider }));
  assert.equal(seen.length, 1, 'once');
  assert.equal(at(seen).response.status, 401);
  assert.equal(at(seen).token, 'stale', 'the provider learns which token was refused');
  assert.equal(at(seen).serverUrl.href, server.url);
  assert.deepEqual(
    server.requests.slice(0, 2).map((r) => r.headers.authorization),
    ['Bearer stale', 'Bearer fresh'],
  );

  // A token that stops working mid-session is handled the same way for the POSTs.
  server.setToken('rotated');
  current = 'stale';
  authProvider.onUnauthorized = async (context) => {
    seen.push(context);
    current = 'rotated';
  };
  assert.deepEqual((await mcp.listTools()).length, 1);
  assert.equal(seen.length, 2);
});

test('a 401 the provider cannot cure fails as an authentication error, after one try', async (t) => {
  const server = await serve(t, { token: 'never-given' });
  let asked = 0;
  const authProvider: AuthProvider = {
    token: async () => 'wrong',
    onUnauthorized: async () => void (asked += 1),
  };
  const mcp = client();
  await assert.rejects(
    mcp.connect(new LegacySseTransport({ url: server.url, headers: {}, authProvider })),
    (error) => {
      assert.ok(error instanceof McpAuthRequiredError && error.status === 401);
      assert.equal(error.wwwAuthenticate, 'Bearer realm="sse"');
      return true;
    },
  );
  assert.equal(asked, 1);
  assert.equal(server.requests.length, 2, 'the stream was asked for twice, not more');
});

test('a server that names an endpoint elsewhere, or none, or is no event stream, fails the connect', async (t) => {
  const elsewhere = await serve(t, { endpoint: 'http://127.0.0.1:1/messages' });
  await assert.rejects(
    client().connect(new LegacySseTransport({ url: elsewhere.url, headers: {} })),
    /another origin/,
  );
  const silent = await serve(t, { mode: 'silent' });
  await assert.rejects(
    client().connect(
      new LegacySseTransport({ url: silent.url, headers: {}, endpointTimeoutMs: 60 }),
    ),
    /did not announce its endpoint within 60 ms/,
  );
  const broken = await serve(t, { mode: 'error' });
  await assert.rejects(
    client().connect(new LegacySseTransport({ url: broken.url, headers: {} })),
    (error) => {
      return error instanceof McpHttpError && error.status === 500;
    },
  );
  const page = await serve(t, { mode: 'html' });
  await assert.rejects(
    client().connect(new LegacySseTransport({ url: page.url, headers: {} })),
    /content type: text\/html/,
  );
});

test('a stream that ends closes the connection and fails what waits on it', async (t) => {
  const server = await serve(t);
  const mcp = client();
  await mcp.connect(new LegacySseTransport({ url: server.url, headers: {} }));
  const closed = new Promise<void>((resolve) => mcp.onClose(resolve));
  server.dropStreams();
  await closed;
  await assert.rejects(mcp.listTools(), McpConnectionClosedError);
});

test('a legacy SSE record connects through the service transport with its bearer token', async (t) => {
  const server = await serve(t, { token: 'sse-token' });
  const record = httpRecord(
    'legacy',
    {},
    { transport: 'sse', url: server.url, auth: { type: 'bearer', tokenEnv: '' } },
  );
  const { connections, states } = kitFor(t, [{ ...record, transport: 'sse' }], {
    transports: createTransport,
    bearerToken: 'sse-token',
  });
  await connections.connect('legacy');
  assert.equal(states.get('legacy'), 'ready');
  assert.deepEqual(connections.counts('legacy'), { tools: 1, resources: 0, prompts: 0 });
  await waitFor(() => server.received.includes('tools/list'));
  for (const request of server.requests)
    assert.equal(request.headers.authorization, 'Bearer sse-token');
});

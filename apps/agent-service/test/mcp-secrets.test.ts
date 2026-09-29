import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import {
  ErrorEnvelopeSchema,
  McpServersResponseSchema,
  parse,
  type McpServerConfig,
  type McpServerUpsertRequest,
} from '@ai/agent-contracts';
import { configureMcp } from '../dist/configure-mcp-tool.js';
import { serversFile } from '../dist/mcp/servers.js';
import { upsertRecord } from '../dist/mcp/server-edits.js';
import { startTestService } from './service-harness.ts';

/**
 * The security invariants of MCP env and header values: they are stored for connecting, never
 * read back by a client or the model, and never sent to a new destination.
 */

const ENV_SECRET = 'sentinel-env-5f1c9a';
const HEADER_SECRET = 'sentinel-header-8b2e4d';

let harness: Awaited<ReturnType<typeof startTestService>>;
const bodies: string[] = [];

before(async () => {
  harness = await startTestService();
});
after(() => harness.stop());

/** Calls the service and records every response body for the leak check. */
async function send(pathname: string, method: string, body?: unknown) {
  const response = await harness.call(pathname, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  bodies.push(text);
  return { status: response.status, json: JSON.parse(text) as unknown };
}

const put = (serverId: string, request: McpServerUpsertRequest) =>
  send(`/v1/mcp/servers/${serverId}`, 'PUT', request);

async function stored(serverId: string): Promise<McpServerConfig> {
  const file = JSON.parse(await readFile(serversFile(harness.config.paths.root), 'utf8')) as {
    servers: McpServerConfig[];
  };
  const record = file.servers.find((server) => server.serverId === serverId);
  assert.ok(record, `${serverId} is stored`);
  return record;
}

function errorCode(json: unknown): string {
  return parse(ErrorEnvelopeSchema, json).error.code;
}

const stdio = (env?: McpServerUpsertRequest['env']): McpServerUpsertRequest => ({
  transport: 'stdio',
  command: '/bin/echo',
  args: [],
  auth: { type: 'none' },
  ...(env ? { env } : {}),
});

const http = (
  url: string,
  headers?: McpServerUpsertRequest['headers'],
): McpServerUpsertRequest => ({
  transport: 'streamable-http',
  url,
  auth: { type: 'none' },
  ...(headers ? { headers } : {}),
});

test('reads and edits show env and header names, never their values', async () => {
  assert.equal((await put('local', stdio({ API_KEY: ENV_SECRET }))).status, 200);
  assert.equal(
    (await put('remote', http('https://a.example/mcp', { Authorization: HEADER_SECRET }))).status,
    200,
  );
  assert.equal((await put('spare', stdio({ TOKEN: ENV_SECRET }))).status, 200);
  const list = await send('/v1/mcp/servers', 'GET');
  assert.equal(list.status, 200);
  const views = parse(McpServersResponseSchema, list.json).servers;
  assert.deepEqual(views.find((view) => view.serverId === 'local')?.stdio?.env, {
    API_KEY: { set: true },
  });
  assert.deepEqual(views.find((view) => view.serverId === 'remote')?.http?.headers, {
    Authorization: { set: true },
  });
  assert.equal(
    (await send('/v1/mcp/servers/local/enabled', 'POST', { enabled: false })).status,
    200,
  );
  assert.equal((await send('/v1/mcp/servers/spare', 'DELETE')).status, 200);
  for (const text of bodies) {
    assert.ok(!text.includes(ENV_SECRET), 'no response carries an env value');
    assert.ok(!text.includes(HEADER_SECRET), 'no response carries a header value');
  }
  assert.equal((await stored('local')).stdio?.env.API_KEY, ENV_SECRET, 'the value is stored');
  assert.equal((await stored('remote')).http?.headers.Authorization, HEADER_SECRET);
});

test('env and headers keep, clear and rename by name on disk', async () => {
  await put('edit', stdio({ KEEP: 'k-value', DROP: 'd-value', OLD: 'o-value' }));
  await put('edit', { ...stdio(), args: ['--v2'] });
  assert.deepEqual((await stored('edit')).stdio?.env, {
    KEEP: 'k-value',
    DROP: 'd-value',
    OLD: 'o-value',
  });
  const renamed = await put('edit', stdio({ KEEP: { keep: true }, NEW: 'n-value' }));
  assert.equal(renamed.status, 200);
  assert.deepEqual((await stored('edit')).stdio?.env, { KEEP: 'k-value', NEW: 'n-value' });

  const missing = await put('edit', stdio({ OLD: { keep: true } }));
  assert.equal(missing.status, 400, 'keep names only a stored entry');
  assert.equal(errorCode(missing.json), 'bad_request');

  await put('web', http('https://b.example/mcp', { 'X-Key': 'x-value', 'X-Old': 'old' }));
  await put('web', http('https://b.example/other', { 'X-Key': { keep: true } }));
  assert.deepEqual((await stored('web')).http?.headers, { 'X-Key': 'x-value' });
});

test('kept secrets never move to another origin or command', async () => {
  await put('moving', http('https://c.example/mcp', { Authorization: 'c-value' }));
  const explicit = await put(
    'moving',
    http('https://evil.example/mcp', { Authorization: { keep: true } }),
  );
  assert.equal(explicit.status, 400);
  assert.equal((await put('moving', http('https://evil.example/mcp'))).status, 400, 'implicit');
  const fresh = await put('moving', http('https://evil.example/mcp', { Authorization: 'new' }));
  assert.equal(fresh.status, 200, 'new values may go anywhere');

  await put('bearer', {
    ...http('https://d.example/mcp'),
    auth: { type: 'bearer', tokenEnv: 'T' },
  });
  const bearer = await put('bearer', {
    ...http('https://evil.example/mcp'),
    auth: { type: 'bearer', tokenEnv: 'T' },
  });
  assert.equal(bearer.status, 400, 'a bearer credential stays with its origin');

  await put('runner', stdio({ SECRET: 'r-value' }));
  const command = await put('runner', {
    ...stdio({ SECRET: { keep: true } }),
    command: '/bin/cat',
  });
  assert.equal(command.status, 400);
  assert.equal(errorCode(command.json), 'bad_request');
  assert.equal((await stored('runner')).stdio?.command, '/bin/echo', 'nothing was saved');
});

test('configure_mcp answers a status without env or header values', async () => {
  const previous = upsertRecord('tool', stdio({ API_KEY: ENV_SECRET }), undefined);
  const result = await configureMcp(
    {
      upsertMcp: async (serverId, request) => upsertRecord(serverId, request, previous),
      audit: () => undefined,
      taskId: 'task',
      runId: () => 'run',
    },
    { serverId: 'tool', transport: 'stdio', command: '/bin/echo', auth: { type: 'none' } },
  );
  const text = result.content.map((block) => block.text).join('\n');
  assert.ok(!text.includes(ENV_SECRET));
  assert.deepEqual(JSON.parse(text), { serverId: 'tool', revision: 1, disabled: false });
});

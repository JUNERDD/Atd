import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  ErrorEnvelopeSchema,
  McpServersResponseSchema,
  parse,
  PluginDetailSchema,
  PluginInstallPreviewSchema,
  PluginDuplicateResponseSchema,
  type McpHttpAuth,
  type McpOAuthClientDraft,
  type McpServerConfig,
  type McpServerUpsertRequest,
} from '@ai/agent-contracts';
import { configureMcp } from '../dist/configure-mcp-tool.js';
import { serversFile } from '../dist/mcp/servers.js';
import { upsertRecord } from '../dist/mcp/server-edits.js';
import {
  clientSecretAccount,
  secretAccount,
  type StoredAuth,
  type StoredServer,
} from '../dist/mcp/server-file.js';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * The security invariants of MCP env and header values: they are stored in the keyring for
 * connecting, never read back by a client or the model, never sent to a new destination, and
 * never copied out of a plugin into plain text.
 */

const ENV_SECRET = 'sentinel-env-5f1c9a';
const HEADER_SECRET = 'sentinel-header-8b2e4d';
const PLUGIN_SECRET = 'sentinel-plugin-3a7f0e';
const CLIENT_SECRET = 'sentinel-client-6d9b21';

let harness: Awaited<ReturnType<typeof startTestService>>;
const bodies: string[] = [];
const keyring = installMemoryKeyring();

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

/** A saved server with its values read back from the keyring, which holds every one of them. */
async function stored(serverId: string): Promise<McpServerConfig> {
  const file = JSON.parse(await readFile(serversFile(harness.config.paths.root), 'utf8')) as {
    servers: StoredServer[];
  };
  const record = file.servers.find((server) => server.serverId === serverId);
  assert.ok(record, `${serverId} is stored`);
  const { serviceId } = harness.config;
  const held = keyring.accounts(serviceId);
  const values = (kind: 'env' | 'header', saved: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(saved).map(([name, value]) => {
        assert.deepEqual(value, { keyring: true }, `${name} is held by the keyring`);
        const secret = held.get(secretAccount(serviceId, record, kind, name));
        assert.ok(secret !== undefined, `${name} has a keyring value`);
        return [name, secret];
      }),
    );
  const auth = (saved: StoredAuth): McpHttpAuth => {
    if (saved.type !== 'oauth') return saved;
    const { clientSecret, ...rest } = saved;
    if (clientSecret === undefined) return rest;
    assert.deepEqual(clientSecret, { keyring: true }, 'the client secret is held by the keyring');
    const secret = held.get(clientSecretAccount(serviceId, record));
    assert.ok(secret !== undefined, 'the client secret has a keyring value');
    return { ...rest, clientSecret: secret };
  };
  return {
    ...record,
    exposure: record.exposure ?? 'auto',
    stdio: record.stdio && { ...record.stdio, env: values('env', record.stdio.env) },
    http: record.http && {
      ...record.http,
      headers: values('header', record.http.headers),
      auth: auth(record.http.auth),
    },
  };
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
  const file = await readFile(serversFile(harness.config.paths.root), 'utf8');
  assert.ok(!file.includes(ENV_SECRET), 'servers.json holds no env value');
  assert.ok(!file.includes(HEADER_SECRET), 'servers.json holds no header value');
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

test('an OAuth client secret is held by the keyring, read as set, and stays with its client', async () => {
  const metadata = 'https://as.example/.well-known/oauth-authorization-server';
  const oauth = (url: string, client?: McpOAuthClientDraft): McpServerUpsertRequest => ({
    ...http(url),
    auth: { type: 'oauth', ...(client ? { client } : {}) },
  });
  const client = { clientId: 'app', clientSecret: CLIENT_SECRET, authServerMetadataUrl: metadata };
  const first = await put('signin', {
    ...oauth('https://e.example/mcp', client),
    exposure: 'deferred',
    exposeResources: true,
  });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const views = parse(McpServersResponseSchema, (await send('/v1/mcp/servers', 'GET')).json);
  const view = views.servers.find((server) => server.serverId === 'signin');
  assert.deepEqual(view?.http?.auth, {
    type: 'oauth',
    scope: null,
    redirectUri: null,
    clientId: 'app',
    authServerMetadataUrl: metadata,
    clientSecret: { set: true },
  });
  assert.deepEqual([view?.exposure, view?.exposeResources], ['deferred', true]);
  const secretOf = async () => {
    const auth = (await stored('signin')).http?.auth;
    return auth?.type === 'oauth' ? auth.clientSecret : undefined;
  };
  assert.equal(await secretOf(), CLIENT_SECRET);
  // Without a client the edit keeps it, and the exposure settings too.
  assert.equal((await put('signin', oauth('https://e.example/v2'))).status, 200);
  assert.equal(await secretOf(), CLIENT_SECRET);
  assert.equal((await stored('signin')).exposure, 'deferred');
  const kept = { ...client, clientSecret: { keep: true as const } };
  assert.equal((await put('signin', oauth('https://e.example/v2', kept))).status, 200);
  assert.equal(await secretOf(), CLIENT_SECRET, 'kept by name');
  const other = await put('signin', oauth('https://e.example/v2', { ...kept, clientId: 'x' }));
  assert.equal(other.status, 400, 'a kept secret stays with its client id');
  assert.equal((await put('signin', oauth('https://evil.example/mcp'))).status, 400, 'origin');
  const plain = { authServerMetadataUrl: 'http://as.example/meta' };
  assert.equal((await put('signin', oauth('https://e.example/v2', plain))).status, 400, 'https');
  for (const text of bodies) assert.ok(!text.includes(CLIENT_SECRET), 'no response carries it');
  const file = await readFile(serversFile(harness.config.paths.root), 'utf8');
  assert.ok(!file.includes(CLIENT_SECRET), 'servers.json holds no client secret');
  // The model can neither set a client nor read the secret.
  const host = {
    upsertMcp: async () => assert.fail('a client draft never reaches the upsert'),
    audit: () => undefined,
    taskId: 'task',
    runId: () => 'run',
  };
  const draft = { serverId: 'signin', transport: 'streamable-http', url: 'https://e.example/v2' };
  await assert.rejects(configureMcp(host, { ...draft, auth: { type: 'oauth', client } }));
});

test('configure_mcp answers the saved settings with env names but not their values', async () => {
  const previous = upsertRecord('tool', stdio({ API_KEY: ENV_SECRET }), undefined);
  const result = await configureMcp(
    {
      upsertMcp: async (serverId, request) => ({
        record: upsertRecord(serverId, request, previous),
        approval: 'required',
      }),
      audit: () => undefined,
      taskId: 'task',
      runId: () => 'run',
    },
    { serverId: 'tool', transport: 'stdio', command: '/bin/echo', auth: { type: 'none' } },
  );
  const text = result.content.map((block) => block.text).join('\n');
  assert.ok(!text.includes(ENV_SECRET));
  assert.deepEqual(JSON.parse(result.content[0]?.text ?? ''), {
    serverId: 'tool',
    transport: 'stdio',
    command: '/bin/echo',
    args: [],
    envNames: ['API_KEY'],
    revision: 1,
    disabled: false,
    approval: 'required',
  });
});

test('a plugin duplicate leaves env-sourced header values out of servers.json', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'mcp-secret-plugin-'));
  try {
    process.env.AI_TEST_MCP_TOKEN = PLUGIN_SECRET;
    await mkdir(path.join(folder, '.claude-plugin'));
    await writeFile(
      path.join(folder, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'secret-fixture', version: '1.0.0', description: 'Fixture' }),
    );
    await writeFile(
      path.join(folder, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          remote: {
            type: 'http',
            url: 'https://plugin.example/mcp',
            headers: { Authorization: 'Bearer ${AI_TEST_MCP_TOKEN}', 'X-Plain': 'plain' },
          },
        },
      }),
    );
    const preview = await send('/v1/plugins/preview', 'POST', {
      source: { kind: 'local', path: folder },
    });
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    const { previewId } = parse(PluginInstallPreviewSchema, preview.json);
    const installed = await send('/v1/plugins/install', 'POST', { previewId });
    assert.equal(installed.status, 200, JSON.stringify(installed.json));
    const { id } = parse(PluginDetailSchema, installed.json).plugin;
    const copy = await send(
      `/v1/plugins/${encodeURIComponent(id)}/items/mcp/remote/duplicate`,
      'POST',
    );
    assert.equal(copy.status, 200, JSON.stringify(copy.json));
    const result = parse(PluginDuplicateResponseSchema, copy.json);
    assert.deepEqual(result.omitted, ['Authorization']);
    const saved = await stored(result.name);
    assert.deepEqual(saved.http?.headers, { 'X-Plain': 'plain' });
    const file = await readFile(serversFile(harness.config.paths.root), 'utf8');
    assert.ok(!file.includes(PLUGIN_SECRET), 'servers.json holds no plugin secret');
  } finally {
    delete process.env.AI_TEST_MCP_TOKEN;
    await rm(folder, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import {
  parse,
  PluginDetailSchema,
  PluginInstallPreviewSchema,
  type McpServerUpsertRequest,
} from '@ai/agent-contracts';
import { client, errorCode } from './launch-helpers.ts';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * HTTP servers that name a service env var in their URL or headers (the service fills those in
 * from its own environment when it dials) need the user's approval like an env-sourced bearer:
 * nothing is dialed before it, the details never show a value, and any change to the URL or a
 * header voids it. Plugin HTTP servers count when their `${VAR}` comes from the environment.
 */

const SECRET_VAR = 'AI_TEST_HTTP_ENV_SECRET';
const SECRET = 'http-env-sentinel-7d2e';
installMemoryKeyring();
const temporary: string[] = [];
let harness: Awaited<ReturnType<typeof startTestService>>;
let api: ReturnType<typeof client>;
let stub: Server;
let base = '';
/** What the stub listener received: the service's dials. */
let received: { url: string; headers: IncomingHttpHeaders }[] = [];

before(async () => {
  process.env[SECRET_VAR] = SECRET;
  harness = await startTestService();
  api = client(harness);
  stub = createServer((request, response) => {
    received.push({ url: request.url ?? '', headers: request.headers });
    // Not a transient failure (the service retries 5xx), so a dial ends at once.
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const address = stub.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await harness.stop();
  await new Promise((resolve) => stub.close(resolve));
  for (const dir of temporary) await rm(dir, { recursive: true, force: true });
  delete process.env[SECRET_VAR];
});
beforeEach(() => {
  received = [];
});

const put = async (serverId: string, url: string, headers: Record<string, string> = {}) => {
  const request: McpServerUpsertRequest = {
    transport: 'streamable-http',
    url,
    auth: { type: 'none' },
    headers,
  };
  const response = await api.send(`/v1/mcp/servers/${serverId}`, 'PUT', request);
  assert.equal(response.status, 200, response.text);
};

async function assertNotDialed(serverId: string) {
  assert.equal(await api.approvalOf(serverId), 'required');
  for (const pathname of ['/v1/mcp/connect', '/v1/mcp/refresh', '/v1/mcp/tools/list']) {
    const response = await api.send(pathname, 'POST', { serverId });
    assert.equal(response.status, 403, `${pathname}: ${response.text}`);
    assert.equal(errorCode(response.json), 'approval_required', pathname);
  }
  assert.deepEqual(received, [], `${serverId} was never dialed`);
}

test('each env reference syntax is refused until approved, then sends the value', async () => {
  const cases: [string, string, Record<string, string>][] = [
    ['env-brace', `${base}/mcp`, { Authorization: `Bearer \${${SECRET_VAR}}` }],
    ['env-colon', `${base}/mcp?key=$env:${SECRET_VAR}`, {}],
    ['env-curly', `${base}/mcp`, { 'X-Key': `{env:${SECRET_VAR}}` }],
  ];
  for (const [serverId, url, headers] of cases) {
    await put(serverId, url, headers);
    await assertNotDialed(serverId);
    const { details, text } = await api.details(serverId);
    assert.ok(!text.includes(SECRET), 'no env value in the details');
    assert.equal(details.kind, 'mcp-http-env');
    assert.equal(details.stdio, null);
    assert.deepEqual(details.http, {
      url,
      tokenEnv: '',
      headerKeys: Object.keys(headers),
      urlReadsEnv: Object.keys(headers).length === 0,
      headers: Object.keys(headers).map((key) => ({ key, readsEnv: true })),
      envReferences: [SECRET_VAR],
    });
    await api.approveNow(serverId);
    assert.equal(await api.approvalOf(serverId), 'approved');
    await api.send('/v1/mcp/connect', 'POST', { serverId });
    assert.ok(received.length > 0, `${serverId} was dialed once approved`);
    assert.ok(
      received.some((hit) => JSON.stringify(hit).includes(SECRET)),
      'the service filled in the env value',
    );
    received = [];
  }
});

test('an escaped leading "!" reaches the server as one literal "!" before the value', async () => {
  await put('env-bang', `${base}/mcp`, { 'X-Bang': `!!\${${SECRET_VAR}}` });
  await api.approveNow('env-bang');
  await api.send('/v1/mcp/connect', 'POST', { serverId: 'env-bang' });
  assert.equal(received[0]?.headers['x-bang'], `!${SECRET}`);
});

test('changing the URL query or a header template voids the approval', async () => {
  await put('env-edit', `${base}/mcp?team=a`, { Authorization: `Bearer \${${SECRET_VAR}}` });
  await api.approveNow('env-edit');
  await put('env-edit', `${base}/mcp?team=b`, { Authorization: `Bearer \${${SECRET_VAR}}` });
  assert.equal(await api.approvalOf('env-edit'), 'changed', 'query');
  await api.approveNow('env-edit');
  await put('env-edit', `${base}/mcp?team=b`, { Authorization: 'Bearer ${HOME}' });
  assert.equal(await api.approvalOf('env-edit'), 'changed', 'header variable');
  await api.approveNow('env-edit');
  await put('env-edit', `${base}/mcp?team=b`, { Authorization: 'Bearer $env:HOME' });
  assert.equal(await api.approvalOf('env-edit'), 'changed', 'header syntax');
  const refused = await api.send('/v1/mcp/connect', 'POST', { serverId: 'env-edit' });
  assert.equal(refused.status, 403, refused.text);
  assert.deepEqual(received, [], 'a changed server is not dialed');
});

test('plain HTTP and literal dollars need no approval', async () => {
  const literals = { 'X-Price': '$5', 'X-Name': '$HOME', 'X-Odd': '${not-a-name}' };
  await put('plain-dollar', `${base}/mcp?q=$USER&r={env}`, literals);
  assert.equal(await api.approvalOf('plain-dollar'), 'notRequired');
  const plain = await api.send('/v1/mcp/connect', 'POST', { serverId: 'plain-dollar' });
  assert.notEqual(plain.status, 403, plain.text);
  assert.ok(received.length > 0, 'dialed without approval');
  assert.equal(received[0]?.headers['x-price'], '$5', 'sent literally');
  assert.equal(received[0]?.headers['x-odd'], '${not-a-name}');
  const none = await api.send('/v1/admin/approvals/mcp/plain-dollar', 'GET');
  assert.equal(none.status, 400, 'a server that needs no approval has no details');
});

/** A local Claude-format plugin with one HTTP server per header set. */
async function httpPlugin(name: string, servers: Record<string, Record<string, string>>) {
  const folder = await mkdtemp(path.join(tmpdir(), 'launch-http-plugin-'));
  temporary.push(folder);
  await mkdir(path.join(folder, '.claude-plugin'));
  await writeFile(
    path.join(folder, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      description: 'Fixture',
      userConfig: { TEAM: { type: 'string', title: 'Team', default: 'blue' } },
    }),
  );
  const mcpServers = Object.fromEntries(
    Object.entries(servers).map(([server, headers]) => [
      server,
      { type: 'http', url: `${base}/mcp`, headers },
    ]),
  );
  await writeFile(path.join(folder, '.mcp.json'), JSON.stringify({ mcpServers }));
  const preview = await api.send('/v1/plugins/preview', 'POST', {
    source: { kind: 'local', path: folder },
  });
  assert.equal(preview.status, 200, preview.text);
  const { previewId } = parse(PluginInstallPreviewSchema, preview.json);
  const installed = await api.send('/v1/plugins/install', 'POST', { previewId });
  assert.equal(installed.status, 200, installed.text);
  const id = parse(PluginDetailSchema, installed.json).plugin.id;
  const enabled = await api.send(`/v1/plugins/${encodeURIComponent(id)}/enabled`, 'POST', {
    enabled: true,
  });
  assert.equal(enabled.status, 200, enabled.text);
  return id;
}

test('a plugin HTTP server needs approval for an env ${VAR}, not for user config', async () => {
  const id = await httpPlugin('http-env-kit', {
    envsrv: { Authorization: `Bearer \${${SECRET_VAR}}` },
    configsrv: { 'X-Team': '${user_config.TEAM}' },
  });
  const fromEnv = `${id}:envsrv`;
  await assertNotDialed(fromEnv);
  const { details, text } = await api.details(fromEnv);
  assert.ok(!text.includes(SECRET), 'no env value in the details');
  assert.equal(details.layer, 'plugin');
  assert.deepEqual(details.http?.headers, [{ key: 'Authorization', readsEnv: true }]);
  assert.deepEqual(details.http?.envReferences, [SECRET_VAR]);
  await api.approveNow(fromEnv);
  await api.send('/v1/mcp/connect', 'POST', { serverId: fromEnv });
  assert.ok(
    received.some((hit) => hit.headers.authorization === `Bearer ${SECRET}`),
    'the approved plugin server sends the env value',
  );

  received = [];
  const fromConfig = `${id}:configsrv`;
  assert.equal(await api.approvalOf(fromConfig), 'notRequired');
  const plain = await api.send('/v1/mcp/connect', 'POST', { serverId: fromConfig });
  assert.notEqual(plain.status, 403, plain.text);
  assert.equal(received[0]?.headers['x-team'], 'blue', 'user config is substituted as before');
});

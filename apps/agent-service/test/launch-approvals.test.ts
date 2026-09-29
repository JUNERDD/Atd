import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  McpLaunchApproveResponseSchema,
  parse,
  type McpServerUpsertRequest,
} from '@ai/agent-contracts';
import { approveMcp } from '../dist/cli-approve.js';
import { configureMcp } from '../dist/configure-mcp-tool.js';
import { LAUNCH_APPROVAL_KEY_ACCOUNT } from '../dist/credentials/keyring.js';
import { upsertRecord } from '../dist/mcp/server-edits.js';
import { client, errorCode, exists, launcher, spawnedWithin } from './launch-helpers.ts';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * Launch approvals for user servers: every launch path refuses an unapproved stdio or env-bearer
 * server without spawning or dialing, approval takes the shell-only routes with the current
 * fingerprint, and any change voids it. Plugin servers and migration: launch-plugins.test.ts.
 */

const ENV_SECRET = 'launch-sentinel-env-4c1b';
const keyring = installMemoryKeyring();
const temporary: string[] = [];
let harness: Awaited<ReturnType<typeof startTestService>>;
let api: ReturnType<typeof client>;
let hits = 0;
let dialed: Server;
let port = 0;

before(async () => {
  process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = 'memory';
  process.env.AI_TEST_LAUNCH_TOKEN = 'launch-token';
  harness = await startTestService();
  api = client(harness);
  dialed = createServer((_request, response) => {
    hits += 1;
    response.statusCode = 500;
    response.end();
  });
  await new Promise<void>((resolve) => dialed.listen(0, '127.0.0.1', resolve));
  const address = dialed.address();
  assert.ok(address && typeof address === 'object');
  port = address.port;
});
after(async () => {
  await harness.stop();
  await new Promise((resolve) => dialed.close(resolve));
  for (const dir of temporary) await rm(dir, { recursive: true, force: true });
  delete process.env.AI_TEST_LAUNCH_TOKEN;
});

const put = (serverId: string, request: McpServerUpsertRequest) =>
  api.send(`/v1/mcp/servers/${serverId}`, 'PUT', request);

const stdio = (command: string, args: string[], env?: McpServerUpsertRequest['env']) =>
  ({ transport: 'stdio', command, args, auth: { type: 'none' }, ...(env ? { env } : {}) }) as const;

/** Every route that reaches a connection; each would spawn a stdio server. */
const launchRoutes = (serverId: string): [string, unknown][] => [
  ['/v1/mcp/connect', { serverId }],
  ['/v1/mcp/reconnect', { serverId }],
  ['/v1/mcp/tools/list', { serverId }],
  ['/v1/mcp/tools/call', { serverId, tool: 'x', args: {} }],
  ['/v1/mcp/resources/list', { serverId }],
  ['/v1/mcp/resources/templates', { serverId }],
  ['/v1/mcp/resources/read', { serverId, uri: 'file:///x' }],
  ['/v1/mcp/prompts/list', { serverId }],
  ['/v1/mcp/prompts/get', { serverId, name: 'p' }],
];

async function assertRefused(pathname: string, body: unknown) {
  const response = await api.send(pathname, 'POST', body);
  assert.equal(response.status, 403, `${pathname}: ${response.text}`);
  assert.equal(errorCode(response.json), 'approval_required', pathname);
  assert.match(response.text, /approve it in Settings/, 'the refusal tells what to do');
}

test('an unapproved stdio server is refused on every launch path without spawning', async () => {
  const { command, marker } = await launcher(temporary);
  assert.equal((await put('local', stdio(command, ['a'], { API_KEY: ENV_SECRET }))).status, 200);
  assert.equal(await api.approvalOf('local'), 'required');
  for (const [pathname, body] of launchRoutes('local')) await assertRefused(pathname, body);
  assert.equal(await exists(marker), false, 'nothing was spawned');
  const row = (await api.status()).servers.find((server) => server.serverId === 'local');
  assert.equal(row?.state, 'approval_required');
});

test('details show what would run and never an env value', async () => {
  const { command } = await launcher(temporary);
  const env = { API_KEY: ENV_SECRET, PATH: '/usr/bin:/bin', DYLD_INSERT_LIBRARIES: '/x.dylib' };
  await put('shown', stdio(command, ['--flag', 'value'], env));
  const { details, text } = await api.details('shown');
  assert.ok(!text.includes(ENV_SECRET), 'no env value in the details');
  assert.equal(details.layer, 'user');
  assert.equal(details.kind, 'mcp-stdio');
  assert.equal(details.state, 'required');
  assert.equal(details.plugin, null);
  assert.equal(details.stdio?.resolvedCommand, command);
  assert.deepEqual(details.stdio?.args, ['--flag', 'value']);
  assert.equal(details.stdio?.cwd, path.resolve(harness.config.paths.root));
  assert.equal(details.stdio?.inheritEnv, false);
  const byKey = new Map(details.stdio?.env.map((entry) => [entry.key, entry]));
  assert.deepEqual(byKey.get('API_KEY'), {
    key: 'API_KEY',
    sensitive: true,
    length: ENV_SECRET.length,
    risky: false,
  });
  assert.equal(byKey.get('PATH')?.risky, true);
  assert.equal(byKey.get('DYLD_INSERT_LIBRARIES')?.risky, true);
  // The HMAC key lives in the keyring only.
  const key = keyring.accounts(harness.config.serviceId).get(LAUNCH_APPROVAL_KEY_ACCOUNT);
  assert.ok(key, 'the key is in the keyring');
  assert.ok(!JSON.stringify(await api.stored()).includes(key), 'the key is not in the data dir');
});

test('a stale fingerprint is refused and nothing is stored', async () => {
  const { command } = await launcher(temporary);
  await put('stale', stdio(command, ['one']));
  const shown = (await api.details('stale')).details.fingerprint;
  await put('stale', stdio(command, ['two']));
  const response = await api.approve('stale', shown);
  assert.equal(response.status, 409, response.text);
  assert.equal(errorCode(response.json), 'approval_changed');
  assert.ok(!(await api.stored()).approvals.some((record) => record.serverId === 'stale'));
  assert.equal(await api.approvalOf('stale'), 'required');
  const invalid = await api.approve('stale', shown, 'renderer');
  assert.equal(invalid.status, 400, 'only shell or cli confirm an approval');
});

test('an approval lets the server launch; a change or a withdrawal stops it', async () => {
  const { command, marker } = await launcher(temporary);
  await put('ok', stdio(command, ['first'], { API_KEY: ENV_SECRET }));
  const { details } = await api.details('ok');
  const response = await api.approve('ok', details.fingerprint, 'shell');
  assert.equal(response.status, 200, response.text);
  const { approval } = parse(McpLaunchApproveResponseSchema, response.json);
  assert.deepEqual(
    { v: approval.v, kind: approval.kind, layer: approval.layer, via: approval.via },
    { v: 1, kind: 'mcp-stdio', layer: 'user', via: 'shell' },
  );
  assert.equal(approval.fingerprint, details.fingerprint);
  assert.equal(await api.approvalOf('ok'), 'approved');
  await api.send('/v1/mcp/connect', 'POST', { serverId: 'ok' });
  assert.ok(await spawnedWithin(marker), 'the approved server was spawned');

  await put('ok', stdio(command, ['second'], { API_KEY: { keep: true } }));
  assert.equal(await api.approvalOf('ok'), 'changed');
  await rm(marker, { force: true });
  await assertRefused('/v1/mcp/connect', { serverId: 'ok' });
  assert.equal(await exists(marker), false);

  await api.approveNow('ok');
  assert.equal(await api.approvalOf('ok'), 'approved');
  const withdrawn = await api.send('/v1/mcp/servers/ok/approval', 'DELETE');
  assert.equal(withdrawn.status, 200, withdrawn.text);
  assert.equal(await api.approvalOf('ok'), 'required');
  assert.ok(!(await api.stored()).approvals.some((record) => record.serverId === 'ok'));
  // Removing a server drops its approval, so a same-named server later starts over.
  await api.approveNow('ok');
  await api.send('/v1/mcp/servers/ok', 'DELETE');
  assert.ok(!(await api.stored()).approvals.some((record) => record.serverId === 'ok'));
});

test('an env-sourced bearer is refused until approved; plain HTTP needs no approval', async () => {
  const url = `http://127.0.0.1:${port}/mcp`;
  await put('remote-env', {
    transport: 'streamable-http',
    url,
    auth: { type: 'bearer', tokenEnv: 'AI_TEST_LAUNCH_TOKEN' },
  });
  assert.equal(await api.approvalOf('remote-env'), 'required');
  await assertRefused('/v1/mcp/connect', { serverId: 'remote-env' });
  await assertRefused('/v1/mcp/refresh', { serverId: 'remote-env' });
  assert.equal(hits, 0, 'nothing was dialed');
  const { details } = await api.details('remote-env');
  assert.equal(details.kind, 'mcp-http-env');
  assert.deepEqual(details.http, {
    url,
    tokenEnv: 'AI_TEST_LAUNCH_TOKEN',
    headerKeys: [],
    urlReadsEnv: false,
    headers: [],
    envReferences: [],
  });
  assert.equal(details.stdio, null);
  await api.approveNow('remote-env');
  await api.send('/v1/mcp/connect', 'POST', { serverId: 'remote-env' });
  assert.ok(hits > 0, 'the approved server was dialed');

  const before = hits;
  await put('remote-plain', { transport: 'streamable-http', url, auth: { type: 'none' } });
  assert.equal(await api.approvalOf('remote-plain'), 'notRequired');
  const plain = await api.send('/v1/mcp/connect', 'POST', { serverId: 'remote-plain' });
  assert.notEqual(plain.status, 403, plain.text);
  assert.ok(hits > before, 'plain HTTP connects as before');
  const none = await api.send('/v1/admin/approvals/mcp/remote-plain', 'GET');
  assert.equal(none.status, 400, 'a server that needs no approval has no details');
});

test('values the adapter would run as commands are refused, approved or not', async () => {
  const { command, marker } = await launcher(temporary);
  const ran = path.join(path.dirname(marker), 'ran');
  const url = `http://127.0.0.1:${port}/mcp`;
  const before = hits;
  await put('cmd-env', stdio(command, [], { X: `!touch '${ran}'` }));
  const details = await api.send('/v1/admin/approvals/mcp/cmd-env', 'GET');
  assert.equal(details.status, 403, 'there is nothing to approve');
  await put('cmd-header', {
    transport: 'streamable-http',
    url,
    auth: { type: 'none' },
    headers: { 'X-Cmd': `!touch '${ran}'` },
  });
  for (const serverId of ['cmd-env', 'cmd-header']) {
    const refused = await api.send('/v1/mcp/connect', 'POST', { serverId });
    assert.equal(refused.status, 403, refused.text);
    assert.equal(errorCode(refused.json), 'forbidden');
  }
  assert.equal(hits, before, 'nothing was dialed');
  assert.equal(await exists(ran), false, 'no command ran');
  assert.equal(await exists(marker), false, 'nothing was spawned');
  await put('literal-header', {
    transport: 'streamable-http',
    url,
    auth: { type: 'none' },
    headers: { 'X-Bang': '!!literal' },
  });
  const literal = await api.send('/v1/mcp/connect', 'POST', { serverId: 'literal-header' });
  assert.notEqual(literal.status, 403, 'the escaped form is a literal value');
  assert.ok(hits > before);
});

test('configure_mcp tells the model when a server needs the user to approve it', async () => {
  const { command } = await launcher(temporary);
  const host = {
    upsertMcp: async (serverId: string, request: McpServerUpsertRequest) => {
      assert.equal((await put(serverId, request)).status, 200);
      return {
        record: upsertRecord(serverId, request, undefined),
        approval: await api.approvalOf(serverId),
      };
    },
    audit: () => undefined,
    taskId: 'task',
    runId: () => 'run',
  };
  const run = async (args: Record<string, unknown>) => {
    const result = await configureMcp(host, { serverId: 'agent-made', ...args });
    return result.content.map((block) => block.text);
  };
  const created = await run({ transport: 'stdio', command, args: ['x'], auth: { type: 'none' } });
  assert.equal(JSON.parse(created[0] ?? '').approval, 'required');
  assert.match(created[1] ?? '', /cannot run until the user approves it/);
  await api.approveNow('agent-made');
  const changed = await run({ transport: 'stdio', command, args: ['y'], auth: { type: 'none' } });
  assert.equal(JSON.parse(changed[0] ?? '').approval, 'changed');
  assert.match(changed[1] ?? '', /approves it again/);
  const plain = await run({
    transport: 'streamable-http',
    url: `http://127.0.0.1:${port}/mcp`,
    auth: { type: 'none' },
  });
  assert.equal(JSON.parse(plain[0] ?? '').approval, 'notRequired');
  assert.equal(plain.length, 1, 'no approval note for a server that needs none');
});

test('the CLI approves only after a terminal confirmation or --yes', async () => {
  const { command } = await launcher(temporary);
  await put('cli-server', stdio(command, []));
  const dataDir = harness.config.paths.root;
  await assert.rejects(approveMcp(dataDir, 'cli-server', { yes: false }), /terminal/);
  assert.equal(await api.approvalOf('cli-server'), 'required');
  await approveMcp(dataDir, 'cli-server', { yes: true });
  assert.equal(await api.approvalOf('cli-server'), 'approved');
  const record = (await api.stored()).approvals.find((entry) => entry.serverId === 'cli-server');
  assert.equal(record?.via, 'cli');
});

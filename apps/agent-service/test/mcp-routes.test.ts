import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { Type, type Static, type TSchema } from 'typebox';
import {
  McpCallResultSchema,
  McpGetPromptResponseSchema,
  McpPromptRefSchema,
  McpReadResourceResponseSchema,
  McpResourceRefSchema,
  McpResourceTemplateRefSchema,
  McpServersResponseSchema,
  McpToolRefSchema,
  parse,
} from '@ai/agent-contracts';
import { McpAuthority } from '../dist/mcp/authority.js';
import { catalogCountsFile } from '../dist/mcp/catalog-memory.js';
import type { McpError } from '../dist/mcp/errors.js';
import { mcpErrorStatus } from '../dist/mcp/routes.js';
import { serversFile } from '../dist/mcp/servers.js';
import { client, errorCode, exists } from './launch-helpers.ts';
import { at, stdioRecord, waitFor, watchStates } from './mcp-kit.ts';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * The MCP routes end to end: a real service on a temporary data dir and the stdio fixture as the
 * server. A journey through approval, connect, the catalog, calls, disconnect, edit, disable and
 * removal, each step read back through the routes a client uses.
 */

const SERVER = fileURLToPath(new URL('./mcp-stdio-server.mjs', import.meta.url));
const CountsFile = Type.Object({
  version: Type.Literal(1),
  servers: Type.Record(
    Type.String(),
    Type.Object({
      key: Type.String(),
      tools: Type.Integer(),
      resources: Type.Integer(),
      prompts: Type.Integer(),
    }),
  ),
});
const Tools = Type.Object({ tools: Type.Array(McpToolRefSchema) });
const Resources = Type.Object({ resources: Type.Array(McpResourceRefSchema) });
const Templates = Type.Object({ templates: Type.Array(McpResourceTemplateRefSchema) });
const Prompts = Type.Object({ prompts: Type.Array(McpPromptRefSchema) });
const Prompt = Type.Object({ ...McpGetPromptResponseSchema.properties, preview: Type.String() });

installMemoryKeyring();
let harness: Awaited<ReturnType<typeof startTestService>>;
let api: ReturnType<typeof client>;
let dir = '';
let marker = '';
let stopped = false;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mcp-routes-'));
  marker = path.join(dir, 'spawns');
  harness = await startTestService();
  api = client(harness);
  const servers = [
    stdioRecord('fixture', process.execPath, [SERVER], { env: { SMOKE_MARKER: marker } }),
    stdioRecord('spare', process.execPath, [SERVER, '--spare'], { env: { SMOKE_MARKER: marker } }),
  ].map((record) => ({ ...record, exposeResources: true, approveTools: false }));
  const file = serversFile(harness.config.paths.root);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ version: 1, servers }));
});
after(async () => {
  if (!stopped) await harness.stop();
  await rm(dir, { recursive: true, force: true });
});

/** One child per line of the marker: its pid and the arguments after the script. */
async function spawns() {
  const lines = (await readFile(marker, 'utf8').catch(() => '')).split('\n');
  return lines
    .filter((line) => /^\d+ /.test(line))
    .map((line) => ({ pid: Number(line.split(' ')[0]), args: line.slice(line.indexOf(' ') + 1) }));
}
const lastSpawn = async () => {
  const all = await spawns();
  return at(all, all.length - 1);
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const dead = (pid: number) => waitFor(() => !alive(pid));

const row = async (serverId = 'fixture') =>
  at((await api.status()).servers.filter((server) => server.serverId === serverId));
const counts = (found: Awaited<ReturnType<typeof row>>) => [
  found.toolCount,
  found.resourceCount,
  found.promptCount,
];
const post = (route: string, body: object) => api.send(route, 'POST', body);
const remembered = async () =>
  parse(
    CountsFile,
    JSON.parse(await readFile(catalogCountsFile(harness.config.paths.root), 'utf8')),
  ).servers;

/** The body of a 200 answer, parsed with the wire schema the answer promises. */
async function answer<T extends TSchema>(
  route: string,
  body: object,
  schema: T,
): Promise<Static<T>> {
  const response = await post(route, body);
  assert.equal(response.status, 200, `${route}: ${response.text}`);
  return parse(schema, response.json);
}

const connect = async (serverId = 'fixture') => {
  const response = await post('/v1/mcp/connect', { serverId });
  assert.equal(response.status, 200, response.text);
};

test('a configured server is listed; nothing launches until it is approved', async () => {
  const found = await row();
  assert.deepEqual(
    [found.state, found.approval, found.disabled],
    ['disconnected', 'required', false],
  );
  assert.deepEqual(counts(found), [0, 0, 0], 'it never connected');

  const refused = await post('/v1/mcp/connect', { serverId: 'fixture' });
  assert.equal(refused.status, 403);
  assert.equal(errorCode(refused.json), 'approval_required');
  assert.equal(await exists(marker), false, 'nothing was spawned');

  assert.equal((await post('/v1/mcp/connect', {})).status, 400, 'a request needs a server');
  const unknown = await post('/v1/mcp/connect', { serverId: 'nowhere' });
  assert.equal(unknown.status, 404);
  assert.equal(errorCode(unknown.json), 'not_found');
  assert.equal((await harness.call('/v1/mcp/status', { anonymous: true })).status, 401);
});

test('disconnecting a server that is not configured is a 404 and leaves no state row', async () => {
  const { config, service } = harness;
  const authority = await McpAuthority.authorityFor({
    serviceId: config.serviceId,
    dataDir: config.paths.root,
    cwd: config.paths.root,
    events: service.events,
    confirms: service.confirms,
    resources: service.resources,
    log: service.log,
  });
  const writes = watchStates(authority.states);
  const unknown = await post('/v1/mcp/disconnect', { serverId: 'nowhere' });
  assert.equal(unknown.status, 404);
  assert.equal(errorCode(unknown.json), 'not_found');
  assert.deepEqual(writes, [], 'no state was written for it');
});

test('connect starts the server once; the status row shows what it offers', async () => {
  await api.approveNow('fixture');
  assert.equal(await api.approvalOf('fixture'), 'approved');
  await connect();
  const found = await row();
  assert.deepEqual([found.state, found.approval, found.lastError], ['ready', 'approved', '']);
  assert.deepEqual(counts(found), [8, 1, 1]);
  await connect();
  assert.equal((await spawns()).length, 1, 'a second connect reuses the child');
  assert.equal((await api.send('/v1/mcp/snapshot', 'GET')).status, 200);
});

test('tools are listed and called through the wire shapes', async () => {
  const listed = await answer('/v1/mcp/tools/list', { serverId: 'fixture' }, Tools);
  assert.equal(listed.tools.length, 8);
  const echo = at(listed.tools.filter((tool) => tool.name === 'echo'));
  assert.deepEqual([echo.serverId, echo.description], ['fixture', 'Echoes the text back.']);

  const call = (tool: string, args?: object) =>
    answer('/v1/mcp/tools/call', { serverId: 'fixture', tool, args }, McpCallResultSchema);
  const called = await call('echo', { text: 'hi' });
  assert.deepEqual(called.content, [{ type: 'text', text: 'hi' }]);
  assert.deepEqual([called.structuredContent, called.isError], [{ echoed: 'hi' }, false]);
  const failed = await call('fail');
  assert.deepEqual([failed.isError, failed.content], [true, [{ type: 'text', text: 'boom' }]]);

  const invalid = await post('/v1/mcp/tools/call', { serverId: 'fixture', tool: 'echo', args: {} });
  assert.equal(invalid.status, 400, invalid.text);
  const missing = await post('/v1/mcp/tools/call', { serverId: 'fixture', tool: 'nowhere' });
  assert.ok([403, 404].includes(missing.status), missing.text);
});

test('resources and prompts are listed and read', async () => {
  const request = { serverId: 'fixture' };
  const resources = await answer('/v1/mcp/resources/list', request, Resources);
  assert.deepEqual(
    resources.resources.map((item) => item.uri),
    ['mem://greeting'],
  );
  const templates = await answer('/v1/mcp/resources/templates', request, Templates);
  assert.deepEqual(
    templates.templates.map((item) => item.uriTemplate),
    ['mem://items/{id}'],
  );

  const read = (uri: string) =>
    answer('/v1/mcp/resources/read', { ...request, uri }, McpReadResourceResponseSchema);
  assert.equal(at((await read('mem://greeting')).contents).text, 'hello from smoke');
  assert.equal(at((await read('mem://items/7')).contents).text, 'item 7');
  const outside = await post('/v1/mcp/resources/read', { ...request, uri: 'mem://secret' });
  assert.deepEqual([outside.status, errorCode(outside.json)], [403, 'forbidden']);

  const prompts = await answer('/v1/mcp/prompts/list', request, Prompts);
  assert.deepEqual(
    prompts.prompts.map((item) => item.name),
    ['greet'],
  );
  const args = { name: 'Ada' };
  const greeting = await answer('/v1/mcp/prompts/get', { ...request, name: 'greet', args }, Prompt);
  assert.equal(at(greeting.messages).role, 'user');
  assert.match(greeting.preview, /Say hello to Ada\./);
});

test('disconnect ends the child and keeps the last-known counts; reconnect starts a new one', async () => {
  const first = await lastSpawn();
  assert.equal((await post('/v1/mcp/disconnect', { serverId: 'fixture' })).status, 200);
  await dead(first.pid);
  const idle = await row();
  assert.equal(idle.state, 'disconnected');
  assert.deepEqual(counts(idle), [8, 1, 1], 'what it offered last, not zeros');
  await waitFor(async () => (await remembered()).fixture?.tools === 8);
  const { tools, resources, prompts } = (await remembered()).fixture ?? {};
  assert.deepEqual([tools, resources, prompts], [8, 1, 1], 'it is on disk for the next start');

  assert.equal((await post('/v1/mcp/reconnect', { serverId: 'fixture' })).status, 200);
  assert.equal((await row()).state, 'ready');
  const second = await lastSpawn();
  assert.equal((await spawns()).length, 2);
  assert.ok(alive(second.pid) && !alive(first.pid));
});

test('an edit voids the approval and the remembered counts until the server connects again', async () => {
  assert.equal((await post('/v1/mcp/disconnect', { serverId: 'fixture' })).status, 200);
  const edit = {
    transport: 'stdio',
    command: process.execPath,
    args: [SERVER, '--edited'],
    auth: { type: 'none' },
    env: { SMOKE_MARKER: { keep: true } },
  };
  const saved = await api.send('/v1/mcp/servers/fixture', 'PUT', edit);
  assert.equal(saved.status, 200, saved.text);
  const servers = parse(McpServersResponseSchema, saved.json).servers;
  const view = at(servers.filter((server) => server.serverId === 'fixture'));
  assert.deepEqual([view.revision, view.exposeResources], [2, true]);
  assert.deepEqual(view.stdio?.env, { SMOKE_MARKER: { set: true } });
  assert.ok(!saved.text.includes(marker), 'no env value is read back');

  const changed = await row();
  assert.deepEqual(
    [changed.state, changed.approval, changed.configRevision],
    ['disconnected', 'changed', 2],
  );
  assert.deepEqual(counts(changed), [0, 0, 0], 'the counts belong to the old configuration');
  const refused = await post('/v1/mcp/connect', { serverId: 'fixture' });
  assert.deepEqual([refused.status, errorCode(refused.json)], [403, 'approval_required']);

  await api.approveNow('fixture');
  await connect();
  assert.deepEqual(counts(await row()), [8, 1, 1]);
  assert.equal((await lastSpawn()).args, '--edited');
});

test('a disabled server refuses connections; enabling it starts over', async () => {
  const running = await lastSpawn();
  const off = await post('/v1/mcp/servers/fixture/enabled', { enabled: false });
  assert.equal(off.status, 200, off.text);
  await dead(running.pid);
  const disabled = await row();
  assert.deepEqual([disabled.state, disabled.disabled], ['disabled', true]);
  assert.ok((await post('/v1/mcp/connect', { serverId: 'fixture' })).status >= 400);

  assert.equal((await post('/v1/mcp/servers/fixture/enabled', { enabled: true })).status, 200);
  assert.equal((await row()).state, 'disconnected');
  await connect();
  assert.equal((await row()).state, 'ready');
});

test('removing a server ends its child and forgets it, counts included', async () => {
  await api.approveNow('spare');
  await connect('spare');
  const spare = await lastSpawn();
  assert.equal(spare.args, '--spare');
  assert.ok(alive(spare.pid));
  await waitFor(async () => Object.hasOwn(await remembered(), 'spare'));

  const removed = await api.send('/v1/mcp/servers/spare', 'DELETE');
  assert.equal(removed.status, 200, removed.text);
  await dead(spare.pid);
  const left = parse(McpServersResponseSchema, removed.json).servers;
  assert.deepEqual(
    left.map((server) => server.serverId),
    ['fixture'],
  );
  assert.deepEqual(
    (await api.status()).servers.map((server) => server.serverId),
    ['fixture'],
  );
  await waitFor(async () => !Object.hasOwn(await remembered(), 'spare'));
});

test('each error code has one status', () => {
  const statuses: Array<[McpError['code'], number]> = [
    ['bad_request', 400],
    ['auth_required', 401],
    ['forbidden', 403],
    ['approval_required', 403],
    ['not_found', 404],
    ['conflict', 409],
    ['approval_changed', 409],
    ['gone', 410],
    ['internal', 500],
  ];
  for (const [code, status] of statuses) assert.equal(mcpErrorStatus(code), status, code);
});

test('stopping the service closes its connections and their children', async () => {
  const fixture = (await spawns()).filter((spawn) => spawn.args === '--edited');
  const running = at(fixture, fixture.length - 1);
  assert.ok(alive(running.pid));
  stopped = true;
  await harness.stop();
  await dead(running.pid);
});

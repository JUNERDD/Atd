import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { McpConnectionClosedError } from '@earendil-works/pi-mcp';
import { createTransport } from '../dist/mcp/transports.js';
import { waitFor } from './mcp-fake-server.ts';
import { at, kitFor, memoryLog, stdioRecord } from './mcp-kit.ts';

/**
 * A real stdio child (test/mcp-stdio-server.mjs) through the connection manager and the real
 * transport factory: what the child is given, that it starts once and dies with its connection.
 */

const SERVER = fileURLToPath(new URL('./mcp-stdio-server.mjs', import.meta.url));
let dir = '';
let marker = '';

before(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'mcp-stdio-')));
  marker = path.join(dir, 'spawns');
  process.env.AI_TEST_STDIO_ARG = 'from-env';
  process.env.AI_TEST_STDIO_REF = 'ref-value';
  process.env.AI_TEST_STDIO_SECRET = 'must-not-reach-the-child';
});
after(async () => {
  delete process.env.AI_TEST_STDIO_ARG;
  delete process.env.AI_TEST_STDIO_REF;
  delete process.env.AI_TEST_STDIO_SECRET;
  await rm(dir, { recursive: true, force: true });
});

const spawns = async () =>
  (await readFile(marker, 'utf8').catch(() => ''))
    .split('\n')
    .filter((line) => /^\d+ /.test(line))
    .map((line) => ({ pid: Number(line.split(' ')[0]), args: line.split(' ').slice(1).join(' ') }));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const child = (overrides: Parameters<typeof stdioRecord>[3] = {}) =>
  stdioRecord('stdio', process.execPath, [SERVER, 'a b', '${AI_TEST_STDIO_ARG}', '~/x'], {
    cwd: dir,
    env: {
      SMOKE_MARKER: marker,
      SMOKE_NAME: 'under-test',
      API_KEY: 'k-1',
      BANG: '!!literal',
      REF: '${AI_TEST_STDIO_REF}',
    },
    ...overrides,
  });

test('the child gets its arguments, env and cwd resolved, and only the inherited service env', async (t) => {
  const { connections, states } = kitFor(t, [child()], {
    transports: createTransport,
    defaultCwd: tmpdir(),
  });
  const { connection } = await connections.ensure('stdio');
  assert.equal(states.get('stdio'), 'ready');
  assert.deepEqual(connections.counts('stdio'), { tools: 8, resources: 1, prompts: 1 });
  const names = ['API_KEY', 'BANG', 'REF', 'SMOKE_NAME', 'AI_TEST_STDIO_SECRET', 'HOME', 'PATH'];
  const result = await connection.use((client) => client.callTool('env', { names }));
  const report = result.structuredContent as {
    env: Record<string, string | null>;
    envNames: string[];
    argv: string[];
    cwd: string;
  };
  assert.deepEqual(report.env, {
    API_KEY: 'k-1',
    BANG: '!literal',
    REF: 'ref-value',
    SMOKE_NAME: 'under-test',
    AI_TEST_STDIO_SECRET: null,
    HOME: process.env.HOME ?? null,
    PATH: process.env.PATH ?? null,
  });
  assert.ok(!report.envNames.includes('AI_TEST_STDIO_SECRET'), 'the service env is not inherited');
  assert.ok(!report.envNames.includes('AI_TEST_STDIO_ARG'));
  assert.deepEqual(report.argv, ['a b', 'from-env', path.join(homedir(), 'x')]);
  assert.equal(await realpath(report.cwd), dir);
  assert.equal((await spawns()).length, 1, 'started once');
});

test('a server without a cwd starts in the authority cwd; a relative one is resolved against it', async (t) => {
  await mkdir(path.join(dir, 'sub'), { recursive: true });
  const records = [
    child({ cwd: null, env: { SMOKE_MARKER: marker } }),
    { ...child({ cwd: 'sub', env: { SMOKE_MARKER: marker } }), serverId: 'relative' },
    { ...child({ cwd: 'nowhere', env: {} }), serverId: 'missing' },
    { ...child({ cwd: '${AI_TEST_STDIO_SECRET}/x', env: {} }), serverId: 'templated' },
  ];
  const { connections } = kitFor(t, records, { transports: createTransport, defaultCwd: dir });
  const where = async (serverId: string) => {
    const { connection } = await connections.ensure(serverId);
    const result = await connection.use((client) => client.callTool('env', {}));
    return realpath(String((result.structuredContent as { cwd: string }).cwd));
  };
  assert.equal(await where('stdio'), dir);
  assert.equal(await where('relative'), path.join(dir, 'sub'));
  await assert.rejects(connections.connect('missing'), (error) => {
    assert.match(String(error), /configured cwd does not exist: ".*[/]nowhere"/);
    return true;
  });
  // A path that names a variable is shown as written, so the value never reaches a message.
  await assert.rejects(connections.connect('templated'), (error) => {
    assert.match(String(error), /does not exist: "\$\{AI_TEST_STDIO_SECRET\}[/]x"/);
    assert.ok(!String(error).includes('must-not-reach-the-child'));
    return true;
  });
});

test('disconnect ends the child; reconnect replaces it', async (t) => {
  const { connections } = kitFor(t, [child()], { transports: createTransport });
  await connections.connect('stdio');
  const before = await spawns();
  const first = at(before, before.length - 1);
  await connections.reconnect('stdio');
  await waitFor(() => !alive(first.pid));
  const second = at(await spawns(), before.length);
  assert.notEqual(second.pid, first.pid);
  await connections.disconnect('stdio');
  await waitFor(() => !alive(second.pid));
});

test('a child that dies mid-session is respawned by the next use, and its stderr is logged', async (t) => {
  const { log, lines } = memoryLog();
  const { connections, states } = kitFor(t, [child()], { transports: createTransport, log });
  const { connection } = await connections.ensure('stdio');
  const spawned = (await spawns()).length;
  await assert.rejects(
    connection.use((client) => client.callTool('crash', {})),
    McpConnectionClosedError,
  );
  await waitFor(() => !connection.isOpen());
  assert.equal(states.get('stdio'), 'ready', 'the logical state does not follow the process');
  const closed = lines
    .map((line) => JSON.parse(line))
    .find((f) => f.message === 'MCP connection closed.');
  assert.match(String(closed?.stderr), /crash requested/);
  const again = await connections.ensure('stdio');
  assert.notEqual(again.connection, connection);
  assert.equal((await spawns()).length, spawned + 1);
});

test('list_changed from a real child recounts the catalog', async (t) => {
  const { connections } = kitFor(t, [child()], { transports: createTransport });
  const { connection } = await connections.ensure('stdio');
  await connection.use((client) => client.callTool('grow', { kind: 'tools' }));
  await connection.use((client) => client.callTool('grow', { kind: 'prompts' }));
  await waitFor(
    () => connections.counts('stdio').tools === 9 && connections.counts('stdio').prompts === 2,
  );
});

test('a child that cannot start says why; a missing executable says so', async (t) => {
  const dying = stdioRecord('dying', process.execPath, [
    '-e',
    'console.error("bad config"); process.exit(2)',
  ]);
  const missing = stdioRecord('missing', path.join(dir, 'no-such-server'));
  const { connections, states } = kitFor(t, [dying, missing], { transports: createTransport });
  await assert.rejects(connections.connect('dying'), (error) => {
    assert.match(String(error), /failed to connect/);
    assert.match(String(error), /bad config/, 'the stderr tail is in the message');
    return true;
  });
  assert.equal(states.get('dying'), 'error');
  await assert.rejects(connections.connect('missing'), /failed to start/);
  assert.match(states.lastError('missing'), /no-such-server/);
});

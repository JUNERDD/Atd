import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { McpHttpError, McpTimeoutError } from '@earendil-works/pi-mcp';
import { CatalogMemory, catalogCountsFile } from '../dist/mcp/catalog-memory.js';
import { McpError } from '../dist/mcp/errors.js';
import { reuseKey } from '../dist/mcp/servers.js';
import { createTransport } from '../dist/mcp/transports.js';
import type { McpTransportFactory } from '../dist/mcp/types.js';
import { FakeMcpServer, waitFor } from './mcp-fake-server.ts';
import { standardTools, tool } from './mcp-fake-tools.ts';
import { at, edited, httpRecord, kitFor, memoryLog, stdioRecord } from './mcp-kit.ts';

/**
 * Connection lifecycle over in-memory MCP servers: reuse, reconnect, task aliases, dropped and
 * cancelled requests, retries and the launch gate. The pool's idle sweep: mcp-pool.test.ts; real
 * stdio children: mcp-stdio.test.ts.
 */

const catalog = () =>
  new FakeMcpServer({
    tools: standardTools(),
    resources: [{ uri: 'mem://greeting', name: 'greeting' }],
    prompts: [{ name: 'greet' }],
  });

test('ensure reuses the open connection; its catalog is counted at connect', async (t) => {
  const fake = catalog();
  const { connections, states } = kitFor(t, [httpRecord('reuse')], { transports: fake.factory });
  const first = await connections.ensure('reuse');
  const second = await connections.ensure('reuse');
  assert.equal(second.connection, first.connection);
  assert.equal(first.physical, 'reuse');
  assert.equal(fake.launches.length, 1, 'one dial');
  assert.equal(states.get('reuse'), 'ready');
  assert.deepEqual(connections.counts('reuse'), { tools: 6, resources: 1, prompts: 1 });
});

test('initialize declares no client capabilities and names the connection', async (t) => {
  const fake = catalog();
  const { connections } = kitFor(t, [httpRecord('hello')], { transports: fake.factory });
  const { connection } = await connections.ensure('hello');
  const { initialize } = at(fake.sessions);
  assert.deepEqual(initialize?.capabilities, {});
  assert.deepEqual(initialize?.clientInfo, { name: 'pi-mcp-hello', version: '1.0.0' });
  assert.equal(initialize?.protocolVersion, '2025-11-25');
  // A server that asks the client to sample gets "method not found", never an answer.
  const outcome = await connection.use((client) => client.callTool('sample', {}));
  assert.match(JSON.stringify(outcome.content), /-32601/);
});

test('an edited server reconnects on its next use instead of reusing the old connection', async (t) => {
  const fake = catalog();
  const record = httpRecord('edit');
  const { connections, records } = kitFor(t, [record], { transports: fake.factory });
  const first = await connections.ensure('edit');
  records.set('edit', edited(record));
  const second = await connections.ensure('edit');
  assert.notEqual(second.connection, first.connection);
  assert.equal(first.connection.isOpen(), false, 'the old connection was closed');
  assert.equal(second.record.revision, 2);
  assert.equal(fake.launches.length, 2);
  assert.equal(fake.open().length, 1);
});

test('an isolated server has a connection per task, apart from its base connection', async (t) => {
  const fake = catalog();
  const { connections, states } = kitFor(t, [httpRecord('iso', { isolateByTask: true })], {
    transports: fake.factory,
  });
  const a = await connections.ensure('iso', undefined, 'task-a');
  const b = await connections.ensure('iso', undefined, 'task-b');
  const base = await connections.ensure('iso');
  assert.deepEqual(
    [a.physical, b.physical, base.physical],
    ['iso__t__task-a', 'iso__t__task-b', 'iso'],
  );
  assert.equal(new Set([a.connection, b.connection, base.connection]).size, 3);
  assert.equal((await connections.ensure('iso', undefined, 'task-a')).connection, a.connection);
  assert.equal(fake.launches.length, 3, 'three transports, one dial each');
  for (const { physical } of [a, b, base]) {
    const named = { name: `pi-mcp-${physical}`, version: '1.0.0' };
    const found = fake.sessions.some((s) => isDeepStrictEqual(s.initialize?.clientInfo, named));
    assert.ok(found, `${physical} announced itself by name`);
  }
  await connections.disconnect('iso');
  assert.equal(fake.open().length, 0, 'disconnect closes the aliases too');
  assert.equal(states.get('iso'), 'disconnected');
});

test('a dropped connection is replaced on the next use', async (t) => {
  const fake = catalog();
  const { connections, states } = kitFor(t, [httpRecord('drop')], {
    transports: fake.factory,
  });
  const first = await connections.ensure('drop');
  await at(fake.open()).drop();
  await waitFor(() => !first.connection.isOpen());
  assert.equal(states.get('drop'), 'ready', 'the logical state does not follow the socket');
  const second = await connections.ensure('drop');
  assert.notEqual(second.connection, first.connection);
  assert.equal(second.connection.isOpen(), true);
  assert.equal(fake.launches.length, 2);
});

test('reconnect closes the connection, opens another and counts the catalog again', async (t) => {
  const fake = catalog();
  const { connections, states } = kitFor(t, [httpRecord('rc')], { transports: fake.factory });
  const first = await connections.ensure('rc');
  fake.tools.push(tool('extra'));
  assert.equal(connections.counts('rc').tools, 6, 'the count is the one taken at connect');
  await connections.reconnect('rc');
  assert.equal(first.connection.isOpen(), false);
  assert.equal(connections.counts('rc').tools, 7);
  assert.equal(states.get('rc'), 'ready');
  assert.equal(fake.requests('tools/call').length, 0, 'nothing was replayed');
});

test('list_changed recounts the catalog; a burst ends on the final counts', async (t) => {
  const fake = catalog();
  const { connections } = kitFor(t, [httpRecord('lc')], { transports: fake.factory });
  await connections.ensure('lc');
  fake.tools.push(tool('added'));
  await fake.notifyListChanged('tools');
  await waitFor(() => connections.counts('lc').tools === 7);
  fake.resources.push({ uri: 'mem://second', name: 'second' });
  fake.prompts.push({ name: 'second' });
  await fake.notifyListChanged('resources');
  await fake.notifyListChanged('prompts');
  await waitFor(
    () => connections.counts('lc').resources === 2 && connections.counts('lc').prompts === 2,
  );
  fake.tools.push(tool('burst-1'), tool('burst-2'));
  for (let i = 0; i < 5; i += 1) await fake.notifyListChanged('tools');
  await waitFor(() => connections.counts('lc').tools === 9);
});

test('aborting a request tells the server it was cancelled', async (t) => {
  const fake = catalog();
  const { connections } = kitFor(t, [httpRecord('cancel')], { transports: fake.factory });
  const { connection } = await connections.ensure('cancel');
  const abort = new AbortController();
  const call = connection.use((client) => client.callTool('hang', {}, { signal: abort.signal }));
  await waitFor(() => fake.requests('tools/call').length === 1);
  abort.abort();
  await assert.rejects(call, { name: 'AbortError' });
  await waitFor(() => at(fake.sessions).cancelled.length === 1);
  assert.equal(typeof at(at(fake.sessions).cancelled).requestId, 'number');
});

test("the record's requestTimeoutMs bounds every request", async (t) => {
  const fake = catalog();
  const record = httpRecord('slow', { requestTimeoutMs: 60 });
  const { connections } = kitFor(t, [record], { transports: fake.factory });
  const { connection } = await connections.ensure('slow');
  await assert.rejects(
    connection.use((client) => client.callTool('hang', {})),
    (error) => error instanceof McpTimeoutError && error.timeoutMs === 60,
  );
  await waitFor(() => at(fake.sessions).cancelled.length === 1);
  assert.equal(at(at(fake.sessions).cancelled).reason, 'Request timed out');
});

test('a transient HTTP failure is retried; the retries are bounded', async (t) => {
  const fake = catalog();
  const { connections, states } = kitFor(t, [httpRecord('flaky'), httpRecord('down')], {
    transports: fake.factory,
  });
  fake.failNext('initialize', 1, () => new McpHttpError(503, 'Service Unavailable'));
  await connections.connect('flaky');
  assert.equal(fake.launches.length, 2, 'one dial failed, the retry connected');
  assert.equal(states.get('flaky'), 'ready');
  assert.equal(fake.open().length, 1, 'the failed attempt left nothing open');

  fake.failNext('initialize', 9, () => new McpHttpError(503, 'Service Unavailable'));
  await assert.rejects(connections.connect('down'), (error) => {
    assert.ok(error instanceof McpError && error.code === 'internal');
    assert.match(error.message, /failed to connect/);
    return true;
  });
  assert.equal(fake.launches.length, 5, 'first try plus two retries');
  assert.equal(states.get('down'), 'error');
});

test('a stdio server that fails to start is not started again', async (t) => {
  const fake = catalog();
  const record = stdioRecord('once', process.execPath);
  const { connections } = kitFor(t, [record], { transports: fake.factory });
  fake.failNext('initialize', 1, () => new McpHttpError(503, 'Service Unavailable'));
  await assert.rejects(connections.connect('once'));
  assert.equal(fake.launches.length, 1);
});

test('a server that is not there fails at once, without retries', async (t) => {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const address: string | AddressInfo | null = listener.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((resolve) => listener.close(resolve));
  let dials = 0;
  const counting: McpTransportFactory = (launch, auth) => {
    dials += 1;
    return createTransport(launch, auth);
  };
  for (const host of ['127.0.0.1', 'localhost']) {
    dials = 0;
    const record = httpRecord('gone', {}, { url: `http://${host}:${address.port}/mcp` });
    const { connections, states } = kitFor(t, [record], { transports: counting });
    await assert.rejects(connections.connect('gone'), (error) => {
      assert.ok(error instanceof McpError && error.code === 'internal');
      assert.match(error.message, /unreachable.*ECONNREFUSED/, `${host} names the errno`);
      return true;
    });
    assert.equal(dials, 1, `${host}: one attempt`);
    assert.equal(states.get('gone'), 'error');
  }
});

test('connects are serialized per server: two callers share one dial', async (t) => {
  const fake = catalog();
  const { connections } = kitFor(t, [httpRecord('twice')], { transports: fake.factory });
  await Promise.all([connections.connect('twice'), connections.connect('twice')]);
  assert.equal(fake.launches.length, 1);
  assert.equal(fake.open().length, 1);
});

test('a refused launch dials nothing and moves the state; reconnect checks it before closing', async (t) => {
  const fake = catalog();
  let allowed = false;
  const launch = {
    assertLaunch: async (record: { serverId: string }) => {
      if (!allowed) throw new McpError('approval_required', record.serverId, 'needs approval');
    },
  };
  const { connections, states } = kitFor(t, [httpRecord('gated')], {
    transports: fake.factory,
    launch,
  });
  for (const action of [() => connections.connect('gated'), () => connections.ensure('gated')]) {
    await assert.rejects(
      action(),
      (error) => error instanceof McpError && error.code === 'approval_required',
    );
  }
  assert.equal(fake.launches.length, 0, 'nothing was dialed');
  assert.equal(states.get('gated'), 'approval_required');
  allowed = true;
  const open = await connections.ensure('gated');
  allowed = false;
  await assert.rejects(connections.reconnect('gated'), { code: 'approval_required' });
  assert.equal(open.connection.isOpen(), true, 'the open connection was not closed first');
});

test('disabled and signed-out servers are refused before anything is dialed', async (t) => {
  const fake = catalog();
  const { connections, states } = kitFor(
    t,
    [httpRecord('off', { disabled: true }), httpRecord('needs')],
    { transports: fake.factory },
  );
  await assert.rejects(connections.connect('off'), { code: 'forbidden' });
  await assert.rejects(connections.ensure('off'), { code: 'forbidden' });
  states.set('needs', 'auth_required');
  await assert.rejects(connections.ensure('needs'), { code: 'auth_required' });
  assert.equal(fake.launches.length, 0);
});

test('a bearer token reaches the transport as a credential, never as a header', async (t) => {
  const fake = catalog();
  const bearer = httpRecord('bearer', {}, { auth: { type: 'bearer', tokenEnv: '' } });
  const { connections } = kitFor(t, [bearer], {
    transports: fake.factory,
    bearerToken: '!not-run ${X}',
  });
  await connections.connect('bearer');
  const { launch } = at(fake.launches);
  assert.ok(launch.kind === 'streamable-http');
  assert.deepEqual(launch.credential, { type: 'bearer', token: '!not-run ${X}' });
  assert.deepEqual(launch.headers, {});
  const missing = kitFor(t, [bearer], { transports: fake.factory });
  await assert.rejects(missing.connections.connect('bearer'), { code: 'auth_required' });
  assert.match(missing.states.lastError('bearer'), /missing its bearer credential/);
});

test('last-known counts outlive the connection, a restart and nothing else', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcp-counts-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { log } = memoryLog();
  const record = httpRecord('mem');
  const last = { tools: 6, resources: 1, prompts: 1 };
  const zeros = { tools: 0, resources: 0, prompts: 0 };
  const fake = catalog();
  const memory = await CatalogMemory.load(dir, log);
  const first = kitFor(t, [record], { transports: fake.factory, memory });
  assert.deepEqual(
    first.connections.counts('mem'),
    zeros,
    'a server that never connected offers nothing',
  );
  await first.connections.connect('mem');
  await first.connections.disconnect('mem');
  assert.deepEqual(first.connections.counts('mem'), last, 'a disconnected server keeps offering');
  await first.dispose();
  await memory.flush();
  const saved = JSON.parse(await readFile(catalogCountsFile(dir), 'utf8'));
  assert.deepEqual(saved, { version: 1, servers: { mem: { key: reuseKey(record), ...last } } });

  const later = await CatalogMemory.load(dir, log);
  const restarted = kitFor(t, [record], { transports: fake.factory, memory: later });
  assert.deepEqual(restarted.connections.counts('mem'), last, 'and after a restart');
  restarted.records.set('mem', edited(record));
  assert.deepEqual(restarted.connections.counts('mem'), zeros, 'an edited server starts over');
  fake.tools.pop();
  await restarted.connections.connect('mem');
  assert.equal(restarted.connections.counts('mem').tools, 5, 'live counts win while it is open');
  await later.flush(); // the write for the changed catalog lands before the directory goes
});

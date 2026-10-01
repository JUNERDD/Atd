import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countCatalog } from '../dist/mcp/catalog.js';
import { MCP_IDLE_CLOSE_MS } from '../dist/mcp/constants.js';
import { McpConnectionPool, type PoolTarget } from '../dist/mcp/pool.js';
import type { McpTransportFactory } from '../dist/mcp/types.js';
import { FakeMcpServer, waitFor } from './mcp-fake-server.ts';
import { standardTools, tool } from './mcp-fake-tools.ts';
import { at, deferred, memoryLog } from './mcp-kit.ts';

/**
 * The pool of open clients: idle closes on an injected clock, reuse and shared dials, a dial
 * nobody waits for any more, and connections discarded while a request is still running.
 */

const target = (physical: string, overrides: Partial<PoolTarget> = {}): PoolTarget => ({
  serverId: physical.split('__t__')[0] ?? physical,
  physical,
  reuseKey: 'key-1',
  idleClose: !physical.includes('__t__'),
  launch: {
    kind: 'streamable-http',
    url: 'https://fake.example/mcp',
    headers: {},
    credential: { type: 'none' },
  },
  auth: undefined,
  requestTimeoutMs: 5_000,
  hideUrl: (text) => text,
  ...overrides,
});

/** A pool over `transports` whose idle clock is `clock.now`. */
function poolFor(fake: FakeMcpServer, transports: McpTransportFactory = fake.factory) {
  const clock = { now: 1_000_000 };
  const pool = new McpConnectionPool({
    transports,
    counter: countCatalog,
    log: memoryLog().log,
    now: () => clock.now,
    counted: () => undefined,
  });
  return { pool, clock };
}

const server = () => new FakeMcpServer({ tools: standardTools() });

test('a base connection idle for longer than the limit closes; a request keeps it open', async (t) => {
  const fake = server();
  const { pool, clock } = poolFor(fake);
  t.after(() => pool.closeAll());
  const connection = await pool.open(target('idle'));
  clock.now += MCP_IDLE_CLOSE_MS;
  await pool.sweepIdle();
  assert.equal(connection.isOpen(), true, 'exactly the limit is not yet idle');

  clock.now += MCP_IDLE_CLOSE_MS - 1_000;
  await connection.use((client) => client.ping());
  clock.now += MCP_IDLE_CLOSE_MS;
  await pool.sweepIdle();
  assert.equal(connection.isOpen(), true, 'the request restarted the idle time');

  clock.now += 1;
  await pool.sweepIdle();
  assert.equal(connection.isOpen(), false);
  assert.equal(pool.get('idle'), undefined);
  assert.equal(fake.open().length, 0);
  assert.equal((await pool.open(target('idle'))).isOpen(), true, 'the next use opens another');
});

test('a connection with a request in flight is never idle, and a task alias never closes', async (t) => {
  const release = deferred();
  const fake = server();
  fake.tools.push(tool('held', () => release.promise.then(() => ({ content: [] }))));
  const { pool, clock } = poolFor(fake);
  t.after(() => pool.closeAll());
  const busy = await pool.open(target('busy'));
  const alias = await pool.open(target('busy__t__task', { idleClose: false }));
  const call = busy.use((client) => client.callTool('held', {}));
  await waitFor(() => fake.requests('tools/call').length === 1);
  clock.now += MCP_IDLE_CLOSE_MS * 5;
  await pool.sweepIdle();
  assert.equal(busy.isOpen(), true, 'a request is running');
  assert.equal(alias.isOpen(), true, 'an alias has no idle limit');
  release.resolve();
  await call;
  await pool.sweepIdle();
  assert.equal(busy.isOpen(), true, 'finishing the request restarted the idle time');
  clock.now += MCP_IDLE_CLOSE_MS + 1;
  await pool.sweepIdle();
  assert.equal(busy.isOpen(), false);
  assert.equal(alias.isOpen(), true);
});

test('open reuses a connection of the same key, and another key replaces it', async (t) => {
  const fake = server();
  const { pool } = poolFor(fake);
  t.after(() => pool.closeAll());
  const first = await pool.open(target('reuse'));
  assert.equal(await pool.open(target('reuse')), first);
  const second = await pool.open(target('reuse', { reuseKey: 'key-2' }));
  assert.notEqual(second, first);
  assert.equal(first.isOpen(), false);
  assert.equal(second.reuseKey, 'key-2');
  assert.equal(fake.launches.length, 2);
});

test('callers of one name share a single dial', async (t) => {
  const fake = server();
  const { pool } = poolFor(fake);
  t.after(() => pool.closeAll());
  const [a, b] = await Promise.all([pool.open(target('one')), pool.open(target('one'))]);
  assert.equal(a, b);
  assert.equal(fake.launches.length, 1);
});

test('a dial nobody waits for any more is cancelled and closed', async (t) => {
  const fake = server();
  const gate = deferred();
  const slow: McpTransportFactory = (launch, auth) => {
    const transport = fake.factory(launch, auth);
    const start = transport.start.bind(transport);
    transport.start = async () => {
      await gate.promise;
      await start();
    };
    return transport;
  };
  const { pool } = poolFor(fake, slow);
  t.after(() => pool.closeAll());
  const leaving = new AbortController();
  const pending = pool.open(target('slowdial'), leaving.signal);
  await waitFor(() => fake.launches.length === 1);
  leaving.abort(new Error('caller left'));
  await assert.rejects(pending, /caller left/);
  gate.resolve();
  await waitFor(() => pool.namesOf('slowdial').length === 0);
  assert.equal(at(fake.sessions).closed, true, 'the abandoned dial closed its transport');
  gate.resolve();
  assert.equal((await pool.open(target('slowdial'))).isOpen(), true, 'a later open dials afresh');
});

test('a discarded connection finishes its request, then closes; new callers get another', async (t) => {
  const release = deferred();
  const fake = server();
  fake.tools.push(tool('held', () => release.promise.then(() => ({ content: [] }))));
  const { pool } = poolFor(fake);
  t.after(() => pool.closeAll());
  const old = await pool.open(target('discard'));
  const call = old.use((client) => client.callTool('held', {}));
  await waitFor(() => fake.requests('tools/call').length === 1);
  await pool.discard(old);
  assert.equal(pool.get('discard'), undefined, 'not handed out any more');
  assert.equal(old.isOpen(), true, 'the request in flight still has its connection');
  const fresh = await pool.open(target('discard'));
  assert.notEqual(fresh, old);
  release.resolve();
  await call;
  await waitFor(() => !old.isOpen());
  assert.equal(fresh.isOpen(), true);
});

test('the pool names and counts a server across its base and task connections', async (t) => {
  const fake = server();
  const { pool } = poolFor(fake);
  t.after(() => pool.closeAll());
  await pool.open(target('multi'));
  await pool.open(target('multi__t__a', { idleClose: false }));
  await pool.open(target('other'));
  assert.deepEqual(pool.namesOf('multi').sort(), ['multi', 'multi__t__a']);
  assert.deepEqual(pool.counts('multi'), { tools: 6, resources: 0, prompts: 0 });
  assert.deepEqual(pool.counts('nobody'), { tools: 0, resources: 0, prompts: 0 });
  await pool.close('multi');
  assert.deepEqual(pool.namesOf('multi'), ['multi__t__a']);
  await pool.closeAll();
  assert.equal(fake.open().length, 0);
  assert.deepEqual(pool.namesOf('other'), []);
});

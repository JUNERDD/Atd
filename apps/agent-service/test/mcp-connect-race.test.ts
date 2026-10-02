import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { McpConnectionState, McpServerConfig } from '@atd/agent-contracts';
import { ConnectOvertaken, translateConnectError } from '../dist/mcp/connect-errors.js';
import type { LaunchGate } from '../dist/mcp/launch-approvals.js';
import { mcpErrorStatus } from '../dist/mcp/routes.js';
import { reuseKey } from '../dist/mcp/servers.js';
import { TxnRevoked } from '../dist/mcp/transactions.js';
import { FakeMcpServer, waitFor } from './mcp-fake-server.ts';
import { standardTools } from './mcp-fake-tools.ts';
import {
  at,
  bounded,
  deferred,
  edited,
  holdListing,
  httpRecord,
  kitFor,
  watchStates,
} from './mcp-kit.ts';

/**
 * A connect that a revoke, disable or removal overtakes while it resolves its launch, waits its
 * turn or opens: it is refused as a 409 conflict and opens or keeps no connection. It leaves the
 * row to the change that overtook it, except that a row it left `connecting` returns to
 * `disconnected`. `McpAuthority.apply` revokes the key, commits the record, runs
 * `disconnectLeaving` on the server and resets the states, in that order; the changes below do the
 * same to the kit's records. A real authority: mcp-authority-apply.test.ts.
 */

const record = httpRecord('x');
const identity = reuseKey(record);

const overtaken = (error: unknown) => {
  assert.ok(error instanceof ConnectOvertaken, String(error));
  assert.equal(error.code, 'conflict');
  assert.equal(error.message, 'MCP server x changed while it was connecting.');
  assert.equal(mcpErrorStatus(error.code), 409);
  return true;
};

/** A launch gate the test closes: a launch resolved while it is closed waits for `release`. */
function launchGate() {
  let closed = false;
  let held = false;
  const release = deferred();
  const launch: LaunchGate = {
    assertLaunch: async () => {
      if (!closed) return;
      held = true;
      await release.promise;
    },
  };
  return {
    launch,
    close: () => void (closed = true),
    reached: () => waitFor(() => held),
    release: () => release.resolve(),
  };
}

function setup(t: TestContext, records: McpServerConfig[] = [record]) {
  const fake = new FakeMcpServer({ tools: standardTools() });
  const gate = launchGate();
  const kit = kitFor(t, records, { transports: fake.factory, launch: gate.launch });
  return { ...kit, fake, gate };
}

/** What `McpAuthority.apply` does to a server it disables or drops, in its order. */
type Change = (kit: ReturnType<typeof setup>) => Promise<void>;
const settleRows = (kit: ReturnType<typeof setup>) => kit.states.reset([...kit.records.values()]);
const changes: Record<string, Change> = {
  disabled: async (kit) => {
    kit.txns.revoke(identity);
    kit.records.set('x', { ...record, disabled: true });
    await kit.connections.disconnectLeaving('x');
    settleRows(kit);
  },
  removed: async (kit) => {
    kit.txns.revoke(identity);
    kit.records.delete('x');
    await kit.connections.disconnectLeaving('x');
    settleRows(kit);
  },
  // A sign-out: the credentials go, the record stays enabled and the row goes idle.
  revoked: async (kit) => {
    kit.txns.revoke(identity);
    await kit.connections.disconnect('x');
  },
};

for (const [name, change] of Object.entries(changes)) {
  test(`a connect overtaken by a change (${name}) while its launch resolves is refused and leaves the row alone`, async (t) => {
    const kit = setup(t);
    kit.gate.close();
    const refused = assert.rejects(kit.connections.connect('x', bounded()), overtaken);
    await kit.gate.reached();
    await change(kit);
    const settled = [kit.states.get('x'), kit.states.lastError('x')];
    const writes = watchStates(kit.states);
    kit.gate.release();
    await refused;
    assert.deepEqual(writes, [], 'the row is what the change set');
    assert.deepEqual([kit.states.get('x'), kit.states.lastError('x')], settled);
    assert.equal(kit.fake.launches.length, 0, 'no transport was built');
    assert.equal(kit.fake.open().length, 0);
  });
}

test('a revoke while the connect waits its turn refuses it; the next connect is not poisoned', async (t) => {
  const kit = setup(t);
  const held = deferred();
  const holder = kit.txns.runTokenOp(identity, () => held.promise, { kind: 'exchange' });
  const refused = assert.rejects(kit.connections.connect('x', bounded()), overtaken);
  await waitFor(() => kit.txns.queuedCount(identity) === 1);
  const writes = watchStates(kit.states);
  kit.txns.revoke(identity);
  await refused;
  assert.deepEqual(writes, ['x -> disconnected'], 'the connecting it left is put back');
  assert.equal(kit.fake.launches.length, 0);

  held.resolve();
  await holder;
  await kit.connections.connect('x', bounded());
  assert.equal(kit.states.get('x'), 'ready');
});

test('a revoke while the connection opens cancels the open at once', async (t) => {
  const kit = setup(t);
  const server = holdListing(kit.fake);
  t.after(() => server.proceed());
  const refused = assert.rejects(kit.connections.connect('x', bounded()), overtaken);
  await server.listing();
  const writes = watchStates(kit.states);
  kit.txns.revoke(identity);
  await refused;
  assert.deepEqual(writes, ['x -> disconnected'], 'the connecting it left is put back');
  await waitFor(() => kit.fake.open().length === 0);
  assert.deepEqual(kit.connections.counts('x'), { tools: 0, resources: 0, prompts: 0 });
});

for (const change of ['disabled', 'gone'] as const) {
  test(`a connection opened for a server that is ${change} closes again, and only that one`, async (t) => {
    const isolated = httpRecord('x', { isolateByTask: true });
    const kit = setup(t, [isolated]);
    await kit.connections.ensure('x', undefined, 'task-b');
    const server = holdListing(kit.fake);
    t.after(() => server.proceed());
    const refused = assert.rejects(kit.connections.connect('x', bounded(), 'task-a'), overtaken);
    await server.listing();
    // No revoke: only the record says so, which the check after the open catches.
    if (change === 'gone') kit.records.delete('x');
    else kit.records.set('x', { ...isolated, disabled: true });
    const writes = watchStates(kit.states);
    server.proceed();
    await refused;
    assert.deepEqual(writes, ['x -> disconnected'], 'the connecting it left is put back');
    const [taskB, taskA] = [at(kit.fake.sessions, 0), at(kit.fake.sessions, 1)];
    await waitFor(() => taskA.closed);
    assert.equal(taskB.closed, false, 'the other task keeps its connection');
    assert.equal(kit.fake.open().length, 1);
  });
}

test('an edit that only re-keys an enabled server does not refuse the connect', async (t) => {
  const kit = setup(t);
  kit.gate.close();
  const connecting = kit.connections.ensure('x', bounded());
  await kit.gate.reached();
  kit.records.set('x', edited(record));
  kit.gate.release();
  const opened = await connecting;
  assert.equal(kit.states.get('x'), 'ready');
  assert.equal(opened.connection.reuseKey, identity, 'opened for the record it started with');

  const next = await kit.connections.ensure('x', bounded());
  assert.notEqual(next.connection, opened.connection, 'the next use reconnects, as after any edit');
  assert.equal(next.connection.reuseKey, reuseKey(edited(record)));
  assert.equal(kit.fake.launches.length, 2);
});

test('reconnect is refused the same way, before it closes the open connection', async (t) => {
  const kit = setup(t);
  const first = await kit.connections.ensure('x', bounded());
  kit.gate.close();
  const refused = assert.rejects(kit.connections.reconnect('x', bounded()), overtaken);
  await kit.gate.reached();
  const writes = watchStates(kit.states);
  kit.txns.revoke(identity);
  kit.gate.release();
  await refused;
  assert.deepEqual(writes, ['x -> disconnected'], 'the connecting it left is put back');
  assert.equal(first.connection.isOpen(), true, 'the revoker closes it, not the refused reconnect');
  assert.equal(kit.fake.launches.length, 1);
});

test('an overtaken connect leaves the change its row, even when its caller has aborted', () => {
  const caller = new AbortController();
  caller.abort();
  const translate = (row: McpConnectionState, error: unknown) => {
    const writes: unknown[][] = [];
    const states = { set: (...args: unknown[]) => void writes.push(args), get: () => row };
    return { result: translateConnectError(states, record, error, caller.signal), writes };
  };
  for (const error of [new TxnRevoked(identity), new ConnectOvertaken('x')]) {
    // Whatever the change made of the row stays: the caller's abort would have written over it.
    for (const row of ['disabled', 'disconnected', 'closing', 'ready', 'error'] as const) {
      const { result, writes } = translate(row, error);
      assert.ok(result instanceof ConnectOvertaken);
      assert.deepEqual(writes, [], `${row} stays`);
    }
    // Only the connecting it left comes back.
    const { result, writes } = translate('connecting', error);
    assert.ok(result instanceof ConnectOvertaken);
    assert.deepEqual(writes, [['x', 'disconnected', '']]);
  }
  // Any other failure of an aborted caller still writes disconnected.
  const other = translate('disabled', new Error('cancelled'));
  assert.deepEqual(other.writes, [['x', 'disconnected', '']]);
});

test('disconnectLeaving closes every connection of a server whose record is gone, and settles its row', async (t) => {
  const isolated = httpRecord('x', { isolateByTask: true });
  for (const change of ['disabled', 'gone'] as const) {
    const kit = setup(t, [isolated]);
    await kit.connections.ensure('x', bounded(), 'task-a');
    await kit.connections.ensure('x', bounded());
    assert.equal(kit.fake.open().length, 2, 'a task alias and the base connection');
    if (change === 'gone') kit.records.delete('x');
    else kit.records.set('x', { ...isolated, disabled: true });
    await kit.connections.disconnectLeaving('x');
    await waitFor(() => kit.fake.open().length === 0);
    // A removed server's row is the next reset's to delete; a disabled one stays as disabled.
    assert.equal(kit.states.get('x'), change === 'gone' ? 'disconnected' : 'disabled', change);
  }
});

test('disconnect resolves the record first: a server that is not configured changes nothing', async (t) => {
  const kit = setup(t);
  await kit.connections.ensure('x', bounded());
  const writes = watchStates(kit.states);
  await assert.rejects(kit.connections.disconnect('nowhere'), {
    code: 'not_found',
    message: 'MCP server nowhere is not configured.',
  });
  kit.records.delete('x');
  await assert.rejects(kit.connections.disconnect('x'), { code: 'not_found' });
  assert.deepEqual(writes, [], 'no state was written');
  assert.equal(kit.fake.open().length, 1, 'and nothing was closed');
});

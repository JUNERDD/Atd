import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test, type TestContext } from 'node:test';
import { __setKeyringModuleForTests } from '../dist/credentials/keyring.js';
import { McpAuthority } from '../dist/mcp/authority.js';
import { FakeMcpServer, waitFor } from './mcp-fake-server.ts';
import { standardTools } from './mcp-fake-tools.ts';
import { at, bounded, deferred, holdListing } from './mcp-kit.ts';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * How a real authority applies a change that drops or disables a server: it revokes the server's
 * credential transactions, commits the change (which writes the keychain), and only then closes
 * the server (`disconnectLeaving`). A connect that begins between the revoke and the end of a slow
 * commit reads the old record and opens a connection, which the close after the commit takes; a
 * change whose commit fails closes nothing, and the connect it overtook leaves the row
 * `disconnected`.
 */

installMemoryKeyring();
let harness: Awaited<ReturnType<typeof startTestService>>;
before(async () => {
  harness = await startTestService();
});
after(() => harness.stop());

/**
 * An in-memory keyring, never the OS one, whose writes and listings wait for `release` once the
 * test called `hold`: a busy keychain, which is what makes a commit slow.
 */
function slowKeyring() {
  const items = new Map<string, string>();
  let gate: Promise<void> = Promise.resolve();
  let open = () => {};
  let waiting = 0;
  const pass = async () => {
    waiting += 1;
    await gate;
    waiting -= 1;
  };
  const named = (service: string, account: string) => `${service}\n${account}`;
  class AsyncEntry {
    private readonly key: string;
    constructor(service: string, account: string) {
      this.key = named(service, account);
    }
    async setPassword(password: string) {
      await pass();
      items.set(this.key, password);
    }
    async getPassword() {
      return items.get(this.key);
    }
    async deleteCredential() {
      return items.delete(this.key);
    }
  }
  __setKeyringModuleForTests({
    AsyncEntry,
    findCredentialsAsync: async (service: string) => {
      await pass();
      const prefix = `${service}\n`;
      return [...items]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, password]) => ({ account: key.slice(prefix.length), password }));
    },
  });
  return {
    hold: () => {
      const held = deferred();
      gate = held.promise;
      open = () => held.resolve();
    },
    release: () => open(),
    /** Writes and listings waiting for the release. */
    waiting: () => waiting,
  };
}

/** A real authority on a fresh data dir, its one server `x` on an in-memory MCP server. */
async function authorityFor(t: TestContext) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-apply-'));
  const fake = new FakeMcpServer({ tools: standardTools() });
  const { events, confirms, resources, log } = harness.service;
  const authority = await McpAuthority.createAuthority(
    { serviceId: 'apply-test', dataDir, cwd: dataDir, events, confirms, resources, log },
    { transports: fake.factory },
  );
  t.after(async () => {
    await authority.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  await authority.upsert('x', {
    transport: 'streamable-http',
    url: 'https://fake.example/mcp',
    auth: { type: 'none' },
  });
  const row = () => authority.snapshot().servers.find((server) => server.serverId === 'x');
  /** `x` saved as disabled, with a header: a save the keychain has to take. */
  const disable = () => {
    const saved = at(authority.configured());
    assert.ok(saved.http);
    return authority.put({
      ...saved,
      disabled: true,
      http: { ...saved.http, headers: { 'X-Key': 'secret' } },
    });
  };
  return { authority, fake, row, disable };
}

/** Runs `change` with the commit held in the keychain, and a connect begun while it is held. */
async function connectDuringSlowCommit(
  t: TestContext,
  change: (kit: Awaited<ReturnType<typeof authorityFor>>) => Promise<unknown>,
) {
  const keychain = slowKeyring();
  t.after(() => keychain.release());
  const kit = await authorityFor(t);
  keychain.hold();
  let committed = false;
  const changing = change(kit).then(() => void (committed = true));
  // The keychain is waiting, so the credentials are revoked and the change is not committed.
  await waitFor(() => keychain.waiting() > 0);
  await kit.authority.facade.connect('x', bounded());
  assert.equal(kit.fake.open().length, 1, 'it opened with the old record');
  assert.equal(committed, false, 'and the commit was still going');
  keychain.release();
  await changing;
  await waitFor(() => kit.fake.open().length === 0);
  return kit;
}

test('a connect begun during a slow commit is closed once the commit disables the server', async (t) => {
  const { row } = await connectDuringSlowCommit(t, ({ disable }) => disable());
  assert.deepEqual([row()?.state, row()?.disabled, row()?.lastError], ['disabled', true, '']);
});

test('a connect begun during a slow commit is closed once the commit removes the server', async (t) => {
  const { row } = await connectDuringSlowCommit(t, ({ authority }) => authority.remove('x'));
  assert.equal(row(), undefined, 'the row is gone with the server');
});

test('a change whose commit fails disconnects nothing: the server stays connected and enabled', async (t) => {
  const keyring = installMemoryKeyring();
  const { authority, fake, row, disable } = await authorityFor(t);
  await authority.facade.connect('x', bounded());
  keyring.state.fail = (operation) => operation === 'set';
  await assert.rejects(disable(), /was not saved/);

  assert.equal(fake.open().length, 1, 'nothing was closed');
  assert.deepEqual([row()?.state, row()?.disabled], ['ready', false]);
  assert.equal(at(authority.configured()).disabled, false);
  const tools = await authority.facade.listTools('x', bounded());
  assert.ok(tools.length > 0, 'the connection still answers');
  assert.equal(fake.launches.length, 1, 'through the connection it already had');
});

test('a change whose commit fails leaves the row of the connect it overtook disconnected', async (t) => {
  const keyring = installMemoryKeyring();
  const { authority, fake, row, disable } = await authorityFor(t);
  const server = holdListing(fake);
  t.after(() => server.proceed());
  const refused = assert.rejects(authority.facade.connect('x', bounded()), {
    code: 'conflict',
    message: 'MCP server x changed while it was connecting.',
  });
  await server.listing();
  assert.equal(row()?.state, 'connecting', 'the connect is opening');
  keyring.state.fail = (operation) => operation === 'set';
  await assert.rejects(disable(), /was not saved/);
  await refused;

  // The revoke refused the connect; nothing else settles the row, since `apply` threw.
  assert.deepEqual([row()?.state, row()?.disabled, row()?.lastError], ['disconnected', false, '']);
  await waitFor(() => fake.open().length === 0);
  assert.equal(at(authority.configured()).disabled, false);
});

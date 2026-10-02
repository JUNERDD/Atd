import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { Type } from 'typebox';
import { parse } from '@atd/agent-contracts';
import { McpAuthority } from '../dist/mcp/authority.js';
import { securityDir } from '../dist/mcp/launch-store.js';
import { serversFile } from '../dist/mcp/servers.js';
import { httpRecord } from './mcp-kit.ts';
import { oauthApi } from './mcp-oauth-kit.ts';
import { startOAuthMock } from './mcp-oauth-mock.ts';
import { ADAPTER_OAUTH_SERVICE, installMemoryKeyring, seedAdapterOAuth } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * The migration of pi-mcp-adapter sign-ins when something is wrong around it: a keychain that
 * cannot be read is recorded as such and tried again at the next load, a migration record that
 * cannot be used means nothing is imported and the record is left alone, and the import is one
 * pass: a server added after it never reads the adapter's keychain service.
 */

const SERVER_ID = 'legacy-one';
const keyring = installMemoryKeyring();
const adapter = keyring.service(ADAPTER_OAUTH_SERVICE);
const Marker = Type.Object({
  version: Type.Literal(1),
  servers: Type.Record(
    Type.String(),
    Type.Object({ result: Type.String(), detail: Type.Optional(Type.String()) }),
  ),
});

/**
 * A service with one OAuth server whose adapter record is fine (none with `seeded: false`); the
 * caller breaks what it likes.
 */
async function start(t: TestContext, { seeded = true } = {}) {
  const mock = await startOAuthMock();
  const harness = await startTestService();
  t.after(async () => {
    keyring.state.fail = () => false;
    await harness.stop();
    await mock.close();
  });
  const root = harness.config.paths.root;
  const oauth = oauthApi(
    () => harness,
    keyring,
    () => mock.url,
  )();
  const markerFile = path.join(securityDir(root), 'mcp-oauth-migration.json');
  const recorded = async () =>
    parse(Marker, JSON.parse(await readFile(markerFile, 'utf8'))).servers;
  /** The sign-in pi-mcp-adapter would have left for a server of this name at `url`. */
  const seedAdapter = (serverId: string, url: string) => {
    const grant = mock.seedGrant();
    seedAdapterOAuth(adapter, serverId, {
      tokens: {
        accessToken: grant.accessToken,
        refreshToken: grant.refreshToken,
        expiresAt: grant.expiresAt,
      },
      clientInfo: { clientId: grant.clientId, redirectUris: grant.redirectUris },
      serverUrl: url,
    });
  };
  if (seeded) {
    const url = `${mock.url}?s=${SERVER_ID}`;
    const record = httpRecord(
      SERVER_ID,
      {},
      { url, auth: { type: 'oauth', scope: null, redirectUri: null } },
    );
    await mkdir(path.dirname(serversFile(root)), { recursive: true });
    await writeFile(serversFile(root), JSON.stringify({ version: 1, servers: [record] }));
    seedAdapter(SERVER_ID, url);
  }
  return { mock, harness, root, oauth, markerFile, recorded, seedAdapter };
}

test('a keychain that cannot be read is recorded as retry and tried again at the next load', async (t) => {
  const { mock, root, oauth, recorded } = await start(t);
  // Only the adapter's items: the service's own keychain items stay readable.
  keyring.state.fail = (operation, account) => operation === 'get' && account.startsWith('sha256-');
  const waiting = await oauth.row(SERVER_ID);
  assert.equal(waiting.state, 'auth_required');
  assert.match(waiting.lastError, /could not be read/);
  assert.equal(oauth.stored(SERVER_ID), undefined);
  const entry = (await recorded())[SERVER_ID];
  assert.equal(
    entry?.result,
    'retry',
    'the first pass is over, and this server waits for the next',
  );
  assert.equal(entry.detail, undefined, 'an error text is shown, never kept');

  keyring.state.fail = () => false;
  await McpAuthority.closeFor(root);
  assert.equal((await oauth.row(SERVER_ID)).state, 'disconnected');
  assert.notEqual(oauth.stored(SERVER_ID), undefined, 'the second load moved it');
  assert.equal((await recorded())[SERVER_ID]?.result, 'migrated');
  assert.equal((await oauth.post('/v1/mcp/connect', SERVER_ID)).status, 200);
  assert.deepEqual([mock.counters.registrations, mock.counters.codeGrants], [0, 0]);
});

test('the first pass writes its record without any OAuth server; a server added later is not imported', async (t) => {
  const { mock, root, oauth, recorded, seedAdapter } = await start(t, { seeded: false });
  await oauth.api.status(); // assembles the MCP authority: the migration pass runs
  assert.deepEqual(await recorded(), {}, 'a record of the pass, with nothing in it');

  // The pi CLI shares the adapter's keychain service: its sign-in for a same-named server is
  // another product's grant, not this app's to take.
  const url = `${mock.url}?s=late-one`;
  seedAdapter('late-one', url);
  const shared = adapter.entries();
  await oauth.put('late-one', { url });
  await McpAuthority.closeFor(root);
  let adapterReads = 0;
  keyring.state.fail = (operation, account) => {
    if (operation === 'get' && account.startsWith('sha256-')) adapterReads += 1;
    return false;
  };
  assert.equal((await oauth.row('late-one')).state, 'disconnected');
  assert.equal(adapterReads, 0, 'the adapter was not read for it');
  assert.equal(oauth.stored('late-one'), undefined, 'and nothing was imported');
  assert.equal((await recorded())['late-one']?.result, 'none');
  const refused = await oauth.post('/v1/mcp/connect', 'late-one');
  assert.equal(refused.status, 401, 'it still needs its own sign-in');
  assert.equal(mock.counters.refreshGrants, 0);
  assert.deepEqual(adapter.entries(), shared);
});

const damaged = {
  'is not JSON': '{ "version": 1, "servers": ',
  'has another shape': JSON.stringify({ version: 2, servers: {} }),
};
for (const [what, content] of Object.entries(damaged)) {
  test(`a migration record that ${what} fails closed: nothing is imported, the record stays`, async (t) => {
    const { root, oauth, markerFile } = await start(t);
    await mkdir(securityDir(root), { recursive: true });
    await writeFile(markerFile, content);
    const before = adapter.entries();

    assert.equal((await oauth.row(SERVER_ID)).state, 'disconnected');
    assert.equal(oauth.stored(SERVER_ID), undefined, 'the adapter record was not read');
    assert.equal(await readFile(markerFile, 'utf8'), content, 'and the record was not rewritten');
    assert.deepEqual(adapter.entries(), before);
  });
}

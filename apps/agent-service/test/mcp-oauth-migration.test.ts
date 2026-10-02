import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Type } from 'typebox';
import { parse } from '@atd/agent-contracts';
import { McpAuthority } from '../dist/mcp/authority.js';
import { securityDir } from '../dist/mcp/launch-store.js';
import { errorCode } from './launch-helpers.ts';
import { at } from './mcp-kit.ts';
import {
  DISABLED,
  MOVED,
  PRESENT,
  SKIPPED,
  UNREADABLE,
  UNREADABLE_IDS,
  LONG_SCOPE,
  seedLegacyWorld,
  type LegacyWorld,
} from './mcp-oauth-legacy-kit.ts';
import { oauthApi } from './mcp-oauth-kit.ts';
import { startOAuthMock, type OAuthMock } from './mcp-oauth-mock.ts';
import { ADAPTER_OAUTH_SERVICE, installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * The one-time move of pi-mcp-adapter's OAuth sign-ins into the service keychain, through a real
 * service: whole, chunked and plaintext records, what is refused and why, the marker in security/,
 * and that the adapter's own items are only ever read. The records: mcp-oauth-legacy-kit.ts.
 */

const Marker = Type.Object({
  version: Type.Literal(1),
  servers: Type.Record(
    Type.String(),
    Type.Object({ result: Type.String(), detail: Type.Optional(Type.String()), at: Type.String() }),
  ),
});

const Saved = Type.Object({
  state: Type.Object({
    tokens: Type.Object({ access_token: Type.String() }),
    clientInformation: Type.Object({ client_id: Type.String() }),
  }),
});

const keyring = installMemoryKeyring();
const adapter = keyring.service(ADAPTER_OAUTH_SERVICE);
let harness: Awaited<ReturnType<typeof startTestService>>;
let mock: OAuthMock;
let world: LegacyWorld;
let adapterBefore = new Map<string, string>();
const oauth = oauthApi(
  () => harness,
  keyring,
  () => mock.url,
);

before(async () => {
  process.env.AI_TEST_OAUTH_TAG = 'blue';
  mock = await startOAuthMock();
  harness = await startTestService();
  const { root, serviceId } = {
    root: harness.config.paths.root,
    serviceId: harness.config.serviceId,
  };
  world = await seedLegacyWorld({ dataDir: root, serviceId }, mock, keyring, adapter);
  adapterBefore = adapter.entries();
});
after(async () => {
  delete process.env.AI_TEST_OAUTH_TAG;
  await harness.stop();
  await mock.close();
});

const savedItem = (serverId: string): unknown => {
  const raw = oauth().stored(serverId);
  return raw === undefined ? undefined : JSON.parse(raw);
};
const markerFile = () =>
  path.join(securityDir(harness.config.paths.root), 'mcp-oauth-migration.json');
const marker = async () => parse(Marker, JSON.parse(await readFile(markerFile(), 'utf8'))).servers;

test('a whole record moves in, without a sign-in in progress, and connects', async () => {
  const { post, row } = oauth();
  assert.equal(
    (await row('legacy-whole')).state,
    'disconnected',
    'the first use loads the servers',
  );
  assert.deepEqual(savedItem('legacy-whole'), world.item('legacy-whole'));
  assert.equal((await post('/v1/mcp/connect', 'legacy-whole')).status, 200);
  const found = await row('legacy-whole');
  assert.deepEqual([found.state, found.toolCount], ['ready', 1]);
  assert.deepEqual([mock.counters.registrations, mock.counters.authorizations], [0, 0]);
});

test('the moved client renews an expired token; nothing is registered again', async () => {
  const { post } = oauth();
  mock.expireAccessTokens();
  const refreshed = mock.counters.refreshGrants;
  assert.equal((await post('/v1/mcp/tools/list', 'legacy-whole')).status, 200);
  assert.equal(mock.counters.refreshGrants, refreshed + 1);
  assert.equal(mock.counters.registrations, 0);
  assert.notDeepEqual(
    savedItem('legacy-whole'),
    world.item('legacy-whole'),
    'the rotation is saved',
  );
});

test('a record split into chunks is joined and checked; a stub client is not taken along', async () => {
  const { post, row } = oauth();
  const scoped = world.item('legacy-chunked', undefined, { scope: LONG_SCOPE });
  assert.deepEqual(savedItem('legacy-chunked'), scoped);
  assert.equal((await post('/v1/mcp/connect', 'legacy-chunked')).status, 200);
  assert.equal((await row('legacy-chunked')).state, 'ready');
  assert.deepEqual(
    savedItem('legacy-stub'),
    world.item('legacy-stub', undefined, { client: false }),
  );
});

test("an older adapter's plaintext file is read; a URL with a variable matches once filled in", async () => {
  const { api, post, row } = oauth();
  assert.deepEqual(savedItem('legacy-plain'), world.item('legacy-plain'));
  assert.equal((await post('/v1/mcp/connect', 'legacy-plain')).status, 200);

  const filled = `${mock.base}/mcp?tag=blue`;
  assert.deepEqual(savedItem('legacy-envurl'), world.item('legacy-envurl', filled));
  await api.approveNow('legacy-envurl');
  assert.equal((await post('/v1/mcp/connect', 'legacy-envurl')).status, 200);
  assert.equal((await row('legacy-envurl')).state, 'ready');
});

test("the service's own sign-in is never replaced", async () => {
  const { post, row } = oauth();
  const own = parse(Saved, savedItem(PRESENT)).state;
  const adapters = world.grant(PRESENT);
  assert.notEqual(own.clientInformation.client_id, adapters.clientId, "not the adapter's client");
  assert.notEqual(own.tokens.access_token, adapters.accessToken);
  assert.equal((await post('/v1/mcp/connect', PRESENT)).status, 200);
  assert.equal((await row(PRESENT)).state, 'ready');
  const kept = parse(Saved, savedItem(PRESENT)).state;
  assert.equal(kept.clientInformation.client_id, own.clientInformation.client_id);
});

test('a record that cannot be read says so; the user is asked to sign in again', async () => {
  const { post, row } = oauth();
  const heard = mock.counters.unauthorized;
  for (const id of UNREADABLE_IDS) {
    const found = await row(id);
    assert.deepEqual([found.state, found.lastError], ['auth_required', UNREADABLE], id);
    assert.equal(savedItem(id), undefined, `${id}: nothing was guessed`);
  }
  assert.equal(mock.counters.unauthorized, heard, 'the status alone dials nothing');
  const refused = await post('/v1/mcp/connect', at(UNREADABLE_IDS));
  assert.deepEqual([refused.status, errorCode(refused.json)], [401, 'auth_required']);
});

test('a disabled server keeps its state; other URLs and records without tokens are skipped', async () => {
  const { api, post, row } = oauth();
  const disabled = await row(DISABLED);
  assert.deepEqual([disabled.state, disabled.lastError], ['disabled', '']);
  const enabled = await api.send(`/v1/mcp/servers/${DISABLED}/enabled`, 'POST', { enabled: true });
  assert.equal(enabled.status, 200, enabled.text);
  assert.equal((await row(DISABLED)).state, 'disconnected');
  assert.equal((await post('/v1/mcp/connect', DISABLED)).status, 401, 'it finds out when it dials');

  for (const id of SKIPPED) {
    assert.deepEqual([(await row(id)).state, savedItem(id)], ['disconnected', undefined], id);
  }
});

test('every decision is recorded once in security/, and the record holds no credential', async () => {
  const found = await marker();
  const results = (ids: string[]) => ids.map((id) => found[id]?.result);
  assert.deepEqual(
    results(MOVED),
    MOVED.map(() => 'migrated'),
  );
  assert.deepEqual(results([PRESENT]), ['present']);
  assert.deepEqual(
    results(SKIPPED),
    SKIPPED.map(() => 'none'),
  );
  for (const id of [...UNREADABLE_IDS, DISABLED]) {
    assert.deepEqual([found[id]?.result, found[id]?.detail], ['unmigratable', UNREADABLE], id);
  }
  for (const entry of Object.values(found)) assert.ok(!Number.isNaN(Date.parse(entry.at)));
  const text = await readFile(markerFile(), 'utf8');
  for (const grant of Object.values(world.grants)) {
    assert.ok(!text.includes(grant.accessToken) && !text.includes(grant.refreshToken));
  }
});

test("logging out is final: a reloaded service does not import the adapter's record again", async () => {
  const { post, row } = oauth();
  assert.equal((await post('/v1/mcp/logout', 'legacy-whole')).status, 200);
  assert.equal(savedItem('legacy-whole'), undefined);

  await McpAuthority.closeFor(harness.config.paths.root);
  assert.equal((await row('legacy-whole')).state, 'disconnected', 'the authority was rebuilt');
  assert.equal(savedItem('legacy-whole'), undefined, 'nothing came back');
  const refused = await post('/v1/mcp/connect', 'legacy-whole');
  assert.deepEqual([refused.status, errorCode(refused.json)], [401, 'auth_required']);
  assert.equal((await marker())['legacy-whole']?.result, 'migrated');
  assert.notEqual(savedItem('legacy-chunked'), undefined, 'the others keep theirs');
});

test("the adapter's own items are exactly as they were, and no one signed in", () => {
  assert.deepEqual(adapter.entries(), adapterBefore);
  assert.deepEqual([mock.counters.registrations, mock.counters.codeGrants], [0, 0]);
});

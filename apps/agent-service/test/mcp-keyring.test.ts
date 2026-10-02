import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  ErrorEnvelopeSchema,
  parse,
  type McpServerConfig,
  type McpServerUpsertRequest,
} from '@ai/agent-contracts';
import { keyringMcpAccount } from '../dist/credentials/keyring.js';
import type { Logger } from '../dist/logging.js';
import { migrateMcpSecrets } from '../dist/mcp/secrets-migration.js';
import { McpServerRecords } from '../dist/mcp/server-records.js';
import { McpServerStore, secretAccount } from '../dist/mcp/server-store.js';
import { credentialIdentity, serversFile } from '../dist/mcp/servers.js';
import type { ResolvedLaunch } from '../dist/mcp/types.js';
import { createKit } from './mcp-kit.ts';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * MCP env and header values at rest: the keyring holds them under per-entry accounts, servers.json
 * only names them, edits and removals keep the two in step, the startup migration moves plain
 * values over, and connecting still gets every value.
 */

const ENV_SECRET = 'kc-sentinel-env-71d2';
const HEADER_SECRET = 'kc-sentinel-header-9e04';
const keyring = installMemoryKeyring();
const logged: string[] = [];
const log: Logger = {
  debug: () => undefined,
  info: (msg, fields) => logged.push(JSON.stringify({ msg, ...fields })),
  warn: (msg, fields) => logged.push(JSON.stringify({ msg, ...fields })),
  error: (msg, fields) => logged.push(JSON.stringify({ msg, ...fields })),
};

let harness: Awaited<ReturnType<typeof startTestService>>;
let serviceId = '';
const temporary: string[] = [];

before(async () => {
  harness = await startTestService();
  serviceId = harness.config.serviceId;
});
after(async () => {
  await harness.stop();
  for (const dir of temporary) await rm(dir, { recursive: true, force: true });
});

async function send(pathname: string, method: string, body?: unknown) {
  const response = await harness.call(pathname, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, text: await response.text() };
}

const put = (serverId: string, request: McpServerUpsertRequest) =>
  send(`/v1/mcp/servers/${serverId}`, 'PUT', request);

const stdio = (env: McpServerUpsertRequest['env']): McpServerUpsertRequest => ({
  transport: 'stdio',
  command: '/bin/echo',
  args: [],
  auth: { type: 'none' },
  ...(env && { env }),
});

const http = (
  url: string,
  headers?: McpServerUpsertRequest['headers'],
): McpServerUpsertRequest => ({
  transport: 'streamable-http',
  url,
  auth: { type: 'none' },
  ...(headers ? { headers } : {}),
});

/** The server's own account (its bearer token), which prefixes all of its entries. */
const bearerAccount = (id: string, serverId: string) =>
  keyringMcpAccount(credentialIdentity(id, { serverId, principal: '' }));

/** A server's keyring entries, by account suffix after the server's own account. */
function entries(serverId: string, id = serviceId): Record<string, string> {
  const own = bearerAccount(id, serverId);
  return Object.fromEntries(
    [...keyring.accounts(id)]
      .filter(([account]) => account === own || account.startsWith(`${own}:`))
      .map(([account, value]) => [account.slice(own.length) || '(bearer)', value]),
  );
}

async function fileText(dataDir = harness.config.paths.root): Promise<string> {
  return readFile(serversFile(dataDir), 'utf8');
}

test('servers.json names env and header entries; the keyring holds their values', async () => {
  assert.equal((await put('kc-local', stdio({ API_KEY: ENV_SECRET }))).status, 200);
  assert.equal(
    (await put('kc-remote', http('https://a.example/mcp', { Authorization: HEADER_SECRET })))
      .status,
    200,
  );
  const text = await fileText();
  assert.ok(!text.includes(ENV_SECRET) && !text.includes(HEADER_SECRET), 'no value on disk');
  const file = JSON.parse(text) as { servers: Array<{ serverId: string; stdio: unknown }> };
  assert.deepEqual(file.servers.find((server) => server.serverId === 'kc-local')?.stdio, {
    command: '/bin/echo',
    args: [],
    env: { API_KEY: { keyring: true } },
    cwd: null,
  });
  const account = secretAccount(
    serviceId,
    { serverId: 'kc-local', principal: '' },
    'env',
    'API_KEY',
  );
  assert.match(account, new RegExp(`^mcp:mcp:${serviceId}:kc-local:[0-9a-f]{8}:env:API_KEY$`));
  assert.equal(keyring.accounts(serviceId).get(account), ENV_SECRET);
  assert.deepEqual(entries('kc-remote'), { ':header:Authorization': HEADER_SECRET });
});

test('keep, change, clear, rename and a transport switch keep the keyring in step', async () => {
  await put('kc-edit', stdio({ KEEP: 'k', DROP: 'd', OLD: 'o' }));
  assert.deepEqual(entries('kc-edit'), { ':env:KEEP': 'k', ':env:DROP': 'd', ':env:OLD': 'o' });
  await put('kc-edit', stdio({ KEEP: { keep: true }, NEW: 'n' }));
  assert.deepEqual(entries('kc-edit'), { ':env:KEEP': 'k', ':env:NEW': 'n' });
  await put('kc-edit', stdio({ KEEP: 'k2', NEW: { keep: true } }));
  assert.deepEqual(entries('kc-edit'), { ':env:KEEP': 'k2', ':env:NEW': 'n' });
  await put('kc-edit', http('https://b.example/mcp', { 'X-Key': 'x' }));
  assert.deepEqual(entries('kc-edit'), { ':header:X-Key': 'x' }, 'env entries went with stdio');
  await put('kc-edit', http('https://b.example/mcp', {}));
  assert.deepEqual(entries('kc-edit'), {}, 'an empty map clears');
});

test('removing a server deletes all its entries, including its bearer token', async () => {
  keyring.set(serviceId, bearerAccount(serviceId, 'kc-gone'), 'bearer-value');
  keyring.set(serviceId, `${bearerAccount(serviceId, 'kc-gone')}:env:LEFTOVER`, 'orphan');
  const bearer: McpServerUpsertRequest = {
    ...http('https://c.example/mcp', { 'X-Key': 'x' }),
    auth: { type: 'bearer', tokenEnv: 'KC_UNSET_TOKEN_ENV' },
  };
  assert.equal((await put('kc-gone', bearer)).status, 200);
  assert.equal((await send('/v1/mcp/servers/kc-gone', 'DELETE')).status, 200);
  assert.deepEqual(entries('kc-gone'), {}, 'values, leftovers and the bearer token are gone');
  assert.deepEqual(entries('kc-local'), { ':env:API_KEY': ENV_SECRET }, 'others stay');
  assert.equal((await put('kc-gone', { ...bearer, url: 'https://new.example/mcp' })).status, 200);
  assert.equal(entries('kc-gone')['(bearer)'], undefined, 'a re-added server has no old token');

  keyring.set(serviceId, bearerAccount(serviceId, 'kc-auth'), 'bearer-value');
  await put('kc-auth', { ...http('https://d.example/mcp'), auth: bearer.auth });
  assert.equal(entries('kc-auth')['(bearer)'], 'bearer-value');
  await put('kc-auth', http('https://d.example/mcp'));
  assert.deepEqual(entries('kc-auth'), {}, 'leaving bearer auth deletes the token');
});

test('a save the keyring refuses leaves the keyring and servers.json as they were', async () => {
  await put('kc-fail', stdio({ A: 'a1' }));
  const before = await fileText();
  keyring.state.fail = (operation, account) => operation === 'set' && account.endsWith(':env:B');
  try {
    const refused = await put('kc-fail', stdio({ A: 'a2', B: 'b-secret' }));
    assert.equal(refused.status, 500);
    const { message } = parse(ErrorEnvelopeSchema, JSON.parse(refused.text)).error;
    assert.match(message, /"B" could not be stored in the OS keyring/);
    assert.ok(!refused.text.includes('b-secret') && !refused.text.includes('a2'));
  } finally {
    keyring.state.fail = () => false;
  }
  assert.deepEqual(entries('kc-fail'), { ':env:A': 'a1' }, 'the changed value was put back');
  assert.equal(await fileText(), before);
});

test('connecting gets every value, hydrated from the keyring after a restart', async () => {
  const records = await McpServerRecords.load(harness.config.paths.root, serviceId, log);
  const dialed: ResolvedLaunch[] = [];
  const { connections } = createKit(records.all(), {
    // Launch approval is not what this test covers (test/launch-approvals.test.ts is).
    transports: (launch) => {
      dialed.push(launch);
      throw new Error('captured');
    },
    defaultCwd: harness.config.paths.root,
    log,
  });
  await assert.rejects(connections.connect('kc-local'));
  await assert.rejects(connections.connect('kc-remote'));
  const [local, remote] = dialed;
  assert.ok(local?.kind === 'stdio');
  assert.equal(local.env.API_KEY, ENV_SECRET);
  assert.ok('PATH' in local.env, 'the inherited variables come along');
  assert.ok(remote?.kind === 'streamable-http');
  assert.deepEqual(remote.headers, { Authorization: HEADER_SECRET });
});

/** A fresh data dir whose servers.json keeps its values in plain text, as saved before. */
async function plainDataDir(): Promise<string> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-keyring-migrate-'));
  temporary.push(dataDir);
  await mkdir(path.join(dataDir, 'mcp'));
  const base = {
    revision: 1,
    principal: '',
    isolateByTask: false,
    exposeResources: false,
    exposure: 'auto' as const,
    approveTools: true,
    includeTools: [],
    excludeTools: [],
    requestTimeoutMs: null,
    disabled: false,
  };
  const servers: McpServerConfig[] = [
    {
      ...base,
      serverId: 'plain-stdio',
      connectionId: 'c1',
      transport: 'stdio',
      stdio: { command: '/bin/echo', args: [], env: { TOKEN: ENV_SECRET }, cwd: null },
      http: null,
    },
    {
      ...base,
      serverId: 'plain-http',
      connectionId: 'c2',
      transport: 'streamable-http',
      stdio: null,
      http: {
        url: 'https://e.example/mcp',
        transport: 'streamable-http',
        headers: { Authorization: HEADER_SECRET },
        auth: { type: 'none' },
      },
    },
  ];
  await writeFile(serversFile(dataDir), JSON.stringify({ version: 1, servers }));
  return dataDir;
}

test(
  'the startup migration moves plain values, converges after an interruption, then idles',
  {
    skip: process.getuid?.() === 0 ? 'root ignores the read-only directory' : false,
  },
  async () => {
    const dataDir = await plainDataDir();
    const id = 'migrate-test';
    const plain = await fileText(dataDir);
    await chmod(path.join(dataDir, 'mcp'), 0o500);
    try {
      await assert.rejects(migrateMcpSecrets(dataDir, id, log), 'the file rewrite fails');
    } finally {
      await chmod(path.join(dataDir, 'mcp'), 0o700);
    }
    assert.equal(await fileText(dataDir), plain, 'interrupted: the file still has its values');
    assert.deepEqual(entries('plain-stdio', id), { ':env:TOKEN': ENV_SECRET });

    await migrateMcpSecrets(dataDir, id, log);
    const moved = await fileText(dataDir);
    assert.ok(!moved.includes(ENV_SECRET) && !moved.includes(HEADER_SECRET), 'no value on disk');
    assert.deepEqual(entries('plain-http', id), { ':header:Authorization': HEADER_SECRET });
    assert.ok(
      logged.some((line) => line.includes('"values":2')),
      'the summary counts values',
    );
    assert.ok(!logged.some((line) => line.includes(ENV_SECRET) || line.includes(HEADER_SECRET)));

    let writes = 0;
    keyring.state.fail = (operation) => {
      if (operation === 'set') writes += 1;
      return false;
    };
    try {
      await migrateMcpSecrets(dataDir, id, log);
    } finally {
      keyring.state.fail = () => false;
    }
    assert.equal(writes, 0, 'nothing left to move');
    assert.equal(await fileText(dataDir), moved);
    const records = await McpServerRecords.load(dataDir, id, log);
    assert.deepEqual(records.find('plain-stdio')?.stdio?.env, { TOKEN: ENV_SECRET });

    const account = secretAccount(id, { serverId: 'plain-stdio', principal: '' }, 'env', 'TOKEN');
    keyring.state.fail = (operation, target) => operation === 'get' && target === account;
    try {
      await assert.rejects(McpServerStore.load(dataDir, id, log), /OS keyring could not be read/);
    } finally {
      keyring.state.fail = () => false;
    }
    keyring.remove(id, account);
    const { records: missing } = await McpServerStore.load(dataDir, id, log);
    const off = missing.find((record) => record.serverId === 'plain-stdio');
    assert.equal(off?.disabled, true, 'a server missing a value stays off');
    assert.deepEqual(off?.stdio?.env, {});
    assert.ok(logged.some((line) => line.includes('"missing":["env:TOKEN"]')));
    assert.equal(await fileText(dataDir), moved, 'loading changes nothing');
  },
);

test('without a keyring, values stay in plain text and only new values are refused', async () => {
  const dataDir = await plainDataDir();
  const plain = await fileText(dataDir);
  keyring.state.fail = () => true;
  try {
    await migrateMcpSecrets(dataDir, 'no-keyring', log);
    assert.equal(await fileText(dataDir), plain, 'the file is untouched');
    assert.ok(logged.some((line) => line.includes('stay in plain text')));
    const { store, records } = await McpServerStore.load(dataDir, 'no-keyring', log);
    await store.save(records.map((record) => ({ ...record, disabled: true })));
    assert.ok((await fileText(dataDir)).includes(ENV_SECRET), 'unchanged values stay plain');
    const changed = records.map((record) =>
      record.stdio ? { ...record, stdio: { ...record.stdio, env: { TOKEN: 'new' } } } : record,
    );
    await assert.rejects(store.save(changed), /could not be stored in the OS keyring/);
  } finally {
    keyring.state.fail = () => false;
  }
});

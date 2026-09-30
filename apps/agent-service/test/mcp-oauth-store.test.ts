import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { McpOAuthState } from '@earendil-works/pi-mcp/oauth';
import { KeyringBackend } from '../dist/credentials/keyring.js';
import { KeychainOAuthStore, oauthAccount } from '../dist/mcp/oauth-store.js';
import { httpRecord, memoryLog } from './mcp-kit.ts';
import { installMemoryKeyring } from './memory-keyring.ts';

/**
 * The keychain store of a server's OAuth sign-in: read once, written in call order, dropped when
 * retired, and unreadable items never quoted.
 */

const SERVICE = 'oauth-unit';
const keyring = installMemoryKeyring();
const backend = new KeyringBackend(SERVICE);

const state = (extra: Partial<McpOAuthState> = {}): McpOAuthState => ({
  serverUrl: 'https://mcp.example/mcp',
  tokens: { access_token: 'at-1', token_type: 'Bearer', refresh_token: 'rt-1' },
  ...extra,
});

let accounts = 0;
const nextAccount = () => `mcp:unit-${(accounts += 1)}:oauth`;

/** The keychain item at `account`, parsed. */
function written(account: string): unknown {
  const raw = keyring.accounts(SERVICE).get(account);
  assert.ok(raw !== undefined, `${account} is in the keychain`);
  return JSON.parse(raw);
}

/** Counts the keychain reads while `run` runs. */
async function countingReads(run: () => Promise<void>): Promise<number> {
  let reads = 0;
  keyring.state.fail = (operation) => {
    if (operation === 'get') reads += 1;
    return false;
  };
  try {
    await run();
  } finally {
    keyring.state.fail = () => false;
  }
  return reads;
}

test('the store reads the keychain once and writes in call order', async () => {
  const account = nextAccount();
  keyring.set(SERVICE, account, JSON.stringify({ v: 1, state: state() }));
  const store = new KeychainOAuthStore(backend, account, memoryLog().log);
  const reads = await countingReads(async () => {
    assert.deepEqual(await store.load(), state());
    assert.deepEqual(await store.load(), state());
  });
  assert.equal(reads, 1, 'the second load answers from what the first one read');

  const writes = [
    store.save(state({ oauthState: 'one' })),
    store.save(state({ oauthState: 'two' })),
  ];
  const seen = (await store.load())?.oauthState;
  assert.equal(seen, 'two', 'a save is visible before the keychain has it');
  await Promise.all(writes);
  assert.deepEqual(written(account), { v: 1, state: state({ oauthState: 'two' }) });
});

test('a save that lands while the keychain is being read is the newer state', async () => {
  const account = nextAccount();
  keyring.set(SERVICE, account, JSON.stringify({ v: 1, state: state({ oauthState: 'old' }) }));
  const store = new KeychainOAuthStore(backend, account, memoryLog().log);
  const loading = store.load();
  const saving = store.save(state({ oauthState: 'new' }));
  assert.equal((await loading)?.oauthState, 'new');
  await saving;
  assert.deepEqual(written(account), { v: 1, state: state({ oauthState: 'new' }) });
});

test('a retired store drops writes and answers nothing; the item stays', async () => {
  const { log, lines } = memoryLog();
  const account = nextAccount();
  const store = new KeychainOAuthStore(backend, account, log);
  await store.save(state({ oauthState: 'kept' }));
  store.retire();
  await store.save(state({ oauthState: 'late' }));
  assert.equal(await store.load(), undefined);
  assert.deepEqual(written(account), { v: 1, state: state({ oauthState: 'kept' }) });
  assert.ok(lines.some((line) => line.includes('dropped a late write')));
});

test('removing the item waits for the writes queued before it, and retires the store', async () => {
  const account = nextAccount();
  const store = new KeychainOAuthStore(backend, account, memoryLog().log);
  const queued = store.save(state());
  const removed = store.remove();
  await store.save(state({ oauthState: 'after' }));
  await Promise.all([queued, removed]);
  assert.equal(keyring.accounts(SERVICE).get(account), undefined, 'no write outlived the removal');
  assert.equal(await store.load(), undefined);
});

test('a malformed item reads as no sign-in, unquoted; an unreadable keychain throws', async () => {
  const { log, lines } = memoryLog();
  const items = {
    garbled: '{"v":1,"state":{"tokens":"hunter2',
    shape: '{"v":1,"state":"hunter2"}',
  };
  for (const [name, item] of Object.entries(items)) {
    const account = `mcp:${name}:oauth`;
    keyring.set(SERVICE, account, item);
    assert.equal(await new KeychainOAuthStore(backend, account, log).load(), undefined, name);
  }
  assert.equal(lines.filter((line) => line.includes('sign in again')).length, 2);
  assert.ok(!lines.join('').includes('hunter2'), 'the value never reaches the log');

  const store = new KeychainOAuthStore(backend, nextAccount(), log);
  keyring.state.fail = (operation) => operation === 'get';
  try {
    await assert.rejects(store.load(), /could not be read/);
  } finally {
    keyring.state.fail = () => false;
  }
  assert.equal(await store.load(), undefined, 'the failed read is not remembered');
});

test('a sign-in is kept under the server, its principal and the service', () => {
  const record = httpRecord('acct');
  const account = oauthAccount(SERVICE, record);
  assert.ok(account.startsWith('mcp:') && account.endsWith(':oauth'), account);
  assert.equal(oauthAccount(SERVICE, record), account);
  for (const other of [
    oauthAccount(SERVICE, { ...record, principal: 'someone' }),
    oauthAccount(SERVICE, { ...record, serverId: 'acct-2' }),
    oauthAccount('another-service', record),
  ]) {
    assert.notEqual(other, account);
  }
});

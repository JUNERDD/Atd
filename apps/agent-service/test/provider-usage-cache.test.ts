import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServiceConnection } from '@atd/agent-contracts';
import type { ProviderStores } from '../dist/providers/runtime.js';
import { providerUsage } from '../dist/providers/usage.js';

function connectionFixture(overrides: Partial<ServiceConnection> = {}): ServiceConnection {
  return {
    connectionId: 'usage-cache',
    revision: 1,
    provider: 'kimi-coding',
    name: 'Kimi Code',
    baseUrl: 'https://api.kimi.com/coding/v1',
    authType: 'api_key',
    defaultModel: 'kimi-for-coding',
    connected: true,
    hasCredential: true,
    configurationId: 'config-1',
    verifiedModel: '',
    migratedAt: null,
    options: {},
    customModels: [],
    catalog: [],
    ...overrides,
  };
}

function storesFor(connection: ServiceConnection, read?: () => void): ProviderStores {
  return {
    dataDir: '/tmp',
    connections: {
      reload: async () => {},
      connection: () => connection,
    },
    keyring: {
      get: async () => {
        read?.();
        return JSON.stringify({ type: 'api_key', key: 'sk-test' });
      },
    },
  } as unknown as ProviderStores;
}

test('a new connection revision bypasses cached usage', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ usages: { limit_5h: { used_ratio: 0.25 } } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const connection = connectionFixture({ connectionId: 'usage-cache-revision' });
    assert.equal((await providerUsage(storesFor(connection), connection)).kind, 'ok');
    assert.equal((await providerUsage(storesFor(connection), connection)).kind, 'ok');
    assert.equal(calls, 1);

    const next = { ...connection, revision: connection.revision + 1 };
    assert.equal((await providerUsage(storesFor(next), next)).kind, 'ok');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a prototype-named provider is unsupported without reading the credential', async () => {
  let reads = 0;
  const connection = connectionFixture({
    provider: 'constructor',
    connectionId: 'usage-prototype',
  });
  assert.deepEqual(
    await providerUsage(
      storesFor(connection, () => (reads += 1)),
      connection,
    ),
    { kind: 'unsupported' },
  );
  assert.equal(reads, 0);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHATGPT_PRIVACY_VERSION, type ServiceConnection } from '@atd/agent-contracts';
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

function storesFor(
  connection: ServiceConnection,
  read?: () => void,
  credential?: () => string,
): ProviderStores {
  return {
    dataDir: '/tmp',
    connections: {
      reload: async () => {},
      connection: () => connection,
    },
    keyring: {
      get: async () => {
        read?.();
        return credential?.() ?? JSON.stringify({ type: 'api_key', key: 'sk-test' });
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

test('ChatGPT usage resolves its OAuth token through the runtime so an expired access token refreshes', async (t) => {
  // The runtime's getAuth refreshes an expired SIWC token under the credential lock; a stale
  // keyring `access` is never used directly. The injected runtime stands in for that resolution
  // so the query asserts it sends the fresh runtime token rather than the raw stored credential.
  const runtime = { getAuth: async () => ({ auth: { apiKey: 'fresh-access' } }) };
  const connection = connectionFixture({
    connectionId: 'usage-chatgpt-oauth',
    provider: 'openai',
    name: 'ChatGPT',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'oauth',
    chatgptConsent: {
      privacyVersion: CHATGPT_PRIVACY_VERSION,
      backgroundAllowed: false,
      acceptedAt: new Date().toISOString(),
    },
    chatgptPlanEnabled: true,
  });
  const stores = storesFor(connection, undefined, () =>
    JSON.stringify({
      type: 'oauth',
      protocol: 'siwc',
      clientId: 'client-1',
      access: 'stale-access',
      refresh: 'refresh-token',
      expires: Date.now() - 60_000,
      subject: 'sub-1',
      idToken: 'e30.e30.sig',
      scopes: [],
    }),
  );
  let bearer: string | null = null;
  let accountId: string | null = null;
  const captureFetch: typeof fetch = async (_url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    bearer = headers.authorization ?? null;
    accountId = headers['chatgpt-account-id'] ?? null;
    return new Response(
      JSON.stringify({
        rate_limit: {
          primary_window: {
            used_percent: 10,
            limit_window_seconds: 18_000,
            reset_at: 1_800_000_000,
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  t.mock.method(globalThis, 'fetch', captureFetch);
  assert.equal((await providerUsage(stores, connection, { runtime })).kind, 'ok');
  // The fresh runtime token (not the stale keyring access) reaches the usage endpoint.
  assert.equal(bearer, 'Bearer fresh-access');
  // The account header still comes from the stored credential's identity.
  assert.equal(accountId, 'sub-1');
});

test('an identity-only ChatGPT sign-in never calls the usage endpoint', async () => {
  const connection = connectionFixture({
    connectionId: 'usage-chatgpt-plan-disabled',
    provider: 'openai',
    name: 'ChatGPT',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'oauth',
    chatgptConsent: {
      privacyVersion: CHATGPT_PRIVACY_VERSION,
      backgroundAllowed: false,
      acceptedAt: new Date().toISOString(),
    },
    chatgptPlanEnabled: false,
  });
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(providerUsage(storesFor(connection), connection), /chatgpt_plan_disabled/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an explicit refresh bypasses the 30 second success cache', async () => {
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
    const connection = connectionFixture({ connectionId: 'usage-cache-refresh' });
    assert.equal((await providerUsage(storesFor(connection), connection)).kind, 'ok');
    assert.equal((await providerUsage(storesFor(connection), connection)).kind, 'ok');
    assert.equal(calls, 1);
    assert.equal(
      (await providerUsage(storesFor(connection), connection, { refresh: true })).kind,
      'ok',
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServiceConnection } from '@atd/agent-contracts';
import { KeyringUnavailable } from '../dist/credentials/keyring.js';
import {
  clearCredentialIssue,
  currentCredentialIssue,
  recordCredentialIssue,
} from '../dist/providers/credential-issues.js';
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

test('ChatGPT OAuth stays unsupported without reading or refreshing its credential', async () => {
  let reads = 0;
  const connection = connectionFixture({
    connectionId: 'usage-chatgpt-unsupported',
    provider: 'openai',
    name: 'ChatGPT',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'oauth',
    chatgptPlanEnabled: true,
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

test('a keychain read failure records an unreadable credential', async () => {
  const connection = connectionFixture({ connectionId: 'usage-keyring-unreadable' });
  const stores = storesFor(connection);
  stores.keyring.get = async () => {
    throw new KeyringUnavailable('denied');
  };
  const result = await providerUsage(stores, connection);
  assert.equal(result.kind, 'error');
  if (result.kind === 'error') assert.match(result.message, /Re-enter it in connection settings\./);
  assert.equal(currentCredentialIssue('/tmp', connection.connectionId), 'unreadable');
  const cachedIssue = await providerUsage(stores, connection);
  assert.equal(cachedIssue.kind, 'error');
  if (cachedIssue.kind === 'error')
    assert.match(cachedIssue.message, /Re-enter it in connection settings\./);
  clearCredentialIssue('/tmp', connection.connectionId);
});

test('a missing stored credential is recorded as missing', async () => {
  const connection = connectionFixture({ connectionId: 'usage-missing-credential' });
  const stores = storesFor(connection);
  stores.keyring.get = async () => undefined;
  const result = await providerUsage(stores, connection);
  assert.deepEqual(result, { kind: 'unavailable', reason: 'no-credential' });
  assert.equal(currentCredentialIssue('/tmp', connection.connectionId), 'missing');
  clearCredentialIssue('/tmp', connection.connectionId);
});

test('a missing OAuth credential is recorded as missing and updates stale unreadable on refresh', async () => {
  const connection = connectionFixture({
    connectionId: 'usage-missing-oauth',
    provider: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    authType: 'oauth',
  });
  const missingRuntime = { getAuth: async () => undefined };
  try {
    const first = await providerUsage(storesFor(connection), connection, {
      runtime: missingRuntime,
    });
    assert.deepEqual(first, { kind: 'unavailable', reason: 'no-credential' });
    assert.equal(currentCredentialIssue('/tmp', connection.connectionId), 'missing');

    const recorded = await providerUsage(storesFor(connection), connection, {
      runtime: missingRuntime,
    });
    assert.equal(recorded.kind, 'error');
    if (recorded.kind === 'error')
      assert.match(recorded.message, /Sign in again in connection settings\./);

    recordCredentialIssue('/tmp', connection.connectionId, 'unreadable');
    const refreshed = await providerUsage(storesFor(connection), connection, {
      refresh: true,
      runtime: { getAuth: async () => ({ auth: {} }) },
    });
    assert.deepEqual(refreshed, { kind: 'unavailable', reason: 'no-credential' });
    assert.equal(currentCredentialIssue('/tmp', connection.connectionId), 'missing');
  } finally {
    clearCredentialIssue('/tmp', connection.connectionId);
  }
});

test('a manual refresh clears a recorded issue after a readable credential', async () => {
  const connection = connectionFixture({ connectionId: 'usage-clear-issue' });
  recordCredentialIssue('/tmp', connection.connectionId, 'missing');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ usages: { limit_5h: { used_ratio: 0.1 } } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  try {
    const result = await providerUsage(storesFor(connection), connection, { refresh: true });
    assert.equal(result.kind, 'ok');
    assert.equal(currentCredentialIssue('/tmp', connection.connectionId), undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a non-JSON 200 response is an error, not an empty success', async () => {
  const connection = connectionFixture({ connectionId: 'usage-invalid-json' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('<html>login</html>', { status: 200 })) as typeof fetch;
  try {
    assert.equal((await providerUsage(storesFor(connection), connection)).kind, 'error');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a redirect is an error, not an empty success', async () => {
  const connection = connectionFixture({ connectionId: 'usage-redirect' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('', {
      status: 302,
      headers: { location: 'https://login.example.com' },
    })) as typeof fetch;
  try {
    assert.equal((await providerUsage(storesFor(connection), connection)).kind, 'error');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('concurrent usage reads share one request', async () => {
  const connection = connectionFixture({ connectionId: 'usage-single-flight' });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ usages: { limit_5h: { used_ratio: 0.1 } } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const [first, second] = await Promise.all([
      providerUsage(storesFor(connection), connection),
      providerUsage(storesFor(connection), connection),
    ]);
    assert.equal(first.kind, 'ok');
    assert.equal(second.kind, 'ok');
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an HTTP base URL requires explicit opt-in', async () => {
  const connection = connectionFixture({
    connectionId: 'usage-http',
    baseUrl: 'http://api.kimi.com/coding/v1',
  });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ usages: { limit_5h: { used_ratio: 0.1 } } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    assert.deepEqual(await providerUsage(storesFor(connection), connection), {
      kind: 'unsupported',
    });
    assert.equal(calls, 0);
    const allowed = { ...connection, allowInsecureUsage: true };
    assert.equal((await providerUsage(storesFor(allowed), allowed)).kind, 'ok');
    assert.equal(calls, 1);

    const loopback = connectionFixture({
      connectionId: 'usage-http-loopback',
      baseUrl: 'http://localhost:8080/v1',
    });
    assert.equal((await providerUsage(storesFor(loopback), loopback)).kind, 'ok');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

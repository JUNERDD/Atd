import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerInvalidation } from '../dist/invalidate.js';
import { registerProviderRoutes } from '../dist/providers/routes.js';
import {
  openRouterCredits,
  quotaWindow,
  resetTimeValue,
  unixTimestampToIso,
  type UsageRequest,
} from '../dist/providers/usage-adapters.js';
import { installMemoryKeyring } from './memory-keyring.ts';

interface ConnectionReply {
  connection: {
    connectionId: string;
    revision: number;
    baseUrl: string;
    allowInsecureUsage?: boolean;
  };
}

async function createProviderApp() {
  installMemoryKeyring();
  const dataDir = await mkdtemp(path.join(tmpdir(), 'provider-usage-routes-'));
  const app = Fastify({ exposeHeadRoutes: false });
  registerInvalidation(app, () => {});
  registerProviderRoutes(app, { serviceId: 'test-provider-usage-routes', dataDir });
  await app.ready();
  return {
    app,
    stop: async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test('OpenRouter /key maps effective_budget, monthly limits, uncapped keys, negative remaining, and errors', async () => {
  const urls: string[] = [];
  const callKey = (body: unknown, status = 200) => {
    const req: UsageRequest = {
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or-secret',
      signal: new AbortController().signal,
      fetch: async (url) => {
        urls.push(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      },
    };
    return openRouterCredits(req);
  };
  assert.deepEqual(
    await callKey({
      data: {
        limit: 100,
        limit_remaining: 90,
        usage: 10,
        effective_budget: {
          limit_usd: 50,
          remaining_usd: 32.5,
          spend_usd: 17.5,
          reset_interval: 'monthly',
        },
      },
    }),
    {
      kind: 'ok',
      windows: [],
      balance: {
        currency: 'USD',
        remaining: 32.5,
        total: 50,
        monthlyUsed: 17.5,
        monthlyLimit: 50,
        monthlyLimitEnabled: true,
      },
    },
  );
  assert.deepEqual(
    await callKey({
      data: {
        limit: 20,
        limit_remaining: 12.75,
        limit_reset: 'monthly',
        usage: 7.25,
        usage_monthly: 4.5,
      },
    }),
    {
      kind: 'ok',
      windows: [],
      balance: {
        currency: 'USD',
        remaining: 12.75,
        total: 20,
        monthlyUsed: 4.5,
        monthlyLimit: 20,
        monthlyLimitEnabled: true,
      },
    },
  );
  assert.deepEqual(await callKey({ data: { limit: 20, limit_remaining: null, usage: 21.5 } }), {
    kind: 'ok',
    windows: [],
    balance: { currency: 'USD', remaining: -1.5, total: 20 },
  });
  assert.deepEqual(
    await callKey({
      data: { limit: null, limit_remaining: null, effective_budget: null, usage: 7.25 },
    }),
    { kind: 'ok', windows: [] },
  );
  assert.deepEqual(await callKey({ error: { message: 'Forbidden' } }, 403), {
    kind: 'error',
    message: 'HTTP 403: Forbidden',
  });
  assert.deepEqual(await callKey({ error: { message: 'Unauthorized' } }, 401), {
    kind: 'error',
    message: 'HTTP 401: Unauthorized',
  });
  assert.ok(urls.every((url) => url === 'https://openrouter.ai/api/v1/key'));
});

test('timestamp helpers parse numeric epoch strings, ISO strings, and guard date bounds', () => {
  const iso = '2025-11-17T08:36:27.000Z';
  assert.equal(unixTimestampToIso('1763368587'), iso);
  assert.equal(unixTimestampToIso('1763368587000'), iso);
  assert.equal(unixTimestampToIso(1_763_368_587_000_000_000), undefined);
  assert.equal(unixTimestampToIso(Number.MAX_SAFE_INTEGER), undefined);
  assert.equal(resetTimeValue('1763368587'), iso);
  assert.equal(resetTimeValue('1763368587000'), iso);
  assert.equal(resetTimeValue('  2026-11-17T12:00:00Z  '), '2026-11-17T12:00:00Z');
  assert.equal(resetTimeValue('   '), undefined);
  assert.equal(resetTimeValue('0'), undefined);
  assert.equal(resetTimeValue('not-a-date'), undefined);
  assert.equal(resetTimeValue(1_763_368_587_000_000_000), undefined);
  assert.equal(resetTimeValue(Number.MAX_SAFE_INTEGER), undefined);
  assert.equal(
    quotaWindow('session', { used_ratio: 0.5, reset_time: '1763368587' })?.resetsAt,
    iso,
  );
  assert.equal(
    quotaWindow('session', { used_ratio: 0.5, reset_time: Number.MAX_SAFE_INTEGER })?.resetsAt,
    undefined,
  );
});

test('POST /v1/providers stores allowInsecureUsage only for non-loopback plain HTTP URLs', async (t) => {
  const { app, stop } = await createProviderApp();
  t.after(stop);

  const create = async (name: string, baseUrl: string, allowInsecureUsage?: boolean) => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/providers',
      payload: {
        provider: 'kimi-coding',
        name,
        baseUrl,
        authType: 'api_key',
        defaultModel: 'kimi-for-coding',
        options: {},
        customModels: [],
        credential: null,
        ...(allowInsecureUsage !== undefined ? { allowInsecureUsage } : {}),
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    return (res.json() as ConnectionReply).connection;
  };

  assert.equal(
    (await create('HTTP Gateway', 'http://gateway.lan/v1', true)).allowInsecureUsage,
    true,
  );
  assert.equal(
    (await create('HTTPS Gateway', 'https://api.kimi.com/coding/v1', true)).allowInsecureUsage,
    undefined,
  );
  assert.equal(
    (await create('Loopback Gateway', 'http://localhost:8080/v1', true)).allowInsecureUsage,
    undefined,
  );
  assert.equal((await create('Default URL', '', true)).allowInsecureUsage, undefined);
});

test('PUT /v1/providers/:connectionId preserves, updates, and clears allowInsecureUsage safely', async (t) => {
  const { app, stop } = await createProviderApp();
  t.after(stop);

  const created = await app.inject({
    method: 'POST',
    url: '/v1/providers',
    payload: {
      provider: 'kimi-coding',
      name: 'HTTP Gateway',
      baseUrl: 'http://gateway.lan/v1',
      authType: 'api_key',
      defaultModel: 'kimi-for-coding',
      options: {},
      customModels: [],
      credential: { type: 'api_key', key: 'sk-initial' },
      allowInsecureUsage: true,
    },
  });
  assert.equal(created.statusCode, 200, created.body);
  let current = (created.json() as ConnectionReply).connection;
  assert.equal(current.allowInsecureUsage, true);

  const update = async (
    baseUrl: string,
    opts: { allowInsecureUsage?: boolean; replaceKey?: boolean } = {},
  ) => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/providers/${current.connectionId}`,
      payload: {
        expectedRevision: current.revision,
        name: 'HTTP Gateway',
        baseUrl,
        defaultModel: 'kimi-for-coding',
        options: {},
        customModels: [],
        credential: opts.replaceKey
          ? { action: 'replace', credential: { type: 'api_key', key: 'sk-rotated' } }
          : { action: 'keep' },
        ...(opts.allowInsecureUsage !== undefined
          ? { allowInsecureUsage: opts.allowInsecureUsage }
          : {}),
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    current = (res.json() as ConnectionReply).connection;
    return current;
  };

  assert.equal((await update('http://gateway.lan/v1')).allowInsecureUsage, true);
  assert.equal(
    (await update('http://gateway.lan/v1', { allowInsecureUsage: false })).allowInsecureUsage,
    undefined,
  );
  assert.equal(
    (await update('http://gateway.lan/v1', { allowInsecureUsage: true })).allowInsecureUsage,
    true,
  );
  assert.equal(
    (await update('http://other-gateway.lan/v1', { replaceKey: true })).allowInsecureUsage,
    undefined,
  );
  assert.equal(
    (await update('http://other-gateway.lan/v1', { allowInsecureUsage: true })).allowInsecureUsage,
    true,
  );
  assert.equal(
    (await update('https://api.kimi.com/coding/v1', { allowInsecureUsage: true, replaceKey: true }))
      .allowInsecureUsage,
    undefined,
  );
  assert.equal(
    (await update('http://localhost:8080/v1', { allowInsecureUsage: true, replaceKey: true }))
      .allowInsecureUsage,
    undefined,
  );
  assert.equal(
    (await update('', { allowInsecureUsage: true, replaceKey: true })).allowInsecureUsage,
    undefined,
  );
});

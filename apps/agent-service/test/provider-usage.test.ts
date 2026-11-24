import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deepseekBalance,
  kimiUsage,
  moonshotBalance,
  numberValue,
  openRouterCredits,
  type UsageRequest,
} from '../dist/providers/usage-adapters.js';
import {
  minimaxUsage,
  openCodeGoUsage,
  zhipuUsage,
} from '../dist/providers/usage-plan-adapters.js';

function responding(
  body: unknown,
  options: { status?: number; baseUrl?: string } = {},
): UsageRequest {
  return {
    baseUrl: options.baseUrl ?? 'https://api.kimi.com/coding/v1',
    apiKey: 'sk-secret-value',
    signal: new AbortController().signal,
    fetch: async () =>
      new Response(JSON.stringify(body), {
        status: options.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
  };
}

test('Kimi Code maps session, weekly, and monthly windows plus its wallet', async () => {
  const usage = await kimiUsage(
    responding({
      usages: {
        limit_5h: { used_ratio: 0.01, reset_time: '2026-11-17T12:00:00Z' },
        limit_7d: { used_ratio: 0.15, reset_time: '2026-11-24T12:00:00Z' },
        limit_month_total: { used_ratio: 0.4 },
        limit_month_code: { used_ratio: 1 },
      },
      boosterWallet: {
        balance: { type: 'BOOSTER', amount: 10_000_000, amountLeft: 5_000_000 },
        monthlyChargeLimitEnabled: true,
        monthlyChargeLimit: { priceInCents: 1000, currency: 'USD' },
        monthlyUsed: { priceInCents: 250, currency: 'USD' },
      },
    }),
  );
  assert.equal(usage.kind, 'ok');
  if (usage.kind !== 'ok') return;
  assert.deepEqual(
    usage.windows.map((window) => window.id),
    ['session', 'weekly', 'monthly', 'monthlyCode'],
  );
  assert.equal(usage.windows[0]?.usedRatio, 0.01);
  assert.equal(usage.windows[0]?.resetsAt, '2026-11-17T12:00:00Z');
  assert.equal(usage.windows[3]?.usedRatio, 1);
  assert.equal(usage.balance?.currency, 'USD');
  assert.equal(usage.balance?.remaining, 5);
  assert.equal(usage.balance?.total, 10);
  assert.equal(usage.balance?.monthlyUsed, 2.5);
  assert.equal(usage.balance?.monthlyLimit, 10);
  assert.equal(usage.balance?.monthlyLimitEnabled, true);
});

test('an unauthorized usage response never echoes the API key', async () => {
  const usage = await kimiUsage(
    responding({ error: { message: 'Invalid API key' } }, { status: 401 }),
  );
  assert.equal(usage.kind, 'error');
  if (usage.kind !== 'error') return;
  assert.match(usage.message, /HTTP 401: Invalid API key/);
  assert.doesNotMatch(usage.message, /sk-secret-value/);
});

test('DeepSeek reports the account balance for the key', async () => {
  const usage = await deepseekBalance(
    responding(
      {
        is_available: true,
        balance_infos: [
          {
            currency: 'CNY',
            total_balance: '12.34',
            granted_balance: '0.00',
            topped_up_balance: '12.34',
          },
        ],
      },
      { baseUrl: 'https://api.deepseek.com' },
    ),
  );
  assert.deepEqual(usage, {
    kind: 'ok',
    windows: [],
    balance: { currency: 'CNY', remaining: 12.34 },
  });
});

test('Moonshot reports its available balance in the regional currency', async () => {
  const usage = await moonshotBalance(
    responding(
      { code: 0, data: { available_balance: 8.5, voucher_balance: 0, cash_balance: 8.5 } },
      { baseUrl: 'https://api.moonshot.cn/v1' },
    ),
    'https://api.moonshot.cn/v1',
    'CNY',
  );
  assert.deepEqual(usage, {
    kind: 'ok',
    windows: [],
    balance: { currency: 'CNY', remaining: 8.5 },
  });
});

test('OpenRouter derives the remaining credits from total usage', async () => {
  const usage = await openRouterCredits(
    responding(
      { data: { total_credits: 20, total_usage: 7.25 } },
      { baseUrl: 'https://openrouter.ai/api/v1' },
    ),
  );
  assert.deepEqual(usage, {
    kind: 'ok',
    windows: [],
    balance: { currency: 'USD', remaining: 12.75, total: 20 },
  });
});

test('Kimi Code accepts the newer limits and usage shape', async () => {
  const usage = await kimiUsage(
    responding({
      limits: [{ detail: { limit: 100, remaining: 60, resetTime: '2026-11-17T08:36:27Z' } }],
      usage: { limit: 1000, remaining: 800, resetTime: '2026-11-24T08:36:27Z' },
    }),
  );
  assert.equal(usage.kind, 'ok');
  if (usage.kind !== 'ok') return;
  assert.deepEqual(
    usage.windows.map((window) => [window.id, window.usedRatio]),
    [
      ['session', 0.4],
      ['weekly', 0.2],
    ],
  );
});

test('Z.AI maps coding-plan windows by unit', async () => {
  const usage = await zhipuUsage(
    responding(
      {
        success: true,
        data: {
          level: 'max',
          limits: [
            { type: 'TOKENS_LIMIT', unit: 3, percentage: 20 },
            { type: 'TOKENS_LIMIT', unit: 6, percentage: 40 },
          ],
        },
      },
      { baseUrl: 'https://api.z.ai/api/coding/paas/v4' },
    ),
    'https://api.z.ai',
  );
  assert.equal(usage.kind, 'ok');
  if (usage.kind !== 'ok') return;
  assert.deepEqual(
    usage.windows.map((window) => [window.id, window.usedRatio]),
    [
      ['session', 0.2],
      ['weekly', 0.4],
    ],
  );
});

test('Zhipu pay-as-you-go accounts fall back to the account balance', async () => {
  const request = responding(
    { success: false, msg: '当前用户不存在coding plan' },
    { baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4' },
  );
  let calls = 0;
  request.fetch = async (url) => {
    calls += 1;
    const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    const body = target.includes('/api/biz/')
      ? { success: true, data: { availableBalance: 12.5 } }
      : { success: false, msg: '当前用户不存在coding plan' };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const usage = await zhipuUsage(request, 'https://open.bigmodel.cn');
  assert.equal(calls, 2);
  assert.deepEqual(usage, {
    kind: 'ok',
    windows: [],
    balance: { currency: 'CNY', remaining: 12.5 },
  });
});

test('MiniMax maps interval and weekly remaining percentages', async () => {
  const usage = await minimaxUsage(
    responding(
      {
        base_resp: { status_code: 0, status_msg: 'success' },
        model_remains: [
          {
            model_name: 'general',
            current_interval_remaining_percent: 60,
            current_weekly_remaining_percent: 30,
            current_weekly_status: 1,
            end_time: Date.now() + 3_600_000,
            weekly_end_time: Date.now() + 86_400_000,
          },
        ],
      },
      { baseUrl: 'https://api.minimax.io/anthropic' },
    ),
    true,
  );
  assert.equal(usage.kind, 'ok');
  if (usage.kind !== 'ok') return;
  assert.deepEqual(
    usage.windows.map((window) => [window.id, window.usedRatio]),
    [
      ['session', 0.4],
      ['weekly', 0.7],
    ],
  );
});

test('OpenCode Go maps rolling, weekly, and monthly windows', async () => {
  const usage = await openCodeGoUsage(
    responding(
      {
        usage: {
          rolling: { status: 'ok', percent: 25, resetsAt: '2026-11-17T08:36:27Z' },
          weekly: { status: 'ok', percent: 50, resetsAt: '2026-11-20T08:36:27Z' },
          monthly: { status: 'ok', percent: 75, resetsAt: '2026-12-17T08:36:27Z' },
        },
      },
      { baseUrl: 'https://opencode.ai/zen/go/v1' },
    ),
  );
  assert.equal(usage.kind, 'ok');
  if (usage.kind !== 'ok') return;
  assert.deepEqual(
    usage.windows.map((window) => [window.id, window.usedRatio]),
    [
      ['session', 0.25],
      ['weekly', 0.5],
      ['monthly', 0.75],
    ],
  );
});

test('empty numeric strings are missing, not zero', () => {
  assert.equal(numberValue(''), null);
  assert.equal(numberValue('   '), null);
  assert.equal(numberValue('12.5'), 12.5);
});

test('custom endpoints do not receive usage keys', async () => {
  let calls = 0;
  const request = responding({});
  request.baseUrl = 'https://gateway.example.com';
  request.fetch = (async () => {
    calls += 1;
    return new Response('{}');
  }) as typeof fetch;
  assert.deepEqual(await zhipuUsage(request, 'https://api.z.ai'), { kind: 'unsupported' });
  assert.deepEqual(await minimaxUsage(request, false), { kind: 'unsupported' });
  assert.deepEqual(await openCodeGoUsage(request), { kind: 'unsupported' });
  assert.equal(calls, 0);
});

test('cleartext and non-standard vendor origins are unsupported', async () => {
  assert.deepEqual(
    await zhipuUsage(
      responding({}, { baseUrl: 'http://api.z.ai/api/coding/paas/v4' }),
      'https://api.z.ai',
    ),
    { kind: 'unsupported' },
  );
  assert.deepEqual(
    await zhipuUsage(
      responding({}, { baseUrl: 'https://api.z.ai:8443/api/coding/paas/v4' }),
      'https://api.z.ai',
    ),
    { kind: 'unsupported' },
  );
});

import type {
  ProviderUsageBalance,
  ProviderUsageResponse,
  ProviderUsageWindow,
  ProviderUsageWindowId,
} from '@atd/agent-contracts';

/** One provider usage request: the connection's endpoint and the API key to authenticate it. */
export interface UsageRequest {
  baseUrl: string;
  apiKey: string;
  /** The user explicitly allowed this connection's usage URL to use plain HTTP. */
  allowInsecure?: boolean;
  fetch: typeof fetch;
  signal: AbortSignal;
}

export type UsageAdapter = (request: UsageRequest) => Promise<ProviderUsageResponse>;

type RecordValue = Record<string, unknown>;

const KIMI_CODE_BASE_URL = 'https://api.kimi.com/coding/v1';
const MAX_RESPONSE_LENGTH = 1_000_000;

export function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function numberValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  // `Number('')` and `Number('   ')` are `0`, which would turn a missing upstream value into a
  // real balance or a fully used window.
  const text = value.trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Loopback HTTP never leaves the machine, so it is safe without the insecure opt-in. */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(hostname);
}

/** Whether a usage URL may receive the API key without an explicit insecure opt-in. */
export function isSecureUsageUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname));
  } catch {
    return false;
  }
}

export function endpoint(baseUrl: string, path: string, fallback: string): string {
  return `${(baseUrl || fallback).replace(/\/+$/, '')}${path}`;
}

export async function getJson(
  request: UsageRequest,
  url: string,
  headers: Record<string, string> = {},
): Promise<{ response: Response; json: unknown }> {
  const response = await request.fetch(url, {
    headers: {
      authorization: `Bearer ${request.apiKey}`,
      accept: 'application/json',
      ...headers,
    },
    // A login/WAF redirect must not turn into a 200 HTML page parsed as an empty usage result.
    redirect: 'manual',
    signal: request.signal,
  });
  const text = await response.text();
  if (text.length > MAX_RESPONSE_LENGTH) throw new Error('The usage response was too large.');
  if (!response.ok) {
    try {
      return { response, json: JSON.parse(text) };
    } catch {
      return { response, json: null };
    }
  }
  try {
    return { response, json: JSON.parse(text) };
  } catch {
    throw new Error('The usage response was not valid JSON.');
  }
}

/**
 * An error response never echoes the credential: only the status and the provider's own message
 * reach the UI, which is what a user needs to fix access.
 */
export function failure(response: Response, json: unknown): ProviderUsageResponse {
  const detail =
    (isRecord(json) && isRecord(json.error) && textValue(json.error.message)) ||
    (isRecord(json) && textValue(json.message)) ||
    null;
  return {
    kind: 'error',
    message: `HTTP ${response.status}${detail ? `: ${detail}` : ''}`.slice(0, 2000),
  };
}

export function quotaWindow(id: ProviderUsageWindowId, value: unknown): ProviderUsageWindow | null {
  if (!isRecord(value)) return null;
  const usedRatio = numberValue(value.used_ratio);
  if (usedRatio === null) return null;
  const resetsAt = resetTimeValue(value.reset_time);
  return {
    id,
    usedRatio: Math.min(Math.max(usedRatio, 0), 1),
    ...(resetsAt ? { resetsAt } : {}),
  };
}

/** A fixed-point amount in millionths of one currency unit, as the Kimi wallet reports it. */
function micros(value: unknown): number | null {
  const amount = numberValue(value);
  return amount === null ? null : Math.round((amount / 1_000_000) * 100) / 100;
}

function kimiBalance(wallet: unknown): ProviderUsageBalance | undefined {
  if (!isRecord(wallet) || !isRecord(wallet.balance)) return undefined;
  if (textValue(wallet.balance.type) !== 'BOOSTER') return undefined;
  const total = micros(wallet.balance.amount);
  if (total === null || total <= 0) return undefined;
  const remaining = micros(wallet.balance.amountLeft) ?? 0;
  const monthlyLimit = isRecord(wallet.monthlyChargeLimit)
    ? numberValue(wallet.monthlyChargeLimit.priceInCents)
    : null;
  const monthlyUsed = isRecord(wallet.monthlyUsed)
    ? numberValue(wallet.monthlyUsed.priceInCents)
    : null;
  const currency =
    (isRecord(wallet.monthlyChargeLimit) && textValue(wallet.monthlyChargeLimit.currency)) ||
    (isRecord(wallet.monthlyUsed) && textValue(wallet.monthlyUsed.currency)) ||
    'USD';
  return {
    currency,
    remaining,
    total,
    ...(monthlyUsed === null ? {} : { monthlyUsed: monthlyUsed / 100 }),
    ...(monthlyLimit === null ? {} : { monthlyLimit: monthlyLimit / 100 }),
    ...(typeof wallet.monthlyChargeLimitEnabled === 'boolean'
      ? { monthlyLimitEnabled: wallet.monthlyChargeLimitEnabled }
      : {}),
  };
}

/** A provider percentage or fraction, clamped to the contract's 0–1 ratio. */
export function clampRatio(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

const MAX_DATE_MS = 8_640_000_000_000_000;

/** A unix timestamp that may be seconds or milliseconds, as an ISO string. */
export function unixTimestampToIso(value: unknown): string | undefined {
  const timestamp = numberValue(value);
  if (timestamp === null || timestamp <= 0) return undefined;
  const milliseconds = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  if (!Number.isFinite(milliseconds) || milliseconds > MAX_DATE_MS) return undefined;
  const date = new Date(Math.trunc(milliseconds));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** A reset value that may be a unix timestamp (number or numeric string) or a parseable date string. */
export function resetTimeValue(value: unknown): string | undefined {
  if (numberValue(value) !== null) return unixTimestampToIso(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && Number.isFinite(Date.parse(trimmed)) ? trimmed : undefined;
}

/** Kimi Code reports a five-hour session, a weekly window, and monthly quotas. */
export async function kimiUsage(request: UsageRequest): Promise<ProviderUsageResponse> {
  const { response, json } = await getJson(
    request,
    endpoint(request.baseUrl, '/usages', KIMI_CODE_BASE_URL),
  );
  if (!response.ok) return failure(response, json);
  const usages = isRecord(json) && isRecord(json.usages) ? json.usages : {};
  const windows: ProviderUsageWindow[] = [
    quotaWindow('session', usages.limit_5h),
    quotaWindow('weekly', usages.limit_7d),
    quotaWindow('monthly', usages.limit_month_total),
    quotaWindow('monthlyCode', usages.limit_month_code),
  ].filter((window): window is ProviderUsageWindow => window !== null);
  // Newer Kimi responses split the five-hour limit into `limits[]` and the weekly one into
  // `usage`; accept both shapes without inventing a window the response did not report.
  if (!windows.length && isRecord(json)) {
    const limits = Array.isArray(json.limits) ? json.limits.filter(isRecord) : [];
    for (const item of limits) {
      if (!isRecord(item.detail)) continue;
      const limit = numberValue(item.detail.limit);
      const remaining = numberValue(item.detail.remaining);
      if (limit === null || remaining === null || limit <= 0) continue;
      const resetsAt = resetTimeValue(item.detail.resetTime);
      windows.push({
        id: 'session',
        usedRatio: clampRatio((limit - remaining) / limit),
        ...(resetsAt ? { resetsAt } : {}),
      });
    }
    if (isRecord(json.usage)) {
      const limit = numberValue(json.usage.limit);
      const remaining = numberValue(json.usage.remaining);
      if (limit !== null && remaining !== null && limit > 0) {
        const resetsAt = resetTimeValue(json.usage.resetTime);
        windows.push({
          id: 'weekly',
          usedRatio: clampRatio((limit - remaining) / limit),
          ...(resetsAt ? { resetsAt } : {}),
        });
      }
    }
  }
  const balance = isRecord(json) ? kimiBalance(json.boosterWallet) : undefined;
  const unique = new Map(windows.map((window) => [window.id, window]));
  return { kind: 'ok', windows: [...unique.values()], ...(balance ? { balance } : {}) };
}

/** DeepSeek publishes the account balance for the API key. */
export async function deepseekBalance(request: UsageRequest): Promise<ProviderUsageResponse> {
  const { response, json } = await getJson(
    request,
    endpoint(request.baseUrl, '/user/balance', 'https://api.deepseek.com'),
  );
  if (!response.ok) return failure(response, json);
  const info =
    isRecord(json) && Array.isArray(json.balance_infos)
      ? json.balance_infos.find(isRecord)
      : undefined;
  const remaining = info ? numberValue(info.total_balance) : null;
  if (remaining === null) return { kind: 'ok', windows: [] };
  return {
    kind: 'ok',
    windows: [],
    balance: { currency: (info && textValue(info.currency)) || 'CNY', remaining },
  };
}

/** Moonshot reports a balance on its Open Platform accounts; the currency follows the region. */
export async function moonshotBalance(
  request: UsageRequest,
  fallbackBaseUrl: string,
  currency: string,
): Promise<ProviderUsageResponse> {
  const { response, json } = await getJson(
    request,
    endpoint(request.baseUrl, '/users/me/balance', fallbackBaseUrl),
  );
  if (!response.ok) return failure(response, json);
  const data = isRecord(json) && isRecord(json.data) ? json.data : undefined;
  const remaining = data ? numberValue(data.available_balance) : null;
  if (remaining === null) return { kind: 'ok', windows: [] };
  return { kind: 'ok', windows: [], balance: { currency, remaining } };
}

/**
 * OpenRouter exposes per-key budget and limits on `GET /api/v1/key` for standard inference and
 * OAuth keys (`GET /api/v1/credits` requires a management key that cannot run completions).
 */
export async function openRouterCredits(request: UsageRequest): Promise<ProviderUsageResponse> {
  const { response, json } = await getJson(
    request,
    endpoint(request.baseUrl, '/key', 'https://openrouter.ai/api/v1'),
  );
  if (!response.ok) return failure(response, json);
  const data = isRecord(json) && isRecord(json.data) ? json.data : undefined;
  if (!data) return { kind: 'ok', windows: [] };
  const effective = isRecord(data.effective_budget) ? data.effective_budget : undefined;
  const effectiveRemaining = effective ? numberValue(effective.remaining_usd) : null;
  let remaining: number | null;
  let total: number | null;
  let monthly = false;
  let monthlySpend: number | null = null;
  if (effective && effectiveRemaining !== null) {
    remaining = effectiveRemaining;
    total = numberValue(effective.limit_usd);
    monthly = textValue(effective.reset_interval) === 'monthly';
    monthlySpend = numberValue(effective.spend_usd);
  } else {
    total = numberValue(data.limit);
    const usage = numberValue(data.usage);
    remaining =
      numberValue(data.limit_remaining) ??
      (total !== null && usage !== null ? total - usage : null);
    monthly = !effective && textValue(data.limit_reset) === 'monthly';
    monthlySpend = numberValue(data.usage_monthly);
  }
  if (remaining === null) return { kind: 'ok', windows: [] };
  return {
    kind: 'ok',
    windows: [],
    balance: {
      currency: 'USD',
      remaining,
      ...(total !== null && total >= 0 ? { total } : {}),
      ...(monthly && total !== null && total > 0 && monthlySpend !== null
        ? {
            monthlyUsed: Math.max(monthlySpend, 0),
            monthlyLimit: total,
            monthlyLimitEnabled: true,
          }
        : {}),
    },
  };
}

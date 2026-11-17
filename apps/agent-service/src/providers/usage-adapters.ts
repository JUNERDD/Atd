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
  /** ChatGPT account ID for OAuth connections; unused by API-key providers. */
  accountId?: string;
  fetch: typeof fetch;
  signal: AbortSignal;
}

export type UsageAdapter = (request: UsageRequest) => Promise<ProviderUsageResponse>;

type RecordValue = Record<string, unknown>;

const KIMI_CODE_BASE_URL = 'https://api.kimi.com/coding/v1';

export function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function numberValue(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
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
    signal: request.signal,
  });
  return { response, json: await response.json().catch(() => null) };
}

/**
 * An error response never echoes the credential: only the status and the provider's own message
 * reach the UI, which is what a user needs to fix access.
 */
export function failure(response: Response, json: unknown): ProviderUsageResponse {
  const message =
    (isRecord(json) && isRecord(json.error) && textValue(json.error.message)) ||
    (isRecord(json) && textValue(json.message)) ||
    null;
  return { kind: 'error', message: `HTTP ${response.status}${message ? `: ${message}` : ''}` };
}

export function quotaWindow(id: ProviderUsageWindowId, value: unknown): ProviderUsageWindow | null {
  if (!isRecord(value)) return null;
  const usedRatio = numberValue(value.used_ratio);
  if (usedRatio === null) return null;
  const resetsAt = textValue(value.reset_time);
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

/** A provider's unix timestamp in seconds, as an ISO string; zero and negative mean "none". */
export function unixSecondsToIso(value: unknown): string | undefined {
  const seconds = numberValue(value);
  if (seconds === null || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

/** A unix timestamp that may be seconds or milliseconds, as an ISO string. */
export function unixTimestampToIso(value: unknown): string | undefined {
  const timestamp = numberValue(value);
  if (timestamp === null || timestamp <= 0) return undefined;
  const milliseconds = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  return new Date(milliseconds).toISOString();
}

/** A reset value that may already be an ISO string or a millisecond timestamp. */
export function resetTimeValue(value: unknown): string | undefined {
  return textValue(value) ?? unixTimestampToIso(value);
}

/** Map a rate-limit window length to the shared window IDs; unknown lengths stay unlabelled. */
export function windowFromSeconds(value: unknown): ProviderUsageWindowId | null {
  const seconds = numberValue(value);
  if (seconds === null || seconds <= 0) return null;
  if (seconds === 18_000) return 'session';
  if (seconds === 604_800) return 'weekly';
  if (seconds === 2_592_000) return 'monthly';
  return null;
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

/** OpenRouter reports total purchased credits and total usage, so the balance is their difference. */
export async function openRouterCredits(request: UsageRequest): Promise<ProviderUsageResponse> {
  const { response, json } = await getJson(
    request,
    endpoint(request.baseUrl, '/credits', 'https://openrouter.ai/api/v1'),
  );
  if (!response.ok) return failure(response, json);
  const data = isRecord(json) && isRecord(json.data) ? json.data : undefined;
  const total = data ? numberValue(data.total_credits) : null;
  if (total === null) return { kind: 'ok', windows: [] };
  const used = (data && numberValue(data.total_usage)) ?? 0;
  return {
    kind: 'ok',
    windows: [],
    balance: { currency: 'USD', remaining: Math.max(total - used, 0), total },
  };
}

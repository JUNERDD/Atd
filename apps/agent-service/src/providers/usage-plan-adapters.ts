import type { ProviderUsageResponse, ProviderUsageWindow } from '@atd/agent-contracts';
import {
  clampRatio,
  failure,
  getJson,
  isRecord,
  numberValue,
  resetTimeValue,
  textValue,
  unixTimestampToIso,
  type UsageRequest,
} from './usage-adapters.js';

type WindowBody = Omit<ProviderUsageWindow, 'id'>;

const ZHIPU_HOSTS = ['api.z.ai', 'open.bigmodel.cn'];
const MINIMAX_HOSTS = ['api.minimax.io', 'api.minimax.cn', 'api.minimaxi.com'];
const OPENCODE_HOSTS = ['opencode.ai'];

/**
 * The vendor origin that serves usage, or `undefined` when the connection points at a custom
 * endpoint. Usage endpoints authenticate with the saved API key, so a custom gateway must not
 * receive it; the caller answers `unsupported` instead.
 */
function vendorOrigin(baseUrl: string, hosts: readonly string[]): string | undefined {
  if (!baseUrl) return undefined;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return undefined;
    return hosts.includes(url.hostname) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** The vendor origin for a connection, falling back to the provider's default usage host. */
function usageOrigin(baseUrl: string, hosts: readonly string[], fallback: string): string | null {
  if (baseUrl) return vendorOrigin(baseUrl, hosts) ?? null;
  return fallback;
}

async function zhipuBalance(request: UsageRequest, origin: string): Promise<ProviderUsageResponse> {
  const { response, json } = await getJson(
    request,
    `${origin}/api/biz/account/query-customer-account-report`,
    { authorization: request.apiKey },
  );
  if (!response.ok) return failure(response, json);
  if (!isRecord(json)) return { kind: 'ok', windows: [] };
  if (json.success === false)
    return {
      kind: 'error',
      message: `API error: ${textValue(json.msg) ?? 'Unknown error'}`.slice(0, 2000),
    };
  const data = isRecord(json.data) ? json.data : json;
  const remaining = numberValue(data.availableBalance) ?? numberValue(data.balance);
  if (remaining === null) return { kind: 'ok', windows: [] };
  return {
    kind: 'ok',
    windows: [],
    balance: {
      currency: origin.includes('bigmodel.cn') ? 'CNY' : 'USD',
      remaining,
    },
  };
}

/** A pay-as-you-go Zhipu account has no Coding Plan; its balance is the useful number. */
function isNoCodingPlan(message: string): boolean {
  const compact = message.toLowerCase().replace(/[\s_-]/g, '');
  return (
    compact.includes('codingplan') &&
    [
      '不存在',
      '没有',
      '未开通',
      'notexist',
      'notfound',
      'nothave',
      'nocodingplan',
      'notsubscribed',
    ].some((keyword) => compact.includes(keyword))
  );
}

/**
 * Z.AI / Zhipu coding-plan windows. The quota endpoint lives on the host's origin and the key
 * travels without the `Bearer` prefix, unlike the inference API.
 */
export async function zhipuUsage(
  request: UsageRequest,
  fallbackOrigin: string,
): Promise<ProviderUsageResponse> {
  const origin = usageOrigin(request.baseUrl, ZHIPU_HOSTS, fallbackOrigin);
  if (!origin) return { kind: 'unsupported' };
  const { response, json } = await getJson(request, `${origin}/api/monitor/usage/quota/limit`, {
    authorization: request.apiKey,
    'accept-language': 'en-US,en',
  });
  if (!response.ok) return failure(response, json);
  if (!isRecord(json)) return { kind: 'ok', windows: [] };
  if (json.success === false) {
    const message = textValue(json.msg) ?? 'Unknown error';
    if (isNoCodingPlan(message)) return zhipuBalance(request, origin);
    return { kind: 'error', message: `API error: ${message}`.slice(0, 2000) };
  }
  const data = isRecord(json.data) ? json.data : undefined;
  if (!data) return { kind: 'error', message: "Missing 'data' field in response." };
  const limits = Array.isArray(data.limits) ? data.limits.filter(isRecord) : [];
  const windows: { session?: ProviderUsageWindow; weekly?: ProviderUsageWindow } = {};
  const unclassified: WindowBody[] = [];
  for (const item of limits) {
    const type = textValue(item.type);
    if (type && !/^(TOKENS_LIMIT|CREDIT_LIMIT)$/i.test(type)) continue;
    const percentage = numberValue(item.percentage);
    if (percentage === null) continue;
    const resetsAt = unixTimestampToIso(item.nextResetTime);
    const body: WindowBody = {
      usedRatio: clampRatio(percentage / 100),
      ...(resetsAt ? { resetsAt } : {}),
    };
    const unit = numberValue(item.unit);
    if (unit === 3) windows.session ??= { id: 'session', ...body };
    else if (unit === 6) windows.weekly ??= { id: 'weekly', ...body };
    else unclassified.push(body);
  }
  for (const body of unclassified) {
    if (!windows.session) windows.session = { id: 'session', ...body };
    else if (!windows.weekly) windows.weekly = { id: 'weekly', ...body };
  }
  return {
    kind: 'ok',
    windows: [windows.session, windows.weekly].filter((window): window is ProviderUsageWindow =>
      Boolean(window),
    ),
  };
}

/** MiniMax reports remaining percentages for its five-hour and optional weekly windows. */
export async function minimaxUsage(
  request: UsageRequest,
  isCn: boolean,
): Promise<ProviderUsageResponse> {
  const origin = usageOrigin(
    request.baseUrl,
    MINIMAX_HOSTS,
    isCn ? 'https://api.minimaxi.com' : 'https://api.minimax.io',
  );
  if (!origin) return { kind: 'unsupported' };
  const { response, json } = await getJson(
    request,
    `${origin}/v1/api/openplatform/coding_plan/remains`,
  );
  if (!response.ok) return failure(response, json);
  if (!isRecord(json)) return { kind: 'ok', windows: [] };
  if (isRecord(json.base_resp)) {
    const status = numberValue(json.base_resp.status_code);
    if (status !== null && status !== 0)
      return {
        kind: 'error',
        message:
          `API error (code ${status}): ${textValue(json.base_resp.status_msg) ?? 'Unknown error'}`.slice(
            0,
            2000,
          ),
      };
  }
  const item = Array.isArray(json.model_remains)
    ? json.model_remains.find((entry) => isRecord(entry) && entry.model_name === 'general')
    : undefined;
  if (!isRecord(item)) return { kind: 'ok', windows: [] };
  const windows: ProviderUsageWindow[] = [];
  const interval = numberValue(item.current_interval_remaining_percent);
  if (interval !== null) {
    const resetsAt = unixTimestampToIso(item.end_time);
    windows.push({
      id: 'session',
      usedRatio: clampRatio((100 - interval) / 100),
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  // Weekly status 1 is active, 2 is exhausted (still a real limit), 3 means no weekly limit.
  const weeklyStatus = numberValue(item.current_weekly_status);
  const weekly = numberValue(item.current_weekly_remaining_percent);
  if ((weeklyStatus === 1 || weeklyStatus === 2) && weekly !== null) {
    const resetsAt = unixTimestampToIso(item.weekly_end_time);
    windows.push({
      id: 'weekly',
      usedRatio: clampRatio((100 - weekly) / 100),
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  return { kind: 'ok', windows };
}

const OPEN_CODE_GO_ORIGIN = 'https://opencode.ai';

/** OpenCode Go exposes rolling (five-hour), weekly and monthly used percentages. */
export async function openCodeGoUsage(request: UsageRequest): Promise<ProviderUsageResponse> {
  const origin = usageOrigin(request.baseUrl, OPENCODE_HOSTS, OPEN_CODE_GO_ORIGIN);
  if (!origin) return { kind: 'unsupported' };
  const { response, json } = await getJson(request, `${origin}/zen/go/v1/usage`);
  if (response.status === 403)
    return {
      kind: 'error',
      message: 'API key is valid but has no OpenCode Go subscription (HTTP 403).',
    };
  if (!response.ok) return failure(response, json);
  const usage = isRecord(json) && isRecord(json.usage) ? json.usage : undefined;
  if (!usage) return { kind: 'ok', windows: [] };
  const windows: ProviderUsageWindow[] = [];
  for (const [key, id] of [
    ['rolling', 'session'],
    ['weekly', 'weekly'],
    ['monthly', 'monthly'],
  ] as const) {
    const window = usage[key];
    if (!isRecord(window)) continue;
    const percent = numberValue(window.percent);
    if (percent === null) continue;
    const resetsAt = percent > 0 ? resetTimeValue(window.resetsAt) : undefined;
    windows.push({
      id,
      usedRatio: clampRatio(percent / 100),
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  return { kind: 'ok', windows };
}

import {
  CHATGPT_PRIVACY_VERSION,
  type ProviderUsageResponse,
  type ServiceConnection,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import { connectionCredentials, connectionRuntime, type ProviderStores } from './runtime.js';
import {
  clampRatio,
  deepseekBalance,
  kimiUsage,
  moonshotBalance,
  openRouterCredits,
  type UsageAdapter,
} from './usage-adapters.js';
import { chatgptUsage, minimaxUsage, openCodeGoUsage, zhipuUsage } from './usage-plan-adapters.js';

const CACHE_MS = 30_000;
const FAILURE_CACHE_MS = 5_000;
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_LIMIT = 50;

/** The auth lookup usage needs from Pi's runtime; tests can substitute it. */
export interface UsageAuthRuntime {
  getAuth(provider: string): Promise<{ auth: { apiKey?: string } } | undefined>;
}

const adapters = new Map<string, UsageAdapter>([
  ['kimi-coding', kimiUsage],
  ['moonshotai', (request) => moonshotBalance(request, 'https://api.moonshot.ai/v1', 'USD')],
  ['moonshotai-cn', (request) => moonshotBalance(request, 'https://api.moonshot.cn/v1', 'CNY')],
  ['deepseek', deepseekBalance],
  ['openrouter', openRouterCredits],
  ['zai', (request) => zhipuUsage(request, 'https://api.z.ai')],
  ['zai-coding-cn', (request) => zhipuUsage(request, 'https://open.bigmodel.cn')],
  ['minimax', (request) => minimaxUsage(request, false)],
  ['minimax-cn', (request) => minimaxUsage(request, true)],
  ['opencode-go', openCodeGoUsage],
]);

const cache = new Map<string, { at: number; value: ProviderUsageResponse }>();

const MESSAGE_LIMIT = 2000;
const RESET_LIMIT = 64;
const CURRENCY_LIMIT = 16;

/**
 * ChatGPT's usage endpoint keys on the workspace account ID, which the stored OIDC ID token
 * carries under the OpenAI auth claim. Fall back to the OIDC subject for older credentials.
 */
export function chatgptAccountId(credential: {
  subject?: unknown;
  idToken?: unknown;
}): string | undefined {
  if (typeof credential.idToken === 'string') {
    const payload = credential.idToken.split('.')[1];
    if (payload) {
      try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
          string,
          unknown
        >;
        const auth = claims['https://api.openai.com/auth'];
        if (auth && typeof auth === 'object' && !Array.isArray(auth)) {
          const accountId = (auth as Record<string, unknown>)['chatgpt_account_id'];
          if (typeof accountId === 'string' && accountId) return accountId;
        }
      } catch {
        // A malformed ID token leaves the OIDC subject as the usable fallback.
      }
    }
  }
  return typeof credential.subject === 'string' ? credential.subject : undefined;
}

/**
 * The provider-reported allowance for one connection. Unsupported providers answer without a
 * request; successful reads are cached briefly so the settings row and its dialog share one call.
 */
export async function providerUsage(
  stores: ProviderStores,
  connection: ServiceConnection,
  options: { refresh?: boolean; runtime?: UsageAuthRuntime } = {},
): Promise<ProviderUsageResponse> {
  // OpenAI's API key has no balance endpoint; only the ChatGPT OAuth plan has usage windows.
  const adapter =
    connection.provider === 'openai'
      ? connection.authType === 'oauth'
        ? chatgptUsage
        : undefined
      : adapters.get(connection.provider);
  if (!adapter) return { kind: 'unsupported' };
  requireChatGPTPlan(connection);
  // Saving a connection increments its revision, so a replaced credential or changed
  // configuration misses the cache instead of serving the previous account's allowance.
  const key = `${connection.connectionId}:${connection.revision}`;
  const cached = cache.get(key);
  if (
    !options.refresh &&
    cached &&
    Date.now() - cached.at < (cached.value.kind === 'error' ? FAILURE_CACHE_MS : CACHE_MS)
  )
    return cached.value;
  const value = bound(await query(stores, connection, adapter, options.runtime));
  remember(key, value);
  return value;
}

/**
 * The usage endpoints send the connection's bearer token to the provider. ChatGPT plan usage
 * additionally requires current privacy consent and the plan permission, so an identity-only
 * sign-in never sends its token to a usage endpoint it is not authorized to call.
 */
function requireChatGPTPlan(connection: ServiceConnection): void {
  if (connection.provider !== 'openai' || connection.authType !== 'oauth') return;
  if (connection.chatgptConsent?.privacyVersion !== CHATGPT_PRIVACY_VERSION)
    throw new ConflictError(
      'chatgpt_privacy_required: Review the ChatGPT privacy notice in connection settings.',
    );
  if (!connection.chatgptPlanEnabled)
    throw new ConflictError(
      'chatgpt_plan_disabled: Enable ChatGPT plan usage in connection settings.',
    );
}

/** Keep an adapter's response inside the shared contract's bounds before the client parses it. */
function bound(value: ProviderUsageResponse): ProviderUsageResponse {
  if (value.kind === 'error') return { ...value, message: value.message.slice(0, MESSAGE_LIMIT) };
  if (value.kind !== 'ok') return value;
  return {
    ...value,
    windows: value.windows.map((window) => ({
      ...window,
      usedRatio: clampRatio(window.usedRatio),
      ...(window.resetsAt ? { resetsAt: window.resetsAt.slice(0, RESET_LIMIT) } : {}),
    })),
    ...(value.balance
      ? {
          balance: {
            ...value.balance,
            currency: value.balance.currency.slice(0, CURRENCY_LIMIT),
            ...(value.balance.total === undefined
              ? {}
              : { total: Math.max(value.balance.total, 0) }),
            ...(value.balance.monthlyUsed === undefined
              ? {}
              : { monthlyUsed: Math.max(value.balance.monthlyUsed, 0) }),
            ...(value.balance.monthlyLimit === undefined
              ? {}
              : { monthlyLimit: Math.max(value.balance.monthlyLimit, 0) }),
          },
        }
      : {}),
  };
}

async function query(
  stores: ProviderStores,
  connection: ServiceConnection,
  adapter: UsageAdapter,
  runtime?: UsageAuthRuntime,
): Promise<ProviderUsageResponse> {
  if (connection.authType !== 'api_key' && connection.authType !== 'oauth')
    return { kind: 'unavailable', reason: 'no-credential' };
  let token: string | undefined;
  let accountId: string | undefined;
  try {
    if (connection.authType === 'oauth') {
      // Resolve OAuth through Pi's runtime auth, like model catalog refresh, so an expired SIWC
      // access token refreshes under the credential lock and a revoked grant invalidates cleanly
      // instead of failing every lookup with the stale keyring bearer token.
      const models = runtime ?? (await connectionRuntime(stores, connection));
      const auth = await models.getAuth(connection.provider);
      if (!auth?.auth.apiKey) return { kind: 'unavailable', reason: 'no-credential' };
      token = auth.auth.apiKey;
      const credential = await connectionCredentials(stores, connection).read(connection.provider);
      accountId =
        credential?.type === 'oauth'
          ? chatgptAccountId(credential as unknown as { subject?: unknown; idToken?: unknown })
          : undefined;
    } else {
      const credential = await connectionCredentials(stores, connection).read(connection.provider);
      token = credential?.type === 'api_key' ? credential.key : undefined;
    }
  } catch {
    return {
      kind: 'error',
      message:
        'The saved credential could not be read or refreshed. Sign in again in connection settings.',
    };
  }
  if (!token) return { kind: 'unavailable', reason: 'no-credential' };
  try {
    return await adapter({
      baseUrl: connection.baseUrl,
      apiKey: token,
      ...(accountId ? { accountId } : {}),
      fetch,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return {
      kind: 'error',
      message: timedOut
        ? 'The usage request timed out.'
        : 'The usage request failed. Check your network connection and try again.',
    };
  }
}

function remember(key: string, value: ProviderUsageResponse): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

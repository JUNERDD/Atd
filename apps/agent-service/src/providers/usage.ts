import type { ProviderUsageResponse, ServiceConnection } from '@atd/agent-contracts';
import { connectionCredentials, type ProviderStores } from './runtime.js';
import {
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

const adapters = new Map<string, UsageAdapter>([
  ['kimi-coding', kimiUsage],
  ['moonshotai', (request) => moonshotBalance(request, 'https://api.moonshot.ai/v1', 'USD')],
  ['moonshotai-cn', (request) => moonshotBalance(request, 'https://api.moonshot.cn/v1', 'CNY')],
  ['deepseek', deepseekBalance],
  ['openrouter', openRouterCredits],
  ['zai', zhipuUsage],
  ['zai-coding-cn', zhipuUsage],
  ['minimax', (request) => minimaxUsage(request, false)],
  ['minimax-cn', (request) => minimaxUsage(request, true)],
  ['opencode-go', openCodeGoUsage],
]);

const cache = new Map<string, { at: number; value: ProviderUsageResponse }>();

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
): Promise<ProviderUsageResponse> {
  // OpenAI's API key has no balance endpoint; only the ChatGPT OAuth plan has usage windows.
  const adapter =
    connection.provider === 'openai'
      ? connection.authType === 'oauth'
        ? chatgptUsage
        : undefined
      : adapters.get(connection.provider);
  if (!adapter) return { kind: 'unsupported' };
  // Saving a connection increments its revision, so a replaced credential or changed
  // configuration misses the cache instead of serving the previous account's allowance.
  const key = `${connection.connectionId}:${connection.revision}`;
  const cached = cache.get(key);
  if (
    cached &&
    Date.now() - cached.at < (cached.value.kind === 'error' ? FAILURE_CACHE_MS : CACHE_MS)
  )
    return cached.value;
  const value = await query(stores, connection, adapter);
  remember(key, value);
  return value;
}

async function query(
  stores: ProviderStores,
  connection: ServiceConnection,
  adapter: UsageAdapter,
): Promise<ProviderUsageResponse> {
  if (connection.authType !== 'api_key' && connection.authType !== 'oauth')
    return { kind: 'unavailable', reason: 'no-credential' };
  let credential;
  try {
    credential = await connectionCredentials(stores, connection).read(connection.provider);
  } catch {
    return {
      kind: 'error',
      message: 'The saved credential could not be read from the OS keychain.',
    };
  }
  // API keys and account tokens both authenticate a provider's usage endpoint.
  const token =
    credential?.type === 'api_key'
      ? credential.key
      : credential?.type === 'oauth'
        ? credential.access
        : undefined;
  if (!token) return { kind: 'unavailable', reason: 'no-credential' };
  const accountId =
    credential?.type === 'oauth'
      ? chatgptAccountId(credential as unknown as { subject?: unknown; idToken?: unknown })
      : undefined;
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

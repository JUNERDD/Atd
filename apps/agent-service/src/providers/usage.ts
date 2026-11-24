import type { ProviderUsageResponse, ServiceConnection } from '@atd/agent-contracts';
import { KeyringUnavailable } from '../credentials/keyring.js';
import {
  clearCredentialIssue,
  currentCredentialIssue,
  expectsStoredCredential,
  recordCredentialIssue,
} from './credential-issues.js';
import { connectionCredentials, connectionRuntime, type ProviderStores } from './runtime.js';
import {
  clampRatio,
  deepseekBalance,
  isSecureUsageUrl,
  kimiUsage,
  moonshotBalance,
  openRouterCredits,
  type UsageAdapter,
} from './usage-adapters.js';
import { minimaxUsage, openCodeGoUsage, zhipuUsage } from './usage-plan-adapters.js';

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
const inFlight = new Map<string, Promise<ProviderUsageResponse>>();
const generations = new Map<string, number>();

const MESSAGE_LIMIT = 2000;
const RESET_LIMIT = 64;
const CURRENCY_LIMIT = 16;

/**
 * The provider-reported allowance for one connection. Unsupported providers answer without a
 * request; successful reads are cached briefly so the settings row and its dialog share one call.
 */
export async function providerUsage(
  stores: ProviderStores,
  connection: ServiceConnection,
  options: { refresh?: boolean; runtime?: UsageAuthRuntime } = {},
): Promise<ProviderUsageResponse> {
  // ChatGPT's SIWC token is scoped to api.openai.com, not the Codex chatgpt.com usage endpoint;
  // until a SIWC-supported usage API is verified, every OpenAI connection stays unsupported.
  const adapter = adapters.get(connection.provider);
  if (!adapter) return { kind: 'unsupported' };
  if (connection.baseUrl && !connection.allowInsecureUsage && !isSecureUsageUrl(connection.baseUrl))
    return { kind: 'unsupported' };
  // Automatic reads stop at a recorded issue; an explicit refresh retries so re-entering the
  // credential can clear it instead of leaving the row permanently stuck.
  if (!options.refresh && currentCredentialIssue(stores.dataDir, connection.connectionId))
    return {
      kind: 'error',
      message: 'The saved credential needs attention. Re-enter it in connection settings.',
    };
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
  if (!options.refresh) {
    const pending = inFlight.get(key);
    if (pending) return pending;
  }
  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);
  let operation: Promise<ProviderUsageResponse>;
  operation = (async () => {
    const value = bound(await query(stores, connection, adapter, options.runtime));
    // A slower request must not replace a newer manual refresh's result.
    if (generations.get(key) === generation) remember(key, value);
    return value;
  })().finally(() => {
    if (inFlight.get(key) === operation) inFlight.delete(key);
  });
  inFlight.set(key, operation);
  return operation;
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
  try {
    if (connection.authType === 'oauth') {
      // Resolve OAuth through Pi's runtime auth, like model catalog refresh, so an expired SIWC
      // access token refreshes under the credential lock and a revoked grant invalidates cleanly
      // instead of failing every lookup with the stale keyring bearer token.
      const models = runtime ?? (await connectionRuntime(stores, connection));
      const auth = await models.getAuth(connection.provider);
      if (!auth?.auth.apiKey) return { kind: 'unavailable', reason: 'no-credential' };
      token = auth.auth.apiKey;
    } else {
      const credential = await connectionCredentials(stores, connection).read(connection.provider);
      token = credential?.type === 'api_key' ? credential.key : undefined;
    }
  } catch (error) {
    if (isKeyringError(error) && expectsStoredCredential(connection))
      recordCredentialIssue(stores.dataDir, connection.connectionId, 'unreadable');
    return {
      kind: 'error',
      message:
        'The saved credential could not be read or refreshed. Sign in again in connection settings.',
    };
  }
  if (!token) {
    if (expectsStoredCredential(connection))
      recordCredentialIssue(stores.dataDir, connection.connectionId, 'missing');
    return { kind: 'unavailable', reason: 'no-credential' };
  }
  if (expectsStoredCredential(connection))
    clearCredentialIssue(stores.dataDir, connection.connectionId);
  try {
    return await adapter({
      baseUrl: connection.baseUrl,
      apiKey: token,
      allowInsecure: connection.allowInsecureUsage === true,
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

function isKeyringError(error: unknown): boolean {
  return (
    error instanceof KeyringUnavailable ||
    (error instanceof Error && error.cause instanceof KeyringUnavailable)
  );
}

function remember(key: string, value: ProviderUsageResponse): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
      generations.delete(oldest);
    }
  }
  cache.set(key, { at: Date.now(), value });
}

import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ServiceConnection, ServiceModelDefinition } from '@atd/agent-contracts';
import { ConnectionStorageLimitError, type ConnectionStore } from '../credentials/connections.js';
import type { KeyringBackend } from '../credentials/keyring.js';
import { ServiceCredentialStore } from '../credentials/service-store.js';
import { ConflictError, UpstreamError } from '../errors.js';
import { directoryModels, isLocalProvider, toServiceModel } from './catalog.js';
import { contextOverrideFile, type ContextOverride } from './context-override.js';
import { discoverCompatibleModels } from './discovery.js';
import { LLAMA_PROVIDER, llamaProvider, migrateLlamaCatalog } from './llama.js';
import { assertCredential, assertProviderAuth } from './auth-policy.js';
import { connectionAuthContext } from './auth-context.js';
import { chatgptOAuth } from './chatgpt-oauth.js';
import { chatgptProvider, loadChatGPTModels } from './chatgpt-provider.js';
import { chatgptUsage, requireChatGPTNotice } from './chatgpt-usage.js';
import { inferenceError } from './inference-result.js';
import type { ChatGPTLoginOptions } from './oauth-callback.js';
import { CatalogFailure, catalogFailureReason } from './catalog-http.js';
import { loadOpenRouterModels, openRouterProvider } from './openrouter-catalog.js';
import { compatibleProvider } from './compatible-provider.js';
import { compatibleModels } from './compatible-models.js';

export interface ProviderStores {
  dataDir: string;
  connections: ConnectionStore;
  keyring: KeyringBackend;
}

/** The keyring-backed credential store of one connection. */
export function connectionCredentials(
  stores: ProviderStores,
  connection: ServiceConnection,
): ServiceCredentialStore {
  return new ServiceCredentialStore(
    stores.keyring,
    stores.connections,
    connection.connectionId,
    connection.provider,
    connection.configurationId,
  );
}

/**
 * A Pi model runtime bound to one connection: its keyring credential,
 * endpoint, options and models. Ambient credentials stay opt-in for cloud
 * connections, and a saved API-key connection never borrows another key from
 * the environment. `contextOverride` gives one model a run's frozen window.
 */
export async function connectionRuntime(
  stores: ProviderStores,
  connection: ServiceConnection,
  credentials: ServiceCredentialStore = connectionCredentials(stores, connection),
  contextOverride?: ContextOverride,
  loginOptions?: ChatGPTLoginOptions,
): Promise<ModelRuntime> {
  assertProviderAuth(connection);
  const usesChatGPT = connection.provider === 'openai' && connection.authType === 'oauth';
  if (usesChatGPT) requireChatGPTNotice(connection);
  const root = path.join(stores.dataDir, 'providers', connection.connectionId);
  await mkdir(root, { recursive: true });
  // llama.cpp catalogs depend on the endpoint. Pi may persist a response after its connection
  // changes, so an old endpoint's cache must stay separate from the new configuration's cache.
  const legacyStorePath = path.join(root, 'models-store.json');
  const modelsStorePath =
    connection.provider === LLAMA_PROVIDER
      ? path.join(
          root,
          `models-store.${createHash('sha256').update(connection.configurationId).digest('hex')}.json`,
        )
      : legacyStorePath;
  if (connection.provider === LLAMA_PROVIDER)
    await migrateLlamaCatalog(connection, legacyStorePath, modelsStorePath);
  const models = await ModelRuntime.create({
    credentials,
    // The SDK only enables its file-backed catalog store when a config path is set. Without an
    // override no models.json is written; the store keeps refreshed catalogs across restarts.
    modelsPath: contextOverride
      ? await contextOverrideFile(root, connection.provider, contextOverride)
      : path.join(root, 'models.json'),
    modelsStorePath,
    refreshOnCreate: false,
  });
  // Pi 1.1.0 registration starts unawaited refreshes. Drain them before the explicit restore:
  // a late config read could otherwise cancel that restore or the next network refresh.
  const refresh = models.refresh.bind(models);
  const registrations: Promise<unknown>[] = [];
  models.refresh = (options) => {
    const operation = refresh(options);
    registrations.push(operation);
    return operation;
  };
  try {
    if (connection.provider === LLAMA_PROVIDER)
      models.registerNativeProvider(await llamaProvider(connection));
    else if (isLocalProvider(connection.provider)) {
      models.registerProvider(connection.provider, {
        name: connection.name,
        baseUrl: connection.baseUrl,
        api: 'openai-completions',
        models: await compatibleModels(connection),
      });
    } else if (
      connection.baseUrl &&
      connection.baseUrl !== models.getProvider(connection.provider)?.baseUrl &&
      !usesChatGPT &&
      connection.provider !== 'openrouter'
    )
      // Providers such as Fireworks have per-protocol model endpoints under one provider URL.
      // Only an intentional endpoint override should replace those model URLs.
      models.registerProvider(connection.provider, { baseUrl: connection.baseUrl });
    let provider = models.getProvider(connection.provider);
    if (!provider) throw new ConflictError('This provider is no longer registered in Pi.');
    if (usesChatGPT)
      provider = chatgptProvider(
        provider,
        chatgptOAuth(stores.dataDir, connection.connectionId, loginOptions),
        connection.catalog ?? [],
        chatgptUsage(stores, connection),
      );
    if (connection.provider === 'openrouter') provider = openRouterProvider(provider, connection);
    if (connection.provider === 'openai-compatible') provider = compatibleProvider(provider);
    const { apiKey, oauth } = provider.auth;
    const options: Record<string, string> = {
      ...connection.options,
      // Azure's transport consults its env overlay before model.baseUrl. Keep an explicitly saved
      // endpoint authoritative even when the service process has a different Azure resource set.
      ...(connection.provider === 'azure' && connection.baseUrl
        ? { AZURE_OPENAI_BASE_URL: connection.baseUrl }
        : {}),
    };
    models.registerNativeProvider({
      ...provider,
      auth:
        connection.authType === 'oauth'
          ? { ...(oauth && { oauth }) }
          : {
              apiKey: {
                name: apiKey?.name ?? 'Connection credentials',
                resolve: async (input) => {
                  const current = stores.connections.connection(connection.connectionId);
                  if (!current.connected || current.configurationId !== connection.configurationId)
                    return undefined;
                  if (connection.authType === 'none')
                    return {
                      auth: {
                        apiKey: 'unused',
                        headers: { Authorization: null, 'x-api-key': null, 'x-goog-api-key': null },
                      },
                      env: options,
                    };
                  if (!apiKey) return undefined;
                  if (input.credential) assertCredential(connection, input.credential);
                  const resolved = await apiKey.resolve({
                    ...input,
                    ...(input.credential && { credential: { ...input.credential, env: options } }),
                    ctx: connectionAuthContext(connection, input.ctx, options),
                  });
                  if (resolved?.auth.apiKey)
                    assertCredential(connection, { type: 'api_key', key: resolved.auth.apiKey });
                  return resolved
                    ? { ...resolved, env: { ...resolved.env, ...options } }
                    : undefined;
                },
              },
            },
    });
  } finally {
    models.refresh = refresh;
    await Promise.allSettled(registrations);
  }
  await models.refresh({ providers: [connection.provider], allowNetwork: false });
  return models;
}

/**
 * One of the connection's Pi models, or undefined when it is unknown. Needs no
 * credential: settings and the composer ask before a connection is usable.
 */
export async function connectionModel(
  stores: ProviderStores,
  connection: ServiceConnection,
  modelId: string,
) {
  return (await connectionRuntime(stores, connection)).getModel(connection.provider, modelId);
}

async function loadCatalog(
  stores: ProviderStores,
  connection: ServiceConnection,
  background: boolean,
): Promise<ServiceModelDefinition[]> {
  if (connection.provider === 'openrouter')
    return loadOpenRouterModels(await directoryModels('openrouter'));
  const models = await connectionRuntime(stores, connection);
  if (connection.provider === 'openai' && connection.authType === 'oauth') {
    if (!connection.chatgptPlanEnabled) return [];
    requireChatGPTNotice(connection);
    const auth = await models.getAuth(connection.provider);
    if (!auth?.auth.apiKey)
      throw new ConflictError('Sign in with ChatGPT before refreshing models.');
    return loadChatGPTModels(
      await directoryModels('openai'),
      auth.auth.apiKey,
      AbortSignal.timeout(15000),
    );
  }
  if (isLocalProvider(connection.provider)) {
    const auth = await models.getAuth(connection.provider);
    if (!auth) throw new ConflictError('Complete authentication before refreshing.');
    // llama.cpp refreshes through Pi's provider (llama.ts), like the directory providers below.
    if (connection.provider !== LLAMA_PROVIDER) return discoverCompatibleModels(connection, auth);
  }
  const result = await models.refresh({
    providers: [connection.provider],
    allowNetwork: true,
    // Background refreshes keep Pi's per-provider freshness window instead of refetching.
    force: !background,
    signal: AbortSignal.timeout(15000),
  });
  const error = result.errors.get(connection.provider);
  if (error) throw error;
  if (result.aborted)
    throw new CatalogFailure('The model directory request timed out or was cancelled.');
  return models.getModels(connection.provider).map(toServiceModel);
}

/** Pi's offline switch, read the way Pi reads it: 1, true or yes. */
function offline(): boolean {
  return ['1', 'true', 'yes'].includes(process.env.PI_OFFLINE?.toLowerCase() ?? '');
}

/**
 * Refreshes one connection's catalog and stores it. A failure keeps the
 * previous catalog; a manual refresh also records why, while a background
 * refresh leaves the connection as it was. Either write is dropped when the
 * configuration changed while the refresh ran. Background refreshes skip the
 * network entirely under `PI_OFFLINE`; manual ones stay explicit.
 */
export async function refreshCatalog(
  stores: ProviderStores,
  connection: ServiceConnection,
  background: boolean,
): Promise<void> {
  if (!connection.connected) throw new ConflictError('Reconnect before refreshing models.');
  if (background && offline()) return;
  try {
    const catalog = await loadCatalog(stores, connection, background);
    await recordCatalog(stores, connection, { catalog, catalogError: '' });
  } catch (error) {
    const reason =
      error instanceof ConflictError || error instanceof ConnectionStorageLimitError
        ? error.message
        : catalogFailureReason(error);
    const message = `Could not refresh models. ${reason} Your saved catalog and model preference are preserved.`;
    if (!background) {
      try {
        await recordCatalog(stores, connection, { catalogError: message });
      } catch (recordError) {
        // A nearly full file may not fit even this diagnostic. Return it without replacing data.
        if (!(recordError instanceof ConnectionStorageLimitError)) throw recordError;
      }
    }
    if (error instanceof ConflictError) throw error;
    throw new UpstreamError(message);
  }
}

function recordCatalog(
  stores: ProviderStores,
  connection: ServiceConnection,
  patch: Pick<ServiceConnection, 'catalogError'> & Pick<Partial<ServiceConnection>, 'catalog'>,
): Promise<void> {
  return stores.connections.change((data) => {
    const current = data.connections.find((item) => item.connectionId === connection.connectionId);
    if (current?.connected && current.configurationId === connection.configurationId)
      Object.assign(current, patch);
  });
}

/**
 * Sends one small model request (it may use credits, never runs tools) and
 * records the verified model when the connected configuration and credential revision still
 * match. Even an OAuth token rotation during the request requires another verification.
 */
export async function verifyModel(
  stores: ProviderStores,
  connection: ServiceConnection,
  modelId: string,
): Promise<void> {
  if (!connection.connected) throw new ConflictError(`Reconnect ${connection.name} first.`);
  const models = await connectionRuntime(stores, connection);
  const model = models.getModel(connection.provider, modelId);
  if (!model) throw new TypeError('This model is unavailable. Refresh or choose another model.');
  const result = await models.completeSimple(
    model,
    { messages: [{ role: 'user', content: 'Reply OK.', timestamp: Date.now() }] },
    // The check is its own one-message conversation. Providers that route by session (OpenCode
    // rejects requests without `x-opencode-session`) read this id the way they read a task's.
    { maxTokens: 16, signal: AbortSignal.timeout(30000), sessionId: randomUUID() },
  );
  // Hitting this deliberately small output cap still proves model access, including when a
  // reasoning model spends the whole allowance thinking before it can emit the reply.
  if (result.stopReason !== 'length' && inferenceError(result))
    throw new UpstreamError(
      'Model verification failed. Check the connection, model access and available quota.',
    );
  await stores.connections.change((data) => {
    const current = data.connections.find((item) => item.connectionId === connection.connectionId);
    if (
      !current?.connected ||
      current.configurationId !== connection.configurationId ||
      current.revision !== connection.revision
    )
      throw new ConflictError(
        'The connection or credential changed during verification. Try again.',
      );
    current.verifiedModel = modelId;
  });
}

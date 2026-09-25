import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ServiceConnection, ServiceModelDefinition } from '@ai/agent-contracts';
import type { ConnectionStore } from '../credentials/connections.js';
import type { KeyringBackend } from '../credentials/keyring.js';
import { ServiceCredentialStore } from '../credentials/service-store.js';
import { ConflictError, UpstreamError } from '../errors.js';
import { isLocalProvider, toServiceModel } from './catalog.js';
import { uniqueModels } from './connection-view.js';
import { discoverCompatibleModels, discoverLlamaModels } from './discovery.js';

export interface ProviderStores {
  dataDir: string;
  connections: ConnectionStore;
  keyring: KeyringBackend;
}

const CATALOG_REFRESH_FAILED =
  'Could not refresh models. Your saved catalog and model preference are preserved.';

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
 * the environment.
 */
export async function connectionRuntime(
  stores: ProviderStores,
  connection: ServiceConnection,
  credentials: ServiceCredentialStore = connectionCredentials(stores, connection),
): Promise<ModelRuntime> {
  const root = path.join(stores.dataDir, 'providers', connection.connectionId);
  await mkdir(root, { recursive: true });
  const models = await ModelRuntime.create({
    credentials,
    // The SDK only enables its file-backed catalog store when a config path is set.
    // No models.json is written; the store keeps refreshed catalogs across restarts.
    modelsPath: path.join(root, 'models.json'),
    modelsStorePath: path.join(root, 'models-store.json'),
    refreshOnCreate: false,
  });
  if (isLocalProvider(connection.provider)) {
    models.registerProvider(connection.provider, {
      name: connection.name,
      baseUrl: connection.baseUrl,
      api: 'openai-completions',
      models: uniqueModels([...(connection.catalog ?? []), ...(connection.customModels ?? [])]),
    });
  } else if (connection.baseUrl)
    models.registerProvider(connection.provider, { baseUrl: connection.baseUrl });
  const provider = models.getProvider(connection.provider);
  if (!provider) throw new ConflictError('This provider is no longer registered in Pi.');
  const apiKey = provider.auth.apiKey;
  const options = connection.options ?? {};
  models.registerNativeProvider({
    ...provider,
    auth:
      connection.authType === 'oauth'
        ? { oauth: provider.auth.oauth }
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
                const resolved = await apiKey.resolve({
                  ...input,
                  credential: input.credential ? { ...input.credential, env: options } : undefined,
                  ctx: {
                    ...input.ctx,
                    env: (name) =>
                      options[name] !== undefined
                        ? Promise.resolve(options[name])
                        : connection.authType === 'ambient'
                          ? input.ctx.env(name)
                          : Promise.resolve(undefined),
                  },
                });
                return resolved ? { ...resolved, env: { ...resolved.env, ...options } } : undefined;
              },
            },
          },
  });
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
  const models = await connectionRuntime(stores, connection);
  if (isLocalProvider(connection.provider)) {
    const auth = await models.getAuth(connection.provider);
    if (!auth) throw new ConflictError('Complete authentication before refreshing.');
    return connection.provider === 'llamacpp'
      ? discoverLlamaModels(connection, auth)
      : discoverCompatibleModels(connection, auth);
  }
  const result = await models.refresh({
    providers: [connection.provider],
    allowNetwork: true,
    // Background refreshes keep Pi's per-provider freshness window instead of refetching.
    force: !background,
    signal: AbortSignal.timeout(15000),
  });
  if (result.aborted || result.errors.size)
    throw new Error('The model catalog could not be refreshed.');
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
  let catalog: ServiceModelDefinition[];
  try {
    catalog = await loadCatalog(stores, connection, background);
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    if (!background)
      await recordCatalog(stores, connection, { catalogError: CATALOG_REFRESH_FAILED });
    throw new UpstreamError(CATALOG_REFRESH_FAILED);
  }
  await recordCatalog(stores, connection, { catalog, catalogError: '' });
}

function recordCatalog(
  stores: ProviderStores,
  connection: ServiceConnection,
  patch: Pick<ServiceConnection, 'catalogError'> & Pick<Partial<ServiceConnection>, 'catalog'>,
): Promise<void> {
  return stores.connections.change((data) => {
    const current = data.connections.find((item) => item.connectionId === connection.connectionId);
    if (current && current.configurationId === connection.configurationId)
      Object.assign(current, patch);
  });
}

/**
 * Sends one small model request (it may use credits, never runs tools) and
 * records the verified model when the configuration is still the one tested.
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
    { maxTokens: 16, signal: AbortSignal.timeout(30000) },
  );
  if (result.stopReason === 'error' || result.stopReason === 'aborted')
    throw new UpstreamError(
      'Model verification failed. Check the connection, model access and available quota.',
    );
  await stores.connections.change((data) => {
    const current = data.connections.find((item) => item.connectionId === connection.connectionId);
    if (current && current.configurationId === connection.configurationId)
      current.verifiedModel = modelId;
  });
}

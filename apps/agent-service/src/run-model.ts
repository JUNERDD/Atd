import path from 'node:path';
import type { Api, CredentialStore, Model } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { TaskRun } from '@ai/agent-contracts';
import { AuthRequired, TempCredentialStore } from './credentials.js';
import { ConnectionStore } from './credentials/connections.js';
import { KeyringBackend } from './credentials/keyring.js';
import {
  connectionCredentials,
  connectionRuntime,
  type ProviderStores,
} from './providers/runtime.js';
import type { ServicePaths } from './storage.js';
import { readServiceId } from './task-runner.js';
import { TEMP_CONNECTION_ID } from './tasks/run-selection.js';

const CONNECT_PROVIDER = 'Connect a provider in Settings → Providers, then send again.';

/** The Pi runtime and model one run executes on. */
export interface RunModel {
  models: ModelRuntime;
  model: Model<Api>;
  /**
   * The store `models` reads credentials from. Subagent children build their own runtime, so
   * the parent hands them this store to run on the same connection credentials.
   */
  credentials: CredentialStore;
  /** The saved connection the runtime is bound to; null on temporary credentials. */
  binding: { stores: ProviderStores; connectionId: string; configurationId: string } | null;
}

/**
 * Opens the runtime for a run's frozen model. A saved connection supplies its
 * endpoint, models and keyring credential; the temp connection keeps the
 * operator's environment-injected key. Missing or unusable credentials fail
 * `auth_required` before any provider request.
 */
export async function openRunModel(paths: ServicePaths, run: TaskRun): Promise<RunModel> {
  const selected = run.snapshot.model;
  if (selected.connectionId === TEMP_CONNECTION_ID) {
    const credentials = new TempCredentialStore();
    const models = await ModelRuntime.create({
      credentials,
      modelsPath: null,
      modelsStorePath: path.join(paths.agentDir, 'models-cache.json'),
      refreshOnCreate: false,
    });
    return { models, model: await configureTempModel(models, run), credentials, binding: null };
  }
  const stores: ProviderStores = {
    dataDir: paths.root,
    connections: await ConnectionStore.load(paths.root),
    keyring: new KeyringBackend(await readServiceId(paths)),
  };
  const connection = stores.connections.data.connections.find(
    (item) => item.connectionId === selected.connectionId,
  );
  if (!connection)
    throw new AuthRequired(`The connection for this message was removed. ${CONNECT_PROVIDER}`);
  if (selected.configurationId && selected.configurationId !== connection.configurationId)
    throw new Error(`${connection.name} changed after this message was sent. Send it again.`);
  if (!connection.connected)
    throw new AuthRequired(
      `${connection.name} is disconnected. Reconnect it in Settings → Providers, then send again.`,
    );
  const credentials = connectionCredentials(stores, connection);
  const models = await connectionRuntime(stores, connection, credentials);
  const model = models.getModel(connection.provider, selected.modelId);
  if (!model)
    throw new Error(
      `${selected.modelId} is unavailable on ${connection.name}. Refresh its models or choose another.`,
    );
  if (!(await models.checkAuth(connection.provider)))
    throw new AuthRequired(
      `${connection.name} has no usable credentials. Reconnect it in Settings → Providers, then send again.`,
    );
  const { connectionId, configurationId } = connection;
  return { models, model, credentials, binding: { stores, connectionId, configurationId } };
}

/**
 * The model for a later run of the same task on this runtime, or null when
 * that run needs a new runtime: another connection, a changed configuration,
 * lost credentials or a model the runtime was not built with. Connectivity
 * is reread first, so a reconnect or disconnect since the last run applies.
 */
export async function reuseRunModel(current: RunModel, run: TaskRun): Promise<Model<Api> | null> {
  const selected = run.snapshot.model;
  const binding = current.binding;
  if (!binding)
    return selected.connectionId === TEMP_CONNECTION_ID
      ? configureTempModel(current.models, run)
      : null;
  if (selected.connectionId !== binding.connectionId) return null;
  await binding.stores.connections.reload();
  const connection = binding.stores.connections.data.connections.find(
    (item) => item.connectionId === binding.connectionId,
  );
  if (
    !connection?.connected ||
    connection.configurationId !== binding.configurationId ||
    (selected.configurationId && selected.configurationId !== binding.configurationId)
  )
    return null;
  const model = current.models.getModel(connection.provider, selected.modelId);
  return model && (await current.models.checkAuth(connection.provider)) ? model : null;
}

/** Registers the temp model; the key comes only from `AI_AGENT_TEMP_API_KEY`. */
async function configureTempModel(models: ModelRuntime, run: TaskRun): Promise<Model<Api>> {
  const temp = new TempCredentialStore();
  if (!temp.hasCredentials()) throw new AuthRequired(CONNECT_PROVIDER);
  const selected = run.snapshot.model;
  const known = models.getModel(selected.provider, selected.modelId);
  const definition = {
    ...known,
    id: selected.modelId,
    name: selected.modelId,
    api: selected.provider === 'openai' ? 'openai-responses' : 'openai-completions',
    baseUrl: selected.baseUrl,
    reasoning: known?.reasoning ?? false,
    input: known?.input ?? ['text' as const],
    cost: known?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: known?.contextWindow ?? 32768,
    maxTokens: known?.maxTokens ?? 4096,
  };
  models.registerProvider(selected.provider, {
    api: definition.api,
    baseUrl: definition.baseUrl,
    models: [{ ...known, ...definition }],
  });
  const provider = models.getProvider(selected.provider);
  if (!provider) throw new Error('The selected provider is unavailable.');
  models.registerNativeProvider({
    ...provider,
    auth: {
      apiKey: {
        name: 'Service temporary credentials',
        resolve: async () => {
          const credential = await temp.read(selected.provider);
          if (!credential || credential.type !== 'api_key' || !credential.key) return undefined;
          return { auth: { apiKey: credential.key }, env: {} };
        },
      },
    },
  });
  const model = models.getModel(selected.provider, selected.modelId);
  if (!model) throw new Error('The selected model is unavailable.');
  if (!(await models.checkAuth(selected.provider))) throw new AuthRequired(CONNECT_PROVIDER);
  return model;
}

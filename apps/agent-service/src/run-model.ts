import path from 'node:path';
import type { Api, Model } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ServiceConnection, TaskRun } from '@ai/agent-contracts';
import { AuthRequired, TempCredentialStore } from './credentials.js';
import { ConnectionStore } from './credentials/connections.js';
import { KeyringBackend } from './credentials/keyring.js';
import { presentConnection } from './providers/connection-view.js';
import type { ContextOverride } from './providers/context-override.js';
import {
  connectionCredentials,
  connectionRuntime,
  type ProviderStores,
} from './providers/runtime.js';
import { readServiceId, type ServicePaths } from './storage.js';
import { TEMP_CONNECTION_ID } from './tasks/run-selection.js';

const CONNECT_PROVIDER = 'Connect a provider in Settings → Providers, then send again.';

/** The Pi runtime and model one run executes on. */
export interface RunModel {
  models: ModelRuntime;
  model: Model<Api>;
  /**
   * Builds a separate runtime for one subagent child the way `models` was built: the same
   * credentials, endpoint and model catalog store. A child resolves the parent's model by id, so
   * a runtime without that catalog would clone the provider's default model definition instead.
   */
  childRuntime: () => Promise<ModelRuntime>;
  /**
   * The saved connection the runtime is bound to, and the frozen window it applies to one model
   * (null: every model keeps its catalog window); null on temporary credentials.
   */
  binding: {
    stores: ProviderStores;
    connectionId: string;
    configurationId: string;
    override: ContextOverride | null;
  } | null;
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
    // The temp model comes from the environment, so it is the same for every run of the process.
    const openTemp = async () => {
      const models = await ModelRuntime.create({
        credentials: new TempCredentialStore(),
        modelsPath: null,
        modelsStorePath: path.join(paths.agentDir, 'models-cache.json'),
        refreshOnCreate: false,
      });
      return { models, model: await configureTempModel(models, run) };
    };
    const { models, model } = await openTemp();
    const childRuntime = async () => (await openTemp()).models;
    return { models, model, childRuntime, binding: null };
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
  const override = await contextOverrideFor(connection, run);
  const models = await connectionRuntime(stores, connection, credentials, override);
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
  return {
    models,
    model,
    childRuntime: () => connectionRuntime(stores, connection, credentials, override),
    binding: { stores, connectionId, configurationId, override: override ?? null },
  };
}

/**
 * The override that gives the run's model its frozen window, or undefined when the catalog
 * window already is that window. The output limit is capped at the window when it exceeds it.
 */
async function contextOverrideFor(
  connection: ServiceConnection,
  run: TaskRun,
): Promise<ContextOverride | undefined> {
  const { contextWindow, model } = run.snapshot;
  if (!contextWindow) return undefined;
  const { catalog = [] } = await presentConnection(connection);
  const definition = catalog.find((item) => item.id === model.modelId);
  const maxTokens = definition && definition.maxTokens > contextWindow ? contextWindow : undefined;
  if (definition?.contextWindow === contextWindow && maxTokens === undefined) return undefined;
  return { modelId: model.modelId, contextWindow, ...(maxTokens ? { maxTokens } : {}) };
}

/**
 * The model for a later run of the same task on this runtime, or null when
 * that run needs a new runtime: another connection, a changed configuration,
 * lost credentials, a model the runtime was not built with, or a frozen window
 * the runtime does not give the model. Connectivity is reread first, so a
 * reconnect or disconnect since the last run applies.
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
  if (!model) return null;
  // A run without a frozen window expects the catalog one, which an override would replace.
  const expected = run.snapshot.contextWindow;
  const overridden = binding.override?.modelId === selected.modelId;
  if (expected !== undefined ? model.contextWindow !== expected : overridden) return null;
  return (await current.models.checkAuth(connection.provider)) ? model : null;
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

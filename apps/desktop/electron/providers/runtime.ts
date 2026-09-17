import { app } from 'electron';
import path from 'node:path';
import { InMemoryCredentialStore, type AuthResult } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { SettingsStore } from '../settings-store';
import type { ResolvedModel } from '../agent/task-schema';
import {
  configurationId,
  isCloud,
  isAmbient,
  isCustom,
  LOCAL_PROVIDERS,
  modelDefinition,
} from './configuration';
import { ConnectionCredentials } from './credentials';
import type { FrozenModel, ModelReference, ProviderCatalogEntry, StoredConnection } from './schema';

export class ProviderRuntime {
  private readonly runtimes = new Map<
    string,
    { identity: string; runtime: Promise<ModelRuntime> }
  >();
  private readonly directory = ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  constructor(private store: SettingsStore) {}

  connection(id: string) {
    const connection = this.store.current.connections.find((item) => item.connectionId === id);
    if (!connection) throw new Error('This provider connection is unavailable.');
    return connection;
  }
  async catalog(): Promise<ProviderCatalogEntry[]> {
    const models = await this.directory;
    return [
      ...models.getProviders().map((provider): ProviderCatalogEntry => ({
        id: provider.id,
        name:
          provider.id === 'openai'
            ? 'OpenAI API'
            : provider.id === 'openai-codex'
              ? 'ChatGPT / Codex'
              : provider.name,
        category: isCloud(provider.id)
          ? 'cloud'
          : provider.id === 'llamacpp'
            ? 'local'
            : provider.auth.oauth
              ? 'accounts'
              : 'api',
        auth: [
          ...(provider.auth.oauth
            ? [{ type: 'oauth' as const, label: provider.auth.oauth.loginLabel ?? 'Account login' }]
            : []),
          ...(provider.auth.apiKey
            ? [
                {
                  type: isAmbient(provider.id)
                    ? ('ambient' as const)
                    : provider.id === 'llamacpp'
                      ? ('none' as const)
                      : ('api_key' as const),
                  label: provider.auth.apiKey.name,
                },
              ]
            : []),
        ],
        baseUrl: provider.baseUrl ?? '',
        models: models.getModels(provider.id).map(modelDefinition),
      })),
      ...LOCAL_PROVIDERS.map((provider): ProviderCatalogEntry => ({
        ...provider,
        category: 'local',
        auth: [
          { type: 'none', label: 'No API key' },
          { type: 'api_key', label: 'API key' },
        ],
        models: [],
      })),
    ];
  }

  async models(connection: StoredConnection): Promise<ModelRuntime> {
    const identity = configurationId(connection);
    const cached = this.runtimes.get(connection.connectionId);
    if (cached?.identity === identity) return cached.runtime;
    const runtime = this.create(connection);
    this.runtimes.set(connection.connectionId, { identity, runtime });
    try {
      return await runtime;
    } catch (error) {
      this.runtimes.delete(connection.connectionId);
      throw error;
    }
  }
  private async create(connection: StoredConnection) {
    const root = path.join(app.getPath('userData'), 'providers', connection.connectionId);
    const models = await ModelRuntime.create({
      credentials: new ConnectionCredentials(
        this.store,
        connection.connectionId,
        connection.provider,
        configurationId(connection),
      ),
      // The SDK only enables its file-backed catalog store when a config path is set.
      // No models.json is written; the store keeps remotely refreshed catalogs across restarts.
      modelsPath: path.join(root, 'models.json'),
      modelsStorePath: path.join(root, 'models-store.json'),
      refreshOnCreate: false,
    });
    if (isCustom(connection.provider)) {
      models.registerProvider(connection.provider, {
        name: connection.name,
        baseUrl: connection.baseUrl,
        api: 'openai-completions',
        models: [...connection.catalog, ...connection.customModels].filter(
          (model, index, all) => !all.slice(index + 1).some((item) => item.id === model.id),
        ),
      });
    } else if (connection.baseUrl)
      models.registerProvider(connection.provider, { baseUrl: connection.baseUrl });
    const provider = models.getProvider(connection.provider);
    if (!provider) throw new Error('This provider is no longer registered in Pi.');
    const apiKey = provider.auth.apiKey;
    // Ambient credentials are opt-in for cloud connections; saved API connections cannot borrow another key.
    models.registerNativeProvider({
      ...provider,
      auth:
        connection.authType === 'oauth'
          ? { oauth: provider.auth.oauth }
          : {
              apiKey: {
                name: apiKey?.name ?? 'Connection credentials',
                resolve: async (input) => {
                  const current = this.connection(connection.connectionId);
                  if (
                    !current.connected ||
                    configurationId(current) !== configurationId(connection)
                  )
                    return undefined;
                  if (connection.authType === 'none')
                    return {
                      auth: {
                        apiKey: 'unused',
                        headers: { Authorization: null, 'x-api-key': null, 'x-goog-api-key': null },
                      },
                      env: connection.options,
                    };
                  if (!apiKey) return undefined;
                  const resolved = await apiKey.resolve({
                    ...input,
                    credential: input.credential
                      ? { ...input.credential, env: connection.options }
                      : undefined,
                    ctx: {
                      ...input.ctx,
                      env: (name) =>
                        connection.options[name] !== undefined
                          ? Promise.resolve(connection.options[name])
                          : connection.authType === 'ambient'
                            ? input.ctx.env(name)
                            : Promise.resolve(undefined),
                    },
                  });
                  return resolved
                    ? { ...resolved, env: { ...resolved.env, ...connection.options } }
                    : undefined;
                },
              },
            },
    });
    await models.refresh({ providers: [connection.provider], allowNetwork: false });
    return models;
  }

  async resolve(reference: ModelReference | null): Promise<FrozenModel> {
    const id = reference?.connectionId ?? this.store.current.defaultConnectionId;
    if (!id) throw new Error('Choose a default provider and model in Providers.');
    const connection = this.connection(id);
    const modelId = reference?.modelId ?? connection.defaultModel;
    if (!modelId) throw new Error('Choose a default model for this provider.');
    if (!connection.connected) throw new Error(`Reconnect ${connection.name} before running.`);
    const models = await this.models(connection);
    const model = models.getModel(connection.provider, modelId);
    if (!model)
      throw new Error(
        `The saved model ${modelId} is unavailable. Refresh or choose a model explicitly.`,
      );
    if (!(await models.checkAuth(connection.provider)))
      throw new Error(`Complete authentication for ${connection.name}.`);
    return {
      connectionId: id,
      modelId,
      provider: connection.provider,
      baseUrl: connection.baseUrl,
      configurationId: configurationId(connection),
      definition: modelDefinition(model),
    };
  }

  assertModel(model: ResolvedModel) {
    const connection = this.connection(model.connectionId);
    if (!connection.connected) throw new Error(`Reconnect ${connection.name} before running.`);
    if (
      connection.provider !== model.provider ||
      connection.baseUrl !== model.baseUrl ||
      ('configurationId' in model && configurationId(connection) !== model.configurationId)
    )
      throw new Error(
        'The saved connection configuration changed. Review the model selection before running.',
      );
    return connection;
  }
  async auth(model: ResolvedModel, signal?: AbortSignal): Promise<AuthResult> {
    const connection = this.assertModel(model);
    const models = await this.models(connection);
    const available = models.getModel(model.provider, model.modelId);
    if (!available)
      throw new Error('The saved model is no longer available. Choose a model explicitly.');
    const result = await models.getAuth(available, { signal });
    this.assertModel(model);
    if (!result) throw new Error(`Complete authentication for ${connection.name}.`);
    return result;
  }
  invalidate(id: string) {
    this.runtimes.delete(id);
  }
}

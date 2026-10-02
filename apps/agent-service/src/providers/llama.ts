import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  Api,
  AuthContext,
  Model,
  ModelsPublication,
  Provider,
  RefreshModelsContext,
} from '@earendil-works/pi-ai';
import type { ServiceConnection, ServiceModelDefinition } from '@ai/agent-contracts';

/** The service's llama.cpp provider id; stored connections, catalogs and runs keep it. */
export const LLAMA_PROVIDER = 'llamacpp';

/**
 * The version whose built-in llama.cpp extension (`dist/extensions/llama/{provider,client}.js`)
 * the wrapper below was verified against. The extension is not exported, so it is loaded by file
 * path and refused for any other version.
 */
const PI_CODING_AGENT_VERSION = '1.0.0';

interface LlamaModules {
  /** Pi's id for the provider (`llama.cpp`); its stored models carry it. */
  piProviderId: string;
  createLlamaProvider: () => { provider: Provider };
  /** The server root: http(s), no query, no trailing `/v1`. Throws for other URLs. */
  normalizeServerUrl: (value: string) => string;
  /** `<server root>/v1`, the OpenAI-compatible inference endpoint. */
  inferenceUrl: (serverUrl: string) => string;
}

let cached: Promise<LlamaModules> | null = null;

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null)
    throw new Error(`pi llama.cpp extension: ${name} did not load.`);
  return value as Record<string, unknown>;
}

function callable<T>(mod: Record<string, unknown>, name: string): T {
  if (typeof mod[name] !== 'function')
    throw new Error(`pi llama.cpp extension: ${name} is unavailable.`);
  return mod[name] as T;
}

async function importModules(): Promise<LlamaModules> {
  // The exports map hides package.json: resolve the main entry (dist/index.js) instead.
  const entry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'));
  const root = path.dirname(path.dirname(entry));
  const { version } = record(
    JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')),
    'package.json',
  );
  if (version !== PI_CODING_AGENT_VERSION)
    throw new Error(
      `pi-coding-agent ${String(version)} is not the verified ${PI_CODING_AGENT_VERSION} pin; refusing to load its llama.cpp provider.`,
    );
  const load = async (file: string) =>
    record(
      await import(pathToFileURL(path.join(root, 'dist', 'extensions', 'llama', file)).href),
      file,
    );
  const provider = await load('provider.js');
  const client = await load('client.js');
  if (typeof provider.LLAMA_PROVIDER_ID !== 'string')
    throw new Error('pi llama.cpp extension: LLAMA_PROVIDER_ID is unavailable.');
  return {
    piProviderId: provider.LLAMA_PROVIDER_ID,
    createLlamaProvider: callable(provider, 'createLlamaProvider'),
    normalizeServerUrl: callable(client, 'normalizeLlamaServerUrl'),
    inferenceUrl: callable(client, 'llamaInferenceUrl'),
  };
}

function loadModules(): Promise<LlamaModules> {
  cached ??= importModules().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

function asModel(definition: ServiceModelDefinition, compat?: Model<Api>['compat']): Model<Api> {
  return { ...definition, provider: LLAMA_PROVIDER, ...(compat ? { compat } : {}) };
}

/**
 * Pi's llama.cpp provider under the service id `llamacpp`, for one connection. Pi's provider
 * does the catalog work: it lists the router's models (loaded, sleeping, and unloaded presets the
 * router can autoload), reads each loaded model's chat template for thinking support without
 * loading or waking any model, takes the context window from the running slot, the launch
 * arguments or the training metadata, and sets the request compat flags llama.cpp needs. The
 * wrapper points it at the connection's endpoint and key, renames the provider on the models it
 * publishes and restores, and keeps the service's own lifecycle for which models exist:
 *
 * - A network refresh in this runtime (the connection's catalog refresh) lists Pi's models.
 * - Otherwise the connection's stored catalog decides: none (never refreshed, or dropped by a
 *   configuration change) lists none; one with a stored Pi catalog lists Pi's models; one that
 *   predates the Pi catalog (no compat flags yet) lists its own definitions until the next
 *   refresh.
 * - Custom models replace models with the same id; a custom chat-completions model keeps the
 *   compat flags Pi found for its id.
 */
export async function llamaProvider(connection: ServiceConnection): Promise<Provider> {
  const modules = await loadModules();
  const { provider: pi } = modules.createLlamaProvider();
  const piKey = pi.auth.apiKey;
  const refresh = pi.refreshModels?.bind(pi);
  if (!piKey || !refresh) throw new Error('pi llama.cpp extension: provider shape changed.');
  const check = piKey.check?.bind(piKey);
  const serverUrl = modules.normalizeServerUrl(connection.baseUrl);
  const withServer = (ctx: AuthContext): AuthContext => ({
    ...ctx,
    env: (name) => (name === 'LLAMA_BASE_URL' ? Promise.resolve(serverUrl) : ctx.env(name)),
  });

  let restored = false;
  let refreshed = false;
  const renamed = new WeakMap<Model<Api>, Model<Api>>();
  const rename = (model: Model<Api>): Model<Api> => {
    let ours = renamed.get(model);
    if (!ours) renamed.set(model, (ours = { ...model, provider: LLAMA_PROVIDER }));
    return ours;
  };
  let memo: { source: readonly Model<Api>[]; key: string; models: Model<Api>[] } | null = null;
  const models = (): Model<Api>[] => {
    const source = pi.getModels();
    const key = `${refreshed}:${restored}`;
    if (memo?.source === source && memo.key === key) return memo.models;
    const piModels = source.map(rename);
    const base =
      refreshed || (connection.catalog && restored)
        ? piModels
        : (connection.catalog ?? []).map((definition) => asModel(definition));
    const custom = (connection.customModels ?? []).map((definition) => {
      const found = piModels.find((model) => model.id === definition.id);
      return asModel(definition, definition.api === found?.api ? found.compat : undefined);
    });
    const customIds = new Set(custom.map((model) => model.id));
    memo = {
      source,
      key,
      models: [...base.filter((model) => !customIds.has(model.id)), ...custom],
    };
    return memo.models;
  };

  const publish =
    (context: RefreshModelsContext) =>
    (publication: ModelsPublication): Promise<boolean> => {
      const { persist, update } = publication;
      return context.publish({
        ...(persist === undefined
          ? {}
          : {
              persist: persist && {
                ...persist,
                models: persist.models.map((model) => ({ ...model, provider: LLAMA_PROVIDER })),
              },
            }),
        update: () => {
          update?.();
          // Pi publishes a stored catalog without `persist` and a fetched one with it.
          if (persist === undefined) restored = true;
          else refreshed = true;
        },
      });
    };

  return {
    id: LLAMA_PROVIDER,
    name: connection.name,
    baseUrl: modules.inferenceUrl(serverUrl),
    auth: {
      apiKey: {
        name: piKey.name,
        ...(check ? { check: (input) => check({ ...input, ctx: withServer(input.ctx) }) } : {}),
        resolve: (input) => piKey.resolve({ ...input, ctx: withServer(input.ctx) }),
      },
    },
    getModels: models,
    refreshModels: (context) => {
      const key = context.credential?.type === 'api_key' ? context.credential.key : undefined;
      const { stored } = context;
      return refresh({
        allowNetwork: context.allowNetwork,
        ...(context.force === undefined ? {} : { force: context.force }),
        signal: context.signal,
        // Pi reads the server from the credential; a keyless connection still refreshes.
        credential: {
          type: 'api_key',
          ...(key ? { key } : {}),
          env: { LLAMA_BASE_URL: serverUrl },
        },
        ...(stored
          ? {
              stored: {
                ...stored,
                models: stored.models.map((model) => ({
                  ...model,
                  provider: modules.piProviderId,
                })),
              },
            }
          : {}),
        publish: publish(context),
      });
    },
    stream: (model, context, options) => pi.stream(model, context, options),
    streamSimple: (model, context, options) => pi.streamSimple(model, context, options),
  };
}

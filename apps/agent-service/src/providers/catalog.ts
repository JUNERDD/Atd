import { InMemoryCredentialStore, type Api, type Model } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ServiceCatalogEntry, ServiceModelDefinition } from '@ai/agent-contracts';

/**
 * Service-owned provider catalog: Pi directory plus local entries. The Pi
 * runtime is cached; any Pi failure falls back to locals only so the
 * endpoint never throws 500 for catalog reads and never returns [].
 */
const LOCAL_PROVIDERS: Array<{ id: string; name: string; baseUrl: string }> = [
  { id: 'llamacpp', name: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080/v1' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { id: 'lm-studio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  { id: 'vllm', name: 'vLLM', baseUrl: 'http://localhost:8000/v1' },
  { id: 'openai-compatible', name: 'Custom provider', baseUrl: '' },
];

const CLOUD_PROVIDERS = new Set([
  'amazon-bedrock',
  'azure-openai-responses',
  'google-vertex',
  'cloudflare-ai-gateway',
  'cloudflare-workers-ai',
]);

/** Local and custom endpoints: the connection supplies the models, not the Pi directory. */
export function isLocalProvider(providerId: string): boolean {
  return LOCAL_PROVIDERS.some((provider) => provider.id === providerId);
}

function isCloud(providerId: string): boolean {
  return CLOUD_PROVIDERS.has(providerId);
}

function isAmbient(providerId: string): boolean {
  return providerId === 'amazon-bedrock' || providerId === 'google-vertex';
}

export function toServiceModel(model: Model<Api>): ServiceModelDefinition {
  const {
    id,
    name,
    api,
    baseUrl,
    reasoning,
    input,
    contextWindow,
    maxTokens,
    cost,
    thinkingLevelMap,
  } = model;
  return {
    id,
    name,
    api,
    baseUrl,
    reasoning,
    input,
    contextWindow,
    maxTokens,
    cost,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
  };
}

function localEntries(): ServiceCatalogEntry[] {
  return LOCAL_PROVIDERS.map((provider): ServiceCatalogEntry => ({
    ...provider,
    category: 'local',
    auth: [
      { type: 'none', label: 'No API key' },
      { type: 'api_key', label: 'API key' },
    ],
    models: [],
  }));
}

let directory: Promise<ModelRuntime> | null = null;

function getDirectory(): Promise<ModelRuntime> {
  if (!directory) {
    directory = ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
    });
  }
  return directory;
}

/**
 * The built-in models Pi ships for one provider, without network or
 * credentials. Local providers and Pi failures have none.
 */
export async function directoryModels(providerId: string): Promise<ServiceModelDefinition[]> {
  try {
    return (await getDirectory()).getModels(providerId).map(toServiceModel);
  } catch {
    directory = null;
    return [];
  }
}

/** Pi providers plus locals; Pi failure falls back to locals only. */
export async function getServiceCatalog(): Promise<ServiceCatalogEntry[]> {
  try {
    const models = await getDirectory();
    const piEntries = models.getProviders().map((provider): ServiceCatalogEntry => {
      const apiKeyType: ServiceCatalogEntry['auth'][number]['type'] = isAmbient(provider.id)
        ? 'ambient'
        : provider.id === 'llamacpp'
          ? 'none'
          : 'api_key';
      return {
        id: provider.id,
        name:
          provider.id === 'openai'
            ? 'OpenAI API'
            : provider.id === 'openai-codex'
              ? 'ChatGPT / Codex'
              : (provider.name ?? provider.id),
        category: isCloud(provider.id)
          ? 'cloud'
          : provider.id === 'llamacpp'
            ? 'local'
            : provider.auth.oauth
              ? 'accounts'
              : 'api',
        auth: [
          ...(provider.auth.oauth
            ? [
                {
                  type: 'oauth' as const,
                  label: provider.auth.oauth.loginLabel ?? 'Account login',
                },
              ]
            : []),
          ...(provider.auth.apiKey
            ? [
                {
                  type: apiKeyType,
                  label: provider.auth.apiKey.name ?? 'API key',
                },
              ]
            : []),
        ],
        baseUrl: provider.baseUrl ?? '',
        models: models.getModels(provider.id).map(toServiceModel),
      };
    });
    return [...piEntries, ...localEntries()];
  } catch {
    directory = null;
    return localEntries();
  }
}

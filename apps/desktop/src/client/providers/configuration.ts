import type { ConnectionConfig } from './schema';

import { CLOUD_FIELDS, isCustom } from './metadata';
export { CLOUD_FIELDS, isCustom, isCloud, isAmbient, LOCAL_PROVIDERS } from './metadata';

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(hostname);
}

export function endpoint(value: string): string {
  const source = value.trim();
  const url = new URL(source);
  if (!/^https?:\/\//.test(source)) throw new Error('Use an HTTP or HTTPS endpoint.');
  if (/[\s\\?#]/.test(source) || url.username || url.password)
    throw new Error('Endpoints cannot contain credentials, queries or fragments.');
  return url.href.replace(/\/+$/, '');
}

/** Plain HTTP outside loopback is allowed, but the form warns before it is saved. */
export function isInsecureEndpoint(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' && !isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

export function validateConfig(config: ConnectionConfig) {
  if (!config.name.trim()) throw new Error('Enter a connection name.');
  if (config.baseUrl) config.baseUrl = endpoint(config.baseUrl);
  if ((isCustom(config.provider) || config.provider === 'azure') && !config.baseUrl)
    throw new Error('Enter the service endpoint.');
  if (config.provider === 'llamacpp') config.baseUrl = `${config.baseUrl.replace(/\/v1$/, '')}/v1`;
  const fields = CLOUD_FIELDS[config.provider] ?? [];
  if (Object.keys(config.options).some((key) => !fields.some((field) => field.key === key)))
    throw new Error('Unsupported connection option.');
  if (config.customModels.length && !isCustom(config.provider))
    throw new Error('Use the provider catalog for this connection.');
  for (const model of config.customModels) {
    if (
      ![
        'openai-completions',
        'openai-responses',
        'anthropic-messages',
        'google-generative-ai',
      ].includes(model.api)
    )
      throw new Error('Choose a supported custom model protocol.');
    model.baseUrl = config.baseUrl;
    if (model.maxTokens > model.contextWindow)
      throw new Error('Output tokens cannot exceed the context window.');
  }
  if (new Set(config.customModels.map((model) => model.id)).size !== config.customModels.length)
    throw new Error('Model IDs must be unique within a connection.');
}

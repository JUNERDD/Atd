import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { parse } from '../../src/client/agent/validation';
import { endpoint } from '../../src/client/providers/configuration';
import type { StoredConnection } from '../../src/client/providers/schema';

const LegacyProviderSchema = Type.Object(
  {
    id: Type.Union([Type.Literal('openai'), Type.Literal('openai-compatible')]),
    baseUrl: Type.String(),
    model: Type.String(),
    encryptedApiKey: Type.String(),
  },
  { additionalProperties: false },
);

export function migrateProvider(value: unknown): StoredConnection[] {
  const old = parse(LegacyProviderSchema, value);
  if (!old.encryptedApiKey && !old.model) return [];
  const baseUrl = endpoint(old.baseUrl);
  // Preserve the original reference used by saved commands and immutable task history.
  const connectionId = createHash('sha256').update(`${old.id}\n${baseUrl}`).digest('hex');
  // Retain encrypted v1 bytes even when the system keychain is temporarily locked.
  const encryptedCredential = old.encryptedApiKey ? `legacy:${old.encryptedApiKey}` : '';
  return [
    {
      connectionId,
      revision: 1,
      provider: old.id,
      name: old.id === 'openai' ? 'OpenAI API' : 'Custom provider',
      baseUrl,
      authType: old.encryptedApiKey || old.id === 'openai' ? 'api_key' : 'none',
      defaultModel: old.model,
      options: {},
      customModels:
        old.id === 'openai-compatible' && old.model
          ? [
              {
                id: old.model,
                name: old.model,
                api: 'openai-completions',
                baseUrl,
                reasoning: false,
                input: ['text'],
                contextWindow: 32768,
                maxTokens: 4096,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ]
          : [],
      connected: Boolean(encryptedCredential) || old.id === 'openai-compatible',
      encryptedCredential,
      catalog: [],
      catalogError: '',
      verifiedModel: '',
    },
  ];
}

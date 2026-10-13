import { Type } from 'typebox';
import type { AuthResult } from '@earendil-works/pi-ai';
import { parse, type ServiceConnection, type ServiceModelDefinition } from '@atd/agent-contracts';
import { CatalogFailure, readCatalogJson } from './catalog-http.js';

/**
 * Model discovery for OpenAI-compatible local and custom endpoints, which have no Pi directory
 * (llama.cpp has Pi's own provider, llama.ts). Reads are bounded, same-endpoint and never load,
 * unload or download models.
 */

const CatalogSchema = Type.Object({
  data: Type.Array(Type.Object({ id: Type.String({ minLength: 1, maxLength: 256 }) }), {
    maxItems: 10000,
  }),
});

function discovered(
  connection: ServiceConnection,
  id: string,
  capacity: Pick<ServiceModelDefinition, 'input' | 'contextWindow' | 'maxTokens'>,
): ServiceModelDefinition {
  return {
    id,
    name: id,
    api: 'openai-completions',
    baseUrl: connection.baseUrl,
    reasoning: false,
    ...capacity,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

/** Only explicitly OpenAI-compatible endpoints use /models; other protocols use manual definitions. */
export async function discoverCompatibleModels(
  connection: ServiceConnection,
  auth: AuthResult,
): Promise<ServiceModelDefinition[]> {
  const customModels = connection.customModels ?? [];
  if (customModels.some((model) => !['openai-completions', 'openai-responses'].includes(model.api)))
    return customModels;
  const value = await readCatalogJson(
    `${connection.baseUrl}/models`,
    auth.auth.apiKey && auth.auth.apiKey !== 'unused'
      ? { Authorization: `Bearer ${auth.auth.apiKey}` }
      : {},
  );
  let result;
  try {
    result = parse(CatalogSchema, value);
  } catch {
    throw new CatalogFailure(
      'Expected an OpenAI-compatible models response: data must be an array of up to 10000 models with non-empty id strings (at most 256 characters).',
    );
  }
  return [...new Set(result.data.map((model) => model.id))].map(
    (id) =>
      customModels.find((model) => model.id === id) ??
      discovered(connection, id, { input: ['text'], contextWindow: 32768, maxTokens: 4096 }),
  );
}

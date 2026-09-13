import { Type } from 'typebox';
import type { AuthResult } from '@earendil-works/pi-ai';
import { parse } from '../agent/validation';
import type { ModelDefinition, StoredConnection } from './schema';

/** Bounded, same-endpoint reads shared by compatible and llama.cpp model discovery. */
export async function readModelMetadata(
  url: string,
  auth: AuthResult,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    headers:
      auth.auth.apiKey && auth.auth.apiKey !== 'unused'
        ? { Authorization: `Bearer ${auth.auth.apiKey}` }
        : {},
    redirect: 'error',
    signal,
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('The model directory could not be loaded.');
  }
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1048576) throw new Error('The model directory is too large.');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Only explicitly OpenAI-compatible endpoints use /models; other protocols use manual definitions. */
export async function refreshLocalModels(
  connection: StoredConnection,
  auth: AuthResult,
): Promise<ModelDefinition[]> {
  if (
    connection.customModels.some(
      (model) => !['openai-completions', 'openai-responses'].includes(model.api),
    )
  )
    return connection.customModels;
  const result = parse(
    Type.Object({
      data: Type.Array(Type.Object({ id: Type.String({ minLength: 1, maxLength: 256 }) }), {
        maxItems: 5000,
      }),
    }),
    await readModelMetadata(`${connection.baseUrl}/models`, auth, AbortSignal.timeout(15000)),
  );
  return [...new Set(result.data.map((model) => model.id))].map(
    (id) =>
      connection.customModels.find((model) => model.id === id) ?? {
        id,
        name: id,
        api: 'openai-completions',
        baseUrl: connection.baseUrl,
        reasoning: false,
        input: ['text'],
        contextWindow: 32768,
        maxTokens: 4096,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
  );
}

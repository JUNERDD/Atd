import { Type } from 'typebox';
import type { AuthResult } from '@earendil-works/pi-ai';
import { parse, type ServiceConnection, type ServiceModelDefinition } from '@ai/agent-contracts';

/**
 * Model discovery for local and custom endpoints, which have no Pi directory.
 * Reads are bounded, same-endpoint and never load, unload or download models.
 */

const DISCOVERY_TIMEOUT_MS = 15000;

async function readModelMetadata(
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
  const result = parse(
    Type.Object({
      data: Type.Array(Type.Object({ id: Type.String({ minLength: 1, maxLength: 256 }) }), {
        maxItems: 5000,
      }),
    }),
    await readModelMetadata(
      `${connection.baseUrl}/models`,
      auth,
      AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    ),
  );
  return [...new Set(result.data.map((model) => model.id))].map(
    (id) =>
      customModels.find((model) => model.id === id) ??
      discovered(connection, id, { input: ['text'], contextWindow: 32768, maxTokens: 4096 }),
  );
}

const LlamaDirectory = Type.Object({
  data: Type.Array(
    Type.Object({
      id: Type.String({ minLength: 1, maxLength: 256 }),
      status: Type.Object({ value: Type.String() }),
      architecture: Type.Optional(Type.Object({ input_modalities: Type.Array(Type.String()) })),
    }),
    { maxItems: 5000 },
  ),
});
const LlamaProperties = Type.Object({
  default_generation_settings: Type.Object({ n_ctx: Type.Integer({ minimum: 1 }) }),
});

/** llama.cpp router discovery: capacity comes from each running slot. */
export async function discoverLlamaModels(
  connection: ServiceConnection,
  auth: AuthResult,
): Promise<ServiceModelDefinition[]> {
  const customModels = connection.customModels ?? [];
  const root = connection.baseUrl.replace(/\/v1$/, '');
  const signal = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  const directory = parse(LlamaDirectory, await readModelMetadata(`${root}/models`, auth, signal));
  const loaded = directory.data.filter(
    (model) => model.status.value === 'loaded' || model.status.value === 'sleeping',
  );
  const result: ServiceModelDefinition[] = [];
  // Small batches avoid overwhelming a shared local router during metadata reads.
  for (let index = 0; index < loaded.length; index += 4) {
    result.push(
      ...(await Promise.all(
        loaded.slice(index, index + 4).map(async (model) => {
          const explicit = customModels.find((item) => item.id === model.id);
          if (explicit) return explicit;
          const url = new URL(`${root}/props`);
          url.searchParams.set('model', model.id);
          url.searchParams.set('autoload', 'false');
          const props = parse(LlamaProperties, await readModelMetadata(url.href, auth, signal));
          const context = props.default_generation_settings.n_ctx;
          return discovered(connection, model.id, {
            input: model.architecture?.input_modalities.includes('image')
              ? ['text', 'image']
              : ['text'],
            contextWindow: context,
            maxTokens: Math.min(4096, context),
          });
        }),
      )),
    );
  }
  return result;
}

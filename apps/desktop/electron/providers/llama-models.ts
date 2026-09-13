import { Type } from 'typebox';
import type { AuthResult } from '@earendil-works/pi-ai';
import { parse } from '../agent/validation';
import type { ModelDefinition, StoredConnection } from './schema';
import { readModelMetadata } from './local-models';

const Directory = Type.Object({
  data: Type.Array(
    Type.Object({
      id: Type.String({ minLength: 1, maxLength: 256 }),
      status: Type.Object({ value: Type.String() }),
      architecture: Type.Optional(Type.Object({ input_modalities: Type.Array(Type.String()) })),
    }),
    { maxItems: 5000 },
  ),
});
const Properties = Type.Object({
  default_generation_settings: Type.Object({ n_ctx: Type.Integer({ minimum: 1 }) }),
});

/** Router discovery never loads, unloads, or downloads models. Capacity comes from each running slot. */
export async function refreshLlamaModels(
  connection: StoredConnection,
  auth: AuthResult,
): Promise<ModelDefinition[]> {
  const root = connection.baseUrl.replace(/\/v1$/, '');
  const signal = AbortSignal.timeout(15000);
  const directory = parse(Directory, await readModelMetadata(`${root}/models`, auth, signal));
  const loaded = directory.data.filter(
    (model) => model.status.value === 'loaded' || model.status.value === 'sleeping',
  );
  const result: ModelDefinition[] = [];
  // Small batches avoid overwhelming a shared local router during metadata reads.
  for (let index = 0; index < loaded.length; index += 4) {
    result.push(
      ...(await Promise.all(
        loaded.slice(index, index + 4).map(async (model): Promise<ModelDefinition> => {
          const explicit = connection.customModels.find((item) => item.id === model.id);
          if (explicit) return explicit;
          const url = new URL(`${root}/props`);
          url.searchParams.set('model', model.id);
          url.searchParams.set('autoload', 'false');
          const props = parse(Properties, await readModelMetadata(url.href, auth, signal));
          return {
            id: model.id,
            name: model.id,
            api: 'openai-completions',
            baseUrl: connection.baseUrl,
            reasoning: false,
            input: model.architecture?.input_modalities.includes('image')
              ? ['text', 'image']
              : ['text'],
            contextWindow: props.default_generation_settings.n_ctx,
            maxTokens: Math.min(4096, props.default_generation_settings.n_ctx),
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          };
        }),
      )),
    );
  }
  return result;
}

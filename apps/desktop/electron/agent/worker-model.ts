import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ResolvedModel } from './task-schema';
import { ModelAuthSchema } from '../providers/schema';
import { nativeCall } from './worker-channel';

/** Pi owns the native transport; main resolves and refreshes this run's connection credentials. */
export async function configureModel(
  models: ModelRuntime,
  selected: ResolvedModel,
  request: () => { taskId: string; runId: string },
) {
  const known = models.getModel(selected.provider, selected.modelId);
  const definition =
    'definition' in selected
      ? selected.definition
      : {
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
        name: 'Application connection',
        resolve: () => nativeCall({ action: 'modelAuth', ...request() }, ModelAuthSchema),
      },
    },
  });
  const model = models.getModel(selected.provider, selected.modelId);
  if (!model) throw new Error('The selected model is unavailable.');
  return model;
}

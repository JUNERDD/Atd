import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ResolvedModel } from './task-schema';

/** Register only the accepted connection, using Pi's provider transport and known model metadata. */
export async function configureModel(
  models: ModelRuntime,
  selected: ResolvedModel,
  apiKey: string,
) {
  const known =
    selected.provider === 'openai' ? models.getModel('openai', selected.modelId) : undefined;
  models.registerProvider('app-provider', {
    baseUrl: selected.baseUrl,
    api: selected.provider === 'openai' ? 'openai-responses' : 'openai-completions',
    authHeader: Boolean(apiKey),
    models: [
      {
        id: selected.modelId,
        name: selected.modelId,
        reasoning: known?.reasoning ?? false,
        input: ['text'],
        cost: known?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: known?.contextWindow ?? 32768,
        maxTokens: known?.maxTokens ?? 4096,
      },
    ],
  });
  await models.setRuntimeApiKey('app-provider', apiKey || 'unused');
  const model = models.getModel('app-provider', selected.modelId);
  if (!model) throw new Error('The selected model is unavailable.');
  return model;
}

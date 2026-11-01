import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { Provider } from '@earendil-works/pi-ai';
import { parse, type ServiceConnection, type ServiceModelDefinition } from '@atd/agent-contracts';
import { CatalogFailure, readCatalogJson } from './catalog-http.js';
import { toServiceModel } from './catalog.js';
import { endpointCapabilities } from './endpoint-capabilities.js';
import { uniqueModels } from './connection-view.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
const Positive = Type.Integer({ minimum: 1 });
// Auto Router uses -1 for a price determined by the selected model; Pi retains this sentinel.
const Price = Type.Union([
  Type.Literal('-1'),
  Type.String({ pattern: '^\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?$' }),
]);
const TierSchema = Type.Object(
  {
    min_prompt_tokens: Type.Integer({ minimum: 0 }),
    prompt: Type.Optional(Price),
    completion: Type.Optional(Price),
    input_cache_read: Type.Optional(Price),
    input_cache_write: Type.Optional(Price),
  },
  { additionalProperties: false },
);
const CatalogSchema = Type.Object({
  data: Type.Array(
    Type.Object({
      id: Type.String({ minLength: 1, maxLength: 256 }),
      name: Type.String({ minLength: 1, maxLength: 256 }),
      context_length: Type.Union([Positive, Type.Null()]),
      architecture: Type.Object({
        input_modalities: Type.Array(Type.String()),
        output_modalities: Type.Array(Type.String()),
      }),
      pricing: Type.Object({
        prompt: Price,
        completion: Price,
        input_cache_read: Type.Optional(Price),
        input_cache_write: Type.Optional(Price),
        overrides: Type.Optional(Type.Array(Type.Unknown())),
      }),
      top_provider: Type.Object({
        max_completion_tokens: Type.Union([Positive, Type.Null()]),
      }),
      supported_parameters: Type.Array(Type.String()),
    }),
    { maxItems: 10000 },
  ),
});

/** Restore the official catalog into Pi, keeping its protocol-specific encoders and model hints. */
export function openRouterProvider(base: Provider, connection: ServiceConnection): Provider {
  const known = new Map(base.getModels().map((model) => [model.id, model]));
  const catalog = uniqueModels([
    ...(connection.catalog ?? base.getModels().map(toServiceModel)),
    ...(connection.customModels ?? []),
  ]);
  const models = catalog.map((model) => ({
    ...known.get(model.id),
    ...model,
    provider: 'openrouter',
    // A custom endpoint still uses the official catalog, but inference stays at the saved URL.
    ...(connection.baseUrl && connection.baseUrl !== OPENROUTER_URL
      ? { baseUrl: connection.baseUrl }
      : {}),
  }));
  const provider = { ...base, getModels: () => models, getAllModels: () => models };
  // The service owns refresh/persistence. Pi's background registration passes must not restore
  // an older pi.dev overlay over the official directory, including after app restart.
  delete provider.refreshModels;
  return provider;
}

function perMillion(price: string | undefined): number {
  const cost = Number(price ?? '0') * 1_000_000;
  if (!Number.isFinite(cost))
    throw new CatalogFailure('OpenRouter returned an invalid model price.');
  return cost;
}

/** Public tool-capable text models, matching Pi's catalog scope. This does not verify a key. */
export async function loadOpenRouterModels(
  known: readonly ServiceModelDefinition[],
): Promise<ServiceModelDefinition[]> {
  const value = await readCatalogJson(`${OPENROUTER_URL}/models?supported_parameters=tools`);
  let catalog;
  try {
    catalog = parse(CatalogSchema, value);
  } catch {
    throw new CatalogFailure(
      'OpenRouter returned an invalid model directory. Expected data with model IDs, context limits, modalities and token prices.',
    );
  }
  const definitions = new Map(known.map((model) => [model.id, model]));
  return uniqueModels(
    catalog.data.flatMap((entry): ServiceModelDefinition[] => {
      if (
        !entry.architecture.output_modalities.includes('text') ||
        !entry.architecture.input_modalities.includes('text') ||
        !entry.supported_parameters.includes('tools')
      )
        return [];
      const model = definitions.get(entry.id);
      const contextWindow = entry.context_length ?? model?.contextWindow;
      if (!contextWindow) return [];
      // Keep Pi's native Anthropic transport where supported; new models use OpenRouter's
      // documented Chat Completions API. An unknown output limit takes Pi's own default for a
      // registered model (16384); Pi sends it as the request cap, so less truncates reasoning.
      const api = model?.api === 'anthropic-messages' ? model.api : 'openai-completions';
      // The service can represent token thresholds. Skip time-based or unknown conditions,
      // as OpenRouter requires, instead of applying their prices to every request.
      const overrides = (entry.pricing.overrides ?? []).filter((override) =>
        Value.Check(TierSchema, override),
      );
      const tiers = [...new Set(overrides.map((override) => override.min_prompt_tokens))]
        .sort((a, b) => a - b)
        .map((threshold) => {
          const rates = { ...entry.pricing };
          // OpenRouter applies every matching override in source order, with later keys winning.
          // Pi chooses one tier, so each threshold must contain the full effective rate set.
          for (const override of overrides)
            if (override.min_prompt_tokens <= threshold) Object.assign(rates, override);
          return {
            inputTokensAbove: threshold,
            input: perMillion(rates.prompt),
            output: perMillion(rates.completion),
            cacheRead: perMillion(rates.input_cache_read),
            cacheWrite: perMillion(rates.input_cache_write),
          };
        });
      const capabilities = endpointCapabilities(entry);
      const reasoning = capabilities.reasoning ?? false;
      // Parse keeps the entry's `reasoning` object, which carries OpenRouter's default effort.
      const defaultThinkingLevel = reasoning ? capabilities.defaultThinkingLevel : undefined;
      // An OpenAI effort list is not an Anthropic token budget or adaptive-effort map.
      const thinkingLevelMap = reasoning
        ? ((api === 'openai-completions' ? capabilities.thinkingLevelMap : undefined) ??
          model?.thinkingLevelMap)
        : undefined;
      return [
        {
          id: entry.id,
          name: entry.name,
          api,
          baseUrl: api === 'anthropic-messages' ? 'https://openrouter.ai/api' : OPENROUTER_URL,
          reasoning,
          ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
          ...(defaultThinkingLevel ? { defaultThinkingLevel } : {}),
          input: entry.architecture.input_modalities.includes('image')
            ? ['text', 'image']
            : ['text'],
          contextWindow,
          maxTokens: Math.min(
            contextWindow,
            entry.top_provider.max_completion_tokens ?? model?.maxTokens ?? 16384,
          ),
          cost: {
            input: perMillion(entry.pricing.prompt),
            output: perMillion(entry.pricing.completion),
            cacheRead: perMillion(entry.pricing.input_cache_read),
            cacheWrite: perMillion(entry.pricing.input_cache_write),
            ...(tiers.length ? { tiers } : {}),
          },
        },
      ];
    }),
  );
}

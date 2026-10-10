import type {
  ContextTier,
  ProviderContextsResponse,
  ServiceConnection,
  ServiceModelDefinition,
} from '@atd/agent-contracts';
import { isLocalProvider } from './catalog.js';

/**
 * Larger context windows a provider offers beyond the one Pi's catalog pins, by
 * `<provider>/<modelId>`. Only first-hand sources qualify; each entry names its source.
 * Pi pins these models at 272,000 tokens so requests stay below OpenAI's long-context price
 * (pi-ai 1.1.0 `providers/data/openai.json`: contextWindow 272000, cost tier above 272000).
 */
const EXTENDED_WINDOWS: Readonly<Record<string, number>> = {
  // developers.openai.com/api/docs/models/gpt-5.5: 1,050,000-token context window. Pi's own
  // Azure catalog lists the same model at 1,050,000 (providers/data/azure.json).
  'openai/gpt-5.5': 1_050_000,
  // Pi v0.86.1 docs/models.md: "To opt into OpenAI's 1.05M context window" for GPT-5.6 Sol, Terra
  // and Luna, set `modelOverrides.<id>.contextWindow` to 1050000; developers.openai.com model pages.
  'openai/gpt-5.6-sol': 1_050_000,
  'openai/gpt-5.6-terra': 1_050_000,
  'openai/gpt-5.6-luna': 1_050_000,
};

/** A model's context tiers, `standard` first; see `deriveContextTiers`. */
export interface ContextTiers {
  options: ProviderContextsResponse['options'];
  defaultTier: ContextTier;
}

/**
 * The windows a catalog model offers, or null without a real choice. With `W` the catalog
 * window, `T` the lowest input size above which the whole request is priced higher and `L` the
 * extended window (`EXTENDED_WINDOWS`, else `W`):
 * - `T < W`: standard `T` stays below the higher price, long `W`; default long (today's window).
 * - else `L > W`: standard `W`, long `L`; default standard (today's window).
 * - else no tiers.
 * `pricedAbove` is set on the long tier whenever `T` exists. Models are never guessed by name.
 */
export function deriveContextTiers(
  provider: string,
  model: ServiceModelDefinition,
): ContextTiers | null {
  const window = model.contextWindow;
  const thresholds = (model.cost.tiers ?? []).map((tier) => tier.inputTokensAbove);
  const priced = thresholds.length ? Math.min(...thresholds) : null;
  const pricedAbove = priced !== null && Number.isSafeInteger(priced) && priced > 0 ? priced : null;
  const extended = EXTENDED_WINDOWS[`${provider}/${model.id}`] ?? window;
  if (pricedAbove !== null && pricedAbove < window)
    return tiers(pricedAbove, window, pricedAbove, 'long');
  if (extended > window) return tiers(window, extended, pricedAbove, 'standard');
  return null;
}

function tiers(
  standard: number,
  long: number,
  pricedAbove: number | null,
  defaultTier: ContextTier,
): ContextTiers {
  return {
    options: [
      { tier: 'standard', contextWindow: standard, pricedAbove: null },
      { tier: 'long', contextWindow: long, pricedAbove },
    ],
    defaultTier,
  };
}

/**
 * The tiers of one of the connection's models. Local providers and the connection's own custom
 * models keep their numeric window and never get tiers; `catalog` is the presented catalog
 * (connection-view.ts), which a missing model is looked up in.
 */
export function connectionModelTiers(
  connection: ServiceConnection,
  catalog: readonly ServiceModelDefinition[],
  modelId: string,
): ContextTiers | null {
  if (isLocalProvider(connection.provider)) return null;
  if (connection.customModels?.some((model) => model.id === modelId)) return null;
  const model = catalog.find((item) => item.id === modelId);
  return model ? deriveContextTiers(connection.provider, model) : null;
}

/** The tier new runs of the model use: the saved choice, else the default. */
export function selectedTier(
  connection: ServiceConnection,
  modelId: string,
  derived: ContextTiers,
): ContextTier {
  return connection.contextTiers?.[modelId] ?? derived.defaultTier;
}

/**
 * The effective window a run of the model freezes, or undefined when the model has no tiers
 * (the run then keeps the catalog window).
 */
export function effectiveContextWindow(
  connection: ServiceConnection,
  catalog: readonly ServiceModelDefinition[],
  modelId: string,
): number | undefined {
  const derived = connectionModelTiers(connection, catalog, modelId);
  if (!derived) return undefined;
  const tier = selectedTier(connection, modelId, derived);
  return derived.options.find((option) => option.tier === tier)?.contextWindow;
}

/** The contexts response for one model; empty without tiers. */
export function contextsResponse(
  connection: ServiceConnection,
  catalog: readonly ServiceModelDefinition[],
  modelId: string,
): ProviderContextsResponse {
  const derived = connectionModelTiers(connection, catalog, modelId);
  if (!derived) return { options: [], defaultTier: null, selected: null };
  return {
    options: derived.options,
    defaultTier: derived.defaultTier,
    selected: selectedTier(connection, modelId, derived),
  };
}

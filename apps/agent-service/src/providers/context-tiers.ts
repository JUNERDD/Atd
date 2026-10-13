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
 * Windows current models are offered at (Pi's catalog clusters at 128k, 200k, 256k, 400k, 500k
 * and 1M), in round numbers so they read as such; a limit slightly under a model's real window
 * is safe. Local servers also serve the small windows a machine's memory allows.
 */
const HOSTED_WINDOWS = [128_000, 200_000, 256_000, 400_000, 500_000, 1_000_000, 2_000_000];
const LOCAL_WINDOWS = [8_000, 16_000, 32_000, 64_000, ...HOSTED_WINDOWS];

/** Choices reach down this factor below the model's largest window, keeping lists short. */
const LADDER_SPAN = 32;

/** How close a common window may come to a listed one before it counts as the same. */
const NEAR_FRACTION = 0.1;

/** The bound of a model whose window is a fallback: no source says how much it takes. */
const UNKNOWN_LIMIT = 2_000_000;

/**
 * The windows a user may pick for one of the connection's models, smallest first, besides its
 * catalog window and tiers, from the windows models are commonly run at. A directory catalog knows the model's window, so it only offers
 * smaller ones. A local or custom endpoint's model is bounded by the largest window a source
 * names (`maxContextWindow`, which may exceed the served window it runs at by default), else by
 * `UNKNOWN_LIMIT`; a named maximum off the ladder is offered itself, so it stays reachable.
 */
export function contextChoices(
  connection: ServiceConnection,
  catalog: readonly ServiceModelDefinition[],
  modelId: string,
): number[] {
  const model = catalog.find((item) => item.id === modelId);
  if (!model) return [];
  const tiers = connectionModelTiers(connection, catalog, modelId);
  const shown = new Set([
    model.contextWindow,
    ...(tiers?.options ?? []).map((o) => o.contextWindow),
  ]);
  const endpoint =
    isLocalProvider(connection.provider) ||
    Boolean(connection.customModels?.some((item) => item.id === modelId));
  const limit = endpoint ? (model.maxContextWindow ?? UNKNOWN_LIMIT) : Math.max(...shown);
  // Half the model's own window stays offered even under a high bound, so a smaller one is near.
  const floor = Math.min(limit / LADDER_SPAN, model.contextWindow / 2);
  // A custom endpoint relays hosted models; the other local providers serve models themselves.
  const ladder =
    endpoint && connection.provider !== 'openai-compatible' ? LOCAL_WINDOWS : HOSTED_WINDOWS;
  // A named maximum off the ladder is offered itself, so the model's full window stays reachable.
  const maximum = endpoint && model.maxContextWindow && !shown.has(limit) ? limit : undefined;
  const fixed = maximum ? [...shown, maximum] : [...shown];
  // A common window within 10% of one already listed would read as the same choice twice.
  const distinct = (window: number) =>
    fixed.every((other) => Math.abs(window - other) > other * NEAR_FRACTION);
  const choices = ladder.filter((window) => window <= limit && window >= floor && distinct(window));
  if (maximum) choices.push(maximum);
  return choices.sort((a, b) => a - b);
}

/** The window the user set for one of the connection's models, for any provider. */
export function customContextWindow(
  connection: ServiceConnection,
  modelId: string,
): number | undefined {
  return connection.contextWindows?.[modelId];
}

/**
 * The effective window a run of the model freezes: the user's custom window, else the selected
 * tier's; undefined when neither applies (the run then keeps the catalog window).
 */
export function effectiveContextWindow(
  connection: ServiceConnection,
  catalog: readonly ServiceModelDefinition[],
  modelId: string,
): number | undefined {
  const custom = customContextWindow(connection, modelId);
  if (custom) return custom;
  const derived = connectionModelTiers(connection, catalog, modelId);
  if (!derived) return undefined;
  const tier = selectedTier(connection, modelId, derived);
  return derived.options.find((option) => option.tier === tier)?.contextWindow;
}

/** The contexts response for one model: its tiers (none without a real choice) and windows. */
export function contextsResponse(
  connection: ServiceConnection,
  catalog: readonly ServiceModelDefinition[],
  modelId: string,
): ProviderContextsResponse {
  const windows = {
    catalogWindow: catalog.find((item) => item.id === modelId)?.contextWindow ?? null,
    choices: contextChoices(connection, catalog, modelId),
    custom: customContextWindow(connection, modelId) ?? null,
  };
  const derived = connectionModelTiers(connection, catalog, modelId);
  if (!derived) return { options: [], defaultTier: null, selected: null, ...windows };
  return {
    options: derived.options,
    defaultTier: derived.defaultTier,
    selected: selectedTier(connection, modelId, derived),
    ...windows,
  };
}

import { clampThinkingLevel, type Api, type Model } from '@earendil-works/pi-ai';
import type { ServiceModelDefinition, ThinkingLevel } from '@atd/agent-contracts';

/** Pi's own default, which a model falls back to when nobody publishes one for it. */
const FALLBACK_LEVEL: ThinkingLevel = 'medium';

/**
 * The level a model runs at when neither the run nor its connection names one: the default its
 * server or maker publishes, else medium, as far as the model supports it. Pi clamps to the
 * model's levels, so a model without reasoning runs with it off.
 */
export function modelDefaultThinkingLevel(
  provider: string,
  definition: ServiceModelDefinition,
): ThinkingLevel {
  const model: Model<Api> = { ...definition, provider };
  return clampThinkingLevel(model, definition.defaultThinkingLevel ?? FALLBACK_LEVEL);
}

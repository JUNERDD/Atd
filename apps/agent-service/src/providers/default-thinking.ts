import { clampThinkingLevel, type Api, type Model } from '@earendil-works/pi-ai';
import type { ServiceModelDefinition, ThinkingLevel } from '@atd/agent-contracts';
import { bailianCapabilities, isBailianEndpoint } from './bailian.js';

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
  const hints =
    provider === 'openai-compatible' && isBailianEndpoint(definition.baseUrl)
      ? bailianCapabilities(definition.id, definition.api)
      : undefined;
  const thinkingLevelMap = definition.thinkingLevelMap ?? hints?.thinkingLevelMap;
  const model: Model<Api> = {
    ...definition,
    provider,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
  };
  return clampThinkingLevel(
    model,
    definition.defaultThinkingLevel ?? hints?.defaultThinkingLevel ?? FALLBACK_LEVEL,
  );
}

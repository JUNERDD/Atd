import type { Api, Model } from '@earendil-works/pi-ai';
import type { ServiceModelDefinition } from '@atd/agent-contracts';
import { isLocalProvider, nativeThinkingOverrides, protocolModelDirectory } from './catalog.js';
import { bailianCapabilities, isBailianEndpoint } from './bailian.js';

/** One capability resolution for the public catalog, default selection and inference runtime. */
export async function resolveModelCapabilities(
  provider: string,
  definitions: readonly ServiceModelDefinition[],
) {
  const makers =
    provider === 'openai-compatible'
      ? await protocolModelDirectory()
      : new Map<string, Model<Api>>();
  const native =
    isLocalProvider(provider) || provider === 'openrouter'
      ? undefined
      : await nativeThinkingOverrides(provider);
  return definitions.map((definition) => {
    const id = definition.id.toLowerCase();
    const correction = native?.get(id);
    const known =
      correction ??
      makers.get(`${definition.api}:${id}`) ??
      makers.get(`${definition.api}:${id.slice(id.lastIndexOf('/') + 1)}`);
    const hints =
      provider === 'openai-compatible' && isBailianEndpoint(definition.baseUrl)
        ? bailianCapabilities(definition.id, definition.api)
        : undefined;
    const levelMap = hints?.thinkingLevelMap ?? known?.thinkingLevelMap;
    return {
      known,
      definition: {
        ...definition,
        ...(correction?.reasoningControl ? { reasoningControl: correction.reasoningControl } : {}),
        ...(correction?.thinkingLevelMap ? { thinkingLevelMap: correction.thinkingLevelMap } : {}),
        ...(definition.reasoning && !definition.thinkingLevelMap && levelMap
          ? { thinkingLevelMap: levelMap }
          : {}),
        ...(definition.reasoning && !definition.defaultThinkingLevel && hints?.defaultThinkingLevel
          ? { defaultThinkingLevel: hints.defaultThinkingLevel }
          : {}),
      },
    };
  });
}

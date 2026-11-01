import { hasApi, type Api, type Model } from '@earendil-works/pi-ai';
import type { ServiceConnection, ServiceModelDefinition } from '@atd/agent-contracts';
import { protocolModelDirectory } from './catalog.js';
import { uniqueModels } from './connection-view.js';
import { bailianCapabilities, bailianCompat, isBailianEndpoint } from './bailian.js';

/** Local servers document max_tokens; they may silently ignore max_completion_tokens. */
const MAX_TOKENS_FIELD_SERVERS = new Set(['ollama', 'lm-studio']);

/**
 * Restore protocol-specific SDK hints lost when serializing the public catalog. A Claude model
 * served over Chat Completions must never inherit Anthropic's adaptive thinking encoder; Gemini
 * effort enums likewise belong only to Google's protocol. Explicit model settings still win.
 */
export async function compatibleModels(connection: ServiceConnection) {
  const makers =
    connection.provider === 'openai-compatible'
      ? await protocolModelDirectory()
      : new Map<string, Model<Api>>();
  return uniqueModels([...(connection.catalog ?? []), ...(connection.customModels ?? [])]).map(
    (definition) => {
      const id = definition.id.toLowerCase();
      const known =
        makers.get(`${definition.api}:${id}`) ??
        makers.get(`${definition.api}:${id.slice(id.lastIndexOf('/') + 1)}`);
      const hints =
        connection.provider === 'openai-compatible' && isBailianEndpoint(definition.baseUrl)
          ? bailianCapabilities(definition.id, definition.api)
          : undefined;
      const levelMap = hints?.thinkingLevelMap ?? known?.thinkingLevelMap;
      const model: ServiceModelDefinition = {
        ...definition,
        ...(definition.reasoning && !definition.thinkingLevelMap && levelMap
          ? { thinkingLevelMap: levelMap }
          : {}),
        ...(definition.reasoning && !definition.defaultThinkingLevel && hints?.defaultThinkingLevel
          ? { defaultThinkingLevel: hints.defaultThinkingLevel }
          : {}),
      };
      // Full vendor flags only belong to that vendor's endpoint. Adaptive Claude thinking is a
      // model feature of the Anthropic protocol, so retain it on compatible relays as well.
      const native =
        known?.baseUrl.replace(/\/$/, '') === model.baseUrl.replace(/\/$/, '')
          ? known?.compat
          : known && hasApi(known, 'anthropic-messages') && known.compat?.forceAdaptiveThinking
            ? { forceAdaptiveThinking: true }
            : undefined;
      const hosted = connection.provider === 'openai-compatible' ? bailianCompat(model) : undefined;
      const compat =
        model.api === 'openai-completions'
          ? {
              ...native,
              ...hosted,
              // Generic relays may reject the OpenAI-only developer role.
              supportsDeveloperRole: false,
              ...(MAX_TOKENS_FIELD_SERVERS.has(connection.provider)
                ? { maxTokensField: 'max_tokens' as const }
                : {}),
            }
          : { ...native, ...hosted };
      return { ...model, compat };
    },
  );
}

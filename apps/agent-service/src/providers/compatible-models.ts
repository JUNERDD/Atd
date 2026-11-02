import { hasApi } from '@earendil-works/pi-ai';
import type { ServiceConnection } from '@atd/agent-contracts';
import { uniqueModels } from './connection-view.js';
import { bailianCompat } from './bailian.js';
import { resolveModelCapabilities } from './model-capabilities.js';

/** Local servers document max_tokens; they may silently ignore max_completion_tokens. */
const MAX_TOKENS_FIELD_SERVERS = new Set(['ollama', 'lm-studio']);

/**
 * Restore protocol-specific SDK hints lost when serializing the public catalog. A Claude model
 * served over Chat Completions must never inherit Anthropic's adaptive thinking encoder; Gemini
 * effort enums likewise belong only to Google's protocol. Explicit model settings still win.
 */
export async function compatibleModels(connection: ServiceConnection) {
  const models = await resolveModelCapabilities(
    connection.provider,
    uniqueModels([...(connection.catalog ?? []), ...(connection.customModels ?? [])]),
  );
  return models.map(({ definition: model, known }) => {
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
  });
}

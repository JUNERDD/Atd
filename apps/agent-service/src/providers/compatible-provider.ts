import type { Api, Provider, StreamOptions } from '@earendil-works/pi-ai';
import { isBailianEndpoint } from './bailian.js';

/**
 * Pi's effort encoder uses Anthropic adaptive thinking. Bailian accepts the same output_config
 * effort but requires thinking.type=enabled. Retain Pi's streaming, tools and message conversion;
 * translate just this documented protocol difference, before the caller observes the payload.
 */
function payloadHook(next: StreamOptions['onPayload']): NonNullable<StreamOptions['onPayload']> {
  return async (payload, model) => {
    if (isBailianEndpoint(model.baseUrl) && typeof payload === 'object' && payload !== null) {
      if (model.api === 'anthropic-messages') {
        const thinking: unknown = Reflect.get(payload, 'thinking');
        if (
          typeof thinking === 'object' &&
          thinking !== null &&
          Reflect.get(thinking, 'type') === 'adaptive'
        )
          Reflect.set(payload, 'thinking', { type: 'enabled' });
      }
      // Verification omits reasoning. Pi's qwen encoder turns that into false even when the
      // model forbids off; GLM-5.3 rejects it. Preserve its always-on contract on this path too.
      if (
        model.api === 'openai-completions' &&
        model.reasoning &&
        model.thinkingLevelMap?.off === null &&
        Reflect.get(payload, 'enable_thinking') === false
      )
        Reflect.set(payload, 'enable_thinking', true);
    }
    return next ? next(payload, model) : undefined;
  };
}

export function compatibleProvider(base: Provider): Provider {
  return {
    ...base,
    stream: (model, context, options) =>
      base.stream<Api>(model, context, { ...options, onPayload: payloadHook(options?.onPayload) }),
    streamSimple: (model, context, options) =>
      base.streamSimple(model, context, { ...options, onPayload: payloadHook(options?.onPayload) }),
  };
}

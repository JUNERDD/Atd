import type { Api, Provider, StreamOptions } from '@earendil-works/pi-ai';
import { isBailianEndpoint } from './bailian.js';

/**
 * Pi's effort encoder uses Anthropic adaptive thinking. Bailian accepts the same output_config
 * effort but requires thinking.type=enabled. Retain Pi's streaming, tools and message conversion;
 * translate just this documented protocol difference, before the caller observes the payload.
 */
function payloadHook(next: StreamOptions['onPayload']): NonNullable<StreamOptions['onPayload']> {
  return async (payload, model) => {
    if (
      model.api === 'anthropic-messages' &&
      isBailianEndpoint(model.baseUrl) &&
      typeof payload === 'object' &&
      payload !== null
    ) {
      const thinking: unknown = Reflect.get(payload, 'thinking');
      if (
        typeof thinking === 'object' &&
        thinking !== null &&
        Reflect.get(thinking, 'type') === 'adaptive'
      )
        Reflect.set(payload, 'thinking', { type: 'enabled' });
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

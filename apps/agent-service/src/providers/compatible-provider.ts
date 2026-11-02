import {
  hasApi,
  isModelType,
  type Api,
  type Provider,
  type StreamOptions,
} from '@earendil-works/pi-ai';
import { isBailianEndpoint } from './bailian.js';
import { nativeThinkingModel } from './native-thinking.js';

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
    }
    // Verification omits reasoning. Boolean encoders must still honor models that forbid off.
    if (
      hasApi(model, 'openai-completions') &&
      model.reasoning &&
      model.thinkingLevelMap?.off === null &&
      typeof payload === 'object' &&
      payload !== null
    ) {
      if (Reflect.get(payload, 'enable_thinking') === false)
        Reflect.set(payload, 'enable_thinking', true);
      const thinking: unknown = Reflect.get(payload, 'thinking');
      if (
        model.compat?.thinkingFormat === 'zai' &&
        typeof thinking === 'object' &&
        thinking !== null &&
        Reflect.get(thinking, 'type') === 'disabled'
      )
        Reflect.set(payload, 'thinking', { type: 'enabled', clear_thinking: false });
    }
    return next ? next(payload, model) : undefined;
  };
}

export function compatibleProvider(base: Provider, normalizeNative = false): Provider {
  return {
    ...base,
    ...(normalizeNative
      ? {
          getModels: () => base.getModels().map(nativeThinkingModel),
          getAllModels: () =>
            (base.getAllModels?.() ?? base.getModels()).map((model) =>
              isModelType(model, 'chat') ? nativeThinkingModel(model) : model,
            ),
        }
      : {}),
    stream: (model, context, options) =>
      base.stream<Api>(model, context, { ...options, onPayload: payloadHook(options?.onPayload) }),
    streamSimple: (model, context, options) =>
      base.streamSimple(model, context, { ...options, onPayload: payloadHook(options?.onPayload) }),
  };
}

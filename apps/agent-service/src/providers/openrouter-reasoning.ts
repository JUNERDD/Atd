import type { Api, Provider, StreamOptions } from '@earendil-works/pi-ai';
import type { ServiceModelDefinition } from '@atd/agent-contracts';
import { endpointCapabilities, effortLevelMap } from './endpoint-capabilities.js';

const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** https://openrouter.ai/docs/guides/best-practices/reasoning-tokens */
export function openRouterReasoning(entry: object) {
  const capabilities = endpointCapabilities(entry);
  const descriptor: unknown = Reflect.get(entry, 'reasoning');
  if (!capabilities.reasoning || typeof descriptor !== 'object' || descriptor === null)
    return capabilities;
  const declared: unknown = Reflect.get(descriptor, 'supported_efforts');
  const mandatory = Reflect.get(descriptor, 'mandatory') === true;
  const supportsBudget = Reflect.get(descriptor, 'supports_max_tokens') === true;
  const names =
    declared === null
      ? EFFORTS
      : Array.isArray(declared)
        ? declared.filter((value): value is string => typeof value === 'string')
        : [];
  const reasoningControl = names.length
    ? ('effort' as const)
    : supportsBudget
      ? ('budget' as const)
      : ('toggle' as const);
  const thinkingLevelMap = effortLevelMap(
    reasoningControl === 'effort'
      ? names
      : reasoningControl === 'budget'
        ? ['minimal', 'low', 'medium', 'high']
        : ['high'],
  )!;
  // mandatory is authoritative. Optional reasoning has an explicit disabled control even when
  // the effort list contains only enabled levels; omitted and null effort lists mean different things.
  thinkingLevelMap.off = mandatory ? null : 'none';
  return { ...capabilities, reasoningControl, thinkingLevelMap };
}

/** Preserve the SDK transport while expressing the endpoint's actual kind of thinking control. */
export function openRouterReasoningProvider(
  base: Provider,
  definitions: readonly ServiceModelDefinition[],
): Provider {
  const controls = new Map(definitions.map((model) => [model.id, model.reasoningControl]));
  const hook =
    (next: StreamOptions['onPayload']): NonNullable<StreamOptions['onPayload']> =>
    async (payload, model) => {
      if (controls.get(model.id) === 'toggle' && typeof payload === 'object' && payload !== null) {
        if (model.api === 'openai-completions') {
          const reasoning: unknown = Reflect.get(payload, 'reasoning');
          const disabled =
            typeof reasoning === 'object' &&
            reasoning !== null &&
            Reflect.get(reasoning, 'effort') === 'none';
          Reflect.set(payload, 'reasoning', { enabled: !disabled });
        } else if (model.api === 'anthropic-messages') {
          const thinking: unknown = Reflect.get(payload, 'thinking');
          const disabled =
            typeof thinking === 'object' &&
            thinking !== null &&
            Reflect.get(thinking, 'type') === 'disabled';
          Reflect.set(payload, 'thinking', { type: disabled ? 'disabled' : 'adaptive' });
          const output: unknown = Reflect.get(payload, 'output_config');
          if (typeof output === 'object' && output !== null)
            Reflect.deleteProperty(output, 'effort');
        }
      }
      return next ? next(payload, model) : undefined;
    };
  return {
    ...base,
    stream: (model, context, options) =>
      base.stream<Api>(model, context, { ...options, onPayload: hook(options?.onPayload) }),
    streamSimple: (model, context, options) =>
      base.streamSimple(model, context, { ...options, onPayload: hook(options?.onPayload) }),
  };
}

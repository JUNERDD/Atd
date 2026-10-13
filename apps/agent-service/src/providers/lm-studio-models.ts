import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { ThinkingLevel } from '@atd/agent-contracts';
import { effortLevelMap, piLevel, type EndpointCapabilities } from './endpoint-capabilities.js';
import type { NativeProbe } from './local-probe.js';

/**
 * LM Studio's native model facts. Its `/v1/models` lists only ids; `GET /api/v1/models`
 * (lmstudio.ai/docs/developer/rest/list) describes every downloaded model by `key`, with its
 * loaded instances, maximum window, vision and, since 0.4.8, its reasoning options. Each model
 * entry is checked on its own, so one unexpected entry drops only that model's facts.
 */

const List = Type.Object({ models: Type.Array(Type.Unknown(), { maxItems: 10000 }) });
const Model = Type.Object({
  key: Type.String({ minLength: 1 }),
  max_context_length: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  loaded_instances: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.Optional(Type.String()),
        config: Type.Optional(
          Type.Object({ context_length: Type.Optional(Type.Integer({ minimum: 1 })) }),
        ),
      }),
    ),
  ),
  // Embedding models carry no capabilities; `reasoning` appears only where it is configurable.
  capabilities: Type.Optional(
    Type.Object({
      vision: Type.Optional(Type.Boolean()),
      reasoning: Type.Optional(
        Type.Object({
          allowed_options: Type.Array(Type.String()),
          default: Type.Optional(Type.String()),
        }),
      ),
    }),
  ),
});
type ModelEntry = Static<typeof Model>;

/**
 * LM Studio's options in OpenAI `reasoning_effort` names, which its Chat Completions endpoint
 * reads: `off` is `none`, and the toggle's `on` becomes one "on" level, `medium`.
 */
function effortName(option: string): string {
  if (option === 'off') return 'none';
  if (option === 'on') return 'medium';
  return option;
}

function defaultLevel(option: string | undefined): ThinkingLevel | undefined {
  // `on` names no level; Pi's own default then applies, clamped to the offered levels.
  return option === 'on' ? undefined : piLevel(option && effortName(option));
}

/** A `/v1/models` id is the model key, or a loaded instance's identifier (`key:2`). */
function described(entry: ModelEntry, id: string): EndpointCapabilities {
  const instances = entry.loaded_instances ?? [];
  const instance = instances.find((item) => item.id === id) ?? instances[0];
  // A loaded instance serves its own window; otherwise the next load may use up to the maximum.
  const contextWindow = instance?.config?.context_length ?? entry.max_context_length ?? undefined;
  const { capabilities } = entry;
  const options = capabilities?.reasoning?.allowed_options;
  const reasoning = capabilities ? options !== undefined : undefined;
  const thinkingLevelMap = options ? effortLevelMap(options.map(effortName)) : undefined;
  const defaultThinkingLevel = options ? defaultLevel(capabilities?.reasoning?.default) : undefined;
  const maximum = entry.max_context_length ?? undefined;
  const maxContextWindow =
    maximum && contextWindow && maximum > contextWindow ? maximum : undefined;
  return {
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxContextWindow ? { maxContextWindow } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(defaultThinkingLevel ? { defaultThinkingLevel } : {}),
    ...(capabilities?.vision === true ? { image: true as const } : {}),
  };
}

export const lmStudioCapabilities: NativeProbe = async (ids, read) => {
  const list = await read('/api/v1/models');
  const result = new Map<string, EndpointCapabilities>();
  if (!Value.Check(List, list)) return result;
  const byId = new Map<string, ModelEntry>();
  for (const entry of list.models) {
    if (!Value.Check(Model, entry)) continue;
    for (const id of [entry.key, ...(entry.loaded_instances ?? []).map((item) => item.id)])
      if (id && !byId.has(id)) byId.set(id, entry);
  }
  for (const id of ids) {
    const entry = byId.get(id);
    if (entry) result.set(id, described(entry, id));
  }
  return result;
};

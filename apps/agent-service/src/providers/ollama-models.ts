import { Type, type TSchema, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { ThinkingLevel } from '@atd/agent-contracts';
import { effortLevelMap, piLevel, type EndpointCapabilities } from './endpoint-capabilities.js';
import { mapLimited, type NativeProbe } from './local-probe.js';

/**
 * Ollama's native model facts. Its `/v1/models` lists only ids, so each model is described by
 * `POST /api/show` (capabilities, trained length, Modelfile parameters, thinking controls) and the
 * loaded ones by `GET /api/ps` (the window actually served). Each response part is checked on its
 * own, so one unexpected field drops only that fact.
 */

/** `/api/show` is one request per model; larger installs keep `/models` facts for the rest. */
const MAX_PROBED = 64;
const CONCURRENCY = 4;

/**
 * The smallest window Ollama assigns when neither the Modelfile nor `OLLAMA_CONTEXT_LENGTH` sets
 * one: its automatic default is 4096 below about 23 GiB of VRAM, then 32768, then 262144. A client
 * cannot read the environment or the VRAM tier, and Ollama silently truncates a longer prompt from
 * the front (losing the system prompt), so an unloaded model without `num_ctx` reports this floor.
 * The user can set the window they configured per model.
 */
const AUTOMATIC_WINDOW_FLOOR = 4096;

const Capabilities = Type.Array(Type.String());
const ModelInfo = Type.Record(Type.String(), Type.Unknown());
const Thinking = Type.Object({
  values: Type.Array(Type.Union([Type.Boolean(), Type.String()]), { minItems: 1 }),
  default: Type.Optional(Type.Union([Type.Boolean(), Type.String(), Type.Null()])),
});
const Running = Type.Object({
  models: Type.Array(Type.Unknown()),
});
const RunningModel = Type.Object({
  name: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  context_length: Type.Integer({ minimum: 1 }),
});

function field<T extends TSchema>(value: unknown, key: string, schema: T): Static<T> | undefined {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) return undefined;
  const item: unknown = Reflect.get(value, key);
  return Value.Check(schema, item) ? item : undefined;
}

/** Windows of loaded models by name; Ollama reloads a model whose window a request changes. */
function loadedWindows(value: unknown): Map<string, number> {
  const windows = new Map<string, number>();
  if (!Value.Check(Running, value)) return windows;
  for (const entry of value.models) {
    if (!Value.Check(RunningModel, entry)) continue;
    for (const name of [entry.name, entry.model])
      if (name && !windows.has(name)) windows.set(name, entry.context_length);
  }
  return windows;
}

/** `general.architecture` names the key prefix of the trained length (`llama.context_length`). */
function trainedWindow(info: Static<typeof ModelInfo> | undefined): number | undefined {
  const arch = info?.['general.architecture'];
  const length = typeof arch === 'string' ? info?.[`${arch}.context_length`] : undefined;
  return Number.isSafeInteger(length) && Number(length) > 0 ? Number(length) : undefined;
}

/** `parameters` is Modelfile text, one `name value` pair per line. */
function configuredWindow(parameters: string | undefined): number | undefined {
  const value = Number(/^\s*num_ctx\s+(\d+)\s*$/m.exec(parameters ?? '')?.[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * Effort names Ollama's OpenAI endpoint honors for one thinking model. A descriptor with named
 * values passes the requested name through verbatim, so only those names are offered; a
 * boolean-only one turns every effort into `true` (one "on" level, `medium`); `false` among the
 * values makes `none` (`think: false`) available. Without a descriptor (older servers) Ollama
 * accepts its legacy aliases, of which `minimal` and `xhigh` only duplicate `low` and `max`.
 */
function thinkingEfforts(thinking: Static<typeof Thinking> | undefined): string[] {
  if (!thinking) return ['none', 'low', 'medium', 'high'];
  const named = thinking.values.filter((value) => typeof value === 'string');
  const efforts = named.length ? named : thinking.values.includes(true) ? ['medium'] : [];
  return thinking.values.includes(false) ? ['none', ...efforts] : efforts;
}

function defaultLevel(thinking: Static<typeof Thinking> | undefined): ThinkingLevel | undefined {
  if (thinking?.default === false) return 'off';
  // `true` names no level; Pi's own default then applies, clamped to the offered levels.
  return typeof thinking?.default === 'string' ? piLevel(thinking.default) : undefined;
}

function described(show: unknown, loaded: number | undefined): EndpointCapabilities | undefined {
  const capabilities = field(show, 'capabilities', Capabilities);
  const trained = trainedWindow(field(show, 'model_info', ModelInfo));
  const window =
    configuredWindow(field(show, 'parameters', Type.String())) ??
    loaded ??
    (show === undefined ? undefined : AUTOMATIC_WINDOW_FLOOR);
  const contextWindow = window && trained ? Math.min(window, trained) : window;
  if (!capabilities && !contextWindow) return undefined;
  // Ollama rejects any effort but `none` for a model without "thinking" (HTTP 400), so such a
  // model is explicitly not a reasoning model and never gets `reasoning_effort`.
  const reasoning = capabilities ? capabilities.includes('thinking') : undefined;
  const thinking = reasoning ? field(show, 'thinking', Thinking) : undefined;
  const thinkingLevelMap = reasoning ? effortLevelMap(thinkingEfforts(thinking)) : undefined;
  const defaultThinkingLevel = reasoning ? defaultLevel(thinking) : undefined;
  // The trained length bounds what a user may raise the window to (served windows come from
  // OLLAMA_CONTEXT_LENGTH or the Modelfile, which the user controls).
  const maxContextWindow =
    trained && contextWindow && trained > contextWindow ? trained : undefined;
  return {
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxContextWindow ? { maxContextWindow } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(defaultThinkingLevel ? { defaultThinkingLevel } : {}),
    ...(capabilities?.includes('vision') ? { image: true as const } : {}),
  };
}

export const ollamaCapabilities: NativeProbe = async (ids, read) => {
  const probed = ids.slice(0, MAX_PROBED);
  const [running, shows] = await Promise.all([
    read('/api/ps'),
    mapLimited(probed, CONCURRENCY, (id) => read('/api/show', { model: id })),
  ]);
  const windows = loadedWindows(running);
  const result = new Map<string, EndpointCapabilities>();
  probed.forEach((id, index) => {
    const capabilities = described(shows[index], windows.get(id));
    if (capabilities) result.set(id, capabilities);
  });
  return result;
};

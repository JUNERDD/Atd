import type { ServiceModelDefinition, ThinkingLevel } from '@atd/agent-contracts';

/**
 * What one OpenAI-compatible `/models` entry declares beyond its id. Servers name the same facts
 * differently, so each is probed under the names known servers publish. Only explicit values
 * count: an absent field is unknown, never "unsupported", and callers fall back for it.
 */
export interface EndpointCapabilities {
  contextWindow?: number;
  /** The largest window the model takes, when the server publishes one above `contextWindow`. */
  maxContextWindow?: number;
  maxTokens?: number;
  /** `false` only when the entry says so; servers that omit the flag leave it undefined. */
  reasoning?: boolean;
  thinkingLevelMap?: ServiceModelDefinition['thinkingLevelMap'];
  /** The level the entry names as the model's default, when it names one Pi has. */
  defaultThinkingLevel?: ThinkingLevel;
  /** Set only when the entry lists image input. */
  image?: true;
}

/**
 * Context window names, most specific first: Magpie, Groq and DeepSeek (`context_window`),
 * OpenRouter, Together and Moonshot (`context_length`), Magpie and Anthropic-style
 * (`max_input_tokens`), Mistral (`max_context_length`), vLLM (`max_model_len`). Ollama and
 * LM Studio publish theirs only in their native APIs (ollama-models.ts, lm-studio-models.ts).
 * llama.cpp's slot context precedes its training context, which only bounds what was loaded.
 */
const CONTEXT_PATHS = [
  ['context_window'],
  ['context_length'],
  ['max_input_tokens'],
  ['max_context_length'],
  ['max_model_len'],
  ['top_provider', 'context_length'],
  ['meta', 'n_ctx'],
  ['meta', 'n_ctx_train'],
];

const OUTPUT_PATHS = [
  ['max_output_tokens'],
  ['max_completion_tokens'],
  ['top_provider', 'max_completion_tokens'],
];

/** Request parameters whose support implies a reasoning model (OpenRouter `supported_parameters`). */
const REASONING_PARAMETERS = new Set(['reasoning', 'reasoning_effort', 'include_reasoning']);

/** Pi levels a server's effort names can map to by name; `off` maps only from `none`. */
const EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Larger values are not a window any server serves, but a malformed or placeholder number. */
const MAX_TOKENS_BOUND = 100_000_000;

function at(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key))
      return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}

function tokenCount(entry: object, paths: readonly (readonly string[])[]): number | undefined {
  for (const path of paths) {
    const value = at(entry, path);
    if (Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= MAX_TOKENS_BOUND)
      return Number(value);
  }
  return undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** Effort names from Magpie (`supported_reasoning_levels[].effort`) and OpenRouter. */
function efforts(entry: object): string[] {
  const levels = at(entry, ['supported_reasoning_levels']);
  const magpie = Array.isArray(levels)
    ? levels.map((level) => (typeof level === 'string' ? level : at(level, ['effort'])))
    : [];
  return [...magpie, ...strings(at(entry, ['reasoning', 'supported_efforts']))]
    .filter((effort): effort is string => typeof effort === 'string')
    .map((effort) => effort.toLowerCase());
}

function reasoningOf(entry: object, declaredEfforts: readonly string[]): boolean | undefined {
  // OpenRouter describes reasoning as an object; Anthropic-style entries nest a boolean.
  const capability = at(entry, ['capabilities', 'reasoning']);
  const flag = at(entry, ['reasoning']);
  const positive =
    declaredEfforts.length > 0 ||
    flag === true ||
    (typeof flag === 'object' && flag !== null) ||
    at(entry, ['supports_reasoning']) === true ||
    at(entry, ['capabilities', 'thinking', 'supported']) === true ||
    capability === true ||
    strings(at(entry, ['capabilities'])).some(
      (name) => name === 'thinking' || name === 'reasoning',
    ) ||
    strings(at(entry, ['supported_parameters'])).some((name) => REASONING_PARAMETERS.has(name));
  if (positive) return true;
  if (flag === false || at(entry, ['supports_reasoning']) === false) return false;
  return undefined;
}

/**
 * Pi's levels from the server's effort names, so the effort menu offers only what it accepts.
 * Without `none`, `off` stays unmapped: choosing it sends no effort and the server's own default
 * applies. Names Pi has no level for are dropped; none recognized leaves Pi's default levels.
 */
export function effortLevelMap(
  declared: readonly string[],
): EndpointCapabilities['thinkingLevelMap'] {
  const names = new Set(declared);
  if (!EFFORT_LEVELS.some((level) => names.has(level))) return undefined;
  const map: NonNullable<EndpointCapabilities['thinkingLevelMap']> = {};
  for (const level of EFFORT_LEVELS) map[level] = names.has(level) ? level : null;
  if (names.has('none')) map.off = 'none';
  return map;
}

const PI_LEVELS: readonly ThinkingLevel[] = ['off', ...EFFORT_LEVELS];

/** The Pi level a server's effort name denotes; `none` is Pi's `off`. */
export function piLevel(value: unknown): ThinkingLevel | undefined {
  if (value === 'none') return 'off';
  return PI_LEVELS.find((level) => level === value);
}

/**
 * The model's default level where the entry publishes one: OpenRouter's `reasoning.default_effort`
 * (`none` when off) and `default_enabled`. A default that names no level (enabled without an
 * effort) is no default here.
 */
export function publishedDefaultLevel(entry: object): ThinkingLevel | undefined {
  if (at(entry, ['reasoning', 'default_enabled']) === false) return 'off';
  return piLevel(at(entry, ['reasoning', 'default_effort']));
}

/** OpenRouter-style modalities, or Mistral's `capabilities.vision`. */
function imageInput(entry: object): boolean {
  return (
    strings(at(entry, ['modalities', 'input'])).includes('image') ||
    strings(at(entry, ['architecture', 'input_modalities'])).includes('image') ||
    at(entry, ['capabilities', 'vision']) === true
  );
}

export function endpointCapabilities(entry: object): EndpointCapabilities {
  const declaredEfforts = efforts(entry);
  const reasoning = reasoningOf(entry, declaredEfforts);
  const contextWindow = tokenCount(entry, CONTEXT_PATHS);
  const maxTokens = tokenCount(entry, OUTPUT_PATHS);
  const thinkingLevelMap = reasoning ? effortLevelMap(declaredEfforts) : undefined;
  const defaultThinkingLevel = reasoning ? publishedDefaultLevel(entry) : undefined;
  return {
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(defaultThinkingLevel ? { defaultThinkingLevel } : {}),
    ...(imageInput(entry) ? { image: true as const } : {}),
  };
}

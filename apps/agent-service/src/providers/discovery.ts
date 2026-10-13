import { Type } from 'typebox';
import type { AuthResult } from '@earendil-works/pi-ai';
import { parse, type ServiceConnection, type ServiceModelDefinition } from '@atd/agent-contracts';
import { modelMakerDirectory } from './catalog.js';
import { CatalogFailure, readCatalogJson } from './catalog-http.js';
import { endpointCapabilities, type EndpointCapabilities } from './endpoint-capabilities.js';
import { lmStudioCapabilities } from './lm-studio-models.js';
import { probeReader, serverRoot, type NativeProbe } from './local-probe.js';
import { ollamaCapabilities } from './ollama-models.js';

/**
 * Model discovery for OpenAI-compatible local and custom endpoints, which have no Pi directory
 * (llama.cpp has Pi's own provider, llama.ts). Each model's capabilities come from its `/models`
 * entry where the server publishes them (endpoint-capabilities.ts), and from the native API of
 * servers whose `/models` lists only ids (Ollama, LM Studio). Reads are bounded, same-endpoint and
 * never load, unload or download models.
 */

const CatalogSchema = Type.Object({
  data: Type.Array(Type.Object({ id: Type.String({ minLength: 1, maxLength: 256 }) }), {
    maxItems: 10000,
  }),
});

/** Protocols whose effort names are `reasoning_effort` values, so their level maps carry over. */
const OPENAI_APIS = new Set(['openai-completions', 'openai-responses']);

/**
 * Used only for what neither the endpoint nor the model maker's directory entry declares. Pi sends
 * `maxTokens` as every request's output cap, so the output fallback is Pi's own default for a
 * registered model without one (16384, pi-coding-agent `provider-composer.js`): a smaller cap
 * truncates reasoning models mid-thought. It is still clamped to the window.
 */
const FALLBACK = { contextWindow: 32768, maxTokens: 16384 };

/** Servers whose native API describes the models their `/models` list only names. */
const NATIVE_PROBES: Partial<Record<string, NativeProbe>> = {
  ollama: ollamaCapabilities,
  'lm-studio': lmStudioCapabilities,
};

/**
 * One discovered model: what the endpoint's entry declares wins, then the model maker's directory
 * entry for the same id (relays often publish only ids), then the fallback. Cost stays zero: a
 * relay's prices are not the maker's. Reasoning stays off unless one source says otherwise.
 */
function discovered(
  connection: ServiceConnection,
  entry: { id: string },
  native: EndpointCapabilities | undefined,
  maker: ServiceModelDefinition | undefined,
): ServiceModelDefinition {
  // The native API is the server's own fuller description, so its facts win.
  const declared = { ...endpointCapabilities(entry), ...native };
  const reasoning = declared.reasoning ?? maker?.reasoning ?? false;
  const contextWindow = declared.contextWindow ?? maker?.contextWindow ?? FALLBACK.contextWindow;
  // What a source names bounds the windows a user may pick; a fallback window bounds nothing.
  const maxContextWindow =
    declared.maxContextWindow ?? declared.contextWindow ?? maker?.contextWindow;
  // Other protocols name levels their own way (Gemini's `MINIMAL`), which no server accepts here.
  const makerMap = maker && OPENAI_APIS.has(maker.api) ? maker.thinkingLevelMap : undefined;
  const thinkingLevelMap = reasoning ? (declared.thinkingLevelMap ?? makerMap) : undefined;
  const defaultThinkingLevel = reasoning ? declared.defaultThinkingLevel : undefined;
  return {
    id: entry.id,
    name: entry.id,
    api: 'openai-completions',
    baseUrl: connection.baseUrl,
    reasoning,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(defaultThinkingLevel ? { defaultThinkingLevel } : {}),
    input: declared.image ? ['text', 'image'] : (maker?.input ?? ['text']),
    contextWindow,
    ...(maxContextWindow ? { maxContextWindow } : {}),
    // An output limit above the window is invalid for a model definition.
    maxTokens: Math.min(
      declared.maxTokens ?? maker?.maxTokens ?? FALLBACK.maxTokens,
      contextWindow,
    ),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

/**
 * The maker's entry for a relayed id: the same id apart from case (`DeepSeek-V4` for `deepseek-v4`),
 * else without the vendor prefix relays often add (`Qwen/qwen3-max`). Never a fuzzy match.
 */
function makerEntry(
  makers: Map<string, ServiceModelDefinition>,
  id: string,
): ServiceModelDefinition | undefined {
  const key = id.toLowerCase();
  return makers.get(key) ?? makers.get(key.slice(key.lastIndexOf('/') + 1));
}

/** Only explicitly OpenAI-compatible endpoints use /models; other protocols use manual definitions. */
export async function discoverCompatibleModels(
  connection: ServiceConnection,
  auth: AuthResult,
): Promise<ServiceModelDefinition[]> {
  const customModels = connection.customModels ?? [];
  if (customModels.some((model) => !['openai-completions', 'openai-responses'].includes(model.api)))
    return customModels;
  const headers: Record<string, string> =
    auth.auth.apiKey && auth.auth.apiKey !== 'unused'
      ? { Authorization: `Bearer ${auth.auth.apiKey}` }
      : {};
  const value = await readCatalogJson(`${connection.baseUrl}/models`, headers);
  let result;
  try {
    result = parse(CatalogSchema, value);
  } catch {
    throw new CatalogFailure(
      'Expected an OpenAI-compatible models response: data must be an array of up to 10000 models with non-empty id strings (at most 256 characters).',
    );
  }
  // Only the custom provider relays makers' hosted models. Local servers run open weights under
  // the maker's ids (`google/gemma-4-31b-it`) with a window the user loaded, not the hosted one.
  const makers =
    connection.provider === 'openai-compatible' ? await modelMakerDirectory() : new Map();
  // The first entry for an id wins; parse keeps each entry's undeclared fields for probing.
  const entries = new Map<string, { id: string }>();
  for (const entry of result.data) if (!entries.has(entry.id)) entries.set(entry.id, entry);
  // Custom definitions replace discovery, so their models need no probe.
  const probe = NATIVE_PROBES[connection.provider];
  const probed = [...entries.keys()].filter((id) => !customModels.some((model) => model.id === id));
  const native = probe
    ? await probe(probed, probeReader(serverRoot(connection.baseUrl), headers))
    : new Map<string, EndpointCapabilities>();
  return [...entries.values()].map(
    (entry) =>
      customModels.find((model) => model.id === entry.id) ??
      discovered(connection, entry, native.get(entry.id), makerEntry(makers, entry.id)),
  );
}

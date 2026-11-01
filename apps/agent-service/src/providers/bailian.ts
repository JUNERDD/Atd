import type {
  AnthropicMessagesCompat,
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
} from '@earendil-works/pi-ai';
import type {
  ServiceConnection,
  ServiceModelDefinition,
  ThinkingLevel,
} from '@atd/agent-contracts';
import { directoryModels } from './catalog.js';
import { effortLevelMap, type EndpointCapabilities } from './endpoint-capabilities.js';

/** Only official endpoints use these rules; a preset label never identifies a server. */
export function isBailianEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname;
    return (
      url.protocol === 'https:' &&
      (!url.port || url.port === '443') &&
      (host === 'dashscope.aliyuncs.com' ||
        host.endsWith('.dashscope.aliyuncs.com') ||
        host === 'dashscope-intl.aliyuncs.com' ||
        host === 'dashscope-us.aliyuncs.com' ||
        host.endsWith('.maas.aliyuncs.com')) &&
      /^\/(?:(?:compatible-mode\/)?v1|apps\/anthropic)\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Pi already owns Bailian's hosted model limits and modalities. Reuse those definitions for
 * ordinary API connections too, without copying the Token Plan endpoint, prices or credentials.
 * Keep full ids: `kimi/kimi-k2.5` and `kimi-k2.5` have different serving contracts on Bailian.
 */
export async function bailianDirectory(
  connection: ServiceConnection,
): Promise<Map<string, ServiceModelDefinition> | undefined> {
  if (connection.provider !== 'openai-compatible' || !isBailianEndpoint(connection.baseUrl))
    return undefined;
  const host = new URL(connection.baseUrl).hostname;
  const provider =
    host.includes('cn-beijing') ||
    host === 'dashscope.aliyuncs.com' ||
    host === 'coding.dashscope.aliyuncs.com'
      ? 'qwen-token-plan-cn'
      : 'qwen-token-plan';
  return new Map((await directoryModels(provider)).map((model) => [model.id.toLowerCase(), model]));
}

interface ThinkingProfile {
  efforts: readonly string[];
  defaultLevel: ThinkingLevel;
  switchable: boolean;
  /** Some hybrid models only accept enable_thinking, not reasoning_effort. */
  supportsEffort: boolean;
}

function profile(
  efforts: readonly string[],
  defaultLevel: ThinkingLevel,
  switchable = true,
): ThinkingProfile {
  return { efforts, defaultLevel, switchable, supportsEffort: true };
}

/**
 * Narrow corrections/additions to Pi's catalog, from Bailian's own serving contract:
 * https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions
 * https://help.aliyun.com/zh/model-studio/deep-thinking
 * Do not infer an effort protocol from a model maker or an unrecognized vendor prefix.
 */
function thinkingProfile(modelId: string): ThinkingProfile | undefined {
  const id = modelId.toLowerCase();
  if (
    /^deepseek-v4\.1-flash(?:-1017)?$/.test(id) ||
    ['deepseek-v4-flash-0731', 'deepseek-v4-pro-0813'].includes(id)
  )
    return profile(['low', 'high', 'max'], 'high');
  if (
    [
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'glm-5',
      'glm-5.1',
      'glm-5.2',
      'glm-5.2-fast-preview',
    ].includes(id)
  )
    return profile(['high', 'max'], 'high');
  if (id === 'glm-5.3') return profile(['low', 'high', 'max'], 'max', false);
  if (id === 'kimi-k3') return profile(['low', 'high', 'max'], 'max');
  if (/^qwen3\.8-(?:max(?:-0902)?|flash|27b|2\.4t-a95b)$/.test(id))
    return profile(['low', 'medium', 'xhigh'], 'xhigh', id !== 'qwen3.8-2.4t-a95b');

  const alwaysOn = [
    'minimax-m2.5',
    'kimi-k2.7-code',
    'qwen3.7-max-preview',
    'qwen3.7-max-2026-05-17',
  ].includes(id);
  const defaultOff =
    [
      'qwen-plus',
      'qwen-plus-latest',
      'qwen-plus-2025-04-28',
      'qwen-flash',
      'qwen-flash-2025-07-28',
    ].includes(id) || ['kimi-k2.5', 'kimi-k2.6'].includes(id);
  const hybrid =
    /^qwen3\.(?:[56]-(?:plus|flash)|7-(?:plus|flash|max))(?:-\d{4}-\d{2}-\d{2})?$/.test(id) ||
    /^qwen3\.5-(?:397b-a17b|122b-a10b|27b|35b-a3b)$/.test(id) ||
    [
      'qwen3.6-35b-a3b',
      'deepseek-v3.2',
      'deepseek-v3.2-exp',
      'deepseek-v3.1',
      'deepseek-v3.1-terminus',
    ].includes(id);
  if (alwaysOn || defaultOff || hybrid)
    return {
      // One enabled setting for models without effort control, rather than five identical tiers.
      efforts: ['high'],
      defaultLevel: defaultOff ? 'off' : 'high',
      switchable: !alwaysOn,
      supportsEffort: false,
    };
  return undefined;
}

/** Endpoint-declared metadata and the user's custom definitions take precedence over these hints. */
export function bailianCapabilities(
  modelId: string,
  api = 'openai-completions',
): EndpointCapabilities {
  const thinking = thinkingProfile(modelId);
  if (!thinking) return {};
  const thinkingLevelMap = effortLevelMap(thinking.efforts)!;
  // Pi's qwen adapter toggles enable_thinking when the selected level is off; no effort is sent.
  thinkingLevelMap.off = thinking.switchable ? 'none' : null;
  return {
    reasoning: true,
    thinkingLevelMap,
    defaultThinkingLevel:
      api === 'anthropic-messages' && ['glm-5.2', 'deepseek-v4-pro'].includes(modelId.toLowerCase())
        ? 'max'
        : thinking.defaultLevel,
  };
}

/** Anthropic has no model-list API. Discover through its documented OpenAI sibling, same origin. */
export function bailianCatalogEndpoint(baseUrl: string): string | undefined {
  if (!isBailianEndpoint(baseUrl)) return undefined;
  const url = new URL(baseUrl);
  if (!url.pathname.replace(/\/$/, '').endsWith('/apps/anthropic')) return undefined;
  url.pathname = url.hostname.startsWith('coding') ? '/v1/models' : '/compatible-mode/v1/models';
  return url.toString();
}

/** Keep the configured protocol; capability data from a sibling API never switches inference. */
export function bailianProtocol(baseUrl: string): 'anthropic-messages' | undefined {
  return bailianCatalogEndpoint(baseUrl) ? 'anthropic-messages' : undefined;
}

/** https://help.aliyun.com/zh/model-studio/anthropic-api-messages */
const MESSAGES_MODELS = new Set([
  'qwen3.8-max',
  'qwen3.8-max-0902',
  'qwen3.8-flash',
  'qwen3.8-2.4t-a95b',
  'qwen3.8-27b',
  'qwen3.7-max',
  'qwen3.7-max-2026-05-20',
  'qwen3.7-max-2026-06-08',
  'qwen3.7-plus',
  'qwen3.7-plus-2026-05-26',
  'qwen3.7-flash',
  'qwen3.7-flash-2026-07-15',
  'qwen3.6-plus',
  'qwen3.6-plus-2026-04-02',
  'qwen3.6-flash',
  'qwen3.6-flash-2026-04-16',
  'qwen3.5-plus',
  'qwen3.5-plus-2026-04-20',
  'qwen3.5-plus-2026-02-15',
  'qwen3.5-flash',
  'qwen3.5-flash-2026-02-23',
  'qwen-plus',
  'qwen-plus-latest',
  'qwen-flash',
  'qwen-flash-2025-07-28',
  'qwen3-coder-flash',
  'qwen3-vl-plus',
  'qwen3.6-27b',
  'qwen3.5-397b-a17b',
  'qwen3.5-122b-a10b',
  'qwen3.5-27b',
  'qwen3.5-35b-a3b',
  'deepseek-v4.1-flash',
  'deepseek-v4.1-flash-1017',
  'deepseek-v4-pro',
  'deepseek-v4-pro-0813',
  'deepseek-v4-flash-0731',
  'kimi-k3',
  'kimi-k2.7-code',
  'kimi-k2.6',
  'kimi-k2.5',
  'glm-5.3',
  'glm-5.2',
  'glm-5.1',
  'glm-5',
  'minimax-m2.5',
]);

/** The sibling catalog also lists models that Bailian does not serve over Anthropic Messages. */
export function supportsBailianMessages(modelId: string): boolean {
  return MESSAGES_MODELS.has(modelId.toLowerCase());
}

/** Match the menu to the wire protocol, including models that only expose an on/off switch. */
export function bailianCompat(
  model: ServiceModelDefinition,
): OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat | undefined {
  if (!isBailianEndpoint(model.baseUrl)) return undefined;
  const thinking = thinkingProfile(model.id);
  if (model.api === 'anthropic-messages')
    return {
      forceAdaptiveThinking: thinking?.supportsEffort ?? Boolean(model.thinkingLevelMap),
      supportsStrictMode: false,
    };
  if (model.api === 'openai-responses')
    return { supportsDeveloperRole: false, supportsStrictMode: false };
  if (model.api !== 'openai-completions') return undefined;
  return {
    thinkingFormat: 'qwen',
    supportsReasoningEffort: thinking?.supportsEffort ?? Boolean(model.thinkingLevelMap),
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsStrictMode: false,
    // Older Qwen and third-party deployments do not accept max_completion_tokens.
    maxTokensField: 'max_tokens',
  };
}

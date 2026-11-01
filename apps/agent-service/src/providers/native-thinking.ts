import { hasApi, type Api, type Model } from '@earendil-works/pi-ai';
import type { ServiceModelDefinition } from '@atd/agent-contracts';

/** SDK transports that encode a boolean thinking switch independently of reasoning_effort. */
const SWITCH_FORMATS = new Set(['deepseek', 'zai', 'qwen', 'together']);
const ENABLED_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
// These native transports default to OpenAI encoding, with no implicit thinking switch.
const OPENAI_FORMAT_PROVIDERS = new Set(['nvidia', 'github-copilot', 'cloudflare-ai-gateway']);

/** Do not advertise distinct efforts when the native encoder sends exactly the same switch. */
export function nativeThinkingModel<T extends Model<Api>>(
  model: T,
): T & Pick<ServiceModelDefinition, 'reasoningControl'> {
  if (!model.reasoning || !hasApi(model, 'openai-completions')) return model;
  const compat = model.compat;
  if (
    compat?.supportsReasoningEffort !== false ||
    compat.supportsThinkingTokenBudget ||
    compat.thinkingTokenBudgetField
  )
    return model;
  const fixed =
    compat.thinkingFormat === 'openai' ||
    (!compat.thinkingFormat && OPENAI_FORMAT_PROVIDERS.has(model.provider));
  if (!fixed && !SWITCH_FORMATS.has(compat.thinkingFormat ?? '')) return model;
  const map = model.thinkingLevelMap;
  const enabled = (['high', 'medium', 'low', 'minimal', 'max', 'xhigh'] as const).find(
    (level) =>
      map?.[level] !== null &&
      ((level !== 'max' && level !== 'xhigh') || map?.[level] !== undefined),
  );
  if (!enabled) return model;
  return {
    ...model,
    reasoningControl: fixed ? 'fixed' : 'toggle',
    thinkingLevelMap: {
      ...map,
      // No control is available: retain reasoning and expose only the server's default mode.
      ...(fixed ? { off: null } : {}),
      ...Object.fromEntries(
        ENABLED_LEVELS.map((level) => [level, level === enabled ? (map?.[level] ?? level) : null]),
      ),
    },
  };
}

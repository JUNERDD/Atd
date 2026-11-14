import type { useTranslation } from 'react-i18next';
import type {
  ModelReference,
  ModelThinkingLevel,
  RunContextChoice,
} from '../../client/providers/schema';
import { formatContextWindow } from './context-window';
import type { ModelContextState } from './use-model-contexts';

export type ProvidersT = ReturnType<typeof useTranslation<'providers'>>['t'];

export const FALLBACK_LEVELS: readonly ModelThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
];

export const encodeRef = (connectionId: string, modelId: string) => `${connectionId}\n${modelId}`;

export function decodeRef(value: string): ModelReference | null {
  const i = value.indexOf('\n');
  return i > 0 && i < value.length - 1
    ? { connectionId: value.slice(0, i), modelId: value.slice(i + 1) }
    : null;
}

export function decodeContext(value: string): RunContextChoice | undefined {
  if (value === 'tier:standard') return { tier: 'standard' };
  if (value === 'tier:long') return { tier: 'long' };
  const tokens = value.startsWith('window:') ? Number(value.slice(7)) : NaN;
  return Number.isInteger(tokens) && tokens > 0 ? { contextWindow: tokens } : undefined;
}

export function encodeContext(choice?: RunContextChoice): string {
  if (!choice) return 'default';
  return 'tier' in choice ? `tier:${choice.tier}` : `window:${choice.contextWindow}`;
}

export function buildContextOptions(
  contexts: ModelContextState,
  contextKey: string,
  t: ProvidersT,
) {
  const items = [{ value: 'default', label: t('aliases.dialog.connectionDefault') }];
  const tiers = contexts.options.length === 2 ? contexts.options : [];
  const used = new Set(tiers.map((option) => option.contextWindow));
  for (const { tier, contextWindow } of tiers) {
    const key =
      tier === 'long' ? 'aliases.tuple.extendedContextSize' : 'aliases.tuple.standardContextSize';
    items.push({
      value: `tier:${tier}`,
      label: t(key, { size: formatContextWindow(contextWindow) }),
    });
  }
  for (const tokens of contexts.choices) {
    if (!used.has(tokens)) {
      items.push({ value: `window:${tokens}`, label: formatContextWindow(tokens) });
    }
  }
  if (contextKey !== 'default' && !items.some((item) => item.value === contextKey)) {
    const kept = decodeContext(contextKey);
    const label = !kept
      ? contextKey
      : 'tier' in kept
        ? t(
            kept.tier === 'long'
              ? 'aliases.tuple.extendedContext'
              : 'aliases.tuple.standardContext',
          )
        : t('aliases.dialog.customContextSize', { size: formatContextWindow(kept.contextWindow) });
    items.push({ value: contextKey, label });
  }
  return items;
}

import type { ReactNode, Ref } from 'react';
import { Check, ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import type { ContextTier, ModelContexts, ModelThinkingLevel } from '../../client/providers/schema';
import { formatContextWindow, formatTokenCount } from './context-window';

/** The drill-in header every subview shares: a back button and the subview's title. */
export function ConfigBackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useTranslation('providers');
  return (
    <div className="model-config-back-header">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('modelConfig.back')}
        title={t('modelConfig.back')}
        onClick={onBack}
      >
        <ChevronLeft />
      </Button>
      <span className="model-config-back-title">{title}</span>
    </div>
  );
}

/**
 * One choice of a subview list. `data-checked` marks the current choice, which receives focus
 * when the subview opens; the trailing check keeps its slot on every row so values stay aligned.
 */
function ConfigOption({
  checked,
  onSelect,
  children,
  value,
}: {
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
  value?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      data-checked={checked}
      className="model-config-effort-option"
      onClick={onSelect}
    >
      <span className="model-config-option-text">{children}</span>
      {value && <span className="model-config-option-value">{value}</span>}
      {checked ? <Check className="shrink-0 size-4" /> : <span className="shrink-0 size-4" />}
    </button>
  );
}

/** Effort levels the model offers, in Pi's order. */
export function EffortOptions({
  levels,
  selected,
  listRef,
  onSelect,
}: {
  levels: ModelThinkingLevel[];
  selected: ModelThinkingLevel;
  listRef: Ref<HTMLDivElement>;
  onSelect: (level: ModelThinkingLevel) => void;
}) {
  const { t } = useTranslation('providers');
  return (
    <div ref={listRef} className="model-config-effort-list">
      {levels.map((level) => (
        <ConfigOption key={level} checked={level === selected} onSelect={() => onSelect(level)}>
          <span className="truncate">{t(`thinkingLevels.levels.${level}`)}</span>
        </ConfigOption>
      ))}
    </div>
  );
}

/**
 * The model's two context windows. The `long` tier notes the pricing threshold above which the
 * whole request costs more; the footnote says the choice is remembered for the model, not the
 * draft.
 */
export function ContextOptions({
  options,
  selected,
  listRef,
  onSelect,
}: {
  options: ModelContexts['options'];
  selected: ContextTier | null;
  listRef: Ref<HTMLDivElement>;
  onSelect: (tier: ContextTier) => void;
}) {
  const { t } = useTranslation('providers');
  return (
    <>
      <div ref={listRef} className="model-config-effort-list">
        {options.map((option) => (
          <ConfigOption
            key={option.tier}
            checked={option.tier === selected}
            value={formatContextWindow(option.contextWindow)}
            onSelect={() => onSelect(option.tier)}
          >
            <span className="truncate">{t(`modelConfig.tiers.${option.tier}`)}</span>
            {option.tier === 'long' && option.pricedAbove != null && (
              <span className="model-config-option-hint">
                {t('modelConfig.pricedAbove', { tokens: formatTokenCount(option.pricedAbove) })}
              </span>
            )}
          </ConfigOption>
        ))}
      </div>
      <p className="model-config-note">{t('modelConfig.contextApplies')}</p>
    </>
  );
}

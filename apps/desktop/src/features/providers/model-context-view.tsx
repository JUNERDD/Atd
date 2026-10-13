import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelContextChoice } from '../../client/providers/schema';
import { formatContextWindow, formatTokenCount } from './context-window';
import { ConfigOption, ConfigOptionList } from './model-config-subviews';
import { contextRows, contextRowTitle, type ModelContextState } from './use-model-contexts';

/**
 * The model popover's Context subview: one list of the model's tiers (the `long` one noting the
 * pricing threshold above which the whole request costs more) or its catalog window as the model
 * default, then the other windows it may use, each titled by its size. The footnote says the
 * choice is remembered for the model, not the draft.
 */
export function ContextOptions({
  contexts,
  listRef,
  onSelect,
}: {
  contexts: ModelContextState;
  listRef: Ref<HTMLDivElement>;
  /** A row was picked, with the write it makes; null when it changes nothing. */
  onSelect: (choice: ModelContextChoice | null) => void;
}) {
  const { t } = useTranslation('providers');
  return (
    <>
      <ConfigOptionList listRef={listRef}>
        {contextRows(contexts).map((row) => (
          <ConfigOption
            key={row.key}
            checked={row.checked}
            // A choice row's title is its window already, so its value slot stays empty.
            value={row.kind === 'choice' ? undefined : formatContextWindow(row.window)}
            onSelect={() => onSelect(row.choice)}
          >
            <span className="truncate">{contextRowTitle(row, t)}</span>
            {row.pricedAbove != null && <PricedAboveHint tokens={row.pricedAbove} />}
          </ConfigOption>
        ))}
      </ConfigOptionList>
      <p className="model-config-note">{t('modelConfig.contextApplies')}</p>
    </>
  );
}

/** The long tier's pricing threshold on one line; the tooltip keeps a cut-off translation whole. */
function PricedAboveHint({ tokens }: { tokens: number }) {
  const { t } = useTranslation('providers');
  const text = t('modelConfig.pricedAbove', { tokens: formatTokenCount(tokens) });
  return (
    <span className="model-config-option-hint" title={text}>
      {text}
    </span>
  );
}

import type { Ref } from 'react';
import type { RunContextChoice } from '@atd/agent-contracts';
import { useTranslation } from 'react-i18next';
import type { ModelContextChoice } from '../../client/providers/schema';
import { formatContextWindow, formatTokenCount } from './context-window';
import { ConfigOption, ConfigOptionList } from './model-config-subviews';
import {
  contextDraftRows,
  contextRows,
  contextRowTitle,
  type ContextRow,
  type ModelContextState,
} from './use-model-contexts';

/**
 * The model popover's Context subview: one list of the model's tiers (the `long` one noting the
 * pricing threshold above which the whole request costs more) or its catalog window as the model
 * default, then the other windows it may use, each titled by its size. When `onSelectDraftChoice`
 * is passed, picks stage a conversation draft choice without modifying saved connection defaults.
 */
export function ContextOptions({
  contexts,
  draftChoice,
  listRef,
  onSelect,
  onSelectDraftChoice,
}: {
  contexts: ModelContextState;
  draftChoice?: RunContextChoice | undefined;
  listRef: Ref<HTMLDivElement>;
  /** A row was picked, with the write it makes; null when it changes nothing. */
  onSelect: (choice: ModelContextChoice | null) => void;
  /** Draft mode handler: receives the staged `RunContextChoice` and whether it changed. */
  onSelectDraftChoice?:
    | ((choice: RunContextChoice | undefined, changed: boolean) => void)
    | undefined;
}) {
  const { t } = useTranslation('providers');
  const { t: tPanel } = useTranslation('panel');
  const rows: Array<ContextRow & { pick: () => void }> = onSelectDraftChoice
    ? contextDraftRows(contexts, draftChoice).map((row) => ({
        ...row,
        pick: () => onSelectDraftChoice(row.runChoice, row.changed),
      }))
    : contextRows(contexts).map((row) => ({
        ...row,
        pick: () => onSelect(row.choice),
      }));
  return (
    <>
      <ConfigOptionList listRef={listRef}>
        {rows.map((row) => (
          <ConfigOption
            key={row.key}
            checked={row.checked}
            // A choice row's title is its window already, so its value slot stays empty.
            value={row.kind === 'choice' ? undefined : formatContextWindow(row.window)}
            onSelect={row.pick}
          >
            <span className="truncate">{contextRowTitle(row, t)}</span>
            {row.pricedAbove != null && <PricedAboveHint tokens={row.pricedAbove} />}
          </ConfigOption>
        ))}
      </ConfigOptionList>
      <p className="model-config-note">
        {onSelectDraftChoice
          ? tPanel('modelConfig.contextAppliesDraft')
          : t('modelConfig.contextApplies')}
      </p>
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

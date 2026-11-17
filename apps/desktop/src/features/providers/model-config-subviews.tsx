import type { ReactNode, Ref } from 'react';
import type { RunContextChoice } from '@atd/agent-contracts';
import { Check, ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import type { Connection, ModelReference, ModelThinkingLevel } from '../../client/providers/schema';
import { ContextOptions } from './model-context-view';
import { ModelList } from './model-list';
import { saveModelContext, type ModelContextState } from './use-model-contexts';

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
 * One choice of a `ConfigOptionList`. `data-checked` marks the current choice, which receives
 * focus when the subview opens; the trailing check keeps its slot on every row so values stay
 * aligned.
 */
export function ConfigOption({
  checked,
  onSelect,
  children,
  value,
}: {
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
  value?: string | undefined;
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
      {checked ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
    </button>
  );
}

/**
 * A subview's option list. It scrolls within the popover's bounded height; arrow/Home/End and
 * Tab navigation are handled on the enclosing `PopoverContent`.
 */
export function ConfigOptionList({
  listRef,
  children,
}: {
  listRef: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <ScrollArea>
      <div ref={listRef} className="model-config-effort-list">
        {children}
      </div>
    </ScrollArea>
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
    <ConfigOptionList listRef={listRef}>
      {levels.map((level) => (
        <ConfigOption key={level} checked={level === selected} onSelect={() => onSelect(level)}>
          <span className="truncate">{t(`thinkingLevels.levels.${level}`)}</span>
        </ConfigOption>
      ))}
    </ConfigOptionList>
  );
}

/** Drill-in subviews (`context`, `effort`, `model`) shared by `ModelConfigPopover`. */
export function ModelConfigSubview({
  view,
  model,
  connection,
  connections,
  baseContexts,
  draftContextChoice,
  hideDraftContextNote,
  onContextChoiceChange,
  levels,
  selectedEffort,
  onThinkingLevelChange,
  scoped,
  scopeLabel,
  optionListRef,
  modelViewRef,
  onBack,
  onSelectModel,
  onOpenProviders,
  onClose,
}: {
  view: 'context' | 'effort' | 'model';
  model: ModelReference | null;
  connection: Connection | undefined;
  connections: Connection[];
  baseContexts: ModelContextState;
  draftContextChoice?: RunContextChoice | undefined;
  hideDraftContextNote?: boolean | undefined;
  onContextChoiceChange?: ((choice: RunContextChoice | undefined) => void) | undefined;
  levels: ModelThinkingLevel[];
  selectedEffort?: ModelThinkingLevel | undefined;
  onThinkingLevelChange?: ((level: ModelThinkingLevel) => void) | undefined;
  scoped: boolean;
  scopeLabel?: string | undefined;
  optionListRef: Ref<HTMLDivElement>;
  modelViewRef: Ref<HTMLDivElement>;
  onBack: () => void;
  onSelectModel: (reference: ModelReference) => void;
  onOpenProviders?: (() => void) | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation('providers');
  if (view === 'context' && model && connection) {
    return (
      <div className="model-config-subview">
        <ConfigBackHeader title={t('modelConfig.context')} onBack={onBack} />
        <ContextOptions
          contexts={baseContexts}
          draftChoice={onContextChoiceChange ? draftContextChoice : undefined}
          hideDraftNote={hideDraftContextNote}
          listRef={optionListRef}
          onSelectDraftChoice={
            onContextChoiceChange
              ? (choice, changed) => {
                  onBack();
                  if (changed) onContextChoiceChange(choice);
                }
              : undefined
          }
          onSelect={(choice) => {
            onBack();
            if (choice) void saveModelContext(model, choice, connection.revision);
          }}
        />
      </div>
    );
  }
  if (view === 'effort' && onThinkingLevelChange && selectedEffort) {
    return (
      <div className="model-config-subview">
        <ConfigBackHeader title={t('thinkingLevels.label')} onBack={onBack} />
        <EffortOptions
          levels={levels}
          selected={selectedEffort}
          listRef={optionListRef}
          onSelect={(level) => {
            if (level !== selectedEffort) onThinkingLevelChange(level);
            onBack();
          }}
        />
      </div>
    );
  }
  if (view === 'model') {
    return (
      <div ref={modelViewRef} className="model-config-subview">
        <ConfigBackHeader title={t('modelConfig.model')} onBack={onBack} />
        <ModelList
          connections={connections}
          value={model}
          scoped={scoped}
          searchLabel={
            scoped ? t('models.searchScopedLabel', { label: scopeLabel }) : t('models.searchLabel')
          }
          onSelect={(reference) => {
            if (
              reference.connectionId !== model?.connectionId ||
              reference.modelId !== model?.modelId
            ) {
              onSelectModel(reference);
            }
            onClose();
          }}
          onOpenProviders={
            onOpenProviders &&
            (() => {
              onClose();
              onOpenProviders();
            })
          }
        />
      </div>
    );
  }
  return null;
}

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@ai/ui/components/popover';
import type {
  Connection,
  ModelReference,
  ModelThinkingLevel,
} from '../../../electron/providers/schema';
import { formatContextWindow } from './context-window';
import { ConfigBackHeader, ContextOptions, EffortOptions } from './model-config-subviews';
import { ModelList } from './model-list';
import { ProviderBrand } from './provider-brand';
import { saveModelContext, useModelContexts } from './use-model-contexts';
import { useThinkingLevels } from './use-thinking-levels';

type ModelConfigView = 'root' | 'context' | 'effort' | 'model';

/**
 * One trigger (`model + context + effort`) with inline drill-in. The root view shows Context,
 * Effort and Model rows; subviews render in the same Popover with a back header. The model view
 * is a ModelList; effort options come from useThinkingLevels, disabled until the model offers a
 * choice and falling back to levels[0] when the given level is unsupported.
 *
 * Context is a drill-in row only when the service offers the model two tiers; otherwise it reads
 * the catalog window. Unlike model and effort, the tier is the connection's remembered choice for
 * the model, so picking one saves it on the connection (every consumer alike) instead of calling
 * back. The trigger and root row show the selected tier's window, else the catalog window.
 *
 * `scopeLabel` names the one connection a scoped popover configures (a provider overview row):
 * its list shows only that connection without a heading, and the trigger drops the brand the row
 * already shows and carries the label for assistive technology.
 */
export function ModelConfigPopover({
  connections,
  model,
  thinkingLevel,
  onModelChange,
  onThinkingLevelChange,
  onOpenProviders,
  scopeLabel,
  compact = false,
  disabled = false,
}: {
  connections: Connection[];
  model: ModelReference | null;
  thinkingLevel: ModelThinkingLevel;
  onModelChange: (value: ModelReference) => void;
  onThinkingLevelChange: (level: ModelThinkingLevel) => void;
  onOpenProviders?: () => void;
  scopeLabel?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation('providers');
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ModelConfigView>('root');
  const contextRowRef = useRef<HTMLButtonElement>(null);
  const effortRowRef = useRef<HTMLButtonElement>(null);
  const modelRowRef = useRef<HTMLButtonElement>(null);
  const optionListRef = useRef<HTMLDivElement>(null);
  const modelViewRef = useRef<HTMLDivElement>(null);
  const previousView = useRef<ModelConfigView>('root');

  const connection = connections.find((item) => item.connectionId === model?.connectionId);
  const definition = connection?.catalog.find((item) => item.id === model?.modelId);
  const name = definition?.name ?? (model?.modelId || t('models.choose'));
  const unavailable = Boolean(
    model?.modelId &&
    (!connection?.connected || !connection.catalog.some((item) => item.id === model.modelId)),
  );
  const displayName = unavailable ? t('models.unavailable', { name }) : name;
  const contexts = useModelContexts(model, connection?.revision ?? null);
  const contextText = formatContextWindow(contexts.window ?? definition?.contextWindow ?? null);
  const contextChoice = Boolean(model) && contexts.options.length === 2;
  const { levels, loading } = useThinkingLevels(model);
  const selected = levels.includes(thinkingLevel) ? thinkingLevel : (levels[0] ?? thinkingLevel);
  const effortText = t(`thinkingLevels.levels.${selected}`);
  const effortDisabled = !model || loading || levels.length < 2;
  const scoped = scopeLabel !== undefined;
  const summary = { model: displayName, contextSize: contextText, effort: effortText };
  const details = model ? `${displayName} · ${contextText} · ${effortText}` : displayName;
  const title = connection && model && !scoped ? `${connection.name} · ${details}` : details;

  useEffect(() => {
    if (!open) {
      previousView.current = 'root';
      return;
    }
    if (view === 'root') {
      if (previousView.current === 'context') contextRowRef.current?.focus();
      else if (previousView.current === 'effort') effortRowRef.current?.focus();
      else if (previousView.current === 'model') modelRowRef.current?.focus();
    } else if (view === 'context' || view === 'effort') {
      const current = optionListRef.current?.querySelector<HTMLElement>('[data-checked="true"]');
      const first = optionListRef.current?.querySelector<HTMLElement>('button');
      (current ?? first)?.focus();
    } else {
      modelViewRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    }
    previousView.current = view;
  }, [view, open]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reset on open, not on close: Radix keeps content mounted during the
        // exit animation, so resetting on close flashes the root over the subview.
        if (next) setView('root');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? 'xs' : 'default'}
          className={compact ? 'composer-model' : 'provider-model-trigger'}
          disabled={disabled}
          aria-label={
            scoped
              ? t('modelConfig.scopedTriggerLabel', { label: scopeLabel, ...summary })
              : t('modelConfig.triggerLabel', summary)
          }
          title={title}
        >
          {connection && !scoped && <ProviderBrand provider={connection.provider} />}
          <span className="min-w-0 flex-1 truncate text-left">{displayName}</span>
          {model && <span className="model-config-context shrink-0">{contextText}</span>}
          {model && <span className="model-config-effort shrink-0">{effortText}</span>}
          <ChevronDown className="shrink-0 size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="model-picker model-picker-scoped p-0"
        align="end"
        collisionPadding={8}
      >
        {view === 'root' && (
          <div className="model-config-root">
            {contextChoice ? (
              <button
                ref={contextRowRef}
                type="button"
                className="model-config-row model-config-row-nav"
                onClick={() => setView('context')}
              >
                <span className="model-config-row-label">{t('modelConfig.context')}</span>
                <span className="model-config-row-value">{contextText}</span>
                <ChevronRight className="shrink-0 size-4" />
              </button>
            ) : (
              <div className="model-config-row">
                <span className="model-config-row-label">{t('modelConfig.context')}</span>
                <span className="model-config-row-value">{contextText}</span>
              </div>
            )}
            <button
              ref={effortRowRef}
              type="button"
              className="model-config-row model-config-row-nav"
              disabled={effortDisabled}
              title={
                selected === thinkingLevel
                  ? t('thinkingLevels.label')
                  : t('thinkingLevels.unavailable', {
                      level: t(`thinkingLevels.levels.${thinkingLevel}`),
                    })
              }
              onClick={() => setView('effort')}
            >
              <span className="model-config-row-label">{t('thinkingLevels.label')}</span>
              <span className="model-config-row-value">{effortText}</span>
              <ChevronRight className="shrink-0 size-4" />
            </button>
            <button
              ref={modelRowRef}
              type="button"
              className="model-config-row model-config-row-nav"
              onClick={() => setView('model')}
            >
              <span className="model-config-row-label">{t('modelConfig.model')}</span>
              <span className="model-config-row-value truncate">{displayName}</span>
              <ChevronRight className="shrink-0 size-4" />
            </button>
          </div>
        )}
        {view === 'context' && model && connection && (
          <div className="model-config-subview">
            <ConfigBackHeader title={t('modelConfig.context')} onBack={() => setView('root')} />
            <ContextOptions
              options={contexts.options}
              selected={contexts.selected}
              listRef={optionListRef}
              onSelect={(tier) => {
                setView('root');
                if (tier !== contexts.selected)
                  void saveModelContext(model, tier, connection.revision);
              }}
            />
          </div>
        )}
        {view === 'effort' && (
          <div className="model-config-subview">
            <ConfigBackHeader title={t('thinkingLevels.label')} onBack={() => setView('root')} />
            <EffortOptions
              levels={levels}
              selected={selected}
              listRef={optionListRef}
              onSelect={(level) => {
                onThinkingLevelChange(level);
                setView('root');
              }}
            />
          </div>
        )}
        {view === 'model' && (
          <div ref={modelViewRef} className="model-config-subview">
            <ConfigBackHeader title={t('modelConfig.model')} onBack={() => setView('root')} />
            <ModelList
              connections={connections}
              value={model}
              scoped={scoped}
              searchLabel={
                scoped
                  ? t('models.searchScopedLabel', { label: scopeLabel })
                  : t('models.searchLabel')
              }
              onSelect={(reference) => {
                onModelChange(reference);
                setOpen(false);
              }}
              onOpenProviders={
                onOpenProviders &&
                (() => {
                  setOpen(false);
                  onOpenProviders();
                })
              }
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

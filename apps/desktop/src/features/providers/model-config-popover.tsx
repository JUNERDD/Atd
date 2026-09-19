import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@ai/ui/components/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@ai/ui/components/command';
import type {
  Connection,
  ModelReference,
  ModelThinkingLevel,
} from '../../../electron/providers/schema';
import { IconButton } from '../../components/icon-button';
import { sortModels } from './model-order';
import { ProviderBrand } from './provider-brand';
import { useThinkingLevels } from './use-thinking-levels';

/**
 * T2 context readout: the selected definition's fixed window, never a choice. Unknown or
 * non-positive counts show an em dash; thousands use lowercase k and millions uppercase M.
 */
function formatContextWindow(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count) || count <= 0) return '—';
  if (count < 1000) return String(count);
  const trim1 = (value: number): string => value.toFixed(1).replace(/\.0$/, '');
  if (count < 10_000) return `${trim1(count / 1000)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${trim1(count / 1_000_000)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

type ModelConfigView = 'root' | 'effort' | 'model';

/**
 * One trigger (`model + context + effort`) with inline drill-in. The root view shows Context
 * readonly plus Effort/Model navigation; subviews render in the same Popover with a back header.
 * Model search, catalog warnings, and empty states mirror ModelPicker; effort options come from
 * useThinkingLevels with the same disabled and levels[0] fallback semantics.
 */
export function ModelConfigPopover({
  connections,
  model,
  thinkingLevel,
  onModelChange,
  onThinkingLevelChange,
  onOpenProviders,
  compact = false,
  disabled = false,
}: {
  connections: Connection[];
  model: ModelReference | null;
  thinkingLevel: ModelThinkingLevel;
  onModelChange: (value: ModelReference) => void;
  onThinkingLevelChange: (level: ModelThinkingLevel) => void;
  onOpenProviders?: () => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation('providers');
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ModelConfigView>('root');
  const effortRowRef = useRef<HTMLButtonElement>(null);
  const modelRowRef = useRef<HTMLButtonElement>(null);
  const effortListRef = useRef<HTMLDivElement>(null);
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
  const contextText = formatContextWindow(definition?.contextWindow ?? null);
  const { levels, loading } = useThinkingLevels(model);
  const selected = levels.includes(thinkingLevel) ? thinkingLevel : (levels[0] ?? thinkingLevel);
  const effortText = t(`thinkingLevels.levels.${selected}`);
  const effortDisabled = !model || loading || levels.length < 2;
  const title =
    connection && model
      ? `${connection.name} · ${displayName} · ${contextText} · ${effortText}`
      : displayName;

  useEffect(() => {
    if (!open) {
      previousView.current = 'root';
      return;
    }
    if (view === 'root') {
      if (previousView.current === 'effort') effortRowRef.current?.focus();
      else if (previousView.current === 'model') modelRowRef.current?.focus();
    } else if (view === 'effort') {
      const current = effortListRef.current?.querySelector<HTMLElement>('[data-checked="true"]');
      const first = effortListRef.current?.querySelector<HTMLElement>('button');
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
        if (!next) setView('root');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? 'xs' : 'default'}
          className={compact ? 'composer-model' : 'provider-model-trigger'}
          disabled={disabled}
          aria-label={t('modelConfig.triggerLabel', {
            model: displayName,
            contextSize: contextText,
            effort: effortText,
          })}
          title={title}
        >
          {connection && <ProviderBrand provider={connection.provider} />}
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
            <div className="model-config-row">
              <span className="model-config-row-label">{t('modelConfig.context')}</span>
              <span className="model-config-row-value">{contextText}</span>
            </div>
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
        {view === 'effort' && (
          <div className="model-config-subview">
            <div className="model-config-back-header">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('modelConfig.back')}
                title={t('modelConfig.back')}
                onClick={() => setView('root')}
              >
                <ChevronLeft />
              </Button>
              <span className="model-config-back-title">{t('thinkingLevels.label')}</span>
            </div>
            <div ref={effortListRef} className="model-config-effort-list">
              {levels.map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={level === selected}
                  data-checked={level === selected}
                  className="model-config-effort-option"
                  onClick={() => {
                    onThinkingLevelChange(level);
                    setView('root');
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-left">
                    {t(`thinkingLevels.levels.${level}`)}
                  </span>
                  {level === selected && <Check className="shrink-0 size-4" />}
                </button>
              ))}
            </div>
          </div>
        )}
        {view === 'model' && (
          <div ref={modelViewRef} className="model-config-subview">
            <div className="model-config-back-header">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('modelConfig.back')}
                title={t('modelConfig.back')}
                onClick={() => setView('root')}
              >
                <ChevronLeft />
              </Button>
              <span className="model-config-back-title">{t('modelConfig.model')}</span>
            </div>
            <Command className="bg-transparent min-h-0">
              <CommandInput
                placeholder={t('models.searchPlaceholder')}
                aria-label={t('models.searchLabel')}
                action={
                  onOpenProviders && (
                    <IconButton
                      label={t('models.manageProviders')}
                      onClick={() => {
                        setOpen(false);
                        onOpenProviders();
                      }}
                    >
                      <Settings2 />
                    </IconButton>
                  )
                }
              />
              <CommandList className="min-h-0 flex-1 max-h-none">
                {connections
                  .filter((item) => item.catalogError)
                  .map((item) => (
                    <output key={item.connectionId} className="model-catalog-warning">
                      {`${item.name}: ${item.catalogError}`}
                    </output>
                  ))}
                <CommandEmpty>
                  {connections.some((item) => item.catalog.length)
                    ? t('models.noMatch')
                    : t('models.none')}
                </CommandEmpty>
                {connections.map((item) => (
                  <CommandGroup key={item.connectionId} heading={item.name} title={item.name}>
                    {sortModels(item.catalog).map((entry) => (
                      <CommandItem
                        key={entry.id}
                        value={`${item.connectionId} ${entry.id}`}
                        keywords={[item.name, entry.name]}
                        disabled={!item.connected}
                        data-checked={
                          model?.connectionId === item.connectionId && model.modelId === entry.id
                        }
                        onSelect={() => {
                          onModelChange({
                            connectionId: item.connectionId,
                            modelId: entry.id,
                          });
                          setOpen(false);
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate" title={entry.name}>
                            {entry.name}
                          </p>
                          {entry.name !== entry.id && (
                            <p className="text-xs text-muted-foreground truncate" title={entry.id}>
                              {entry.id}
                            </p>
                          )}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

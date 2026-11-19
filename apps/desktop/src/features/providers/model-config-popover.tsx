import { useRef } from 'react';
import {
  catalogModelDefaultThinkingLevel,
  supportedModelThinkingLevels,
} from '@atd/agent-contracts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { cn } from '@atd/ui/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@atd/ui/components/popover';
import type { Connection, ModelReference, ModelThinkingLevel } from '../../client/providers/schema';
import {
  resolvePopoverTriggerLabels,
  type ModelAliasPopoverProps,
} from '../agent/use-panel-aliases';
import { formatContextWindow } from './context-window';
import { ModelConfigAliases } from './model-config-aliases';
import { useModelConfigNavState } from './model-config-keys';
import { ModelConfigSubview } from './model-config-subviews';
import { ProviderBrand } from './provider-brand';
import { providerPresentation } from './provider-services';
import { applyDraftContext, useModelContexts } from './use-model-contexts';
import { resolveSelectedThinkingLevel, useThinkingLevels } from './use-thinking-levels';
import { ChatGPTPlan } from './chatgpt-plan';

function renderRowContent(label: string, value: string | null, nav = true, truncate = false) {
  return (
    <>
      <span className="model-config-row-label">{label}</span>
      <span className={cn('model-config-row-value', truncate && 'truncate')}>{value}</span>
      {nav && <ChevronRight className="size-4 shrink-0" />}
    </>
  );
}

/**
 * The effort the popover edits, or `hideEffort` where the level is set elsewhere (a command's own
 * level, which applies whichever model runs it): the popover then offers no effort at all.
 */
type EffortControl =
  | {
      hideEffort?: false;
      /** The level chosen for the run; none shows the model's own default. */
      thinkingLevel: ModelThinkingLevel | undefined;
      onThinkingLevelChange: (level: ModelThinkingLevel) => void;
    }
  | { hideEffort: true; thinkingLevel?: undefined; onThinkingLevelChange?: undefined };

type ModelConfigPopoverProps = EffortControl &
  ModelAliasPopoverProps & {
    connections: Connection[];
    model: ModelReference | null;
    onModelChange: (value: ModelReference) => void;
    onOpenProviders?: () => void;
    scopeLabel?: string;
    compact?: boolean;
    disabled?: boolean;
  };

/**
 * One trigger (`model + context + effort`) with inline drill-in. The root view shows Context,
 * Effort and Model rows; subviews render in the same Popover with a back header. The model view
 * is a ModelList; effort options come from useThinkingLevels, disabled until the model offers a
 * choice and clamping to the nearest supported level when the given level is unsupported.
 *
 * Context is a drill-in row once the model's catalog window is known, for every provider: its
 * tiers or its catalog window, and the other windows the service offers for it. Unlike model and effort, the window is the
 * connection's remembered choice for the model, so picking one saves it on the connection (every
 * consumer alike) instead of calling back. The trigger and root row show the window new runs use:
 * the custom one, else the selected tier's, else the catalog's.
 *
 * `scopeLabel` names the one connection a scoped popover configures (a provider overview row):
 * its list shows only that connection without a heading, and the trigger drops the brand the row
 * already shows and carries the label for assistive technology. `hideEffort` drops the effort
 * from the trigger and the root view.
 */
export function ModelConfigPopover(props: ModelConfigPopoverProps) {
  const { connections, model, scopeLabel, activeAliasId } = props;
  const compact = props.compact ?? false;
  const disabled = props.disabled ?? false;
  const effort = props.hideEffort ? null : props;
  const { t } = useTranslation('providers');
  const { t: tPanel } = useTranslation('panel');
  const contextRowRef = useRef<HTMLButtonElement>(null);
  const effortRowRef = useRef<HTMLButtonElement>(null);
  const modelRowRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionListRef = useRef<HTMLDivElement>(null);
  const modelViewRef = useRef<HTMLDivElement>(null);
  const nav = useModelConfigNavState(disabled);
  const { open, setOpen, view, switched, show } = nav;
  const dom = () => ({
    root: rootRef.current,
    optionList: optionListRef.current,
    modelView: modelViewRef.current,
  });

  const connection = connections.find((item) => item.connectionId === model?.connectionId);
  const definition = connection?.catalog.find((item) => item.id === model?.modelId);
  const name = definition?.name ?? (model?.modelId || t('models.choose'));
  const unavailable = Boolean(
    model?.modelId &&
    (!connection?.connected || !connection.catalog.some((item) => item.id === model.modelId)),
  );
  const displayName = unavailable ? t('models.unavailable', { name }) : name;
  const scoped = scopeLabel !== undefined;
  const activeAlias =
    !scoped && activeAliasId
      ? (props.aliases?.find((item) => item.id === activeAliasId) ?? null)
      : null;
  const isAliasModified = Boolean(activeAlias && props.aliasModified);
  const baseContexts = useModelContexts(model, connection);
  const contexts = props.onContextChoiceChange
    ? applyDraftContext(baseContexts, props.draftContextChoice)
    : baseContexts;
  const fallbackWindow =
    (model ? connection?.contextWindows?.[model.modelId] : undefined) ??
    definition?.contextWindow ??
    null;
  const contextText = formatContextWindow(contexts.window ?? fallbackWindow);
  const contextChoice = Boolean(model && connection) && contexts.catalogWindow !== null;
  const { levels, defaultLevel, loading } = useThinkingLevels(effort ? model : null, connection);
  // While loading, clamp and default from the catalog definition so frame 1 matches resolved effort.
  const effectiveLevels = levels.length
    ? levels
    : definition
      ? supportedModelThinkingLevels(definition)
      : [];
  const fallbackDefault = loading
    ? definition
      ? catalogModelDefaultThinkingLevel(definition)
      : undefined
    : defaultLevel;
  const thinkingLevel = effort ? (effort.thinkingLevel ?? fallbackDefault) : undefined;
  const selected = resolveSelectedThinkingLevel(thinkingLevel, effectiveLevels);
  const effortText = selected
    ? definition?.reasoningControl === 'fixed'
      ? t('modelConfig.modelDefault')
      : t(`thinkingLevels.levels.${selected}`)
    : null;
  const effortDisabled = !model || loading || levels.length < 2;
  const summary = { model: displayName, contextSize: contextText, effort: effortText ?? '' };
  const details = model
    ? [displayName, contextText, ...(effortText ? [effortText] : [])].join(' · ')
    : displayName;
  const title = connection && model && !scoped ? `${connection.name} · ${details}` : details;
  const triggerLabels = resolvePopoverTriggerLabels({
    activeAlias,
    aliasModified: isAliasModified,
    title,
    details,
    scopeLabel,
    summary,
    hasEffort: Boolean(effortText),
    tProviders: t,
    tPanel,
  });

  return (
    <Popover open={open} onOpenChange={nav.onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant={compact ? 'glass-ghost' : 'ghost'}
          size={compact ? 'xs' : 'default'}
          className={compact ? 'composer-model' : 'provider-model-trigger'}
          disabled={disabled}
          aria-label={triggerLabels.ariaLabel}
          title={triggerLabels.title}
          onClick={nav.onTriggerClick}
          onKeyDown={(event) => nav.onTriggerKeyDown(event, dom())}
        >
          {connection && !scoped && (
            <ProviderBrand
              provider={providerPresentation(connection)?.service.brand ?? connection.provider}
            />
          )}
          <span className="flex min-w-0 flex-1 items-center gap-0.5 text-left">
            <span className="min-w-0 truncate">{activeAlias ? activeAlias.name : displayName}</span>
            {isAliasModified && (
              <span className="composer-model-modified shrink-0" aria-hidden="true">
                *
              </span>
            )}
          </span>
          {model && <span className="model-config-context shrink-0">{contextText}</span>}
          {model && effortText && (
            <span className="model-config-effort shrink-0">{effortText}</span>
          )}
          <ChevronDown className="size-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      {/* One content per view: resizing a live glass surface let WebKit morph it from a snapshot
          of the previous view, overlapping both, and the popover took a frame to reposition. A
          fresh content stays hidden until it is placed; it skips the entry animation. */}
      <PopoverContent
        key={view}
        className={cn(
          'model-picker model-picker-scoped p-0',
          switched && 'data-open:animate-none!',
        )}
        align="end"
        collisionPadding={8}
        // Each view mounts its own content: pointer open leaves focus on the content while keyboard
        // open focuses the first/last root item, and transitions focus the target row or control.
        onOpenAutoFocus={(event) =>
          nav.onOpenAutoFocus(event, {
            ...dom(),
            rootRows: {
              context: contextRowRef.current,
              effort: effortRowRef.current,
              model: modelRowRef.current,
            },
          })
        }
        // Unmounting a view's content would hand focus back to the trigger a tick later, after the
        // next view focused its row; only a real close returns it there.
        onCloseAutoFocus={(event) => {
          if (open) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          const el = event.target instanceof Element ? event.target : null;
          if (view === 'root' && el?.closest('[data-alias-save-form]')) event.preventDefault();
        }}
        onPointerMove={nav.onPointerMove}
        onPointerLeave={nav.onPointerLeave}
        onKeyDown={(event) => nav.onContentKeyDown(event, dom())}
      >
        {view === 'root' && (
          <div ref={rootRef} className="model-config-root">
            {!scoped && props.aliases && props.aliases.length > 0 && props.onSelectAlias && (
              <ModelConfigAliases
                aliases={props.aliases}
                connections={connections}
                activeAlias={activeAlias}
                aliasModified={isAliasModified}
                cycleShortcut={props.cycleShortcut}
                onSelectAlias={props.onSelectAlias}
                onRestoreAlias={props.onRestoreAlias}
                onSaveAsAlias={props.onSaveAsAlias}
                onClosePopover={() => setOpen(false)}
              />
            )}
            <ChatGPTPlan connection={connection} variant="menu" />
            {contextChoice ? (
              <button
                ref={contextRowRef}
                type="button"
                data-root-item
                data-drill="context"
                className="model-config-row model-config-row-nav"
                onClick={() => show('context')}
              >
                {renderRowContent(t('modelConfig.context'), contextText)}
              </button>
            ) : (
              <div className="model-config-row">
                {renderRowContent(t('modelConfig.context'), contextText, false)}
              </div>
            )}
            {effort && (
              <button
                ref={effortRowRef}
                type="button"
                data-root-item
                data-drill="effort"
                className="model-config-row model-config-row-nav"
                disabled={effortDisabled}
                title={
                  !thinkingLevel || selected === thinkingLevel
                    ? t('thinkingLevels.label')
                    : t('thinkingLevels.unavailable', {
                        level: t(`thinkingLevels.levels.${thinkingLevel}`),
                      })
                }
                onClick={() => show('effort')}
              >
                {renderRowContent(t('thinkingLevels.label'), effortText)}
              </button>
            )}
            <button
              ref={modelRowRef}
              type="button"
              data-root-item
              data-drill="model"
              className="model-config-row model-config-row-nav"
              onClick={() => show('model')}
            >
              {renderRowContent(t('modelConfig.model'), displayName, true, true)}
            </button>
          </div>
        )}
        {view !== 'root' && (
          <ModelConfigSubview
            view={view}
            model={model}
            connection={connection}
            connections={connections}
            baseContexts={baseContexts}
            draftContextChoice={props.draftContextChoice}
            hideDraftContextNote={props.hideDraftContextNote}
            onContextChoiceChange={props.onContextChoiceChange}
            levels={levels}
            selectedEffort={selected}
            onThinkingLevelChange={effort?.onThinkingLevelChange}
            scoped={scoped}
            scopeLabel={scopeLabel}
            optionListRef={optionListRef}
            modelViewRef={modelViewRef}
            onBack={() => show('root')}
            onSelectModel={props.onModelChange}
            onOpenProviders={props.onOpenProviders}
            onClose={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

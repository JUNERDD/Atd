import { useState } from 'react';
import type { ModelAlias, RunContextChoice } from '@atd/agent-contracts';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { Connection, ModelReference, ModelThinkingLevel } from '../../client/providers/schema';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { formatContextWindow } from '../providers/context-window';
import { contextDiverges, useModelContexts } from '../providers/use-model-contexts';
import { useThinkingLevels } from '../providers/use-thinking-levels';
import type { useRunChoices } from './use-run-choices';
import { choiceFromAlias } from './use-run-choices';

/** Props shared from the task panel down to `Composer`, `ComposerConfiguration`, and `QuickPanel`. */
export interface PanelAliasState {
  aliases: ModelAlias[];
  activeAlias: ModelAlias | null;
  aliasModified: boolean;
  cycleShortcut: string;
  onSelectAlias: (alias: ModelAlias) => void;
  onRestoreAlias: () => void;
  onSaveAsAlias: (name: string) => Promise<void>;
}

/** Optional alias and draft-context props accepted by `ModelConfigPopover`. */
export interface ModelAliasPopoverProps {
  aliases?: ModelAlias[] | undefined;
  activeAliasId?: string | null | undefined;
  aliasModified?: boolean | undefined;
  cycleShortcut?: string | undefined;
  onSelectAlias?: ((alias: ModelAlias) => void) | undefined;
  onRestoreAlias?: (() => void) | undefined;
  onSaveAsAlias?: ((name: string) => Promise<void>) | undefined;
  draftContextChoice?: RunContextChoice | undefined;
  onContextChoiceChange?: ((choice: RunContextChoice | undefined) => void) | undefined;
}

/** Human-readable 4-tuple summary (`Model · Context · Effort`) for one alias item. */
export function formatAliasTupleSummary(
  alias: ModelAlias,
  connections: readonly Connection[],
  tProviders: TFunction<'providers'>,
): string {
  const connection = connections.find((item) => item.connectionId === alias.connectionId);
  const definition = connection?.catalog.find((item) => item.id === alias.modelId);
  const modelLabel = definition?.name ?? alias.modelId;
  const contextLabel = alias.contextChoice
    ? 'contextWindow' in alias.contextChoice
      ? formatContextWindow(alias.contextChoice.contextWindow)
      : tProviders(`modelConfig.tiers.${alias.contextChoice.tier}`)
    : definition?.contextWindow
      ? formatContextWindow(definition.contextWindow)
      : null;
  const level = alias.thinkingLevel ?? connection?.defaultThinkingLevel;
  const effortLabel =
    level && definition?.reasoningControl !== 'fixed'
      ? tProviders(`thinkingLevels.levels.${level}`)
      : null;
  return [
    modelLabel,
    ...(contextLabel ? [contextLabel] : []),
    ...(effortLabel ? [effortLabel] : []),
  ].join(' · ');
}

/** Whether an alias's connection is currently online and still exposes the alias's model. */
export function isAliasAvailable(alias: ModelAlias, connections: readonly Connection[]): boolean {
  const connection = connections.find((item) => item.connectionId === alias.connectionId);
  return Boolean(
    connection?.connected && connection.catalog.some((item) => item.id === alias.modelId),
  );
}

/** Resolves trigger `aria-label` and `title` cleanly whether an alias is active or not. */
export function resolvePopoverTriggerLabels({
  activeAlias,
  aliasModified,
  title,
  details,
  scopeLabel,
  summary,
  hasEffort,
  tProviders,
  tPanel,
}: {
  activeAlias: ModelAlias | null;
  aliasModified: boolean;
  title: string;
  details: string;
  scopeLabel: string | undefined;
  summary: { model: string; contextSize: string; effort: string };
  hasEffort: boolean;
  tProviders: TFunction<'providers'>;
  tPanel: TFunction<'panel'>;
}): { title: string; ariaLabel: string } {
  if (activeAlias) {
    const aliasLabel = aliasModified
      ? tPanel('aliases.triggerModified', { name: activeAlias.name })
      : activeAlias.name;
    return {
      title: `${aliasLabel} · ${title}`,
      ariaLabel: tPanel('aliases.triggerAriaLabel', { alias: aliasLabel, details }),
    };
  }
  const ariaLabel =
    scopeLabel !== undefined
      ? tProviders('modelConfig.scopedTriggerLabel', { label: scopeLabel, ...summary })
      : hasEffort
        ? tProviders('modelConfig.triggerLabel', summary)
        : tProviders('modelConfig.modelOnlyTriggerLabel', summary);
  return { title, ariaLabel };
}

type RunChoicesHandle = ReturnType<typeof useRunChoices>;

function effortDiverges(
  draftLevel: ModelThinkingLevel | undefined,
  aliasLevel: ModelThinkingLevel | undefined,
  defaultLevel: ModelThinkingLevel | undefined,
): boolean {
  if (draftLevel === aliasLevel) return false;
  if (defaultLevel === undefined) return true;
  return (draftLevel ?? defaultLevel) !== (aliasLevel ?? defaultLevel);
}

/**
 * Resolves the composer's active model alias, non-destructive draft override state, save/restore
 * flows, and `⌘⇧M` cycling across connected aliases.
 */
export function usePanelAliases(
  snapshot: SettingsSnapshot | null,
  nextRun: RunChoicesHandle,
  policyKey: string,
  enabled: boolean,
): { aliasState: PanelAliasState; cycleAlias: () => void } {
  const { t } = useTranslation('panel');
  const [createdPending, setCreatedPending] = useState<{
    alias: ModelAlias;
    atAliases: readonly ModelAlias[];
  } | null>(null);
  const aliases = snapshot?.aliases ?? [];
  const connections = snapshot?.connections ?? [];
  const cycleShortcut = snapshot?.shortcuts.cycleModelAlias ?? '';
  const { activeChoice, choices, model, policy, setChoice } = nextRun;

  // Keep newly created alias active immediately until settings snapshot catches up.
  const hasPending = Boolean(
    createdPending &&
    aliases === createdPending.atAliases &&
    !aliases.some((item) => item.id === createdPending.alias.id),
  );
  const effectiveAliases =
    createdPending && hasPending ? [...aliases, createdPending.alias] : aliases;
  const resolvedId =
    activeChoice?.aliasId ??
    (createdPending && hasPending && choices[policyKey]?.aliasId === createdPending.alias.id
      ? createdPending.alias.id
      : undefined);
  const activeAlias = resolvedId
    ? (effectiveAliases.find((item) => item.id === resolvedId) ?? null)
    : null;

  const modelDiverges = Boolean(
    activeAlias &&
    (!model ||
      model.connectionId !== activeAlias.connectionId ||
      model.modelId !== activeAlias.modelId),
  );
  const sameModelTarget = activeAlias && !modelDiverges ? activeAlias : null;
  const targetRef: ModelReference | null = sameModelTarget
    ? { connectionId: sameModelTarget.connectionId, modelId: sameModelTarget.modelId }
    : null;
  const targetConnection = sameModelTarget
    ? connections.find((item) => item.connectionId === sameModelTarget.connectionId)
    : undefined;
  const baseContexts = useModelContexts(targetRef, targetConnection);
  const { defaultLevel } = useThinkingLevels(targetRef, targetConnection);

  const aliasModified = Boolean(
    activeAlias &&
    (modelDiverges ||
      contextDiverges(policy.contextChoice, activeAlias.contextChoice, baseContexts) ||
      effortDiverges(policy.thinkingLevel, activeAlias.thinkingLevel, defaultLevel)),
  );

  function onSelectAlias(alias: ModelAlias) {
    setCreatedPending(null);
    setChoice(choiceFromAlias(alias));
  }

  function onRestoreAlias() {
    if (!activeAlias) return;
    setChoice(choiceFromAlias(activeAlias));
  }

  async function onSaveAsAlias(rawName: string): Promise<void> {
    const name = rawName.trim();
    if (!name) throw new Error(t('aliases.emptyName'));
    const bridge = window.desktop?.settings.providers;
    if (!bridge) throw new Error(t('errors.openDesktopApp'));
    if (!model) throw new Error(t('aliases.missingModel'));
    const created = await bridge.createAlias({
      name,
      connectionId: model.connectionId,
      modelId: model.modelId,
      ...(policy.contextChoice ? { contextChoice: policy.contextChoice } : {}),
      ...(policy.thinkingLevel ? { thinkingLevel: policy.thinkingLevel } : {}),
    });
    setCreatedPending({ alias: created, atAliases: aliases });
    setChoice(choiceFromAlias(created));
  }

  function cycleAlias() {
    if (!enabled) return;
    const online = effectiveAliases.filter((alias) => isAliasAvailable(alias, connections));
    if (online.length === 0) return;
    const currentIndex = activeAlias ? online.findIndex((item) => item.id === activeAlias.id) : -1;
    const next = online[currentIndex === -1 ? 0 : (currentIndex + 1) % online.length];
    if (!next) return;
    if (next.id === activeAlias?.id && !aliasModified) return;
    onSelectAlias(next);
  }

  return {
    aliasState: {
      aliases: effectiveAliases,
      activeAlias,
      aliasModified,
      cycleShortcut,
      onSelectAlias,
      onRestoreAlias,
      onSaveAsAlias,
    },
    cycleAlias,
  };
}

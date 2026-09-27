import { BookOpen, Gauge } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { rankByQuery } from '@ai/ui/lib/fuzzy-match';
import type { RunPolicy } from '../../../electron/agent/run-policy';
import type { Connection, ModelReference } from '../../../electron/providers/schema';
import type { ComposerEditorCommands } from '../composer-editor/editor-commands';
import { rankModels } from '../providers/model-match';
import { sortModels } from '../providers/model-order';
import { ProviderBrand } from '../providers/provider-brand';
import { useCatalogRefresh } from '../providers/use-catalog-refresh';
import { useModelContexts } from '../providers/use-model-contexts';
import { useThinkingLevels } from '../providers/use-thinking-levels';
import type { CompactBlock } from '../agent/compaction/compact-availability';
import type { ExtensionSkillRow } from '../service/extension-rows';
import {
  QUICK_COMMANDS,
  isDrillCommand,
  type QuickCommand,
  type QuickCommandActions,
  type QuickCommandContext,
} from './quick-commands';
import { orderGroups, type QuickGroup, type QuickOption, type QuickView } from './quick-options';
import { compactDrill, contextDrill } from './slash-drills';
import type { TriggerState } from './trigger';
import type { ServiceListView } from './use-service-lists';

export type SlashTrigger = Extract<TriggerState, { kind: 'slash' }>;

/** Enabled skills matching `query`, best first; a pick inserts one skill chip. */
function skillGroup(
  skills: ServiceListView<ExtensionSkillRow>,
  query: string,
  editor: ComposerEditorCommands,
  t: TFunction<'panel'>,
): QuickGroup {
  const enabled = skills.status === 'ready' ? skills.rows.filter((row) => row.enabled) : [];
  return {
    id: 'skills',
    heading: t('quickPanel.groups.skills'),
    options: rankByQuery(enabled, query, (row) => ({
      title: row.name,
      description: row.description,
    })).map(({ item: row, match }): QuickOption => ({
      value: `skill:${row.name}`,
      score: match?.score,
      ranges: match?.ranges,
      icon: <BookOpen />,
      title: row.name,
      description: row.description || undefined,
      select: () => editor.insertChips([{ kind: 'skill', name: row.name }]),
    })),
  };
}

/**
 * Skills only: what an inline `/` lists in the composer and every `/` lists in command
 * instructions. A list still loading may yet match, so it is not reported as no match.
 */
export function skillsView(
  skills: ServiceListView<ExtensionSkillRow>,
  query: string,
  editor: ComposerEditorCommands,
  t: TFunction<'panel'>,
): QuickView {
  return {
    groups: [skillGroup(skills, query, editor, t)],
    empty:
      skills.status === 'loading'
        ? t('quickPanel.states.loading')
        : t('quickPanel.states.noSkillMatches'),
  };
}

/**
 * The `/` panel. A leading `/` lists quick commands and enabled skills, or the `/model`,
 * `/effort` and `/context` drill lists and the `/compact <focus>` row; an inline `/` lists skills
 * only, since commands act on the whole draft. Model and effort changes stay on this draft
 * (`useDefaultModel: false` for a model pick) and never touch the app defaults; a context tier is
 * the connection's remembered choice for the model. Every drill pick clears the trigger text.
 */
export function useSlashView({
  trigger,
  running,
  pending,
  editor,
  actions,
  policy,
  onPolicyChange,
  connections,
  model,
  skills,
  compact,
}: {
  trigger: SlashTrigger | null;
  running: boolean;
  pending: boolean;
  editor: ComposerEditorCommands;
  actions: QuickCommandActions;
  policy: RunPolicy;
  onPolicyChange: (policy: RunPolicy) => void;
  connections: Connection[];
  model: ModelReference | null;
  skills: ServiceListView<ExtensionSkillRow>;
  /** Why the open task cannot be compacted now; null when it can. */
  compact: CompactBlock | null;
}): QuickView {
  const { t } = useTranslation('panel');
  const { t: tp } = useTranslation('providers');
  const shown = policy.model ?? model;
  // Levels load once a leading `/` opens; they gate `/effort` and fill its drill list.
  const leading = trigger?.placement === 'leading' ? shown : null;
  const effort = useThinkingLevels(leading);
  const shownConnection = connections.find((item) => item.connectionId === shown?.connectionId);
  // Tiers load with the levels; they gate `/context` and fill its drill list.
  const contexts = useModelContexts(leading, shownConnection?.revision ?? null);
  useCatalogRefresh(trigger?.drill?.command === 'model');
  if (!trigger) return { groups: [], empty: null };
  if (trigger.drill?.command === 'compact')
    return compactDrill({ query: trigger.drill.query, block: compact, actions, editor, t });
  const drill = trigger.drill && isDrillCommand(trigger.drill.command) ? trigger.drill : null;

  if (drill?.command === 'context')
    return contextDrill({
      query: drill.query,
      shown,
      connection: shownConnection,
      contexts,
      editor,
      t,
      tp,
    });

  if (drill?.command === 'model') {
    const groups = connections.map((connection): QuickGroup => {
      const ranked = rankModels(sortModels(connection.catalog), drill.query, connection.name);
      return {
        id: `model:${connection.connectionId}`,
        heading: connection.name,
        // Every model matches the connection name alike, so the heading shows that match once.
        headingRanges: ranked[0]?.match?.ranges.connection,
        notice: connection.catalogError || undefined,
        options: ranked.map(({ item: entry, match }): QuickOption => ({
          value: `model:${JSON.stringify([connection.connectionId, entry.id])}`,
          score: match?.score,
          ranges: match ? { title: match.ranges.name, description: match.ranges.id } : undefined,
          icon: <ProviderBrand provider={connection.provider} />,
          title: entry.name,
          description: entry.name === entry.id ? undefined : entry.id,
          status: connection.connected ? undefined : t('quickPanel.states.providerOffline'),
          disabled: !connection.connected,
          checked: shown?.connectionId === connection.connectionId && shown.modelId === entry.id,
          select: () => {
            const next = { connectionId: connection.connectionId, modelId: entry.id };
            onPolicyChange({ ...policy, useDefaultModel: false, model: next });
            editor.clearTrigger();
          },
        })),
      };
    });
    const anyModel = connections.some((connection) => connection.catalog.length > 0);
    return {
      groups: orderGroups(groups, drill.query),
      empty: anyModel ? tp('models.noMatch') : tp('models.none'),
    };
  }

  if (drill?.command === 'effort') {
    const current = policy.thinkingLevel ?? shownConnection?.defaultThinkingLevel ?? 'off';
    // Same substitution as the model popover: an unsupported level shows the first offered one.
    const selected = effort.levels.includes(current) ? current : (effort.levels[0] ?? current);
    // Why no level can be chosen replaces the list as the panel's empty line.
    const reason = !shown
      ? t('quickPanel.blocked.noModel')
      : effort.loading
        ? t('quickPanel.states.loading')
        : effort.levels.length < 2
          ? t('quickPanel.blocked.noEffort')
          : null;
    const levels = reason ? [] : effort.levels;
    // The level id (`high`) also matches, unmarked, whatever the interface language.
    const options = rankByQuery(levels, drill.query, (level) => ({
      title: tp(`thinkingLevels.levels.${level}`),
      level,
    })).map(({ item: level, match }): QuickOption => ({
      value: `effort:${level}`,
      score: match?.score,
      ranges: match?.ranges,
      icon: <Gauge />,
      title: tp(`thinkingLevels.levels.${level}`),
      checked: level === selected,
      select: () => {
        onPolicyChange({ ...policy, thinkingLevel: level });
        editor.clearTrigger();
      },
    }));
    const group = { id: 'effort', heading: tp('thinkingLevels.label'), options };
    return { groups: [group], empty: reason ?? t('quickPanel.states.noMatches') };
  }

  if (trigger.placement === 'inline') return skillsView(skills, trigger.query, editor, t);
  const skillOptions = skillGroup(skills, trigger.query, editor, t);
  // A list still loading may yet match, so it is not reported as no match.
  const loading = skills.status === 'loading';

  const context: QuickCommandContext = {
    hasModel: shown !== null,
    effortLevels: effort.loading ? null : effort.levels.length,
    contextTiers: contexts.loading ? null : contexts.options.length,
    hasPending: pending,
    compact,
  };
  const run = (command: QuickCommand) => {
    if (command.kind === 'drill') {
      editor.replaceTrigger(`/${command.id} `);
      return;
    }
    // Clear first: a view switch unmounts the composer, and the draft must not keep `/new`.
    editor.clearTrigger();
    command.run(actions);
  };
  const rows = QUICK_COMMANDS.map((command) => {
    const blocked = command.blockedBy?.(context) ?? null;
    const title = t(`quickPanel.commands.${command.id}.title`);
    const description = blocked
      ? t(`quickPanel.blocked.${blocked}`)
      : t(`quickPanel.commands.${command.id}.description`);
    return { command, blocked, title, description };
  });
  // The id (the row's `/model` status) and the English keywords match too, unmarked.
  const commands = rankByQuery(rows, trigger.query, (row) => ({
    title: row.title,
    description: row.description,
    id: row.command.id,
    keywords: row.command.keywords.join(' '),
  })).map(({ item: { command, blocked, title, description }, match }): QuickOption => {
    const Icon = command.icon;
    return {
      value: `command:${command.id}`,
      icon: <Icon />,
      title,
      description,
      ranges: match?.ranges,
      status: `/${command.id}`,
      disabled: blocked !== null,
      score: match?.score,
      select: () => run(command),
    };
  });
  const commandGroup = {
    id: 'commands',
    heading: t('quickPanel.groups.commands'),
    options: commands,
  };
  // A run in progress lists quick commands only: chips wait until the run finishes.
  if (running) return { groups: [commandGroup], empty: t('quickPanel.states.runningNoMatches') };
  return {
    groups: orderGroups([commandGroup, skillOptions], trigger.query),
    empty: loading ? t('quickPanel.states.loading') : t('quickPanel.states.noCommandMatches'),
  };
}

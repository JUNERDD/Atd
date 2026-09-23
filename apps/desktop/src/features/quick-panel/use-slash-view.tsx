import { BookOpen, Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { rankByQuery } from '@ai/ui/lib/fuzzy-match';
import type { RunPolicy } from '../../../electron/agent/run-policy';
import type { Connection, ModelReference } from '../../../electron/providers/schema';
import type { ComposerEditorCommands } from '../composer-editor/editor-commands';
import { rankModels } from '../providers/model-match';
import { sortModels } from '../providers/model-order';
import { ProviderBrand } from '../providers/provider-brand';
import { useThinkingLevels } from '../providers/use-thinking-levels';
import type { ExtensionSkillRow } from '../service/use-service';
import {
  QUICK_COMMANDS,
  isDrillCommand,
  type QuickCommand,
  type QuickCommandActions,
  type QuickCommandContext,
} from './quick-commands';
import { orderGroups, type QuickGroup, type QuickOption, type QuickView } from './quick-options';
import type { TriggerState } from './trigger';
import type { ServiceListView } from './use-service-lists';

export type SlashTrigger = Extract<TriggerState, { kind: 'slash' }>;

/**
 * The `/` panel. A leading `/` lists quick commands and enabled skills, or the `/model` and
 * `/effort` drill lists; an inline `/` lists skills only, since commands act on the whole draft.
 * Policy changes stay on this draft (`useDefaultModel: false` for a model pick) and never touch
 * the app defaults; every drill pick clears the trigger text afterwards.
 */
export function useSlashView({
  trigger,
  running,
  editor,
  actions,
  policy,
  onPolicyChange,
  connections,
  model,
  skills,
}: {
  trigger: SlashTrigger | null;
  running: boolean;
  editor: ComposerEditorCommands;
  actions: QuickCommandActions;
  policy: RunPolicy;
  onPolicyChange: (policy: RunPolicy) => void;
  connections: Connection[];
  model: ModelReference | null;
  skills: ServiceListView<ExtensionSkillRow>;
}): QuickView {
  const { t } = useTranslation('panel');
  const { t: tp } = useTranslation('providers');
  const shown = policy.model ?? model;
  // Levels load once a leading `/` opens; they gate `/effort` and fill its drill list.
  const effort = useThinkingLevels(trigger?.placement === 'leading' ? shown : null);
  if (!trigger) return { groups: [], empty: null };
  const drill = trigger.drill && isDrillCommand(trigger.drill.command) ? trigger.drill : null;

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
    const connection = connections.find((item) => item.connectionId === shown?.connectionId);
    const current = policy.thinkingLevel ?? connection?.defaultThinkingLevel ?? 'off';
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

  const enabled = skills.status === 'ready' ? skills.rows.filter((row) => row.enabled) : [];
  const skillGroup: QuickGroup = {
    id: 'skills',
    heading: t('quickPanel.groups.skills'),
    options: rankByQuery(enabled, trigger.query, (row) => ({
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
  // A list still loading may yet match, so it is not reported as no match.
  const loading = skills.status === 'loading';
  if (trigger.placement === 'inline')
    return {
      groups: [skillGroup],
      empty: loading ? t('quickPanel.states.loading') : t('quickPanel.states.noSkillMatches'),
    };

  const context: QuickCommandContext = {
    hasModel: shown !== null,
    effortLevels: effort.loading ? null : effort.levels.length,
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
    groups: orderGroups([commandGroup, skillGroup], trigger.query),
    empty: loading ? t('quickPanel.states.loading') : t('quickPanel.states.noCommandMatches'),
  };
}

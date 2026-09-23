import { BookOpen, Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RunPolicy } from '../../../electron/agent/run-policy';
import type { Connection, ModelReference } from '../../../electron/providers/schema';
import type { ComposerEditorCommands } from '../composer-editor/editor-commands';
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
import {
  orderGroups,
  rankByQuery,
  type QuickGroup,
  type QuickOption,
  type QuickView,
} from './quick-options';
import type { TriggerState } from './trigger';
import { serviceNotice, type ServiceListView } from './use-service-lists';

export type SlashTrigger = Extract<TriggerState, { kind: 'slash' }>;

/**
 * The `/` panel: quick commands and enabled skills at the root, or the `/model` and `/effort`
 * drill lists. Policy changes stay on this draft (`useDefaultModel: false` for a model pick) and
 * never touch the app defaults; every drill pick clears the trigger text afterwards.
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
  // Levels load once the `/` panel opens; they gate `/effort` and fill its drill list.
  const effort = useThinkingLevels(trigger ? shown : null);
  if (!trigger) return { groups: [], empty: '' };
  const drill = trigger.drill && isDrillCommand(trigger.drill.command) ? trigger.drill : null;

  if (drill?.command === 'model') {
    const groups = connections.map((connection): QuickGroup => ({
      id: `model:${connection.connectionId}`,
      heading: connection.name,
      notice: connection.catalogError || undefined,
      options: rankByQuery(
        sortModels(connection.catalog),
        drill.query,
        (entry) => `${entry.name} ${entry.id} ${connection.name}`,
      ).map(({ item: entry, score }) => ({
        value: `model:${JSON.stringify([connection.connectionId, entry.id])}`,
        score,
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
    }));
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
    const notice = !shown
      ? t('quickPanel.blocked.noModel')
      : effort.loading
        ? t('quickPanel.states.loading')
        : effort.levels.length < 2
          ? t('quickPanel.blocked.noEffort')
          : undefined;
    const levels = notice ? [] : effort.levels;
    const options = rankByQuery(
      levels,
      drill.query,
      (level) => `${level} ${tp(`thinkingLevels.levels.${level}`)}`,
    ).map(({ item: level, score }): QuickOption => ({
      value: `effort:${level}`,
      score,
      icon: <Gauge />,
      title: tp(`thinkingLevels.levels.${level}`),
      checked: level === selected,
      select: () => {
        onPolicyChange({ ...policy, thinkingLevel: level });
        editor.clearTrigger();
      },
    }));
    const group = { id: 'effort', heading: tp('thinkingLevels.label'), options, notice };
    return { groups: [group], empty: t('quickPanel.states.noMatches') };
  }

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
  const commands = rankByQuery(
    QUICK_COMMANDS,
    trigger.query,
    (command) =>
      `${command.id} ${t(`quickPanel.commands.${command.id}.title`)} ${command.keywords.join(' ')}`,
  ).map(({ item: command, score }): QuickOption => {
    const blocked = command.blockedBy?.(context) ?? null;
    const Icon = command.icon;
    return {
      value: `command:${command.id}`,
      icon: <Icon />,
      title: t(`quickPanel.commands.${command.id}.title`),
      description: blocked
        ? t(`quickPanel.blocked.${blocked}`)
        : t(`quickPanel.commands.${command.id}.description`),
      status: `/${command.id}`,
      disabled: blocked !== null,
      score,
      select: () => run(command),
    };
  });
  const commandGroup = {
    id: 'commands',
    heading: t('quickPanel.groups.commands'),
    options: commands,
  };
  // A run in progress lists quick commands only: a queued `/skill:` cannot be checked in advance.
  if (running) return { groups: [commandGroup], empty: t('quickPanel.states.runningNoMatches') };

  const enabled = skills.status === 'ready' ? skills.rows.filter((row) => row.enabled) : [];
  const skillGroup: QuickGroup = {
    id: 'skills',
    heading: t('quickPanel.groups.skills'),
    notice:
      serviceNotice(skills, t) ??
      (enabled.length === 0 && !trigger.query ? t('quickPanel.states.noSkills') : undefined),
    options: rankByQuery(enabled, trigger.query, (row) => `${row.name} ${row.description}`).map(
      ({ item: row, score }) => ({
        value: `skill:${row.name}`,
        score,
        icon: <BookOpen />,
        title: row.name,
        description: row.description || undefined,
        select: () => editor.insertChips([{ kind: 'skill', name: row.name }]),
      }),
    ),
  };
  return {
    groups: orderGroups([commandGroup, skillGroup], trigger.query),
    empty: t('quickPanel.states.noCommandMatches'),
  };
}

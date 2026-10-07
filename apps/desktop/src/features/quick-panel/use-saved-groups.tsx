import { Brain, Command } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MemoryUnit } from '@atd/agent-contracts';
import { rankByQuery } from '@atd/ui/lib/fuzzy-match';
import type { CommandDefinition } from '../../client/agent/command-schema';
import type { Chip } from '../composer-editor/draft';
import type { ComposerEditorCommands } from '../composer-editor/editor-commands';
import { MEMORY_TYPES } from '../memory/memory-labels';
import { useMemorySnapshot } from '../memory/use-memory-snapshot';
import type { QuickGroup, QuickOption } from './quick-options';
import type { ServiceListView } from './use-service-lists';

/** Characters of a memory's description its chip names it by. */
const MEMORY_CHIP_CHARS = 80;

/**
 * Saved memories as the `@` panel lists them, read once the memory group is first wanted. Without
 * the agent bridge (tests), or after a failed read or a snapshot error, the group is left out.
 */
export function useMemoryList(wanted: boolean): ServiceListView<MemoryUnit> {
  const { snapshot, failed } = useMemorySnapshot(wanted);
  if (!window.desktop?.agent || failed) return { status: 'unavailable' };
  if (!snapshot) return wanted ? { status: 'loading' } : { status: 'unavailable' };
  return snapshot.error ? { status: 'unavailable' } : { status: 'ready', rows: snapshot.units };
}

/** A memory's text on one line, cut to `max` characters with an ellipsis. */
function memoryLine(content: string, max: number): string {
  const line = content.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/**
 * The `@` panel's saved commands and memories. A pick inserts a chip that hands the run the
 * command's definition or the memory's current content; neither runs nor changes anything. Only
 * enabled commands and memories are offered, like subagents: a disabled one is turned off
 * everywhere, and a turned-off memory is out of runs. A memory reads as its description, with its
 * name below and its type trailing, like its row in the Memory section.
 */
export function useSavedGroups({
  query,
  editor,
  commands,
  memories,
  accepts,
}: {
  query: string;
  editor: ComposerEditorCommands;
  /** Snapshot commands, or none where the editor offers no command chips. */
  commands: readonly CommandDefinition[];
  memories: ServiceListView<MemoryUnit>;
  accepts: (chip: Chip) => boolean;
}): { groups: QuickGroup[]; loading: boolean } {
  const { t } = useTranslation('panel');
  const { t: tMemory } = useTranslation('memory');

  const offered = commands.filter(
    (command) =>
      command.enabled && accepts({ kind: 'command', commandId: command.id, name: command.name }),
  );
  const commandGroup: QuickGroup = {
    id: 'savedCommands',
    heading: t('quickPanel.groups.savedCommands'),
    icon: <Command />,
    options: rankByQuery(offered, query, (command) => ({
      title: command.name,
      description: command.description,
    })).map(({ item: command, match }): QuickOption => ({
      value: `command:${command.id}`,
      score: match?.score,
      ranges: match?.ranges,
      icon: <Command />,
      title: command.name,
      description: command.description || undefined,
      select: () =>
        editor.insertChips([{ kind: 'command', commandId: command.id, name: command.name }]),
    })),
  };

  const units =
    memories.status === 'ready'
      ? memories.rows.flatMap((unit) => {
          const title = memoryLine(unit.description, MEMORY_CHIP_CHARS);
          const chip: Chip = { kind: 'memory', target: unit.type, entryId: unit.id, title };
          return unit.enabled && title && accepts(chip) ? [{ unit, chip }] : [];
        })
      : [];
  const memoryGroup: QuickGroup = {
    id: 'memory',
    heading: t('quickPanel.groups.memory'),
    icon: <Brain />,
    options: rankByQuery(units, query, ({ unit }) => ({
      title: unit.description,
      description: unit.name,
    })).map(({ item: { unit, chip }, match }): QuickOption => ({
      value: `memory:${unit.type}:${unit.id}`,
      score: match?.score,
      ranges: match?.ranges,
      icon: <Brain />,
      title: unit.description,
      description: unit.name,
      status: tMemory(MEMORY_TYPES[unit.type].labelKey),
      select: () => editor.insertChips([chip]),
    })),
  };

  return { groups: [commandGroup, memoryGroup], loading: memories.status === 'loading' };
}

import { Brain, Command } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { rankByQuery } from '@ai/ui/lib/fuzzy-match';
import type { MemoryEntry } from '../../client/agent/bridge';
import type { CommandDefinition } from '../../client/agent/command-schema';
import type { Chip } from '../composer-editor/draft';
import type { ComposerEditorCommands } from '../composer-editor/editor-commands';
import { useMemorySnapshot } from '../memory/use-memory-snapshot';
import type { QuickGroup, QuickOption } from './quick-options';
import type { ServiceListView } from './use-service-lists';

/** Characters of a memory a row shows and matches; the row truncates it to its width. */
const MEMORY_ROW_CHARS = 240;
/** Characters of a memory its chip names it by. */
const MEMORY_CHIP_CHARS = 80;

/** The Memory settings' names for each target. */
const TARGET_LABELS = {
  memory: 'memory.list.preference',
  user: 'memory.list.userProfile',
  failure: 'memory.list.corrections',
} as const satisfies Record<MemoryEntry['target'], string>;

/**
 * Saved memories as the `@` panel lists them, read once the memory group is first wanted. Without
 * the agent bridge (tests), or after a failed read or a snapshot error, the group is left out.
 */
export function useMemoryList(wanted: boolean): ServiceListView<MemoryEntry> {
  const { snapshot, failed } = useMemorySnapshot(wanted);
  if (!window.desktop?.agent || failed) return { status: 'unavailable' };
  if (!snapshot) return wanted ? { status: 'loading' } : { status: 'unavailable' };
  return snapshot.error ? { status: 'unavailable' } : { status: 'ready', rows: snapshot.entries };
}

/** A memory's content on one line, cut to `max` characters with an ellipsis. */
function memoryLine(content: string, max: number): string {
  const line = content.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/**
 * The `@` panel's saved commands and memories. A pick inserts a chip that hands the run the
 * command's definition or the entry's content; neither runs nor changes anything. Only enabled
 * commands are offered, like subagents: a disabled one is turned off everywhere.
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
  memories: ServiceListView<MemoryEntry>;
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

  const entries =
    memories.status === 'ready'
      ? memories.rows.flatMap((entry) => {
          const title = memoryLine(entry.content, MEMORY_CHIP_CHARS);
          const chip: Chip = { kind: 'memory', target: entry.target, entryId: entry.id, title };
          return title && accepts(chip) ? [{ entry, chip }] : [];
        })
      : [];
  const memoryGroup: QuickGroup = {
    id: 'memory',
    heading: t('quickPanel.groups.memory'),
    options: rankByQuery(entries, query, ({ entry }) => ({
      title: memoryLine(entry.content, MEMORY_ROW_CHARS),
    })).map(({ item: { entry, chip }, match }): QuickOption => ({
      value: `memory:${entry.target}:${entry.id}`,
      score: match?.score,
      ranges: match?.ranges,
      icon: <Brain />,
      title: memoryLine(entry.content, MEMORY_ROW_CHARS),
      status: tMemory(TARGET_LABELS[entry.target]),
      select: () => editor.insertChips([chip]),
    })),
  };

  return { groups: [commandGroup, memoryGroup], loading: memories.status === 'loading' };
}

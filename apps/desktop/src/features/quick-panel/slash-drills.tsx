import { FoldVertical, Layers } from 'lucide-react';
import type { TFunction } from 'i18next';
import { rankByQuery } from '@atd/ui/lib/fuzzy-match';
import type { Connection, ModelReference } from '../../client/providers/schema';
import {
  MAX_COMPACT_INSTRUCTIONS,
  type CompactBlock,
} from '../agent/compaction/compact-availability';
import type { ComposerEditorCommands } from '../composer-editor/editor-commands';
import { formatContextWindow, formatTokenCount } from '../providers/context-window';
import {
  contextRows,
  contextRowTitle,
  saveModelContext,
  type ModelContextState,
} from '../providers/use-model-contexts';
import type { QuickCommandActions } from './quick-commands';
import type { QuickOption, QuickView } from './quick-options';

/**
 * `/context`: the model's context windows, like the model popover's Context subview: its tiers or
 * its catalog window as the model default, then the other windows the service offers for it. The
 * pick is saved on the connection for the model's later tasks, not on the draft.
 */
export function contextDrill({
  query,
  shown,
  connection,
  contexts,
  editor,
  t,
  tp,
}: {
  query: string;
  shown: ModelReference | null;
  connection: Connection | undefined;
  contexts: ModelContextState;
  editor: ComposerEditorCommands;
  t: TFunction<'panel'>;
  tp: TFunction<'providers'>;
}): QuickView {
  // Why no window can be chosen replaces the list as the panel's empty line. A reload after a
  // write keeps the previous answer listed, so only a first load reads as loading.
  const reason = !shown
    ? t('quickPanel.blocked.noModel')
    : contexts.catalogWindow === null && contexts.loading
      ? t('quickPanel.states.loading')
      : contexts.catalogWindow === null || !connection
        ? t('quickPanel.blocked.noContext')
        : null;
  const rows = reason ? [] : contextRows(contexts);
  // The row kind (`long`) and the window (`1M`) also match, unmarked, whatever the language.
  const options = rankByQuery(rows, query, (row) => ({
    title: contextRowTitle(row, tp),
    kind: row.kind,
    size: formatContextWindow(row.window),
  })).map(({ item: row, match }): QuickOption => ({
    value: `context:${row.key}`,
    score: match?.score,
    ranges: match?.ranges,
    icon: <Layers />,
    title: contextRowTitle(row, tp),
    // The window rides in the description: a `status` renders in the shortcut slot, which hides
    // the row's check mark, and the check is what shows the saved window here. A choice row is
    // titled by its window, so it repeats nothing there.
    description:
      [
        row.kind === 'choice' ? null : formatContextWindow(row.window),
        row.pricedAbove != null
          ? tp('modelConfig.pricedAbove', { tokens: formatTokenCount(row.pricedAbove) })
          : null,
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
    checked: row.checked,
    select: () => {
      if (shown && connection && row.choice)
        void saveModelContext(shown, row.choice, connection.revision);
      editor.clearTrigger();
    },
  }));
  const group = {
    id: 'context',
    heading: tp('modelConfig.context'),
    icon: <Layers />,
    options,
  };
  return { groups: [group], empty: reason ?? t('quickPanel.states.noMatches') };
}

/**
 * `/compact <focus>`: one row that compacts the open task now, the text after the command being
 * the summary's focus. A blocked task shows why instead of the row.
 */
export function compactDrill({
  query,
  block,
  actions,
  editor,
  t,
}: {
  query: string;
  block: CompactBlock | null;
  actions: QuickCommandActions;
  editor: ComposerEditorCommands;
  t: TFunction<'panel'>;
}): QuickView {
  const focus = query.trim();
  const tooLong = focus.length > MAX_COMPACT_INSTRUCTIONS;
  const option: QuickOption = {
    value: 'command:compact',
    icon: <FoldVertical />,
    title: t('quickPanel.commands.compact.title'),
    description: tooLong
      ? t('quickPanel.blocked.focusTooLong', { count: MAX_COMPACT_INSTRUCTIONS })
      : focus
        ? t('quickPanel.commands.compact.focus', { focus })
        : t('quickPanel.commands.compact.description'),
    status: '/compact',
    disabled: tooLong,
    select: () => {
      // Clear first, like every run command, so the draft never keeps `/compact …`.
      editor.clearTrigger();
      actions.compact(focus || undefined);
    },
  };
  const group = {
    id: 'compact',
    heading: t('quickPanel.groups.commands'),
    icon: <FoldVertical />,
    options: [option],
  };
  if (block) return { groups: [], empty: t(`quickPanel.blocked.${block}`) };
  return { groups: [group], empty: null };
}

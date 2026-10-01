import { FoldVertical, Layers } from 'lucide-react';
import type { TFunction } from 'i18next';
import { rankByQuery } from '@ai/ui/lib/fuzzy-match';
import type { Connection, ModelReference } from '../../client/providers/schema';
import {
  MAX_COMPACT_INSTRUCTIONS,
  type CompactBlock,
} from '../agent/compaction/compact-availability';
import type { ComposerEditorCommands } from '../composer-editor/editor-commands';
import { formatContextWindow, formatTokenCount } from '../providers/context-window';
import { saveModelContext, type ModelContextChoice } from '../providers/use-model-contexts';
import type { QuickCommandActions } from './quick-commands';
import type { QuickOption, QuickView } from './quick-options';

/**
 * `/context`: the model's two context windows, like the model popover's Context subview. The
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
  contexts: ModelContextChoice;
  editor: ComposerEditorCommands;
  t: TFunction<'panel'>;
  tp: TFunction<'providers'>;
}): QuickView {
  // Why no window can be chosen replaces the list as the panel's empty line.
  const reason = !shown
    ? t('quickPanel.blocked.noModel')
    : contexts.loading
      ? t('quickPanel.states.loading')
      : contexts.options.length < 2 || !connection
        ? t('quickPanel.blocked.noContext')
        : null;
  const tiers = reason ? [] : contexts.options;
  // The tier id (`long`) and the window (`1M`) also match, unmarked, whatever the language.
  const options = rankByQuery(tiers, query, (option) => ({
    title: tp(`modelConfig.tiers.${option.tier}`),
    tier: option.tier,
    size: formatContextWindow(option.contextWindow),
  })).map(({ item: option, match }): QuickOption => ({
    value: `context:${option.tier}`,
    score: match?.score,
    ranges: match?.ranges,
    icon: <Layers />,
    title: tp(`modelConfig.tiers.${option.tier}`),
    // The window rides in the description: a `status` renders in the shortcut slot, which hides
    // the row's check mark, and the check is what shows the saved tier here.
    description: [
      formatContextWindow(option.contextWindow),
      option.tier === 'long' && option.pricedAbove != null
        ? tp('modelConfig.pricedAbove', { tokens: formatTokenCount(option.pricedAbove) })
        : null,
    ]
      .filter(Boolean)
      .join(' · '),
    checked: option.tier === contexts.selected,
    select: () => {
      if (shown && connection && option.tier !== contexts.selected)
        void saveModelContext(shown, option.tier, connection.revision);
      editor.clearTrigger();
    },
  }));
  const group = { id: 'context', heading: tp('modelConfig.context'), options };
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
  const group = { id: 'compact', heading: t('quickPanel.groups.commands'), options: [option] };
  if (block) return { groups: [], empty: t(`quickPanel.blocked.${block}`) };
  return { groups: [group], empty: null };
}

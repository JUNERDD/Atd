import type { ModelAlias, RunContextChoice } from '@atd/agent-contracts';
import { ArrowsToAxisDashedHorizontal, Cpu, Layers, Sparkles } from 'lucide-react';
import type { TFunction } from 'i18next';
import { rankByQuery } from '@atd/ui/lib/fuzzy-match';
import type { Connection, ModelReference } from '../../client/providers/schema';
import {
  MAX_COMPACT_INSTRUCTIONS,
  type CompactBlock,
} from '../agent/compaction/compact-availability';
import type { ComposerEditorCommands } from '../composer-editor/editor-commands';
import { formatAliasTupleSummary, isAliasAvailable } from '../agent/use-panel-aliases';
import { formatContextWindow, formatTokenCount } from '../providers/context-window';
import { ProviderBrand } from '../providers/provider-brand';
import { providerPresentation } from '../providers/provider-services';
import {
  contextDraftRows,
  contextRows,
  contextRowTitle,
  saveModelContext,
  type ContextRow,
  type ModelContextState,
} from '../providers/use-model-contexts';
import type { QuickCommandActions } from './quick-commands';
import type { QuickGroup, QuickOption, QuickView } from './quick-options';

/**
 * `/context`: the model's context windows, like the model popover's Context subview: its tiers or
 * its catalog window as the model default, then the other windows the service offers for it. When
 * `onSelectContextChoice` is passed, picks update the draft run policy only; otherwise they save
 * on the connection.
 */
export function contextDrill({
  query,
  shown,
  connection,
  contexts,
  draftChoice,
  onSelectContextChoice,
  editor,
  t,
  tp,
}: {
  query: string;
  shown: ModelReference | null;
  connection: Connection | undefined;
  contexts: ModelContextState;
  draftChoice?: RunContextChoice | undefined;
  onSelectContextChoice?: ((choice: RunContextChoice | undefined) => void) | undefined;
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
  const rows: Array<ContextRow & { pick: () => void }> = reason
    ? []
    : onSelectContextChoice
      ? contextDraftRows(contexts, draftChoice).map((row) => ({
          ...row,
          pick: () => {
            if (row.changed) onSelectContextChoice(row.runChoice);
          },
        }))
      : contextRows(contexts).map((row) => ({
          ...row,
          pick: () => {
            if (shown && connection && row.choice)
              void saveModelContext(shown, row.choice, connection.revision);
          },
        }));
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
      row.pick();
      editor.clearTrigger();
    },
  }));
  const group = {
    id: 'context',
    heading: tp('modelConfig.context'),
    icon: <Layers />,
    options,
  };
  return { query, groups: [group], empty: reason ?? t('quickPanel.states.noMatches') };
}

/** `/model` alias group prepended above connection catalogs when saved model aliases exist. */
export function modelAliasGroup({
  aliases,
  connections,
  query,
  activeAlias,
  aliasModified,
  onSelectAlias,
  editor,
  t,
  tp,
}: {
  aliases: ModelAlias[];
  connections: Connection[];
  query: string;
  activeAlias: ModelAlias | null;
  aliasModified: boolean;
  onSelectAlias: (alias: ModelAlias) => void;
  editor: ComposerEditorCommands;
  t: TFunction<'panel'>;
  tp: TFunction<'providers'>;
}): QuickGroup | null {
  if (aliases.length === 0) return null;
  const ranked = rankByQuery(aliases, query, (alias) => {
    const connection = connections.find((item) => item.connectionId === alias.connectionId);
    const definition = connection?.catalog.find((item) => item.id === alias.modelId);
    return {
      name: alias.name,
      model: definition?.name ?? alias.modelId,
      modelId: alias.modelId,
      connection: connection?.name ?? '',
      provider: connection?.provider ?? '',
    };
  });
  return {
    id: 'model-aliases',
    heading: t('quickPanel.groups.aliases'),
    icon: <Sparkles />,
    options: ranked.map(({ item: alias, match }): QuickOption => {
      const connection = connections.find((item) => item.connectionId === alias.connectionId);
      const available = isAliasAvailable(alias, connections);
      const brand = connection
        ? (providerPresentation(connection)?.service.brand ?? connection.provider)
        : null;
      return {
        value: `alias:${alias.id}`,
        score: match?.score,
        ranges: match ? { title: match.ranges.name } : undefined,
        icon: brand ? <ProviderBrand provider={brand} /> : <Cpu />,
        title: alias.name,
        description: formatAliasTupleSummary(alias, connections, tp),
        status: available ? undefined : t('quickPanel.states.providerOffline'),
        disabled: !available,
        checked: activeAlias?.id === alias.id && !aliasModified,
        select: () => {
          if (available) onSelectAlias(alias);
          editor.clearTrigger();
        },
      };
    }),
  };
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
    icon: <ArrowsToAxisDashedHorizontal />,
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
    icon: <ArrowsToAxisDashedHorizontal />,
    options: [option],
  };
  if (block) return { query, groups: [], empty: t(`quickPanel.blocked.${block}`) };
  return { query, groups: [group], empty: null };
}

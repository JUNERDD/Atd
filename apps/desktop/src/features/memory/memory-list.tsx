import { Bookmark, Brain, Ellipsis, Lightbulb, Pencil, Trash2, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ai/ui/components/dropdown-menu';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@ai/ui/components/empty';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@ai/ui/components/item';
import { matchFields } from '@ai/ui/lib/fuzzy-match';
import type { MemoryEntry } from '../../client/agent/bridge';
import { IconButton } from '../../components/icon-button';

const TARGET = {
  memory: { icon: Bookmark, labelKey: 'memory.list.preference' },
  user: { icon: UserRound, labelKey: 'memory.list.userProfile' },
  failure: { icon: Lightbulb, labelKey: 'memory.list.corrections' },
} as const;

/**
 * Saved memories in the same row anatomy as the skills list: the kind's icon, the entry on one
 * line with its kind below, and More for secondary actions. A click anywhere on the row opens the
 * editor, which shows the entry in full. Saved order stays; the search matches and marks the text.
 */
export function MemoryList({
  entries,
  query,
  empty,
  disabled,
  onEdit,
  onDelete,
}: {
  entries: MemoryEntry[];
  query: string;
  /** Shown when nothing is listed: no memories yet, or none matching the search. */
  empty: string;
  /** Locks the row actions while a change is saving. */
  disabled: boolean;
  onEdit: (entry: MemoryEntry) => void;
  onDelete: (entry: MemoryEntry) => void;
}) {
  const { t } = useTranslation('memory');
  const shown = entries.flatMap((entry) => {
    const match = matchFields(query, { content: entry.content });
    return match || !query.trim() ? [{ entry, match }] : [];
  });
  if (!shown.length) {
    return (
      <div className="settings-extension-empty">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Brain />
            </EmptyMedia>
            <EmptyTitle>{empty}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }
  return (
    <ItemGroup>
      {shown.map(({ entry, match }) => {
        const { icon: Icon, labelKey } = TARGET[entry.target];
        const preview = entry.content.slice(0, 70);
        return (
          <Item asChild key={entry.id} size="xs" className="settings-open-row">
            <li>
              <button
                type="button"
                className="settings-open-row-button"
                aria-label={t('memory.list.editLabel', { content: preview })}
                disabled={disabled}
                onClick={() => onEdit(entry)}
              />
              <ItemMedia variant="icon">
                <Icon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle title={entry.content}>
                  <HighlightedText text={entry.content} ranges={match?.ranges.content} />
                </ItemTitle>
                <ItemDescription>{t(labelKey)}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      label={t('memory.list.more')}
                      aria-label={t('memory.list.moreActionsFor', { content: preview })}
                      disabled={disabled}
                      tooltipDismissOnClick
                    >
                      <Ellipsis />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onEdit(entry)}>
                      <Pencil />
                      {t('memory.list.edit')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onDelete(entry)}>
                      <Trash2 />
                      {t('memory.list.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </li>
          </Item>
        );
      })}
    </ItemGroup>
  );
}

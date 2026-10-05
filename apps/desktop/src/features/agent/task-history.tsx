import { useState, type ComponentType, type ReactNode } from 'react';
import { Copy, Ellipsis, History, Pencil, SearchIcon, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@atd/ui/components/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { HighlightedText } from '@atd/ui/components/highlighted-text';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@atd/ui/components/empty';
import { useCompositionQuery } from '@atd/ui/lib/ime';
import { Shimmer } from '@atd/ui/components/ai-elements/shimmer';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { matchFields, type FieldsMatch } from '@atd/ui/lib/fuzzy-match';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@atd/ui/components/alert-dialog';
import type { AgentTask } from '../../client/agent/task-schema';
import { isActive } from '../../client/agent/task-schema';
import { IconButton } from '../../components/icon-button';
import { AppOriginBadge } from '../apps/app-origin-badge';
import { agentApi } from './use-agent';
import { forgetComposerMemory } from './use-composer-memory';
import { SettingsSearchField } from '../settings/settings-search-field';
import { HistoryViewMenu } from './history-view-menu';
import { groupHistory, rowDate, sortHistory, stampOf } from './history-view';
import { RenameTaskDialog } from './rename-task-dialog';
import { useCopyTaskId } from './use-copy-task-id';
import { useHistoryView } from './use-history-view';
import { messageOf } from '../../lib/errors';

/** Row actions, rendered once by the More dropdown and once by the right-click context menu. */
function TaskMenuItems({
  task,
  Item,
  Separator,
  onRename,
  onCopyId,
  onDelete,
}: {
  task: AgentTask;
  Item: ComponentType<{
    onSelect: () => void;
    disabled?: boolean;
    variant?: 'default' | 'destructive';
    children: ReactNode;
  }>;
  Separator: ComponentType;
  onRename: () => void;
  onCopyId: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('tasks');
  return (
    <>
      <Item onSelect={onRename}>
        <Pencil />
        {t('history.rename')}
      </Item>
      <Item onSelect={onCopyId}>
        <Copy />
        {t('history.copyId')}
      </Item>
      <Separator />
      <Item variant="destructive" disabled={isActive(task.runs.at(-1)?.status)} onSelect={onDelete}>
        <Trash2 />
        {t('history.delete')}
      </Item>
    </>
  );
}

type HistoryEntry = {
  task: AgentTask;
  /** Shown only when it says something: every finished task would otherwise read "Completed". */
  statusLabel: string;
  match: FieldsMatch<'title' | 'status'> | null;
};

/** Run states that need the user's attention read in the destructive color, beside their text. */
const ERROR_STATUSES = new Set(['failed', 'interrupted']);

export function TaskHistory({
  tasks,
  onChoose,
}: {
  tasks: AgentTask[];
  onChoose: (id: string) => void;
}) {
  const { t, i18n } = useTranslation('tasks');
  // The last renamed or deleted task stays mounted while its dialog closes so the exit animation
  // keeps its content.
  const [deleting, setDeleting] = useState<{ task: AgentTask; open: boolean } | null>(null);
  const [renaming, setRenaming] = useState<{ task: AgentTask; open: boolean } | null>(null);
  const copyId = useCopyTaskId();
  const search = useCompositionQuery();
  const [view, setView] = useHistoryView();
  const [error, setError] = useState('');
  const query = search.query.trim();
  // Sections are dated against when the history opened, so they hold still while it is browsed.
  const [now] = useState(() => new Date());
  function statusLabelOf(task: AgentTask) {
    const status = task.runs.at(-1)?.status;
    if (status === 'completed') return '';
    return status ? t(`status.${status}`) : t('history.importedDraft');
  }
  // The query filters and marks the visible title and status; the view orders and sections them.
  const visible = tasks.flatMap((task): HistoryEntry[] => {
    const statusLabel = statusLabelOf(task);
    const match = matchFields(query, { title: task.title, status: statusLabel || undefined });
    return match || !query ? [{ task, statusLabel, match }] : [];
  });
  const sections = groupHistory(sortHistory(visible, view.sort, i18n.language), view, now);
  /** The section's heading; the ungrouped list has none. */
  function sectionTitle(section: (typeof sections)[number]): string | null {
    switch (section.kind) {
      case 'period':
        return t(`history.section.${section.period}`);
      case 'month':
        return section.month.toLocaleDateString(
          i18n.language,
          section.month.getFullYear() === now.getFullYear()
            ? { month: 'long' }
            : { year: 'numeric', month: 'long' },
        );
      case 'status':
        return t(`history.statusSection.${section.status}`);
      case 'model':
        return section.model ?? t('history.noModel');
      case 'all':
        return null;
    }
  }
  return (
    <section className="panel-content task-history" aria-label={t('history.label')}>
      <div className="flex items-center gap-2 pb-3">
        <SettingsSearchField
          search={search}
          className="h-8! min-w-0 flex-1"
          aria-label={t('history.searchLabel')}
          placeholder={t('history.searchPlaceholder')}
        />
        <HistoryViewMenu view={view} onChange={setView} />
      </div>
      <ScrollArea className="-mr-3 min-h-0 flex-1" gutter="stable" scrollShadow>
        <div className="history-sections">
          {sections.map((section) => {
            const title = sectionTitle(section);
            return (
              <section
                key={section.id}
                className="history-section"
                aria-labelledby={title === null ? undefined : `history-section-${section.id}`}
              >
                {title !== null && (
                  <h3 id={`history-section-${section.id}`} className="history-section-title">
                    {title}
                  </h3>
                )}
                <ul className="task-list">
                  {section.items.map(({ task, statusLabel, match }) => {
                    const status = task.runs.at(-1)?.status;
                    const progressing =
                      status === 'queued' || status === 'running' || status === 'stopping';
                    const stamp = stampOf(task, view.sort);
                    const updated = new Date(stamp);
                    const menuActions = {
                      task,
                      onRename: () => setRenaming({ task, open: true }),
                      onCopyId: () => void copyId(task),
                      onDelete: () => setDeleting({ task, open: true }),
                    };
                    return (
                      <ContextMenu key={task.id}>
                        <ContextMenuTrigger asChild>
                          <li className="history-row">
                            <Button
                              variant="ghost"
                              className="task-row min-w-0"
                              onClick={() => onChoose(task.id)}
                            >
                              <span className="task-row-head">
                                <span className="task-row-title" title={task.title}>
                                  <HighlightedText text={task.title} ranges={match?.ranges.title} />
                                </span>
                                {task.origin && <AppOriginBadge origin={task.origin} />}
                              </span>
                              <span className="task-row-meta">
                                <time dateTime={stamp} title={updated.toLocaleString()}>
                                  {rowDate(updated, now, i18n.language, view.group === 'date')}
                                </time>
                                {statusLabel && (
                                  <span
                                    className="task-row-status"
                                    data-tone={
                                      status && ERROR_STATUSES.has(status) ? 'error' : undefined
                                    }
                                  >
                                    {/* Shimmer animates plain text only, so a running status stays unmarked. */}
                                    {progressing ? (
                                      <Shimmer as="span">{statusLabel}</Shimmer>
                                    ) : (
                                      <HighlightedText
                                        text={statusLabel}
                                        ranges={match?.ranges.status}
                                      />
                                    )}
                                  </span>
                                )}
                              </span>
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <IconButton
                                  label={t('history.more')}
                                  aria-label={t('history.moreActionsFor', { title: task.title })}
                                  className="history-row-more"
                                  tooltipDismissOnClick
                                >
                                  <Ellipsis />
                                </IconButton>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <TaskMenuItems
                                  {...menuActions}
                                  Item={DropdownMenuItem}
                                  Separator={DropdownMenuSeparator}
                                />
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </li>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <TaskMenuItems
                            {...menuActions}
                            Item={ContextMenuItem}
                            Separator={ContextMenuSeparator}
                          />
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
        {!visible.length && (
          <Empty className="px-4 py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">{tasks.length ? <SearchIcon /> : <History />}</EmptyMedia>
              <EmptyTitle className="text-base">
                {tasks.length ? t('history.noMatches', { query }) : t('history.empty')}
              </EmptyTitle>
              <EmptyDescription>
                {tasks.length ? t('history.noMatchesDescription') : t('history.emptyDescription')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </ScrollArea>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {renaming && (
        <RenameTaskDialog
          task={renaming.task}
          open={renaming.open}
          onOpenChange={(open) => setRenaming({ task: renaming.task, open })}
        />
      )}
      <AlertDialog
        open={deleting?.open ?? false}
        onOpenChange={(open) => {
          if (deleting) setDeleting({ task: deleting.task, open });
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('history.deleteTitle', { title: deleting?.task.title ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('history.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('history.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) {
                  const { id } = deleting.task;
                  void agentApi()
                    .deleteTask(id)
                    .then(() => forgetComposerMemory(id))
                    .catch((error) => setError(messageOf(error)));
                }
              }}
            >
              {t('history.deleteAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

import { useState } from 'react';
import { History, SearchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@atd/ui/components/empty';
import { useCompositionQuery } from '@atd/ui/lib/ime';
import { matchFields } from '@atd/ui/lib/fuzzy-match';
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
import { agentApi } from './use-agent';
import { forgetComposerMemory } from './use-composer-memory';
import { SettingsSearchField } from '../settings/settings-search-field';
import { HistoryList, type HistoryActions } from './history-list';
import { historyRows, type HistoryEntry } from './history-rows';
import { HistoryViewMenu } from './history-view-menu';
import { groupHistory, sortHistory } from './history-view';
import { RenameTaskDialog } from './rename-task-dialog';
import { useCopyTaskId } from './use-copy-task-id';
import { useHistoryView } from './use-history-view';
import { useTaskContentSearch } from './use-task-content-search';
import { messageOf } from '../../lib/errors';

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
  const content = useTaskContentSearch(query, tasks);
  // Sections are dated against when the history opened, so they hold still while it is browsed.
  const [now] = useState(() => new Date());
  function statusLabelOf(task: AgentTask) {
    const status = task.runs.at(-1)?.status;
    if (status === 'completed') return '';
    return status ? t(`status.${status}`) : t('history.importedDraft');
  }
  // The query filters and marks the visible title and status, and lists a task whose conversation
  // matches with that message, which shows only where it is why the task is listed (a title match
  // would mostly repeat itself); the view orders and sections them, never by relevance.
  const visible = tasks.flatMap((task): HistoryEntry[] => {
    const statusLabel = statusLabelOf(task);
    const match = matchFields(query, { title: task.title, status: statusLabel || undefined });
    const hit = query ? (content.hits.get(task.id) ?? null) : null;
    if (!match && !hit && query) return [];
    return [{ task, statusLabel, match, content: match ? null : hit }];
  });
  // "No results" waits for the conversation search, so it never flashes before a late match.
  const settledEmpty = !visible.length && !content.pending;
  let searchStatus = '';
  if (content.pending) searchStatus = t('history.searchingConversations');
  else if (content.failed) searchStatus = t('history.conversationSearchFailed');
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
      case 'origin':
        return t(`history.originSection.${section.origin}`);
      case 'all':
        return null;
    }
  }
  const rows = historyRows(
    sections.map((section) => ({ title: sectionTitle(section), items: section.items })),
  );
  const actions: HistoryActions = {
    rename: (task) => setRenaming({ task, open: true }),
    copyId: (task) => void copyId(task),
    delete: (task) => setDeleting({ task, open: true }),
  };
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
      <HistoryList rows={rows} view={view} now={now} actions={actions} onChoose={onChoose}>
        {settledEmpty && (
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
      </HistoryList>
      {/* Always mounted, so assistive technology announces the search's progress and failure. */}
      <output className="block text-xs text-muted-foreground">{searchStatus}</output>
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

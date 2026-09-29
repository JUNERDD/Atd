import { useState, type ComponentType, type ReactNode } from 'react';
import { Ellipsis, Link2, Pencil, SearchIcon, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@ai/ui/components/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ai/ui/components/dropdown-menu';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@ai/ui/components/input-group';
import { useCompositionQuery } from '@ai/ui/lib/ime';
import { Shimmer } from '@ai/ui/components/ai-elements/shimmer';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { matchFields } from '@ai/ui/lib/fuzzy-match';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@ai/ui/components/alert-dialog';
import type { AgentTask } from '../../client/agent/task-schema';
import { isActive } from '../../client/agent/task-schema';
import { IconButton } from '../../components/icon-button';
import { agentApi } from './use-agent';
import { RenameTaskDialog } from './rename-task-dialog';
import { useCopyTaskLink } from './use-copy-task-link';
import { messageOf } from '../../lib/errors';

/** Row actions, rendered once by the More dropdown and once by the right-click context menu. */
function TaskMenuItems({
  task,
  Item,
  Separator,
  onRename,
  onCopyLink,
  onDelete,
}: {
  task: AgentTask;
  Item: ComponentType<{ onSelect: () => void; disabled?: boolean; children: ReactNode }>;
  Separator: ComponentType;
  onRename: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('tasks');
  return (
    <>
      <Item onSelect={onRename}>
        <Pencil />
        {t('history.rename')}
      </Item>
      <Item onSelect={onCopyLink}>
        <Link2 />
        {t('history.copyLink')}
      </Item>
      <Separator />
      <Item disabled={isActive(task.runs.at(-1)?.status)} onSelect={onDelete}>
        <Trash2 />
        {t('history.delete')}
      </Item>
    </>
  );
}

export function TaskHistory({
  tasks,
  onChoose,
}: {
  tasks: AgentTask[];
  onChoose: (id: string) => void;
}) {
  const { t } = useTranslation('tasks');
  const [deleting, setDeleting] = useState<AgentTask | null>(null);
  // The last renamed task stays mounted while its dialog closes so the exit animation keeps its content.
  const [renaming, setRenaming] = useState<{ task: AgentTask; open: boolean } | null>(null);
  const copyLink = useCopyTaskLink();
  const search = useCompositionQuery();
  const [error, setError] = useState('');
  const query = search.query.trim();
  function statusLabelOf(task: AgentTask) {
    const status = task.runs.at(-1)?.status;
    return status ? t(`status.${status}`) : t('history.importedDraft');
  }
  // The query filters and marks the visible title and status; the list stays chronological.
  const visible = tasks.flatMap((task) => {
    const statusLabel = statusLabelOf(task);
    const match = matchFields(query, { title: task.title, status: statusLabel });
    return match || !query ? [{ task, statusLabel, match }] : [];
  });
  return (
    <section className="panel-content task-history" aria-label={t('history.label')}>
      <div className="pb-3">
        <InputGroup className="h-8!">
          <InputGroupInput
            aria-label={t('history.searchLabel')}
            placeholder={t('history.searchPlaceholder')}
            value={search.text}
            onChange={(event) => search.change(event.target.value)}
            {...search.compositionProps}
          />
          <InputGroupAddon>
            <SearchIcon className="size-4 shrink-0 opacity-50" />
          </InputGroupAddon>
        </InputGroup>
      </div>
      <ScrollArea className="flex-1 min-h-0 -mr-3" gutter="stable">
        <ul className="task-list">
          {visible.map(({ task, statusLabel, match }) => {
            const status = task.runs.at(-1)?.status;
            const progressing =
              status === 'queued' || status === 'running' || status === 'stopping';
            const menuActions = {
              task,
              onRename: () => setRenaming({ task, open: true }),
              onCopyLink: () => void copyLink(task),
              onDelete: () => setDeleting(task),
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
                      <span className="task-row-title" title={task.title}>
                        <HighlightedText text={task.title} ranges={match?.ranges.title} />
                      </span>
                      <span className="task-row-meta">
                        <time dateTime={task.updatedAt}>
                          {new Date(task.updatedAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </time>
                        <span>
                          {/* Shimmer animates plain text only, so a running status stays unmarked. */}
                          {progressing ? (
                            <Shimmer as="span">{statusLabel}</Shimmer>
                          ) : (
                            <HighlightedText text={statusLabel} ranges={match?.ranges.status} />
                          )}
                        </span>
                      </span>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          label={t('history.more')}
                          aria-label={t('history.moreActionsFor', { title: task.title })}
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
        {!visible.length && (
          <p className="py-6 text-center text-sm">
            {tasks.length ? t('history.noMatches') : t('history.empty')}
          </p>
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
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('history.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('history.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('history.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting)
                  void agentApi()
                    .deleteTask(deleting.id)
                    .catch((error) => setError(messageOf(error)));
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

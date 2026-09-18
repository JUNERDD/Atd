import { useState } from 'react';
import { SearchIcon, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { commandFilter } from '@ai/ui/lib/command-filter';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@ai/ui/components/input-group';
import { Shimmer } from '@ai/ui/components/ai-elements/shimmer';
import { ScrollArea } from '@ai/ui/components/scroll-area';
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
import type { AgentTask } from '../../../electron/agent/task-schema';
import { isActive } from '../../../electron/agent/task-schema';
import { IconButton } from '../../components/icon-button';
import { agentApi } from './use-agent';
import { messageOf } from '../../lib/errors';

export function TaskHistory({
  tasks,
  onChoose,
}: {
  tasks: AgentTask[];
  onChoose: (id: string) => void;
}) {
  const { t } = useTranslation('tasks');
  const [deleting, setDeleting] = useState<AgentTask | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const query = search.trim();
  function statusLabelOf(task: AgentTask) {
    const status = task.runs.at(-1)?.status;
    return status ? t(`status.${status}`) : t('history.importedDraft');
  }
  const visible = query
    ? tasks.filter((task) => commandFilter(`${task.title} ${statusLabelOf(task)}`, query) > 0)
    : tasks;
  return (
    <section className="panel-content task-history" aria-label={t('history.label')}>
      <div className="pb-3">
        <InputGroup className="h-8!">
          <InputGroupInput
            aria-label={t('history.searchLabel')}
            placeholder={t('history.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <InputGroupAddon>
            <SearchIcon className="size-4 shrink-0 opacity-50" />
          </InputGroupAddon>
        </InputGroup>
      </div>
      <ScrollArea className="flex-1 min-h-0 -mr-3" gutter>
        <ul className="task-list">
          {visible.map((task) => {
            const status = task.runs.at(-1)?.status;
            const statusLabel = statusLabelOf(task);
            const progressing =
              status === 'queued' || status === 'running' || status === 'stopping';
            return (
              <li key={task.id} className="history-row">
                <Button
                  variant="ghost"
                  className="task-row min-w-0"
                  onClick={() => onChoose(task.id)}
                >
                  <span className="task-row-title" title={task.title}>
                    {task.title}
                  </span>
                  <span className="task-row-meta">
                    <time dateTime={task.updatedAt}>
                      {new Date(task.updatedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </time>
                    <span>
                      {progressing ? <Shimmer as="span">{statusLabel}</Shimmer> : statusLabel}
                    </span>
                  </span>
                </Button>
                <IconButton
                  label={t('history.delete')}
                  aria-label={t('history.deleteFor', { title: task.title })}
                  disabled={isActive(task.runs.at(-1)?.status)}
                  onClick={() => setDeleting(task)}
                >
                  <Trash2 />
                </IconButton>
              </li>
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

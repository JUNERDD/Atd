import { Circle, CircleCheck, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TodoDetails, TodoItem, TodoStatus } from '@ai/agent-contracts';
import { cn } from '@ai/ui/lib/utils';
import { DetailBox } from './detail-box';

type VisibleStatus = Exclude<TodoStatus, 'deleted'>;

/**
 * Status glyph of one todo: a spinner while in progress, an empty circle while pending, a check
 * once completed. Deleted items are tombstones and never reach it. The glyph carries the
 * status name for assistive technology because the row text alone does not state it.
 */
export function TodoStatusIcon({ status }: { status: VisibleStatus }) {
  const { t } = useTranslation('tasks');
  const props = { role: 'img', strokeWidth: 1.75, className: 'size-3.5 shrink-0' };
  switch (status) {
    case 'in_progress':
      return (
        <LoaderCircle
          {...props}
          className={cn(props.className, 'animate-spin')}
          aria-label={t('todo.status.in_progress')}
        />
      );
    case 'pending':
      return (
        <Circle
          {...props}
          className={cn(props.className, 'text-muted-foreground')}
          aria-label={t('todo.status.pending')}
        />
      );
    case 'completed':
      return (
        <CircleCheck
          {...props}
          className={cn(props.className, 'text-muted-foreground')}
          aria-label={t('todo.status.completed')}
        />
      );
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return null;
    }
  }
}

function isVisible(task: TodoItem): task is TodoItem & { status: VisibleStatus } {
  return task.status !== 'deleted';
}

/** `#1, #2, and #3` in the reader's language; ids are the handles blocked-by refers to. */
function useIdList() {
  const { i18n } = useTranslation('tasks');
  const format = new Intl.ListFormat(i18n.resolvedLanguage ?? i18n.language, {
    type: 'conjunction',
  });
  return (ids: number[]) => format.format(ids.map((id) => `#${id}`));
}

function TodoRow({ task, idList }: { task: TodoItem & { status: VisibleStatus }; idList: string }) {
  const { t } = useTranslation('tasks');
  const active = task.status === 'in_progress' && task.activeForm ? task.activeForm : null;
  return (
    <li className="flex min-w-0 items-start gap-2">
      <span className="flex h-4.5 shrink-0 items-center">
        <TodoStatusIcon status={task.status} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p
          className={cn(
            'm-0 min-w-0 truncate',
            task.status === 'completed' && 'text-muted-foreground line-through',
          )}
          title={task.subject}
        >
          <span className="text-muted-foreground">{`#${task.id}`}</span> {task.subject}
        </p>
        {active && (
          <p className="m-0 min-w-0 truncate text-muted-foreground" title={active}>
            {active}
          </p>
        )}
        {idList && (
          <p className="m-0 min-w-0 truncate text-muted-foreground" title={idList}>
            {t('todo.blockedBy', { ids: idList })}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * The todo list as the call left it (`todo` details): progress over the visible items, then one
 * checklist row per item in id order. Long subjects truncate with the full text on hover; the
 * box scrolls vertically once the list outgrows it.
 */
export function TodoBody({ details, copyText }: { details: TodoDetails; copyText: string }) {
  const { t } = useTranslation('tasks');
  const formatIds = useIdList();
  const tasks = details.tasks.filter(isVisible);
  const completed = tasks.filter((task) => task.status === 'completed').length;
  return (
    <DetailBox variant="output" copyText={copyText}>
      {tasks.length === 0 ? (
        <p className="m-0 text-muted-foreground">{t('todo.empty')}</p>
      ) : (
        <>
          <p className="m-0 text-muted-foreground">
            {t('todo.progress', { completed, total: tasks.length })}
          </p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label={t('todo.listLabel')}>
            {tasks.map((task) => (
              <TodoRow
                key={task.id}
                task={task}
                idList={task.blockedBy.length > 0 ? formatIds(task.blockedBy) : ''}
              />
            ))}
          </ul>
        </>
      )}
      {details.truncated && (
        <p className="m-0 text-muted-foreground">{t('activity.truncatedNote')}</p>
      )}
    </DetailBox>
  );
}

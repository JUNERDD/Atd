import { Circle, CircleCheck, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PopoverDescription, PopoverHeader, PopoverTitle } from '@ai/ui/components/popover';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { cn } from '@ai/ui/lib/utils';
import type { VisibleTodo } from './selectors';

/**
 * Status glyph of one todo: a spinner while in progress, an empty circle while pending, a check
 * once completed. Deleted items are tombstones and never reach it. The glyph carries the
 * status name for assistive technology because the row text alone does not state it.
 */
function TodoStatusIcon({ status }: { status: VisibleTodo['status'] }) {
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

/**
 * The task list of the Todos view, in rpiv-todo id order, with one status glyph per task.
 * Subjects truncate to one line; the full subject (and what blocks a task) stays in the row's
 * native tooltip and in the accessible text, which is never truncated.
 */
export function TodoList({ todos }: { todos: readonly VisibleTodo[] }) {
  const { t } = useTranslation('tasks');
  return (
    <ScrollArea className="composer-todos-scroll" gutter="stable" scrollShadow>
      <ul className="composer-todos-list" aria-label={t('todo.listLabel')}>
        {todos.map((todo) => {
          const blockedBy =
            todo.status === 'pending' && todo.blockedBy.length > 0
              ? t('todo.blockedBy', { ids: todo.blockedBy.map((id) => `#${id}`).join(', ') })
              : null;
          return (
            <li
              key={todo.id}
              className="composer-todo"
              data-status={todo.status}
              title={blockedBy ? `${todo.subject}\n${blockedBy}` : todo.subject}
            >
              <TodoStatusIcon status={todo.status} />
              <span className="composer-todo-subject">{todo.subject}</span>
              {blockedBy && <span className="sr-only">{blockedBy}</span>}
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}

/** The composer popover's Todos view: the list under a header of its title and completed count. */
export function TodosPanel({
  todos,
  completed,
}: {
  todos: readonly VisibleTodo[];
  completed: number;
}) {
  const { t } = useTranslation('tasks');
  return (
    <div className="composer-todos">
      <PopoverHeader className="composer-todos-header">
        <PopoverTitle className="text-sm">{t('todo.title')}</PopoverTitle>
        <PopoverDescription className="text-xs">
          {t('todo.progress', { completed, total: todos.length })}
        </PopoverDescription>
      </PopoverHeader>
      <TodoList todos={todos} />
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { PopoverDescription, PopoverHeader, PopoverTitle } from '@ai/ui/components/popover';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { TodoStatusIcon } from '../transcript/todo-body';
import type { VisibleTodo } from './selectors';

/**
 * The task list of the Todos view, in rpiv-todo id order, with the transcript's todo status
 * glyphs. Subjects truncate to one line; the full subject (and what blocks a task) stays in the
 * row's native tooltip and in the accessible text, which is never truncated.
 */
export function TodoList({ todos }: { todos: readonly VisibleTodo[] }) {
  const { t } = useTranslation('tasks');
  return (
    <ScrollArea className="composer-todos-scroll" gutter>
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

/** The composer popover's Todos view: the list under its title and completed count. */
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

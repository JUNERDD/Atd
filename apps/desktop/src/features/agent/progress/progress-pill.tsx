import type { KeyboardEvent } from 'react';
import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@ai/ui/components/popover';
import { Separator } from '@ai/ui/components/separator';
import type { Block } from '../../../../electron/agent/transcript-schema';
import { TodoList } from './todo-list';
import { useTaskProgress } from './use-task-progress';
import './progress.css';

/**
 * Circular progress of the todo list: a muted track with an arc for the completed share. The pill
 * text says the same, so the ring is decorative. `pathLength` makes the dash a plain percentage.
 */
function StepRing({ completed, total }: { completed: number; total: number }) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <svg className="composer-progress-ring" viewBox="0 0 16 16" aria-hidden>
      <circle className="composer-progress-ring-track" cx="8" cy="8" r="6" />
      {percent > 0 && (
        <circle
          className="composer-progress-ring-value"
          cx="8"
          cy="8"
          r="6"
          pathLength={100}
          strokeDasharray={`${percent} 100`}
          data-complete={percent === 100 || undefined}
        />
      )}
    </svg>
  );
}

/**
 * Compact progress pill, centered above the composer input: a progress ring and `Step x / y` from
 * the latest todo list, and, while the reply is `live` (its run is in progress), the subagents that
 * reply dispatched successfully, finished ones included. Each half hides when it has nothing to say
 * and the pill hides when both do. With todos it opens the Todos popover; without them it is a
 * plain status.
 */
export function ProgressPill({ blocks, live }: { blocks: readonly Block[]; live: boolean }) {
  const { t } = useTranslation('panel');
  const { t: tt } = useTranslation('tasks');
  const progress = useTaskProgress(blocks);
  const { todos, step, completed } = progress;
  const subagents = live ? progress.subagents : 0;
  if (!step && subagents === 0) return null;
  const stepText = step
    ? t('composer.progress.step', { current: step.current, total: step.total })
    : null;
  const subagentText =
    subagents === 0
      ? null
      : subagents === 1
        ? t('composer.progress.subagentOne')
        : t('composer.progress.subagentMany', { count: subagents });
  const content = (
    <>
      {stepText && (
        <span className="composer-progress-part">
          <StepRing completed={completed} total={step?.total ?? 0} />
          <span className="truncate">{stepText}</span>
        </span>
      )}
      {stepText && subagentText && <Separator orientation="vertical" className="h-3" />}
      {subagentText && (
        <span className="composer-progress-part">
          <Bot aria-hidden />
          <span className="truncate">{subagentText}</span>
        </span>
      )}
    </>
  );
  if (todos.length === 0)
    return (
      <div className="composer-progress-row">
        <output className="composer-progress" aria-label={t('composer.progress.label')}>
          {content}
        </output>
      </div>
    );
  // Esc closes this popover only: marking it handled keeps the panel-global Esc (new chat, hide)
  // and the HITL popover around the composer from reacting to the same key.
  const onContentKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  return (
    <div className="composer-progress-row">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            className="composer-progress"
            aria-label={[stepText, subagentText, t('composer.progress.showTodos')]
              .filter(Boolean)
              .join(' · ')}
          >
            {content}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          sideOffset={8}
          className="composer-todos"
          onKeyDown={onContentKeyDown}
        >
          <PopoverHeader className="composer-todos-header">
            <PopoverTitle className="text-sm">{tt('todo.title')}</PopoverTitle>
            <PopoverDescription className="text-xs">
              {tt('todo.progress', { completed, total: todos.length })}
            </PopoverDescription>
          </PopoverHeader>
          <TodoList todos={todos} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

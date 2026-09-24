import { TODO_TOOL, type TodoItem } from '@ai/agent-contracts';
import type { Block } from '../../../../electron/agent/transcript-schema';
import { subagentLaunches } from '../transcript/subagent-call';

/** A todo the UI lists: rpiv-todo's `deleted` tombstones never show. */
export type VisibleTodo = TodoItem & { status: Exclude<TodoItem['status'], 'deleted'> };

/** Position in the todo list: the task being worked on, or the next one once none is. */
export interface TodoStep {
  current: number;
  total: number;
}

export interface TaskProgress {
  todos: VisibleTodo[];
  step: TodoStep | null;
  completed: number;
  /** Subagents launched by `subagent` calls that are still running. */
  running: number;
}

function isVisible(todo: TodoItem): todo is VisibleTodo {
  return todo.status !== 'deleted';
}

/**
 * The current todo list: every successful `todo` call carries the whole list after it, so the
 * latest block with todo details is the list of the transcript's branch. Running or failed calls
 * have no details and are skipped.
 */
export function latestTodos(blocks: readonly Block[]): VisibleTodo[] {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind !== 'tool' || block.name !== TODO_TOOL) continue;
    const data = block.details.data;
    if (data?.type === 'todo') return data.tasks.filter(isVisible);
  }
  return [];
}

/**
 * Step `current / total` over the visible todos: the first in-progress task, otherwise the task
 * after the completed ones, capped at the last so a finished list reads `total / total`.
 */
export function todoStep(todos: readonly VisibleTodo[]): TodoStep | null {
  const total = todos.length;
  if (total === 0) return null;
  const active = todos.findIndex((todo) => todo.status === 'in_progress');
  if (active >= 0) return { current: active + 1, total };
  const completed = todos.filter((todo) => todo.status === 'completed').length;
  return { current: Math.min(completed + 1, total), total };
}

/** Counts launches the same way the transcript's subagent rows do (`subagentLaunches`). */
export function runningSubagents(blocks: readonly Block[]): number {
  let running = 0;
  for (const block of blocks) {
    if (block.kind === 'tool' && block.name === 'subagent' && block.status === 'running')
      running += subagentLaunches(block.args, block.status);
  }
  return running;
}

export function taskProgress(blocks: readonly Block[]): TaskProgress {
  const todos = latestTodos(blocks);
  return {
    todos,
    step: todoStep(todos),
    completed: todos.filter((todo) => todo.status === 'completed').length,
    running: runningSubagents(blocks),
  };
}

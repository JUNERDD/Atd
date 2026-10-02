import { TODO_TOOL, type SubagentChildSummary, type TodoItem } from '@atd/agent-contracts';
import type { Block } from '../../../client/agent/transcript-schema';
import { subagentLaunches } from '../transcript/subagent-call';
import { subagentDetailsOf } from '../transcript/subagent-children';

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
  /** Subagents the current assistant message dispatched successfully, finished or not. */
  subagents: number;
  /**
   * Those subagents' summaries in launch order, for the pill's list. Empty for transcripts
   * recorded before the service summarized children; `subagents` still counts those.
   */
  children: SubagentChildSummary[];
  /** Whether a summary dropped children over its bound, so the list is incomplete. */
  childrenTruncated: boolean;
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

/**
 * Subagents dispatched by the current assistant message: the blocks after the latest user message,
 * the same boundary that starts a transcript turn. Counts like the transcript's group header
 * (`subagentLaunches`), so only completed dispatches add up.
 */
export function dispatchedSubagents(blocks: readonly Block[]): number {
  let dispatched = 0;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!block || block.kind === 'user') break;
    if (block.kind === 'tool' && block.name === 'subagent')
      dispatched += subagentLaunches(block.args, block.status);
  }
  return dispatched;
}

/**
 * Children of the current assistant message's `subagent` calls, from their summaries (the same
 * boundary as `dispatchedSubagents`). A child appears once it launched, so running ones count.
 */
export function currentChildren(blocks: readonly Block[]): {
  children: SubagentChildSummary[];
  truncated: boolean;
} {
  const calls: { children: SubagentChildSummary[]; truncated: boolean }[] = [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!block || block.kind === 'user') break;
    const details = block.kind === 'tool' ? subagentDetailsOf(block) : null;
    if (details) calls.unshift(details);
  }
  return {
    children: calls.flatMap((call) => call.children),
    truncated: calls.some((call) => call.truncated),
  };
}

export function taskProgress(blocks: readonly Block[]): TaskProgress {
  const todos = latestTodos(blocks);
  const { children, truncated } = currentChildren(blocks);
  return {
    todos,
    step: todoStep(todos),
    completed: todos.filter((todo) => todo.status === 'completed').length,
    subagents: children.length || dispatchedSubagents(blocks),
    children,
    childrenTruncated: truncated,
  };
}

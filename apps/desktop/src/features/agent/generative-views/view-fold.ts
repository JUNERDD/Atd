import { createContext, use, useMemo, useState } from 'react';
import { SHOW_UI_TOOL, UPDATE_UI_TOOL } from '@atd/agent-contracts';
import type { Block } from '../../../client/agent/transcript-schema';

/**
 * A view's data as the transcript holds it: its `show_ui` data at revision 0, then the data of
 * each completed `update_ui` for it, one revision each.
 */
export interface ViewSnapshot {
  data: unknown;
  revision: number;
}

/** Every view of a task, by its `show_ui` call id. */
export type ViewSnapshots = ReadonlyMap<string, ViewSnapshot>;

const NO_VIEWS: ViewSnapshots = new Map();

/**
 * Folds the transcript into each view's data, in document order: a `show_ui` call's `data` (null
 * without one) at revision 0, then every completed `update_ui` naming that call replaces the data
 * and adds a revision. An update naming no earlier view applies to nothing. The transcript is the
 * only store, so a fork, a reload or a rewind folds to the data its own calls hold. A view whose
 * data did not change keeps its snapshot, and the map stays `previous` when no view changed.
 */
export function foldViews(blocks: readonly Block[], previous: ViewSnapshots): ViewSnapshots {
  const next = new Map<string, ViewSnapshot>();
  for (const block of blocks) {
    if (block.kind !== 'tool') continue;
    if (block.name === SHOW_UI_TOOL) {
      next.set(block.callId, { data: block.args.data ?? null, revision: 0 });
      continue;
    }
    if (block.name !== UPDATE_UI_TOOL || block.status !== 'completed') continue;
    const id = block.args.id;
    if (typeof id !== 'string') continue;
    const shown = next.get(id);
    if (shown) next.set(id, { data: block.args.data ?? null, revision: shown.revision + 1 });
  }
  let unchanged = next.size === previous.size;
  for (const [id, snapshot] of next) {
    const held = previous.get(id);
    if (held && held.revision === snapshot.revision && Object.is(held.data, snapshot.data))
      next.set(id, held);
    else unchanged = false;
  }
  return unchanged ? previous : next;
}

/**
 * The views of a task's transcript, held by value: streamed patches that leave every view's data
 * as it was keep the same map, so the cards that read it skip them.
 */
export function useViewSnapshots(blocks: readonly Block[]): ViewSnapshots {
  const [views, setViews] = useState(NO_VIEWS);
  const next = useMemo(() => foldViews(blocks, views), [blocks, views]);
  if (next !== views) setViews(next);
  return next;
}

/** What a view card needs from the transcript showing it: the task and every view's data. */
export interface TaskViews {
  taskId: string;
  views: ViewSnapshots;
}

export const TaskViewsContext = createContext<TaskViews | null>(null);

/**
 * The views of the task the transcript shows; null outside a task's own transcript (a subagent's
 * drill-in view, which runs no `show_ui`, or an isolated render).
 */
export function useTaskViews(): TaskViews | null {
  return use(TaskViewsContext);
}

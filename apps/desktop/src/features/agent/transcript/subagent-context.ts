import { createContext, useContext, useMemo, useState } from 'react';
import type { PermissionRequest } from '../../../client/agent/permission-schema';
import type { Block } from '../../../client/agent/transcript-schema';
import {
  EMPTY_CHILD_INDEX,
  indexSubagentChildren,
  pendingExecutions,
  sameChildIndex,
  type PendingByExecution,
  type SubagentChildIndex,
} from './subagent-children';

export type SubagentContextValue = {
  index: SubagentChildIndex;
  /** What each child waits on, by execution id. */
  pending: PendingByExecution;
  /**
   * Opens a child's drill-in view; `origin` receives focus again when the view closes. Null
   * outside the task panel, where cards stay informational.
   */
  open: ((childKey: string, origin: HTMLElement) => void) | null;
};

/**
 * Shares the open task's subagent children with the parts that reach them from different
 * places: summary cards inside tool rows, the drill-in header, and the approval and question
 * controls in the composer popover. The task panel provides it and owns the drill-in state
 * behind `open`; without a provider, cards render without the drill-in action.
 */
export const SubagentContext = createContext<SubagentContextValue>({
  index: EMPTY_CHILD_INDEX,
  pending: new Map(),
  open: null,
});

export function useSubagents(): SubagentContextValue {
  return useContext(SubagentContext);
}

/**
 * The provider value for one task: re-indexed when its blocks or requests change, and kept while
 * the children it indexes are equal by value, so streamed patches leave it stable.
 */
export function useSubagentContextValue(
  blocks: readonly Block[],
  requests: readonly PermissionRequest[],
  open: (childKey: string, origin: HTMLElement) => void,
): SubagentContextValue {
  const nextIndex = useMemo(() => indexSubagentChildren(blocks), [blocks]);
  const [index, setIndex] = useState(nextIndex);
  if (index !== nextIndex && !sameChildIndex(index, nextIndex)) setIndex(nextIndex);
  const pending = useMemo(() => pendingExecutions(requests), [requests]);
  return useMemo(() => ({ index, pending, open }), [index, pending, open]);
}

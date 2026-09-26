import { createContext, useContext, useMemo } from 'react';
import type { PermissionRequest } from '../../../../electron/agent/permission-schema';
import type { Block } from '../../../../electron/agent/transcript-schema';
import {
  EMPTY_CHILD_INDEX,
  indexSubagentChildren,
  pendingExecutions,
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

/** The provider value for one task: re-indexed only when its blocks or requests change. */
export function useSubagentContextValue(
  blocks: readonly Block[],
  requests: readonly PermissionRequest[],
  open: (childKey: string, origin: HTMLElement) => void,
): SubagentContextValue {
  const index = useMemo(() => indexSubagentChildren(blocks), [blocks]);
  const pending = useMemo(() => pendingExecutions(requests), [requests]);
  return useMemo(() => ({ index, pending, open }), [index, pending, open]);
}

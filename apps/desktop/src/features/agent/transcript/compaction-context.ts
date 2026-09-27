import { createContext, useContext } from 'react';

/** Retrying a failed compaction of the conversation on screen. */
export interface CompactionRetry {
  retry: () => void;
  /** The task cannot be compacted now (a run is active, or a compaction is under way). */
  disabled: boolean;
  /**
   * The task's latest compaction block. Only a failure that is still the latest offers Retry:
   * a later compaction already superseded an earlier failure.
   */
  latestCompaction: string | null;
}

/**
 * The task transcript provides this so a failed compaction row can offer "Retry"; a subagent's
 * drill-in view provides none, since only the task itself can be compacted.
 */
export const CompactionRetryContext = createContext<CompactionRetry | null>(null);

export function useCompactionRetry(): CompactionRetry | null {
  return useContext(CompactionRetryContext);
}

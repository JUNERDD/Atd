import { useMemo } from 'react';
import type { Block } from '../../../../electron/agent/transcript-schema';
import { taskProgress, type TaskProgress } from './selectors';

/**
 * Todo step and running subagents of the open task's transcript. Transcript patches replace the
 * block array, so the derivation reruns only when the transcript changed.
 */
export function useTaskProgress(blocks: readonly Block[]): TaskProgress {
  return useMemo(() => taskProgress(blocks), [blocks]);
}

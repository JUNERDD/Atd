import { useMemo, useState } from 'react';
import type { Block } from '../../../client/agent/transcript-schema';
import { sameProgress, taskProgress, type TaskProgress } from './selectors';

/**
 * Todo step and running subagents of the open task's transcript. Transcript patches replace the
 * block array, so the derivation reruns only when the transcript changed, and the progress is
 * held by value: a patch that leaves it as it was keeps the same object, so the pill skips it.
 */
export function useTaskProgress(blocks: readonly Block[]): TaskProgress {
  const next = useMemo(() => taskProgress(blocks), [blocks]);
  const [progress, setProgress] = useState(next);
  if (progress !== next && !sameProgress(progress, next)) setProgress(next);
  return progress;
}

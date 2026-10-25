import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { restoreQueue } from '../composer-editor/restore-queue';
import type { ComposerDrafts } from './use-composer-memory';

/** A native Stop may target any conversation, regardless of the panel's current view. */
export function useWithdrawnQueue(setDrafts: Dispatch<SetStateAction<ComposerDrafts>>) {
  useEffect(
    () =>
      window.desktop?.onTaskQueueWithdrawn?.(({ taskId, unsent }) => {
        if (!unsent.steering.length && !unsent.followUp.length) return;
        setDrafts((previous) => ({
          ...previous,
          [taskId]: restoreQueue(previous[taskId] ?? { text: '', chips: [] }, unsent),
        }));
      }),
    [setDrafts],
  );
}

import { useState } from 'react';
import { emptyContextState, newTaskTitle } from '@atd/agent-contracts';
import type { TaskDetail } from '../../client/agent/bridge';
import type { TaskInput } from '../../client/agent/task-schema';
import { EMPTY_QUEUE } from '../../client/agent/transcript-schema';
import { useTaskDetail } from './use-agent';

/**
 * A new chat the service has not created yet: an empty conversation, named as the service will
 * name it (`newTaskTitle`, or a launched command's `title`), before its first run settles.
 */
function openingDetail(taskId: string, title: string): TaskDetail {
  const now = new Date().toISOString();
  return {
    task: {
      id: taskId,
      title,
      createdAt: now,
      updatedAt: now,
      sessionFile: null,
      runs: [],
      legacy: null,
    },
    artifacts: [],
    requests: [],
    queue: EMPTY_QUEUE,
    context: emptyContextState(),
    revision: 0,
    blocks: [],
  };
}

/**
 * The conversation the page shows (`taskId`): as `useTaskDetail` loads it (`epoch` reloads it),
 * else as the latest send returned it (`accept`) until it loads. A new chat that an optimistic send
 * or command launch opens (`open`) has no task until the service takes its first run, so nothing
 * loads it: until then it shows as `openingDetail`, and `unsaved` tells the controls that act on a
 * task to leave it alone. Leaving it forgets it; a run still on its way creates its task regardless.
 */
export function usePageDetail(taskId: string | null, epoch: number) {
  const [sent, setSent] = useState<TaskDetail | null>(null);
  const [opening, setOpening] = useState<TaskDetail | null>(null);
  const [lastEpoch, setLastEpoch] = useState(epoch);
  if (sent && sent.task.id !== taskId) setSent(null);
  if (opening && opening.task.id !== taskId) setOpening(null);
  if (lastEpoch !== epoch) {
    setLastEpoch(epoch);
    if (sent) setSent(null);
  }
  const { detail } = useTaskDetail(opening ? null : taskId, epoch, sent);
  return {
    detail: opening ?? detail,
    unsaved: opening !== null,
    open: (id: string, input: TaskInput, title?: string) =>
      setOpening(openingDetail(id, title || newTaskTitle(input, ''))),
    accept: (accepted: TaskDetail) => {
      setOpening(null);
      setSent(accepted);
    },
  };
}

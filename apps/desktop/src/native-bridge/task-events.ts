import { Type } from 'typebox';

const TaskId = Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' });

/** Task actions the shell delivers to the panel, including while its document is loading. */
export const NativeTaskEvents = {
  'task.open': Type.Object({ taskId: TaskId }, { additionalProperties: false }),
  /** The exact messages native Stop withdrew; restore them to this task's own draft. */
  'task.queueWithdrawn': Type.Object(
    {
      taskId: TaskId,
      runId: TaskId,
      unsent: Type.Object(
        { steering: Type.Array(Type.String()), followUp: Type.Array(Type.String()) },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
};

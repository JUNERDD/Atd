import { Type } from 'typebox';
import { Compile } from 'typebox/compile';
import {
  TODO_ACTIVE_FORM_MAX_LENGTH,
  TODO_BLOCKED_BY_MAX_ITEMS,
  TODO_DETAILS_MAX_ITEMS,
  TODO_SUBJECT_MAX_LENGTH,
  TodoStatusSchema,
  type TodoDetails,
  type TodoItem,
} from '@atd/agent-contracts';
import { createClamp } from './clamp.js';

/**
 * rpiv-todo `TaskDetails` (tool/types.ts): the replay snapshot every successful `todo` call
 * returns. Only `tasks` is read; `error` marks a failed reducer op, which has no list to show.
 */
const RawTodoDetailsValidator = Compile(
  Type.Object({
    tasks: Type.Array(Type.Unknown()),
    error: Type.Optional(Type.Unknown()),
  }),
);

/** rpiv-todo `Task`; `description`, `owner`, and `metadata` stay in the session. */
const RawTaskValidator = Compile(
  Type.Object({
    id: Type.Integer({ minimum: 0 }),
    subject: Type.String(),
    status: TodoStatusSchema,
    activeForm: Type.Optional(Type.String()),
    blockedBy: Type.Optional(Type.Array(Type.Unknown())),
  }),
);

/** Over the item cap, deleted tombstones go first, then the highest ids. */
function keepOrder(a: TodoItem, b: TodoItem): number {
  const deleted = Number(a.status === 'deleted') - Number(b.status === 'deleted');
  return deleted || a.id - b.id;
}

export function projectTodoDetails(raw: unknown): TodoDetails | undefined {
  if (!RawTodoDetailsValidator.Check(raw) || raw.error !== undefined) return undefined;
  const clamp = createClamp();
  const items: TodoItem[] = [];
  for (const task of raw.tasks) {
    if (!RawTaskValidator.Check(task)) {
      clamp.drop();
      continue;
    }
    const blockedBy = (task.blockedBy ?? []).filter(
      (id): id is number => typeof id === 'number' && Number.isInteger(id) && id >= 0,
    );
    if (blockedBy.length !== (task.blockedBy?.length ?? 0)) clamp.drop();
    items.push({
      id: task.id,
      subject: clamp.text(task.subject, TODO_SUBJECT_MAX_LENGTH),
      status: task.status,
      ...(task.activeForm !== undefined
        ? { activeForm: clamp.text(task.activeForm, TODO_ACTIVE_FORM_MAX_LENGTH) }
        : {}),
      blockedBy: clamp.list(blockedBy, TODO_BLOCKED_BY_MAX_ITEMS),
    });
  }
  const kept = clamp.list(items.sort(keepOrder), TODO_DETAILS_MAX_ITEMS);
  return {
    type: 'todo',
    tasks: kept.sort((a, b) => a.id - b.id),
    truncated: clamp.truncated,
  };
}

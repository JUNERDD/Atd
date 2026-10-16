import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/**
 * Task notices: what the service wants the person to hear about a task they started while they
 * may not be looking at it. Like automation notices, the shell pulls them after a `taskNotices`
 * invalidation (shell-only routes), decides from its own presence and preferences whether to post
 * a system notification, and acknowledges every notice it read, so each is handled once however
 * many windows are open. Automation tasks never get one: their automation's notices cover them.
 */

/** Pending notices the service keeps; older unacknowledged ones are dropped. */
export const MAX_TASK_NOTICES = 50;
/** The most suggested answers a `needsInput` notice carries (a question offers up to 8). */
export const MAX_TASK_NOTICE_OPTIONS = 8;

/**
 * `needsInput`: the agent asked a question nobody has answered for a few seconds.
 * `needsConfirmation`: the agent waits for approval of a guarded action.
 * `completed`: a run that took a while finished. `failed`: a run failed.
 * `resolved`: a request a `needs*` notice the shell already read was answered or withdrawn
 * elsewhere, so the shell takes back what it showed for it; it never notifies.
 */
export const TaskNoticeKindSchema = Type.Union([
  Type.Literal('needsInput'),
  Type.Literal('needsConfirmation'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('resolved'),
]);
export type TaskNoticeKind = Static<typeof TaskNoticeKindSchema>;

/** The pending request a `needs*` notice is about, so a reply from the notification can name it. */
export const TaskNoticeRequestSchema = Type.Object(
  { id: Identifier, revision: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type TaskNoticeRequest = Static<typeof TaskNoticeRequestSchema>;

export const TaskNoticeSchema = Type.Object(
  {
    id: Identifier,
    kind: TaskNoticeKindSchema,
    taskId: Identifier,
    /** The task's title when the notice was made; user data, never translated, may be empty. */
    taskTitle: Type.String({ maxLength: 200 }),
    /** Set on `needsInput`, `needsConfirmation` and `resolved`. */
    request: Type.Optional(TaskNoticeRequestSchema),
    /**
     * Runtime text the shell shows only when the person allows message previews: the question,
     * the action awaiting approval, the opening of the answer, or the error. Not translated.
     */
    preview: Type.Optional(Type.String({ maxLength: 500 })),
    /**
     * `needsInput`: the answers the agent suggested, which the notification offers as actions
     * while previews are on. Runtime text.
     */
    options: Type.Optional(
      Type.Array(Type.String({ maxLength: 500 }), { maxItems: MAX_TASK_NOTICE_OPTIONS }),
    ),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);
export type TaskNotice = Static<typeof TaskNoticeSchema>;

/** GET `/v1/task-notices` (shell only): unacknowledged notices, oldest first. */
export const TaskNoticesResponseSchema = Type.Object(
  { notices: Type.Array(TaskNoticeSchema, { maxItems: MAX_TASK_NOTICES }) },
  { additionalProperties: false },
);
export type TaskNoticesResponse = Static<typeof TaskNoticesResponseSchema>;

/** POST `/v1/task-notices/ack` (shell only): the notices it read. Unknown ids are ignored. */
export const AckTaskNoticesRequestSchema = Type.Object(
  { ids: Type.Array(Identifier, { minItems: 1, maxItems: MAX_TASK_NOTICES }) },
  { additionalProperties: false },
);
export type AckTaskNoticesRequest = Static<typeof AckTaskNoticesRequestSchema>;

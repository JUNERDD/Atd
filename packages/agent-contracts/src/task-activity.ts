import { Type, type Static } from 'typebox';
import { ComputerActivitySchema } from './computer-activity.js';
import { ComputerHostStateSchema } from './computer-http.js';
import { Identifier } from './identifiers.js';
import { RunStatusSchema } from './task.js';

/** Recent terminal results stay visible briefly; subscriptions never renew their lifetime. */
export const TASK_ACTIVITY_TERMINAL_MS = 60_000;
export const TASK_ACTIVITY_MAX_TERMINAL = 20;
/** A waiting question's suggested answers, as many as a notification offers. */
export const TASK_ACTIVITY_MAX_OPTIONS = 8;

/**
 * Who started the task: the person in a conversation, a saved command, an automation, or a user
 * app's backend (`TaskOriginSchema`, `RunSnapshot.fromCommand`).
 */
export const TaskActivitySourceSchema = Type.Union([
  Type.Literal('conversation'),
  Type.Literal('command'),
  Type.Literal('automation'),
  Type.Literal('app'),
]);
export type TaskActivitySource = Static<typeof TaskActivitySourceSchema>;

/**
 * What an active run is doing now, from its live transcript: a streaming thought or reply, or the
 * kind of tool call in flight. A closed set, so no tool name, argument or text leaves the service.
 */
export const TaskActivityStepSchema = Type.Union([
  Type.Literal('thinking'),
  Type.Literal('responding'),
  Type.Literal('command'),
  Type.Literal('reading'),
  Type.Literal('editing'),
  Type.Literal('tool'),
]);
export type TaskActivityStep = Static<typeof TaskActivityStepSchema>;

/** A request's text the card shows in full; longer details are cut and marked `detailClipped`. */
export const TASK_ACTIVITY_DETAIL_CHARS = 20_000;
/** Pending requests listed per task; the oldest come first. */
export const TASK_ACTIVITY_MAX_REQUESTS = 16;

/**
 * What an approval would allow (`GrantScopeSchema`), reduced to what the card names and decides
 * on: a file tool and whether the path is inside the task folder, another guarded tool, or computer
 * access with the target as the person recognizes it and how long the access lasts.
 */
export const TaskActivityGrantSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('file'),
      tool: Type.Union([Type.Literal('read'), Type.Literal('write'), Type.Literal('edit')]),
      location: Type.Union([Type.Literal('inside'), Type.Literal('outside')]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('tool'),
      tool: Type.Union([
        Type.Literal('bash'),
        Type.Literal('command'),
        Type.Literal('mcp'),
        Type.Literal('web'),
        Type.Literal('app'),
        Type.Literal('automation'),
        Type.Literal('computer'),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('computerAccess'),
      targetKind: Type.Union([Type.Literal('browser'), Type.Literal('application')]),
      targetLabel: Type.String({ maxLength: 256 }),
      /** A website's allowed origins; empty for an application. */
      origins: Type.Array(Type.String({ maxLength: 2048 }), { maxItems: 32 }),
      persistence: Type.Union([Type.Literal('run'), Type.Literal('saved')]),
    },
    { additionalProperties: false },
  ),
]);
export type TaskActivityGrant = Static<typeof TaskActivityGrantSchema>;

/**
 * One pending request (`PermissionRequestSchema`) as the card decides it. `revision` keeps a stale
 * answer from answering a newer request. `subagent` names the subagent that asked, absent for the
 * task's own. An approval carries what the conversation's approval shows: the scope, the service's
 * title, the detail (cut at `TASK_ACTIVITY_DETAIL_CHARS`), a bash command's suggested allowlist
 * entry and the auto tier's review. A question carries its suggested answers; `viewCallId` marks
 * one a `show_ui` view waits on, answered in that view's window (`ViewOpenParams.callId`).
 */
export const TaskActivityRequestSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('confirmation'),
      requestId: Identifier,
      revision: Type.Integer({ minimum: 1 }),
      createdAt: Type.String(),
      subagent: Type.Optional(Type.String({ maxLength: 1024 })),
      scope: TaskActivityGrantSchema,
      title: Type.String({ maxLength: 500 }),
      detail: Type.String({ maxLength: TASK_ACTIVITY_DETAIL_CHARS }),
      detailClipped: Type.Boolean(),
      allowlistEntry: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
      review: Type.Optional(
        Type.Object(
          {
            outcome: Type.Union([Type.Literal('flagged'), Type.Literal('unavailable')]),
            /** The reviewer's reason in the person's language; empty when it gave none. */
            reason: Type.String({ maxLength: 500 }),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('input'),
      requestId: Identifier,
      revision: Type.Integer({ minimum: 1 }),
      createdAt: Type.String(),
      subagent: Type.Optional(Type.String({ maxLength: 1024 })),
      title: Type.String({ maxLength: 4000 }),
      options: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), {
        maxItems: TASK_ACTIVITY_MAX_OPTIONS,
      }),
      viewCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    },
    { additionalProperties: false },
  ),
]);
export type TaskActivityRequest = Static<typeof TaskActivityRequestSchema>;

/**
 * One root task's latest run, listed once it was seen active in this service epoch: subagent work
 * belongs to its root, and a task's next run replaces its previous row.
 */
export const TaskActivityRunSchema = Type.Object(
  {
    taskId: Identifier,
    runId: Identifier,
    title: Type.String({ maxLength: 1024 }),
    source: TaskActivitySourceSchema,
    /** The run's model provider (`ServiceModel.provider`), which names the brand mark it shows. */
    provider: Type.String({ minLength: 1, maxLength: 256 }),
    status: RunStatusSchema,
    startedAt: Type.String(),
    updatedAt: Type.String(),
    terminalAt: Type.Optional(Type.String()),
    /**
     * Every pending request of the task and its subagents while the run is active, oldest first,
     * with what the card needs to decide each in place (`POST /v1/confirms`). Empty when none.
     */
    requests: Type.Array(TaskActivityRequestSchema, { maxItems: TASK_ACTIVITY_MAX_REQUESTS }),
    /** Absent between steps, and once the run ended. */
    step: Type.Optional(TaskActivityStepSchema),
    /** Present once the run called the computer tool. */
    computer: Type.Optional(ComputerActivitySchema),
  },
  { additionalProperties: false },
);
export type TaskActivityRun = Static<typeof TaskActivityRunSchema>;

/**
 * Authoritative current/recent task activity, including an empty list. Rows keep first-seen
 * order. Revision orders display changes within the service epoch; restart begins with no rows.
 * `hostState` is the computer host's, which only rows with `computer` depend on; preview
 * availability belongs to the host's exact task/run source metadata, not this snapshot.
 */
export const TaskActivitySnapshotSchema = Type.Object(
  {
    serviceId: Identifier,
    epoch: Type.Integer({ minimum: 0 }),
    revision: Type.Integer({ minimum: 0 }),
    hostState: ComputerHostStateSchema,
    runs: Type.Array(TaskActivityRunSchema),
  },
  { additionalProperties: false },
);
export type TaskActivitySnapshot = Static<typeof TaskActivitySnapshotSchema>;

export const TaskActivityFrameSchema = Type.Object(
  { type: Type.Literal('task.activity'), snapshot: TaskActivitySnapshotSchema },
  { additionalProperties: false },
);
export type TaskActivityFrame = Static<typeof TaskActivityFrameSchema>;

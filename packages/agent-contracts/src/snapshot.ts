import { Type, type Static } from 'typebox';
import { Identifier, SessionEntryId } from './identifiers.js';
import {
  CapabilityRequestSchema,
  GrantScopeSchema,
  PermissionOutcomeSchema,
  PermissionRequestSchema,
} from './confirms.js';
import { AgentTaskSchema } from './task.js';
import { ToolBlockDetailsSchema } from './tool-details.js';

/**
 * T1 transcript block subset. Field names match the desktop Block shape so T6
 * can converge the two projections without renaming; T1 omits usage/diff
 * details that the service ledger does not need.
 */
const blockBase = {
  id: Type.String({ maxLength: 256 }),
  runId: Identifier,
  timestamp: Type.Number(),
  endedAt: Type.Number(),
};

/**
 * Provider-reported usage of the assistant message a block came from. Every block projected from
 * one message carries the same copy, so clients dedupe by message (`timestamp`) when summing a
 * turn. `cost` is the total in USD at the model's catalog price, 0 when the catalog has none.
 * Absent while the message streams and on messages without usage.
 */
export const MessageUsageSchema = Type.Object(
  {
    input: Type.Integer({ minimum: 0 }),
    output: Type.Integer({ minimum: 0 }),
    cacheRead: Type.Integer({ minimum: 0 }),
    cacheWrite: Type.Integer({ minimum: 0 }),
    cost: Type.Number({ minimum: 0 }),
    /**
     * How long the provider spent generating `output`, as the service timed the stream (its
     * generation.ts): the token rate divides by it. Absent when the stream could not be timed,
     * including messages that failed or stopped and sessions from before it was measured.
     */
    durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type MessageUsage = Static<typeof MessageUsageSchema>;
/** What every block of one assistant message carries alike. */
const messageFields = {
  usage: Type.Optional(MessageUsageSchema),
  /**
   * While the message streams: when its first output (text, thinking or a tool call) arrived, in
   * epoch ms, so a client can time the live token rate. Absent before that and once it settled.
   */
  firstTokenAt: Type.Optional(Type.Number()),
};

export const ServiceToolStatusSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('declined'),
  Type.Literal('interrupted'),
]);
export type ServiceToolStatus = Static<typeof ServiceToolStatusSchema>;

export const ServiceBlockSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('user'),
      ...blockBase,
      text: Type.String(),
      /**
       * Set on the run's prompt: the first user message after its `app-invocation`. Clients render
       * a prompt from the run snapshot's input (text plus chips); queued follow-ups stay text.
       */
      prompt: Type.Optional(Type.Literal(true)),
      /**
       * The message's Pi session entry: edit, regenerate and fork address the turn by it. Absent
       * only for a message not yet persisted.
       */
      entryId: Type.Optional(SessionEntryId),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('assistant'),
      ...blockBase,
      text: Type.String(),
      streaming: Type.Boolean(),
      stopReason: Type.Union([
        Type.Literal('stop'),
        Type.Literal('length'),
        Type.Literal('error'),
        Type.Literal('aborted'),
        Type.Null(),
      ]),
      error: Type.String(),
      ...messageFields,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('thinking'),
      ...blockBase,
      text: Type.String(),
      streaming: Type.Boolean(),
      redacted: Type.Boolean(),
      ...messageFields,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('tool'),
      ...blockBase,
      callId: Type.String({ maxLength: 256 }),
      name: Type.String({ maxLength: 128 }),
      args: Type.Record(Type.String(), Type.Unknown()),
      status: ServiceToolStatusSchema,
      output: Type.String(),
      partial: Type.String(),
      permission: Type.Union([
        Type.Object(
          {
            scope: GrantScopeSchema,
            outcome: Type.Union([PermissionOutcomeSchema, Type.Null()]),
          },
          { additionalProperties: false },
        ),
        Type.Null(),
      ]),
      /** C1 additive: whitelisted per-tool result facts (tool-details.ts). */
      details: Type.Optional(ToolBlockDetailsSchema),
      ...messageFields,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('question'),
      ...blockBase,
      callId: Type.String({ maxLength: 256 }),
      title: Type.String(),
      options: Type.Array(Type.String()),
      status: ServiceToolStatusSchema,
      answer: Type.Union([Type.String(), Type.Null()]),
      skipped: Type.Boolean(),
      ...messageFields,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('system'),
      ...blockBase,
      level: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')]),
      text: Type.String(),
    },
    { additionalProperties: false },
  ),
  /**
   * One context compaction. `running` is live only; `completed` comes from Pi's persisted
   * compaction entry and `failed` from a service session entry, so both survive a reload.
   */
  Type.Object(
    {
      kind: Type.Literal('compaction'),
      ...blockBase,
      status: Type.Union([
        Type.Literal('running'),
        Type.Literal('completed'),
        Type.Literal('failed'),
      ]),
      /** `manual` is a user request, `threshold` the automatic trigger, `overflow` a context overflow. */
      reason: Type.Union([
        Type.Literal('manual'),
        Type.Literal('threshold'),
        Type.Literal('overflow'),
      ]),
      /** Markdown summary; empty unless `completed`. */
      summary: Type.String(),
      /** Context tokens before and after, null when unknown. */
      tokensBefore: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      tokensAfter: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      /** Why a `failed` compaction failed; empty otherwise. */
      error: Type.String(),
    },
    { additionalProperties: false },
  ),
  /**
   * A failed model request Pi is retrying. Live only: it shows from the failure until the retry
   * gets a response or the retries end, and never survives a reload.
   */
  Type.Object(
    {
      kind: Type.Literal('retry'),
      ...blockBase,
      /** This retry's number, from 1, and how many the run may make. */
      attempt: Type.Integer({ minimum: 1 }),
      maxAttempts: Type.Integer({ minimum: 1 }),
      /** The provider error that failed the previous attempt. */
      error: Type.String(),
    },
    { additionalProperties: false },
  ),
]);
export type ServiceBlock = Static<typeof ServiceBlockSchema>;

export const QueueStateSchema = Type.Object(
  {
    steering: Type.Array(Type.String()),
    followUp: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
export type QueueState = Static<typeof QueueStateSchema>;

/**
 * A task's context usage, also the data of `context.update` events. `contextWindow` is the
 * effective window of the task's latest run; `tokens` and `percent` (of that window, may exceed
 * 100) are null while unknown, such as right after a compaction.
 */
export const TaskContextStateSchema = Type.Object(
  {
    contextWindow: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    tokens: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    percent: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    /** Compactions the task's session has completed. */
    compactions: Type.Integer({ minimum: 0 }),
    compacting: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type TaskContextState = Static<typeof TaskContextStateSchema>;

/** Context state of a task with no usage known yet. */
export function emptyContextState(): TaskContextState {
  return { contextWindow: null, tokens: null, percent: null, compactions: 0, compacting: false };
}

/** What a task summary carries; the full snapshot extends it with the task's session. */
const taskSummaryFields = {
  task: AgentTaskSchema,
  requests: Type.Array(PermissionRequestSchema),
  capabilities: Type.Array(CapabilityRequestSchema),
  queue: QueueStateSchema,
};

/**
 * A task without its transcript and context usage: the ledger task, pending confirms and
 * capabilities, and the live queue. The service builds it from memory without reading the task's
 * session, so a client can list every task and load transcripts only for the tasks it shows.
 */
export const TaskSummarySchema = Type.Object(taskSummaryFields, { additionalProperties: false });
export type TaskSummary = Static<typeof TaskSummarySchema>;

/** Full task state returned after a gap or restart instead of replaying events. */
export const TaskSnapshotSchema = Type.Object(
  {
    ...taskSummaryFields,
    revision: Type.Integer({ minimum: 0 }),
    blocks: Type.Array(ServiceBlockSchema),
    context: TaskContextStateSchema,
    epoch: Type.Integer({ minimum: 0 }),
    seq: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type TaskSnapshot = Static<typeof TaskSnapshotSchema>;

/**
 * Answer to a subscribe without `taskIds` that cannot be replayed: every task the service holds,
 * as of `(epoch, seq)`. It is the authoritative task set, so a client drops cached tasks it does
 * not list; transcripts load on demand through the task snapshot endpoint.
 */
export const SummariesFrameSchema = Type.Object(
  {
    type: Type.Literal('summaries'),
    epoch: Type.Integer({ minimum: 0 }),
    seq: Type.Integer({ minimum: 0 }),
    tasks: Type.Array(TaskSummarySchema),
  },
  { additionalProperties: false },
);
export type SummariesFrame = Static<typeof SummariesFrameSchema>;

/**
 * Client subscription: replay from (epoch, seq). When that is stale, a subscription naming
 * `taskIds` gets one `snapshot` frame per task, and one without gets a single `summaries` frame.
 * `status: true` also asks for `status` frames: one at once, then one whenever the counts change.
 */
export const SubscribeSchema = Type.Object(
  {
    epoch: Type.Integer({ minimum: 0 }),
    seq: Type.Integer({ minimum: 0 }),
    taskIds: Type.Optional(Type.Array(Identifier, { maxItems: 100 })),
    status: Type.Optional(Type.Literal(true)),
  },
  { additionalProperties: false },
);
export type Subscribe = Static<typeof SubscribeSchema>;

/**
 * Root-task counts for a status indicator such as the menu bar. A root task counts once, and a
 * subagent's work counts toward its root. `attention` counts tasks waiting for the user (a pending
 * request, or a latest run awaiting input or confirmation) and wins over `running`, which counts
 * the other tasks whose latest run is queued, running or stopping. Sent only to connections that
 * subscribed with `status: true`: on each subscribe, then only when a count changed.
 */
export const StatusFrameSchema = Type.Object(
  {
    type: Type.Literal('status'),
    running: Type.Integer({ minimum: 0 }),
    attention: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type StatusFrame = Static<typeof StatusFrameSchema>;

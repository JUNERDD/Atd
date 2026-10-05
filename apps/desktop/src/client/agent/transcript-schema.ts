import { Type, type Static } from 'typebox';
import { SessionEntryId, ToolBlockDetailsSchema } from '@atd/agent-contracts';
import { Identifier } from './command-schema';
import { GrantScopeSchema, PermissionOutcomeSchema } from './permission-schema';

/**
 * The canonical transcript is a flat, append-only list of blocks owned by the main process. The
 * worker projects it from the Pi session (live `AgentSession.subscribe` events and, on reopen, the
 * session JSONL) with one projection so the two paths cannot diverge. The renderer derives turns
 * and folds activity from this list and never assembles Pi messages itself.
 *
 * Block ids are stable across live and cold projection: `u:<timestamp>:<n>` for user messages,
 * `a:<timestamp>:<index>` / `t:<timestamp>:<index>` for assistant text and thinking content items,
 * `tool:<callId>` and `q:<callId>` for tool calls, `s:<timestamp>:<n>` for system notes; compaction
 * ids are the service's.
 */
const blockBase = {
  id: Type.String({ maxLength: 256 }),
  runId: Identifier,
  /** Pi message timestamp in milliseconds; blocks appear in non-decreasing order. */
  timestamp: Type.Number(),
  /**
   * Wall-clock completion of this block's content in milliseconds. Pi stamps assistant messages
   * at creation, so `timestamp` alone cannot end a turn; `endedAt` carries the session entry
   * time (message end, tool result time) instead. The renderer takes the max as the turn end.
   */
  endedAt: Type.Number(),
};

export const ToolStatusSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  /** The user declined the permission; the tool result carries the decline error for the model. */
  Type.Literal('declined'),
  /** The run ended (abort, crash, app quit) before a result was recorded. */
  Type.Literal('interrupted'),
]);
export type ToolStatus = Static<typeof ToolStatusSchema>;

/**
 * Renderable facts from Pi's `ToolResultMessage.details`, normalized across tools. The service
 * projects and bounds them (`ServiceBlock` tool `details`); the main process revalidates them.
 */
export const ToolDetailsSchema = Type.Object(
  {
    /**
     * Pi's display diff for a completed `edit` (`+<n> text` / `-<n> text` / ` <n> text` lines,
     * no file or hunk headers); empty otherwise.
     */
    diff: Type.String({ maxLength: 200000 }),
    /** The service shortened `diff` to its bound. */
    truncated: Type.Boolean(),
    /** Full output file when Pi truncated shell output; empty otherwise. */
    fullOutputPath: Type.String({ maxLength: 4096 }),
    /**
     * Structured result of a completed `todo`, `web_search`, or `fetch_content` call,
     * discriminated by `type`; each variant carries its own `truncated`. Absent for every other
     * tool, while running, and on failure, except the launching `subagent` call, whose child
     * summaries are present in every state, and a `codemode` call, whose script's tool calls
     * (`steps`) are too. The edit diff is never duplicated here.
     */
    data: Type.Optional(ToolBlockDetailsSchema),
  },
  { additionalProperties: false },
);
export type ToolDetails = Static<typeof ToolDetailsSchema>;

/**
 * Provider-reported usage of one assistant message. The service sends `input`, `output`, both
 * cache counts and `cost` (USD at the model's catalog price, 0 when the catalog has none); the
 * turn header sums them for its usage detail. `durationMs` is the generation time the service
 * timed from the stream, which the token rate divides `output` by; messages without it stay out
 * of the rate. Absent while streaming and when unknown. Every block derived from the same message
 * carries the same copy so tool-only messages keep their usage; the renderer dedupes by message
 * when summing a turn.
 */
export const AssistantUsageSchema = Type.Object(
  {
    output: Type.Integer({ minimum: 0 }),
    input: Type.Optional(Type.Integer({ minimum: 0 })),
    cacheRead: Type.Optional(Type.Integer({ minimum: 0 })),
    cacheWrite: Type.Optional(Type.Integer({ minimum: 0 })),
    cost: Type.Optional(Type.Number({ minimum: 0 })),
    durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type AssistantUsage = Static<typeof AssistantUsageSchema>;

/** What every block of one assistant message carries alike. */
const messageFields = {
  usage: Type.Optional(AssistantUsageSchema),
  /**
   * While the message streams: when its first output arrived (epoch ms), from which the live
   * token rate times its estimate. Absent before that and once the message settled.
   */
  firstTokenAt: Type.Optional(Type.Number()),
};

/** Permission state of a guarded tool call, from the `app-permission` record once resolved. */
export const ToolPermissionSchema = Type.Object(
  {
    scope: GrantScopeSchema,
    /** `null` while the main process still holds a pending request for this call. */
    outcome: Type.Union([PermissionOutcomeSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ToolPermission = Static<typeof ToolPermissionSchema>;

export const BlockSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('user'),
      ...blockBase,
      text: Type.String(),
      /**
       * The run's prompt (first user message after its invocation). The renderer draws it from the
       * run snapshot's input, chips included; queued follow-ups stay plain text.
       */
      prompt: Type.Optional(Type.Literal(true)),
      /**
       * The message's Pi session entry: edit, regenerate and fork address the turn by it. Absent
       * while the message is not persisted yet.
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
      /** Pi stop reason once the message completed; `null` while streaming. */
      stopReason: Type.Union([
        Type.Literal('stop'),
        Type.Literal('length'),
        Type.Literal('error'),
        Type.Literal('aborted'),
        Type.Null(),
      ]),
      /** Provider error text when `stopReason` is `error`; empty otherwise. */
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
      /** Redacted reasoning has no readable text; the renderer shows a placeholder. */
      redacted: Type.Boolean(),
      /** Wall-clock reasoning time in ms, measured live; null on cold projection or when untimed. */
      durationMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      ...messageFields,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('tool'),
      ...blockBase,
      callId: Type.String({ maxLength: 256 }),
      /** Pi tool name: read, write, edit, bash, command, memory_* … */
      name: Type.String({ maxLength: 128 }),
      /** The parsed tool arguments as the model produced them. */
      args: Type.Record(Type.String(), Type.Unknown()),
      status: ToolStatusSchema,
      /** Text of the final tool result (error text when failed or declined). */
      output: Type.String(),
      /** Live output streamed through `tool_execution_update`; empty once the result arrives. */
      partial: Type.String(),
      details: ToolDetailsSchema,
      /** `null` for tools that never pass through the permission gate (memory tools). */
      permission: Type.Union([ToolPermissionSchema, Type.Null()]),
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
      status: ToolStatusSchema,
      /** The user's answer from the `app-question` record; `null` while pending or when skipped. */
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
   * One context compaction, mirrored from the service block. `running` is live only; `completed`
   * and `failed` survive a reload. Provider history before it was summarized, so a turn holding
   * one hides its settled token rate.
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
      tokensBefore: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      tokensAfter: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      /** Why a `failed` compaction failed; empty otherwise. */
      error: Type.String(),
    },
    { additionalProperties: false },
  ),
  /** A failed model request the service is retrying, mirrored from the service block; live only. */
  Type.Object(
    {
      kind: Type.Literal('retry'),
      ...blockBase,
      attempt: Type.Integer({ minimum: 1 }),
      maxAttempts: Type.Integer({ minimum: 1 }),
      /** The provider error that failed the previous attempt. */
      error: Type.String(),
    },
    { additionalProperties: false },
  ),
]);
export type Block = Static<typeof BlockSchema>;
export type BlockOf<K extends Block['kind']> = Extract<Block, { kind: K }>;

/**
 * One publication of the transcript. `snapshot` carries the whole document and resets the
 * consumer; otherwise `blocks` holds changed blocks in document order (existing ids replace in
 * place, new ids append) and `removed` lists ids that left the document. Revisions increase by one
 * per publication of a task; a consumer that observes a gap must request a fresh snapshot.
 */
export const TranscriptPatchSchema = Type.Object(
  {
    taskId: Identifier,
    revision: Type.Integer({ minimum: 0 }),
    snapshot: Type.Boolean(),
    blocks: Type.Array(BlockSchema),
    removed: Type.Array(Type.String({ maxLength: 256 })),
  },
  { additionalProperties: false },
);
export type TranscriptPatch = Static<typeof TranscriptPatchSchema>;

/** `<toolCallId>:<seq>` from the parent `subagent` block's details. */
export const ChildKeySchema = Type.String({ minLength: 1, maxLength: 512 });

/**
 * One child session's transcript patch, forwarded only while the renderer holds a subscription
 * for `(taskId, childKey)`. Same rules as `TranscriptPatch`, so `applyTranscriptPatch` applies it;
 * `revision` counts per child.
 */
export const ChildTranscriptPatchSchema = Type.Object(
  {
    taskId: Identifier,
    childKey: ChildKeySchema,
    revision: Type.Integer({ minimum: 0 }),
    snapshot: Type.Boolean(),
    blocks: Type.Array(BlockSchema),
    removed: Type.Array(Type.String({ maxLength: 256 })),
  },
  { additionalProperties: false },
);
export type ChildTranscriptPatch = Static<typeof ChildTranscriptPatchSchema>;

/** Pi's pending mid-run messages as reported by `queue_update`. */
export const QueueStateSchema = Type.Object(
  {
    steering: Type.Array(Type.String()),
    followUp: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
export type QueueState = Static<typeof QueueStateSchema>;
export const EMPTY_QUEUE: QueueState = { steering: [], followUp: [] };

/** Applies a patch to a block list; returns `null` when the patch does not follow `revision`. */
export function applyTranscriptPatch(
  current: { revision: number; blocks: Block[] },
  patch: TranscriptPatch,
): { revision: number; blocks: Block[] } | null {
  if (patch.snapshot) return { revision: patch.revision, blocks: patch.blocks };
  if (patch.revision !== current.revision + 1) return null;
  const removed = new Set(patch.removed);
  const next = current.blocks.filter((block) => !removed.has(block.id));
  const index = new Map(next.map((block, position) => [block.id, position]));
  for (const block of patch.blocks) {
    const position = index.get(block.id);
    if (position === undefined) {
      index.set(block.id, next.length);
      next.push(block);
    } else next[position] = block;
  }
  return { revision: patch.revision, blocks: next };
}

import { Type, type Static } from 'typebox';
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
 * `tool:<callId>` and `q:<callId>` for tool calls, `s:<timestamp>:<n>` for system notes.
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

/** Renderable facts from Pi's `ToolResultMessage.details`, normalized across built-in tools. */
export const ToolDetailsSchema = Type.Object(
  {
    /** Unified diff for `edit`; empty otherwise. */
    diff: Type.String({ maxLength: 200000 }),
    truncated: Type.Boolean(),
    /** Full output file when Pi truncated shell output; empty otherwise. */
    fullOutputPath: Type.String({ maxLength: 4096 }),
  },
  { additionalProperties: false },
);
export type ToolDetails = Static<typeof ToolDetailsSchema>;

/**
 * Provider-reported generated tokens for one assistant message, plus the worker-measured
 * generation time from `message_start` to `message_end`. Absent while streaming and when
 * unknown (after compaction, or on blocks projected before usage plumbing). Every block derived
 * from the same message carries the same copy so tool-only messages keep their usage; the
 * renderer dedupes by timestamp when summing a turn. This is a rate input, never billed usage.
 * `durationMs` is absent on records written before duration capture; those turns hide the rate
 * instead of dividing by wall time.
 */
export const AssistantUsageSchema = Type.Object(
  {
    output: Type.Integer({ minimum: 0 }),
    durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type AssistantUsage = Static<typeof AssistantUsageSchema>;

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
      usage: Type.Optional(AssistantUsageSchema),
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
      usage: Type.Optional(AssistantUsageSchema),
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
      usage: Type.Optional(AssistantUsageSchema),
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
      usage: Type.Optional(AssistantUsageSchema),
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

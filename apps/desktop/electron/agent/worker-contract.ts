import { Type, type Static } from 'typebox';
import { Identifier } from './command-schema';
import { InputSchema, RunSchema } from './task-schema';
import { MemoryEntrySchema } from './bridge';
import { NativeRequestSchema } from './native-schema';
import {
  GrantScopeSchema,
  PermissionRecordSchema,
  PermissionRequestSchema,
} from './permission-schema';
import { BlockSchema, QueueStateSchema, TranscriptPatchSchema } from './transcript-schema';

/** The user's reply to an `ask_user` question, delivered to the blocked tool call. */
export const QuestionAnswerSchema = Type.Union([
  Type.Object({ answer: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  Type.Object({ skipped: Type.Literal(true) }, { additionalProperties: false }),
]);
export type QuestionAnswer = Static<typeof QuestionAnswerSchema>;

/**
 * Result of the `transcript` request: the projected document plus the session grants recovered
 * from `app-permission` records, so the main process can seed its grant set after a restart.
 */
export const TranscriptSnapshotSchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 0 }),
    blocks: Type.Array(BlockSchema),
    grants: Type.Array(GrantScopeSchema),
  },
  { additionalProperties: false },
);
export type TranscriptSnapshot = Static<typeof TranscriptSnapshotSchema>;

export const WorkerRequestSchema = Type.Union([
  Type.Object({ action: Type.Literal('initialize'), root: Type.String(), paused: Type.Boolean() }),
  Type.Object({
    action: Type.Literal('run'),
    taskId: Identifier,
    run: RunSchema,
    sessionFile: Type.Union([Type.String(), Type.Null()]),
    attachments: Type.Array(
      Type.Object({ path: Type.String(), text: Type.String(), name: Type.String() }),
    ),
  }),
  /** Current document of a live session, or a cold projection of `sessionFile`. */
  Type.Object({
    action: Type.Literal('transcript'),
    taskId: Identifier,
    sessionFile: Type.Union([Type.String(), Type.Null()]),
  }),
  Type.Object({ action: Type.Literal('stop'), runId: Identifier }),
  Type.Object({
    action: Type.Literal('answer'),
    requestId: Identifier,
    answer: QuestionAnswerSchema,
  }),
  /** Appends a permission decision to the task's session and republishes the affected block. */
  Type.Object({
    action: Type.Literal('record'),
    taskId: Identifier,
    record: PermissionRecordSchema,
  }),
  Type.Object({
    action: Type.Literal('queue'),
    taskId: Identifier,
    text: Type.String({ minLength: 1 }),
    mode: Type.Union([Type.Literal('followUp'), Type.Literal('steer')]),
  }),
  Type.Object({
    action: Type.Literal('replaceQueue'),
    taskId: Identifier,
    followUp: Type.Array(Type.String({ minLength: 1 })),
  }),
  Type.Object({ action: Type.Literal('memory') }),
  Type.Object({ action: Type.Literal('pause'), paused: Type.Boolean() }),
  Type.Object({
    action: Type.Literal('memoryUpdate'),
    entry: MemoryEntrySchema,
    content: Type.String(),
  }),
  Type.Object({ action: Type.Literal('forget'), taskId: Identifier }),
  Type.Object({ action: Type.Literal('shutdown') }),
]);
export type WorkerRequest = Static<typeof WorkerRequestSchema>;
export type WorkerRun = Extract<WorkerRequest, { action: 'run' }>;
export const WorkerInboundSchema = Type.Union([
  Type.Object({ type: Type.Literal('request'), id: Identifier, request: WorkerRequestSchema }),
  Type.Object({
    type: Type.Literal('nativeResponse'),
    id: Identifier,
    ok: Type.Boolean(),
    value: Type.Unknown(),
    error: Type.String(),
  }),
  Type.Object({ type: Type.Literal('nativeData'), id: Identifier, data: Type.String() }),
]);
export const WorkerOutboundSchema = Type.Union([
  Type.Object({ type: Type.Literal('memoryChanged') }),
  Type.Object({
    type: Type.Literal('response'),
    id: Identifier,
    ok: Type.Boolean(),
    value: Type.Unknown(),
    error: Type.String(),
  }),
  Type.Object({ type: Type.Literal('native'), id: Identifier, request: NativeRequestSchema }),
  /**
   * Coalesced transcript changes of one task; the first publication after a session opens is a
   * snapshot. `sessionFile` is the Pi JSONL path once it exists so the task stays reopenable even
   * if the run never returns; empty until Pi has written it.
   */
  Type.Object({
    type: Type.Literal('transcript'),
    patch: TranscriptPatchSchema,
    sessionFile: Type.String(),
  }),
  Type.Object({ type: Type.Literal('queue'), taskId: Identifier, queue: QueueStateSchema }),
  /** An `ask_user` question blocked on the host; answered through the `answer` request. */
  Type.Object({ type: Type.Literal('question'), request: PermissionRequestSchema }),
  Type.Object({
    type: Type.Literal('notice'),
    taskId: Identifier,
    text: Type.String(),
    kind: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')]),
  }),
]);
export type WorkerOutbound = Static<typeof WorkerOutboundSchema>;
export const CapturedInputSchema = Type.Pick(InputSchema, ['text', 'capturedAt']);

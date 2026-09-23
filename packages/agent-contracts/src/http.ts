import { Type, type Static } from 'typebox';
import { Identifier, OperationId } from './identifiers.js';
import {
  CapabilityResultSchema,
  PermissionAnswerSchema,
  PermissionRequestSchema,
} from './confirms.js';
import { ThinkingLevelSchema } from './models.js';
import { ResourceRefSchema } from './resources.js';
import { QueueStateSchema, TaskSnapshotSchema } from './snapshot.js';
import { AgentTaskSchema, ModelSelectionSchema, TaskInputSchema } from './task.js';

/** Run acceptance; repeats with the same operationId return the original run. */
export const SubmitTaskRequestSchema = Type.Object(
  {
    operationId: OperationId,
    taskId: Type.Optional(Type.Union([Identifier, Type.Null()])),
    input: TaskInputSchema,
    model: Type.Optional(ModelSelectionSchema),
    /** Absent uses the connection's saved level, else off. */
    thinkingLevel: Type.Optional(ThinkingLevelSchema),
  },
  { additionalProperties: false },
);
export type SubmitTaskRequest = Static<typeof SubmitTaskRequestSchema>;

export const SubmitTaskResponseSchema = Type.Object(
  {
    taskId: Identifier,
    runId: Identifier,
    duplicate: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type SubmitTaskResponse = Static<typeof SubmitTaskResponseSchema>;

export const TaskResponseSchema = Type.Object(
  {
    task: AgentTaskSchema,
  },
  { additionalProperties: false },
);
export type TaskResponse = Static<typeof TaskResponseSchema>;

/**
 * Stop withdraws the messages still queued on the run: Pi's abort would otherwise deliver them
 * with a later prompt. `unsent` returns them so the client restores them to its draft.
 */
export const CancelRunResponseSchema = Type.Object(
  {
    task: AgentTaskSchema,
    unsent: QueueStateSchema,
  },
  { additionalProperties: false },
);
export type CancelRunResponse = Static<typeof CancelRunResponseSchema>;

/** Reply to a pending confirm; revision mismatch rejects the reply as stale. */
export const ConfirmReplyRequestSchema = Type.Object(
  {
    requestId: Identifier,
    revision: Type.Integer({ minimum: 1 }),
    answer: PermissionAnswerSchema,
  },
  { additionalProperties: false },
);
export type ConfirmReplyRequest = Static<typeof ConfirmReplyRequestSchema>;

export const ConfirmReplyResponseSchema = Type.Object(
  {
    request: PermissionRequestSchema,
    resolved: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ConfirmReplyResponse = Static<typeof ConfirmReplyResponseSchema>;

/** Desktop client delivery for a live capability request. */
export const CapabilityReplyRequestSchema = Type.Object(
  {
    result: CapabilityResultSchema,
  },
  { additionalProperties: false },
);
export type CapabilityReplyRequest = Static<typeof CapabilityReplyRequestSchema>;

/** Queue a mid-run message on the active run; rejects when no run is active. */
export const QueueMessageRequestSchema = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 100000 }),
    mode: Type.Union([Type.Literal('followUp'), Type.Literal('steer')]),
  },
  { additionalProperties: false },
);
export type QueueMessageRequest = Static<typeof QueueMessageRequestSchema>;

/** Resource upload metadata; bytes travel as the raw request body. */
export const ResourceUploadResponseSchema = Type.Object(
  {
    resource: ResourceRefSchema,
  },
  { additionalProperties: false },
);
export type ResourceUploadResponse = Static<typeof ResourceUploadResponseSchema>;

export const SnapshotResponseSchema = Type.Object(
  {
    snapshot: TaskSnapshotSchema,
  },
  { additionalProperties: false },
);
export type SnapshotResponse = Static<typeof SnapshotResponseSchema>;

/** Ledger record shape the service persists; T2 extends it with migration fields. */
export const LedgerDataSchema = Type.Object(
  {
    version: Type.Literal(1),
    tasks: Type.Array(AgentTaskSchema),
    /** operationId -> { taskId, runId }; the idempotency index. */
    operations: Type.Record(
      Type.String(),
      Type.Object({ taskId: Identifier, runId: Identifier }, { additionalProperties: false }),
    ),
    resources: Type.Array(ResourceRefSchema),
    /** Serialized pending confirms/capabilities; recovery revalidates them. */
    pendingConfirms: Type.Array(PermissionRequestSchema),
    pendingCapabilities: Type.Array(
      Type.Object(
        {
          id: Identifier,
          revision: Type.Integer({ minimum: 1 }),
          capability: Type.String({ maxLength: 64 }),
          input: Type.Unknown(),
          taskId: Identifier,
          runId: Identifier,
          executionId: Type.String({ maxLength: 256 }),
          operationId: Type.String({ maxLength: 128 }),
          expiresAt: Type.String(),
          createdAt: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type LedgerData = Static<typeof LedgerDataSchema>;

import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import { PermissionTierSchema } from './confirms.js';
import { ThinkingLevelSchema } from './models.js';
import { QueueStateSchema } from './snapshot.js';
import {
  ModelSelectionSchema,
  RunSnapshotSchema,
  ServiceToolIdSchema,
  TaskInputSchema,
} from './task.js';
import { CommandSkillRefSchema, ServiceCommandFullSchema } from './commands.js';

/**
 * T6b (service v1.2 candidate): live task management DTOs. PATCH/DELETE/
 * queue-replace mutate ledger state; preview is read-only (no ledger write,
 * no run) and shows the snapshot a submit with the same inputs would freeze.
 */

/** Rename and/or retier; at least one field is required (400 otherwise). */
export const PatchTaskRequestSchema = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    permissionTier: Type.Optional(PermissionTierSchema),
  },
  { additionalProperties: false },
);
export type PatchTaskRequest = Static<typeof PatchTaskRequestSchema>;

export const DeleteTaskResponseSchema = Type.Object(
  {
    deleted: Type.Literal(true),
    taskId: Identifier,
  },
  { additionalProperties: false },
);
export type DeleteTaskResponse = Static<typeof DeleteTaskResponseSchema>;

/** Replaces the pending follow-up list; steering messages are preserved. */
export const ReplaceQueueRequestSchema = Type.Object(
  {
    followUp: Type.Array(Type.String({ minLength: 1, maxLength: 100000 }), { maxItems: 50 }),
  },
  { additionalProperties: false },
);
export type ReplaceQueueRequest = Static<typeof ReplaceQueueRequestSchema>;

export const ReplaceQueueResponseSchema = Type.Object(
  {
    queue: QueueStateSchema,
  },
  { additionalProperties: false },
);
export type ReplaceQueueResponse = Static<typeof ReplaceQueueResponseSchema>;

/** Run policy for preview; every field is optional (absent means default). */
export const ServiceRunPolicySchema = Type.Object(
  {
    tools: Type.Optional(Type.Array(ServiceToolIdSchema, { uniqueItems: true })),
    memory: Type.Optional(Type.Boolean()),
    useDefaultModel: Type.Optional(Type.Boolean()),
    confirmExpansion: Type.Optional(Type.Boolean()),
    model: Type.Optional(ModelSelectionSchema),
    thinkingLevel: Type.Optional(ThinkingLevelSchema),
    skills: Type.Optional(Type.Array(CommandSkillRefSchema, { maxItems: 32 })),
    roleId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    mcpTools: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 64 }),
    ),
  },
  { additionalProperties: false },
);
export type ServiceRunPolicy = Static<typeof ServiceRunPolicySchema>;

/**
 * Preview inputs. The command travels inline (the selected definition) or by
 * id (looked up in the service command store); an inline command wins when
 * both are present.
 */
export const PreviewTaskRequestSchema = Type.Object(
  {
    policy: Type.Optional(Type.Union([ServiceRunPolicySchema, Type.Null()])),
    input: TaskInputSchema,
    command: Type.Optional(Type.Union([ServiceCommandFullSchema, Type.Null()])),
    commandId: Type.Optional(Type.Union([Identifier, Type.Null()])),
  },
  { additionalProperties: false },
);
export type PreviewTaskRequest = Static<typeof PreviewTaskRequestSchema>;

/** The snapshot a submit would freeze, plus non-fatal resolution warnings. */
export const PreviewTaskResponseSchema = Type.Object(
  {
    snapshot: RunSnapshotSchema,
    commandId: Type.Union([Identifier, Type.Null()]),
    warnings: Type.Array(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);
export type PreviewTaskResponse = Static<typeof PreviewTaskResponseSchema>;

/**
 * `POST /v1/tasks/:taskId/compact`: compacts the task's context now, optionally focused by
 * `instructions`. Refused with 409 while the task has an active run or when nothing can be
 * compacted; the envelope's `error.code` is a `CompactRefusal`.
 */
export const CompactTaskRequestSchema = Type.Object(
  { instructions: Type.Optional(Type.String({ maxLength: 2000 })) },
  { additionalProperties: false },
);
export type CompactTaskRequest = Static<typeof CompactTaskRequestSchema>;

/**
 * The compaction was accepted. Progress and outcome arrive as the task's `compaction` block and
 * `context.update` events.
 */
export const CompactTaskResponseSchema = Type.Object(
  { ok: Type.Literal(true) },
  { additionalProperties: false },
);
export type CompactTaskResponse = Static<typeof CompactTaskResponseSchema>;

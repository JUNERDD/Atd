import { Type, type Static } from 'typebox';
import { Identifier, OperationId } from './identifiers.js';
import { PermissionTierSchema } from './confirms.js';
import { ThinkingLevelSchema } from './models.js';

/** Tool ids the T1 runner proxies; dynamic MCP/Skill ids arrive in T3/T4. */
export const ServiceToolIdSchema = Type.Union([
  Type.Literal('read'),
  Type.Literal('write'),
  Type.Literal('edit'),
  Type.Literal('bash'),
  Type.Literal('command'),
  Type.Literal('ask_user'),
]);
export type ServiceToolId = Static<typeof ServiceToolIdSchema>;

export const FileRefSchema = Type.Object(
  {
    id: Identifier,
    name: Type.String({ maxLength: 255 }),
    size: Type.Integer({ minimum: 0 }),
    type: Type.String({ maxLength: 100 }),
  },
  { additionalProperties: false },
);
export type FileRef = Static<typeof FileRefSchema>;

export const TaskInputSchema = Type.Object(
  {
    text: Type.String({ maxLength: 100000 }),
    source: Type.Union([
      Type.Literal('manual'),
      Type.Literal('selection'),
      Type.Literal('clipboard'),
      Type.Literal('none'),
    ]),
    capturedAt: Type.String(),
    selection: Type.String({ maxLength: 100000 }),
    clipboard: Type.String({ maxLength: 100000 }),
    files: Type.Array(FileRefSchema, { maxItems: 10 }),
    arguments: Type.Record(
      Type.String(),
      Type.Union([Type.String({ maxLength: 10000 }), Type.Number(), Type.Boolean()]),
    ),
  },
  { additionalProperties: false },
);
export type TaskInput = Static<typeof TaskInputSchema>;

/**
 * Frozen model reference; temp-credential injection resolves auth at run time.
 * T2 additive growth: provider accepts any Pi provider id so migrated runs
 * keep their original provider (T1 wrote openai/openai-compatible only);
 * configurationId pins the connection revision the run was accepted with.
 */
export const ServiceModelSchema = Type.Object(
  {
    connectionId: Type.String({ maxLength: 4096 }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
    provider: Type.String({ minLength: 1, maxLength: 256 }),
    baseUrl: Type.String({ maxLength: 2048 }),
    configurationId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);
export type ServiceModel = Static<typeof ServiceModelSchema>;

export const ModelSelectionSchema = Type.Object(
  {
    connectionId: Type.String({ minLength: 1, maxLength: 4096 }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
export type ModelSelection = Static<typeof ModelSelectionSchema>;

/** Run lifecycle; `unknown` means the outcome could not be established. */
export const RunStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('awaiting_input'),
  Type.Literal('awaiting_confirmation'),
  Type.Literal('stopping'),
  Type.Literal('stopped'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('interrupted'),
  Type.Literal('unknown'),
]);
export type RunStatus = Static<typeof RunStatusSchema>;

/** Frozen at acceptance; later config edits never mutate an accepted snapshot. */
export const RunSnapshotSchema = Type.Object(
  {
    input: TaskInputSchema,
    instructions: Type.String({ maxLength: 20000 }),
    model: ServiceModelSchema,
    tools: Type.Array(ServiceToolIdSchema),
    memory: Type.Boolean(),
    /** T2 additive: migrated runs keep their accepted thinking level. */
    thinkingLevel: Type.Optional(ThinkingLevelSchema),
  },
  { additionalProperties: false },
);
export type RunSnapshot = Static<typeof RunSnapshotSchema>;

export const TaskRunSchema = Type.Object(
  {
    id: Identifier,
    operationId: OperationId,
    createdAt: Type.String(),
    status: RunStatusSchema,
    error: Type.String(),
    snapshot: RunSnapshotSchema,
  },
  { additionalProperties: false },
);
export type TaskRun = Static<typeof TaskRunSchema>;

export const AgentTaskSchema = Type.Object(
  {
    id: Identifier,
    title: Type.String(),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    sessionFile: Type.Union([Type.String(), Type.Null()]),
    runs: Type.Array(TaskRunSchema),
    /** T5 owns subagent linkage; T1 always records root tasks. */
    rootTaskId: Type.Union([Identifier, Type.Null()]),
    parentExecutionId: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
    /** Frozen from the service default when the task is created. */
    permissionTier: Type.Optional(PermissionTierSchema),
  },
  { additionalProperties: false },
);
export type AgentTask = Static<typeof AgentTaskSchema>;

/** Active statuses that block acceptance of a second run on the same task. */
export function isActiveStatus(status: RunStatus | undefined): boolean {
  return (
    status !== undefined &&
    ['queued', 'running', 'awaiting_input', 'awaiting_confirmation', 'stopping'].includes(status)
  );
}

/** Terminal statuses after which the ledger entry never changes again. */
export function isTerminalStatus(status: RunStatus | undefined): boolean {
  return (
    status !== undefined &&
    ['stopped', 'completed', 'failed', 'cancelled', 'interrupted', 'unknown'].includes(status)
  );
}

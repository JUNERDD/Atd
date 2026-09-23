import { Type, type Static } from 'typebox';
import { Identifier, OperationId } from './identifiers.js';
import { PermissionTierSchema } from './confirms.js';
import { ThinkingLevelSchema } from './models.js';
import { SkillName } from './skills.js';

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

/** Upper bound on the chip records one submitted message carries. */
export const MAX_INPUT_CHIPS = 64;

/**
 * Display record of one composer chip, kept with the submitted text so the transcript and the
 * title show the message the way it was composed. Each kind holds only what the chip shows and
 * identifies; what the run does with it still comes from staging (skills, references) and `files`.
 */
export const InputChipSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal('file'), fileId: Identifier, name: Type.String({ maxLength: 255 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('task'), taskId: Identifier, title: Type.String({ maxLength: 1024 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('mcpServer'), serverId: Identifier },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('agent'), name: Identifier }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('skill'), name: SkillName }, { additionalProperties: false }),
]);
export type InputChip = Static<typeof InputChipSchema>;

/**
 * A chip and the `[from, to)` UTF-16 range of its serialized token in `TaskInput.text`. The
 * schema bounds the numbers only; acceptance checks that ranges lie inside the text, ascending and
 * without overlap.
 */
export const InputChipRangeSchema = Type.Object(
  {
    from: Type.Integer({ minimum: 0, maximum: 100000 }),
    to: Type.Integer({ minimum: 0, maximum: 100000 }),
    chip: InputChipSchema,
  },
  { additionalProperties: false },
);
export type InputChipRange = Static<typeof InputChipRangeSchema>;

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
    /**
     * Composer chips in `text`, in document order. The desktop always sends the array, empty for
     * plain text, so an absent field marks input from before chips were recorded (or from another
     * client): the transcript then reads a leading `/skill:<name> ` as the skill chip it was.
     */
    chips: Type.Optional(Type.Array(InputChipRangeSchema, { maxItems: MAX_INPUT_CHIPS })),
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

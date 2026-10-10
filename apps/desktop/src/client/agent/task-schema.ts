import { Type, type Static } from 'typebox';
import {
  InputChipRangeSchema,
  MAX_FOLDERS,
  MAX_INPUT_CHIPS,
  TaskOriginSchema,
} from '@atd/agent-contracts';
import { ArgumentValuesSchema, CommandSchema, Identifier, ToolIdSchema } from './command-schema';
import {
  FrozenModelSchema,
  ModelThinkingLevelSchema,
  type ModelThinkingLevel,
} from '../providers/schema';
import {
  DEFAULT_PERMISSION_TIER,
  PermissionTierSchema,
  type PermissionTier,
} from './permission-schema';

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
export const InputSchema = Type.Object(
  {
    text: Type.String({ maxLength: 100000 }),
    source: Type.Union([
      Type.Literal('manual'),
      Type.Literal('selection'),
      Type.Literal('clipboard'),
      Type.Literal('screenshot'),
      Type.Literal('none'),
    ]),
    capturedAt: Type.String(),
    selection: Type.String({ maxLength: 100000 }),
    clipboard: Type.String({ maxLength: 100000 }),
    files: Type.Array(FileRefSchema, { maxItems: 10 }),
    arguments: ArgumentValuesSchema,
    /** The service's chip records (`TaskInput.chips`), passed through unchanged. */
    chips: Type.Optional(Type.Array(InputChipRangeSchema, { maxItems: MAX_INPUT_CHIPS })),
    /**
     * Ids of the shell-registered folders the message grants its task (`TaskInput.folders`).
     * Submit always sends the array; input stored before folders has none.
     */
    folders: Type.Optional(Type.Array(Identifier, { maxItems: MAX_FOLDERS })),
  },
  { additionalProperties: false },
);
export type TaskInput = Static<typeof InputSchema>;

// v1 history keeps its original model snapshot; new submissions freeze the full model definition.
// T6 pure client: service models may use any Pi provider id (T2 additive); the
// narrowed openai-only shape stays for history, new runs use the open shape.
export const ResolvedModelSchema = Type.Union([
  FrozenModelSchema,
  Type.Object(
    {
      connectionId: Type.String({ maxLength: 4096 }),
      modelId: Type.String({ maxLength: 256 }),
      provider: Type.String({ minLength: 1, maxLength: 256 }),
      baseUrl: Type.String({ maxLength: 2048 }),
    },
    { additionalProperties: false },
  ),
]);
export type ResolvedModel = Static<typeof ResolvedModelSchema>;
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
  // T6: service `unknown` (outcome could not be established after a crash).
  Type.Literal('unknown'),
]);
export type RunStatus = Static<typeof RunStatusSchema>;

export const RunSnapshotSchema = Type.Object(
  {
    command: Type.Union([CommandSchema, Type.Null()]),
    definition: Type.Union([Type.Literal('current'), Type.Literal('saved')]),
    input: InputSchema,
    instructions: Type.String(),
    model: ResolvedModelSchema,
    /** Frozen at acceptance; runs saved before thinking levels existed ran with reasoning off. */
    thinkingLevel: Type.Optional(ModelThinkingLevelSchema),
    tools: Type.Array(ToolIdSchema),
    memory: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type RunSnapshot = Static<typeof RunSnapshotSchema>;
export const RunSchema = Type.Object(
  {
    id: Identifier,
    invocationId: Identifier,
    createdAt: Type.String(),
    status: RunStatusSchema,
    error: Type.String(),
    snapshot: RunSnapshotSchema,
  },
  { additionalProperties: false },
);
export type TaskRun = Static<typeof RunSchema>;
export const TaskSchema = Type.Object(
  {
    id: Identifier,
    title: Type.String(),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    sessionFile: Type.Union([Type.String(), Type.Null()]),
    runs: Type.Array(RunSchema),
    legacy: Type.Union([
      Type.Object({ prompt: Type.String(), attachments: Type.Array(FileRefSchema) }),
      Type.Null(),
    ]),
    /** Frozen from the Settings default when the task is created; tasks saved before tiers existed prompt for everything. */
    permissionTier: Type.Optional(PermissionTierSchema),
    /** Set when a user app's backend started the task; absent for the user's own tasks. */
    origin: Type.Optional(TaskOriginSchema),
    /**
     * The conversation this task is a side chat of (a command launched from inside it ran here);
     * absent for every other task. The conversation may have been deleted since.
     */
    sideChatOf: Type.Optional(Identifier),
  },
  { additionalProperties: false },
);
export type AgentTask = Static<typeof TaskSchema>;

const ArtifactLocationSchema = Type.Object(
  {
    name: Type.String(),
    path: Type.String(),
    size: Type.Number(),
    fingerprint: Type.String(),
  },
  { additionalProperties: false },
);

export const ArtifactSchema = Type.Object(
  {
    id: Identifier,
    taskId: Identifier,
    runId: Identifier,
    name: Type.String(),
    path: Type.String(),
    size: Type.Number(),
    fingerprint: Type.String(),
    relocation: Type.Union([ArtifactLocationSchema, Type.Null()]),
    partial: Type.Boolean(),
    status: Type.Union([
      Type.Literal('available'),
      Type.Literal('missing'),
      Type.Literal('changed'),
    ]),
  },
  { additionalProperties: false },
);
export type Artifact = Static<typeof ArtifactSchema>;

/** Relinking keeps the produced file's original identity intact. */
export function artifactLocation(file: Artifact) {
  return file.relocation ?? file;
}
/** The thinking level this run was accepted with; runs saved before the control existed used 'off'. */
export function runThinkingLevel(snapshot: RunSnapshot): ModelThinkingLevel {
  return snapshot.thinkingLevel ?? 'off';
}
/** The tier guarding this task's tool calls; tasks created before tiers existed take the default. */
export function taskPermissionTier(task: AgentTask): PermissionTier {
  return task.permissionTier ?? DEFAULT_PERMISSION_TIER;
}
export function isActive(status: RunStatus | undefined): boolean {
  return (
    status !== undefined &&
    ['queued', 'running', 'awaiting_input', 'awaiting_confirmation', 'stopping'].includes(status)
  );
}
export function emptyInput(): TaskInput {
  return {
    text: '',
    source: 'manual',
    capturedAt: '',
    selection: '',
    clipboard: '',
    files: [],
    arguments: {},
  };
}

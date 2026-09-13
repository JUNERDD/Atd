import { Type, type Static } from 'typebox';
import { ArgumentValuesSchema, CommandSchema, Identifier, ToolIdSchema } from './command-schema';
import { FrozenModelSchema } from '../providers/schema';

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
      Type.Literal('none'),
    ]),
    capturedAt: Type.String(),
    selection: Type.String({ maxLength: 100000 }),
    clipboard: Type.String({ maxLength: 100000 }),
    files: Type.Array(FileRefSchema, { maxItems: 10 }),
    arguments: ArgumentValuesSchema,
  },
  { additionalProperties: false },
);
export type TaskInput = Static<typeof InputSchema>;

// v1 history keeps its original model snapshot; new submissions freeze the full model definition.
export const ResolvedModelSchema = Type.Union([
  FrozenModelSchema,
  Type.Object(
    {
      connectionId: Type.String({ maxLength: 4096 }),
      modelId: Type.String({ maxLength: 256 }),
      provider: Type.Union([Type.Literal('openai'), Type.Literal('openai-compatible')]),
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
]);
export type RunStatus = Static<typeof RunStatusSchema>;

export const RunSnapshotSchema = Type.Object(
  {
    command: Type.Union([CommandSchema, Type.Null()]),
    definition: Type.Union([Type.Literal('current'), Type.Literal('saved')]),
    input: InputSchema,
    instructions: Type.String(),
    model: ResolvedModelSchema,
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
  },
  { additionalProperties: false },
);
export type AgentTask = Static<typeof TaskSchema>;

export const PermissionSchema = Type.Object(
  {
    id: Identifier,
    taskId: Identifier,
    runId: Identifier,
    kind: Type.Union([Type.Literal('confirmation'), Type.Literal('input')]),
    title: Type.String(),
    detail: Type.String(),
    options: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
export type PermissionRequest = Static<typeof PermissionSchema>;

export const MessagePartSchema = Type.Union([
  Type.Object({ type: Type.Literal('text'), text: Type.String() }),
  Type.Object({
    type: Type.Literal('tool'),
    id: Type.String(),
    name: Type.String(),
    input: Type.String(),
    output: Type.String(),
    status: Type.Union([
      Type.Literal('running'),
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('interrupted'),
    ]),
  }),
]);
export type MessagePart = Static<typeof MessagePartSchema>;
export const MessageSchema = Type.Object({
  id: Type.String(),
  role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
  parts: Type.Array(MessagePartSchema),
  timestamp: Type.Number(),
});
export type TaskMessage = Static<typeof MessageSchema>;

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

export function activeRun(task: AgentTask): TaskRun | undefined {
  return task.runs.at(-1);
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
    capturedAt: new Date().toISOString(),
    selection: '',
    clipboard: '',
    files: [],
    arguments: {},
  };
}

import { Type, type Static } from 'typebox';
import { SubmitTaskResponseSchema, type SubmitTaskResponse } from './http.js';
import { Identifier, OperationId } from './identifiers.js';
import { ThinkingLevelSchema } from './models.js';
import { SkillName } from './skills.js';
import { ModelSelectionSchema, ServiceToolIdSchema, TaskInputSchema } from './task.js';

/**
 * T6b (service v1.2 candidate): live command management DTOs. The persisted
 * shape extends the stored ServiceCommand core (id/revision/name/
 * description/instructions/enabled/tools/memory) with the desktop editor
 * fields below so T6 resume can round-trip full command definitions.
 * Objects intentionally allow additional properties: known fields are
 * validated, unknown future fields pass through untouched (mirroring the
 * `additionalProperties: true` ServiceCommand store shape).
 */

export const CommandToolSchema = Type.Union([
  Type.Literal('read'),
  Type.Literal('write'),
  Type.Literal('edit'),
  Type.Literal('bash'),
  Type.Literal('command'),
]);
export type CommandTool = Static<typeof CommandToolSchema>;

const ParameterBase = {
  key: Type.String({ pattern: '^[a-zA-Z][a-zA-Z0-9_]*$', maxLength: 64 }),
  label: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.String({ maxLength: 500 }),
  required: Type.Boolean(),
};

export const CommandParameterSchema = Type.Union([
  Type.Object(
    {
      ...ParameterBase,
      type: Type.Literal('text'),
      multiline: Type.Boolean(),
      default: Type.Optional(Type.String({ maxLength: 10000 })),
      maxLength: Type.Integer({ minimum: 1, maximum: 10000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ParameterBase,
      type: Type.Literal('number'),
      default: Type.Optional(Type.Number()),
      min: Type.Optional(Type.Number()),
      max: Type.Optional(Type.Number()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ParameterBase,
      type: Type.Literal('boolean'),
      default: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ParameterBase,
      type: Type.Literal('enum'),
      default: Type.Optional(Type.String({ maxLength: 256 })),
      options: Type.Array(
        Type.Object(
          {
            value: Type.String({ maxLength: 256 }),
            label: Type.String({ maxLength: 256 }),
          },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: 50 },
      ),
    },
    { additionalProperties: false },
  ),
]);
export type CommandParameter = Static<typeof CommandParameterSchema>;

export const CommandInputSchema = Type.Object(
  {
    source: Type.Union([
      Type.Literal('manual'),
      Type.Literal('selection'),
      Type.Literal('clipboard'),
      Type.Literal('screenshot'),
      Type.Literal('none'),
    ]),
    required: Type.Boolean(),
    files: Type.Boolean(),
    selection: Type.Boolean(),
    clipboard: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type CommandInput = Static<typeof CommandInputSchema>;

/**
 * Where a command is offered beyond the command list, its shortcut and the launcher. Each place
 * hands the command text that stands in for the selection it reads: the text selected in another
 * app (`selectionToolbar`), the text selected in a conversation's answers (`turnSelection`), or a
 * settled turn's answer (`turnActions`). Clients offer a command only where it is placed and only
 * while it reads the selection (`offeredAt`).
 */
export const CommandPlacementSchema = Type.Object(
  {
    /** The selection toolbar over text selected in other apps. */
    selectionToolbar: Type.Boolean(),
    /** The toolbar over text selected in a conversation's answers. */
    turnSelection: Type.Boolean(),
    /** A settled turn's actions, which run the command on the turn's answer. */
    turnActions: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type CommandPlacement = Static<typeof CommandPlacementSchema>;
export type CommandPlace = keyof CommandPlacement;

/**
 * The placement of a command that never chose one (stored before placements existed, or created
 * without one): a command that takes the selection as its input shows on the selection toolbar
 * over other apps, as every such command did before, and in no conversation until it is put there.
 */
export function defaultCommandPlacement(source: CommandInput['source']): CommandPlacement {
  return { selectionToolbar: source === 'selection', turnSelection: false, turnActions: false };
}

/** Whether a command reads the selection: as its input, or through the `{{selection}}` variable. */
export function readsSelection(input: CommandInput): boolean {
  return input.source === 'selection' || input.selection;
}

/** Whether a client offers `command` at `place`: it is enabled, placed there and reads the selection. */
export function offeredAt(
  command: { enabled: boolean; input: CommandInput; placement: CommandPlacement },
  place: CommandPlace,
): boolean {
  return command.enabled && command.placement[place] && readsSelection(command.input);
}

export const CommandModelSchema = Type.Union([
  Type.Object({ mode: Type.Literal('inherit') }, { additionalProperties: false }),
  Type.Object(
    {
      mode: Type.Literal('fixed'),
      connectionId: Type.String({ maxLength: 4096 }),
      modelId: Type.String({ minLength: 1, maxLength: 256 }),
      thinkingLevel: Type.Optional(ThinkingLevelSchema),
    },
    { additionalProperties: false },
  ),
]);
export type CommandModel = Static<typeof CommandModelSchema>;

export const CommandSkillRefSchema = Type.Object(
  {
    name: SkillName,
    revision: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);
export type CommandSkillRef = Static<typeof CommandSkillRefSchema>;

/**
 * Full round-trippable command: core identity plus editor fields. Skills, subagents, MCP servers
 * and conversations are written into `instructions` as tokens (`instruction-tokens.ts`), so the
 * command carries no separate skill or role selection.
 */
export const ServiceCommandFullSchema = Type.Object({
  id: Identifier,
  revision: Type.Integer({ minimum: 1 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.String({ maxLength: 500 }),
  instructions: Type.String({ minLength: 1, maxLength: 20000 }),
  enabled: Type.Boolean(),
  shortcut: Type.String({ maxLength: 100 }),
  templateId: Type.Union([Identifier, Type.Null()]),
  input: CommandInputSchema,
  placement: CommandPlacementSchema,
  parameters: Type.Array(CommandParameterSchema, { maxItems: 20 }),
  model: CommandModelSchema,
  tools: Type.Array(CommandToolSchema, { uniqueItems: true }),
  memory: Type.Union([Type.Literal('inherit'), Type.Literal('off')]),
  migratedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  /**
   * The plugin that contributes this command, computed by the service and never persisted. Absent
   * for the user's own commands (the Personal plugin); present commands are read-only except for
   * `enabled`, and their `name` is qualified (`<plugin>:<item>`).
   */
  pluginId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});
export type ServiceCommandFull = Static<typeof ServiceCommandFullSchema>;

/** Create draft: full shape without identity; the service assigns both. */
export const CommandCreateSchema = Type.Object({
  id: Type.Optional(Identifier),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  instructions: Type.String({ minLength: 1, maxLength: 20000 }),
  enabled: Type.Optional(Type.Boolean()),
  shortcut: Type.Optional(Type.String({ maxLength: 100 })),
  templateId: Type.Optional(Type.Union([Identifier, Type.Null()])),
  input: Type.Optional(CommandInputSchema),
  /** Omitted: `defaultCommandPlacement` of the input source. */
  placement: Type.Optional(CommandPlacementSchema),
  parameters: Type.Optional(Type.Array(CommandParameterSchema, { maxItems: 20 })),
  model: Type.Optional(CommandModelSchema),
  tools: Type.Optional(Type.Array(CommandToolSchema, { uniqueItems: true })),
  memory: Type.Optional(Type.Union([Type.Literal('inherit'), Type.Literal('off')])),
});
export type CommandCreate = Static<typeof CommandCreateSchema>;

/** Full-replace update guarded by the expected live revision (409 on drift). */
export const CommandUpdateRequestSchema = Type.Object({
  command: ServiceCommandFullSchema,
  expectedRevision: Type.Integer({ minimum: 1 }),
});
export type CommandUpdateRequest = Static<typeof CommandUpdateRequestSchema>;

export const CommandsListResponseSchema = Type.Object(
  {
    commands: Type.Array(ServiceCommandFullSchema),
  },
  { additionalProperties: false },
);
export type CommandsListResponse = Static<typeof CommandsListResponseSchema>;

export const CommandGetResponseSchema = Type.Object(
  {
    command: ServiceCommandFullSchema,
  },
  { additionalProperties: false },
);
export type CommandGetResponse = Static<typeof CommandGetResponseSchema>;

export const CommandDeleteResponseSchema = Type.Object(
  {
    deleted: Type.Literal(true),
    id: Identifier,
  },
  { additionalProperties: false },
);
export type CommandDeleteResponse = Static<typeof CommandDeleteResponseSchema>;

/**
 * Run-time picks over a command's saved settings, as the panel's pickers set them; each absent
 * field keeps the command's own. A picked model wins over the command's fixed model
 * (`runModelSelection`).
 */
export const CommandRunPolicySchema = Type.Object(
  {
    model: Type.Optional(ModelSelectionSchema),
    thinkingLevel: Type.Optional(ThinkingLevelSchema),
    tools: Type.Optional(Type.Array(ServiceToolIdSchema, { uniqueItems: true })),
    memory: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type CommandRunPolicy = Static<typeof CommandRunPolicySchema>;

/**
 * `POST /v1/commands/:id/run`: launches a saved command, the user's own or a plugin's, as one run.
 * Every launcher takes this path: the service renders the template with `input`, stages the
 * skills and references the template names, shows its tokens as the run's chips (the input's own
 * chips are replaced), freezes the text as command material and titles a new task after the
 * command. 404 for an unknown command, 409 for a disabled one or a busy task, 400 for input the
 * template cannot run with.
 */
export const CommandRunRequestSchema = Type.Object(
  {
    /** Repeats with the same id answer the original run (`duplicate: true`). */
    operationId: OperationId,
    /** The task to run in; absent starts a new task. */
    taskId: Type.Optional(Identifier),
    /** What the template reads: the `{{input}}` text, argument values, files and captures. */
    input: TaskInputSchema,
    policy: Type.Optional(CommandRunPolicySchema),
    /** Starts the new task as a side chat of this conversation (`SubmitTaskRequest.sideChatOf`). */
    sideChatOf: Type.Optional(Identifier),
  },
  { additionalProperties: false },
);
export type CommandRunRequest = Static<typeof CommandRunRequestSchema>;

/** A command run is accepted like a task submit. */
export const CommandRunResponseSchema = SubmitTaskResponseSchema;
export type CommandRunResponse = SubmitTaskResponse;

/**
 * Stored command core in `commands.json`. `migratedAt` stays so files written
 * by the 0.2.x desktop import still load; new commands record it as null.
 */
export const ServiceCommandSchema = Type.Object(
  {
    id: Identifier,
    revision: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ maxLength: 500 }),
    instructions: Type.String({ minLength: 1, maxLength: 20000 }),
    enabled: Type.Boolean(),
    tools: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 20 }),
    memory: Type.Union([Type.Literal('inherit'), Type.Literal('off')]),
    migratedAt: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: true },
);
export type ServiceCommand = Static<typeof ServiceCommandSchema>;

export const ServiceCommandsFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    commands: Type.Array(ServiceCommandSchema, { maxItems: 500 }),
  },
  { additionalProperties: false },
);
export type ServiceCommandsFile = Static<typeof ServiceCommandsFileSchema>;

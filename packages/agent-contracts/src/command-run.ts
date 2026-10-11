import { Type, type Static } from 'typebox';
import { CommandOutputSchema } from './command-output.js';
import { SubmitTaskResponseSchema, type SubmitTaskResponse } from './http.js';
import { Identifier, OperationId } from './identifiers.js';
import { ThinkingLevelSchema } from './models.js';
import { ModelSelectionSchema, ServiceToolIdSchema, TaskInputSchema } from './task.js';

/**
 * How a saved command runs: the model and reasoning level it asks for, the run-time picks that
 * override them, and the launch request itself.
 */

/** The model a command runs with: the run's own selection (`inherit`), or one fixed model. */
export const CommandModelSchema = Type.Union([
  Type.Object({ mode: Type.Literal('inherit') }, { additionalProperties: false }),
  Type.Object(
    {
      mode: Type.Literal('fixed'),
      connectionId: Type.String({ maxLength: 4096 }),
      modelId: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  ),
]);
export type CommandModel = Static<typeof CommandModelSchema>;

/**
 * The reasoning level a command asks for, whichever model runs it: `inherit` asks for none, so the
 * connection's default level applies. A run-time pick wins over it (`commandThinkingLevel`), and
 * the run clamps it to what the model supports.
 */
export const CommandThinkingLevelSchema = Type.Union([
  Type.Literal('inherit'),
  ThinkingLevelSchema,
]);
export type CommandThinkingLevel = Static<typeof CommandThinkingLevelSchema>;

/**
 * Run-time picks over a command's saved settings, as the panel's pickers set them; each absent
 * field keeps the command's own. A picked model wins over the command's fixed model
 * (`runModelSelection`), and a picked level over the command's level (`commandThinkingLevel`).
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
    /**
     * Where this run's answer goes, picked for this launch over the command's saved output; never
     * remembered. It decides what the run's hidden instructions tell the model (`outputInstruction`).
     */
    output: Type.Optional(CommandOutputSchema),
    /** Starts the new task as a side chat of this conversation (`SubmitTaskRequest.sideChatOf`). */
    sideChatOf: Type.Optional(Identifier),
  },
  { additionalProperties: false },
);
export type CommandRunRequest = Static<typeof CommandRunRequestSchema>;

/** A command run is accepted like a task submit. */
export const CommandRunResponseSchema = SubmitTaskResponseSchema;
export type CommandRunResponse = SubmitTaskResponse;

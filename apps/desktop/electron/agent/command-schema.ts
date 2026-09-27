import { Type, type Static } from 'typebox';
import { ModelThinkingLevelSchema } from '../providers/schema';

export const Identifier = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-zA-Z0-9_-]+$',
});
export const ShortText = Type.String({ maxLength: 256 });
export const ToolIdSchema = Type.Union([
  Type.Literal('read'),
  Type.Literal('write'),
  Type.Literal('edit'),
  Type.Literal('bash'),
  Type.Literal('command'),
]);
export type ToolId = Static<typeof ToolIdSchema>;

const parameterBase = {
  key: Type.String({ pattern: '^[a-zA-Z][a-zA-Z0-9_]*$', maxLength: 64 }),
  label: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.String({ maxLength: 500 }),
  required: Type.Boolean(),
};
export const ParameterSchema = Type.Union([
  Type.Object(
    {
      ...parameterBase,
      type: Type.Literal('text'),
      multiline: Type.Boolean(),
      default: Type.Optional(Type.String({ maxLength: 10000 })),
      maxLength: Type.Integer({ minimum: 1, maximum: 10000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...parameterBase,
      type: Type.Literal('number'),
      default: Type.Optional(Type.Number()),
      min: Type.Optional(Type.Number()),
      max: Type.Optional(Type.Number()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...parameterBase,
      type: Type.Literal('boolean'),
      default: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...parameterBase,
      type: Type.Literal('enum'),
      default: Type.Optional(ShortText),
      options: Type.Array(
        Type.Object(
          { value: ShortText, label: ShortText },
          {
            additionalProperties: false,
          },
        ),
        { minItems: 1, maxItems: 50 },
      ),
    },
    { additionalProperties: false },
  ),
]);
export type Parameter = Static<typeof ParameterSchema>;
export const ArgumentValuesSchema = Type.Record(
  Type.String(),
  Type.Union([Type.String({ maxLength: 10000 }), Type.Number(), Type.Boolean()]),
);
export type ArgumentValues = Static<typeof ArgumentValuesSchema>;

export const ModelPolicySchema = Type.Union([
  Type.Object({ mode: Type.Literal('inherit') }, { additionalProperties: false }),
  Type.Object(
    {
      mode: Type.Literal('fixed'),
      connectionId: Type.String({ maxLength: 4096 }),
      modelId: Type.String({ minLength: 1, maxLength: 256 }),
      /** Level this command pins; omitted commands use the connection's saved level. */
      thinkingLevel: Type.Optional(ModelThinkingLevelSchema),
    },
    { additionalProperties: false },
  ),
]);
/**
 * A saved command. Skills, subagents, MCP servers and conversations are tokens in `instructions`
 * (`instruction-tokens.ts` in `@ai/agent-contracts`), so there is no separate skill or role field.
 */
export const CommandSchema = Type.Object(
  {
    id: Identifier,
    revision: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ maxLength: 500 }),
    instructions: Type.String({ minLength: 1, maxLength: 20000 }),
    enabled: Type.Boolean(),
    shortcut: Type.String({ maxLength: 100 }),
    templateId: Type.Union([Identifier, Type.Null()]),
    input: Type.Object(
      {
        source: Type.Union([
          Type.Literal('manual'),
          Type.Literal('selection'),
          Type.Literal('clipboard'),
          Type.Literal('none'),
        ]),
        required: Type.Boolean(),
        files: Type.Boolean(),
        selection: Type.Boolean(),
        clipboard: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    parameters: Type.Array(ParameterSchema, { maxItems: 20 }),
    model: ModelPolicySchema,
    tools: Type.Array(ToolIdSchema, { uniqueItems: true }),
    memory: Type.Union([Type.Literal('inherit'), Type.Literal('off')]),
  },
  { additionalProperties: false },
);
export type CommandDefinition = Static<typeof CommandSchema>;

/** The fields the command tool may author; identity, state and model stay with the stored command. */
export const CommandFieldsSchema = Type.Object(
  {
    name: CommandSchema.properties.name,
    description: CommandSchema.properties.description,
    instructions: CommandSchema.properties.instructions,
    input: CommandSchema.properties.input,
    parameters: Type.Array(ParameterSchema, { maxItems: 20 }),
    tools: Type.Array(ToolIdSchema, { uniqueItems: true }),
    memory: CommandSchema.properties.memory,
  },
  { additionalProperties: false },
);
export type CommandFields = Static<typeof CommandFieldsSchema>;

export const CommandToolSchema = Type.Union([
  Type.Object({ operation: Type.Literal('list') }, { additionalProperties: false }),
  Type.Object(
    { operation: Type.Literal('get'), commandId: Identifier },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      operation: Type.Literal('save'),
      commandId: Type.Union([Identifier, Type.Null()]),
      expectedRevision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      fields: CommandFieldsSchema,
    },
    { additionalProperties: false },
  ),
]);
export type CommandToolArguments = Static<typeof CommandToolSchema>;

/**
 * Parameters exposed to the model. Providers require the root schema of a function
 * to be an object, so the discriminated union above cannot be sent as-is; the worker
 * validates the returned arguments against CommandToolSchema.
 */
export const CommandToolParametersSchema = Type.Object(
  {
    operation: Type.Union([Type.Literal('list'), Type.Literal('get'), Type.Literal('save')]),
    commandId: Type.Optional(Type.Union([Identifier, Type.Null()])),
    expectedRevision: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
    fields: Type.Optional(CommandFieldsSchema),
  },
  { additionalProperties: false },
);

/** Command tool replies; the worker parses the native response with these schemas. */
export const CommandSummarySchema = Type.Object(
  {
    id: Identifier,
    revision: Type.Integer({ minimum: 1 }),
    name: CommandSchema.properties.name,
    description: CommandSchema.properties.description,
  },
  { additionalProperties: false },
);
export const CommandSaveResultSchema = Type.Object(
  {
    id: Identifier,
    revision: Type.Integer({ minimum: 1 }),
    name: CommandSchema.properties.name,
  },
  { additionalProperties: false },
);

/** The native registry is the source of available tools; definitions store explicit IDs. */
export const TOOL_DESCRIPTIONS = [
  { id: 'read', label: 'Read files', description: 'Read selected files and approved resources.' },
  {
    id: 'write',
    label: 'Create files',
    description: 'Confirm each file before creating or replacing it.',
  },
  {
    id: 'edit',
    label: 'Edit files',
    description: 'Confirm the exact file and changes before writing.',
  },
  { id: 'bash', label: 'Terminal', description: 'Confirm each command and its working directory.' },
  {
    id: 'command',
    label: 'Manage commands',
    description: 'Create or update saved commands, with your confirmation.',
  },
] satisfies { id: ToolId; label: string; description: string }[];

import { Type, type Static } from 'typebox';

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
    },
    { additionalProperties: false },
  ),
]);
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
] satisfies { id: ToolId; label: string; description: string }[];

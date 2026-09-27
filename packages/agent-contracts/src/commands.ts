import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import { ThinkingLevelSchema } from './models.js';

/**
 * T6b (service v1.2 candidate): live command management DTOs. The persisted
 * shape extends the migrated ServiceCommand core (id/revision/name/
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
    name: Type.String({ minLength: 1, maxLength: 128 }),
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
  parameters: Type.Array(CommandParameterSchema, { maxItems: 20 }),
  model: CommandModelSchema,
  tools: Type.Array(CommandToolSchema, { uniqueItems: true }),
  memory: Type.Union([Type.Literal('inherit'), Type.Literal('off')]),
  migratedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
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

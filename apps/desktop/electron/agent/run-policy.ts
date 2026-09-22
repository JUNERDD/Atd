import { Type, type Static } from 'typebox';
import { ToolIdSchema } from './command-schema';
import { ModelReferenceSchema, ModelThinkingLevelSchema } from '../providers/schema';

export const RunPolicySchema = Type.Object(
  {
    tools: Type.Array(ToolIdSchema, { uniqueItems: true }),
    memory: Type.Boolean(),
    useDefaultModel: Type.Boolean(),
    confirmExpansion: Type.Boolean(),
    model: Type.Optional(ModelReferenceSchema),
    /** Thinking level for this run; omitted runs use the connection's saved level. */
    thinkingLevel: Type.Optional(ModelThinkingLevelSchema),
    /** T6 additive: skill refs saved on the task, frozen at accept via staging. */
    skills: Type.Optional(
      Type.Array(
        Type.Object(
          {
            name: Type.String({ minLength: 1, maxLength: 128 }),
            revision: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
          },
          { additionalProperties: false },
        ),
        { maxItems: 32 },
      ),
    ),
    /** T6 additive: role id saved on the task, frozen at accept via staging. */
    roleId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    /** T6 additive: MCP tool refs (connectionId+toolName) for display; service freezes all. */
    mcpTools: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 64 }),
    ),
  },
  { additionalProperties: false },
);
export type RunPolicy = Static<typeof RunPolicySchema>;

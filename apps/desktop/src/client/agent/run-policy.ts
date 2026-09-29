import { Type, type Static } from 'typebox';
import { MAX_RUN_REFERENCES, MAX_RUN_SKILLS, RunReferenceSchema } from '@ai/agent-contracts';
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
            // Qualified plugin skill names (`<plugin>:<item>`) run up to 193 characters.
            name: Type.String({ minLength: 1, maxLength: 193 }),
            revision: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
          },
          { additionalProperties: false },
        ),
        { maxItems: MAX_RUN_SKILLS },
      ),
    ),
    /** T6 additive: role id saved on the task, frozen at accept via staging. */
    roleId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    /**
     * T6 additive: MCP tool refs (connectionId+toolName) staged for the next run. The service
     * binds exactly the staged set, so a staged list is a strict allowlist; without staging,
     * every MCP tool stays available.
     */
    mcpTools: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 64 }),
    ),
    /**
     * Composer `@` references (conversation, subagent, MCP server) staged for the next run, where
     * the service resolves them into run material. They suggest and allow; they never narrow the
     * tool set.
     */
    references: Type.Optional(Type.Array(RunReferenceSchema, { maxItems: MAX_RUN_REFERENCES })),
  },
  { additionalProperties: false },
);
export type RunPolicy = Static<typeof RunPolicySchema>;

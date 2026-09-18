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
  },
  { additionalProperties: false },
);
export type RunPolicy = Static<typeof RunPolicySchema>;

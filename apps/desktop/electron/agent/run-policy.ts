import { Type, type Static } from 'typebox';
import { ToolIdSchema } from './command-schema';

export const RunPolicySchema = Type.Object(
  {
    tools: Type.Array(ToolIdSchema, { uniqueItems: true }),
    memory: Type.Boolean(),
    useDefaultModel: Type.Boolean(),
    confirmExpansion: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type RunPolicy = Static<typeof RunPolicySchema>;

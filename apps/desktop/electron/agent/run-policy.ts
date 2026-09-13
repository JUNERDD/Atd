import { Type, type Static } from 'typebox';
import { ToolIdSchema } from './command-schema';
import { ModelReferenceSchema } from '../providers/schema';

export const RunPolicySchema = Type.Object(
  {
    tools: Type.Array(ToolIdSchema, { uniqueItems: true }),
    memory: Type.Boolean(),
    useDefaultModel: Type.Boolean(),
    confirmExpansion: Type.Boolean(),
    model: Type.Optional(ModelReferenceSchema),
  },
  { additionalProperties: false },
);
export type RunPolicy = Static<typeof RunPolicySchema>;

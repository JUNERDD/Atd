import { Type, type Static } from 'typebox';

/** The development-only, one-way import; provider storage and credentials are never involved. */
export const DevelopmentSyncResponseSchema = Type.Object(
  {
    settings: Type.Boolean(),
    commands: Type.Integer({ minimum: 0 }),
    skills: Type.Integer({ minimum: 0 }),
    agents: Type.Integer({ minimum: 0 }),
    backupDir: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type DevelopmentSyncResponse = Static<typeof DevelopmentSyncResponseSchema>;

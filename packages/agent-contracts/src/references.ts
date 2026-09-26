import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/** Upper bound on references staged for one run; the composer dedupes before staging. */
export const MAX_RUN_REFERENCES = 16;

/**
 * A reference picked in the composer's `@` panel. `SubmitTaskRequest` carries only what
 * acceptance freezes, so references stage per task like skill and MCP selection and freeze
 * once at run acceptance, where the service resolves them into run material and capabilities:
 * `task` injects a bounded excerpt of that conversation, `mcpServer` suggests that
 * server's tools without narrowing the tool set, and `agent` registers and allows that
 * `~/.atd/agents` subagent for the run with a delegation hint.
 */
export const RunReferenceSchema = Type.Union([
  Type.Object({ kind: Type.Literal('task'), taskId: Identifier }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('agent'), name: Identifier }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal('mcpServer'), serverId: Identifier },
    { additionalProperties: false },
  ),
]);
export type RunReference = Static<typeof RunReferenceSchema>;

/** `POST /v1/references/stage`: replaces the task's staged references for its next run. */
export const StageReferencesRequestSchema = Type.Object(
  {
    taskId: Identifier,
    references: Type.Array(RunReferenceSchema, { maxItems: MAX_RUN_REFERENCES }),
  },
  { additionalProperties: false },
);
export type StageReferencesRequest = Static<typeof StageReferencesRequestSchema>;

export const StageReferencesResponseSchema = Type.Object(
  {
    taskId: Identifier,
    references: Type.Array(RunReferenceSchema, { maxItems: MAX_RUN_REFERENCES }),
    stagedAt: Type.String(),
  },
  { additionalProperties: false },
);
export type StageReferencesResponse = Static<typeof StageReferencesResponseSchema>;

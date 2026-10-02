import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import { McpServerIdSchema } from './mcp.js';
import { MemoryTargetSchema } from './memory.js';
import { SubagentNameSchema } from './subagents.js';

/** Upper bound on references staged for one run; the composer dedupes before staging. */
export const MAX_RUN_REFERENCES = 16;

/**
 * A reference picked in the composer's `@` panel. `SubmitTaskRequest` carries only what
 * acceptance freezes, so references stage per task like skill and MCP selection and freeze
 * once at run acceptance, where the service resolves them into run material and capabilities:
 * `task` injects a bounded excerpt of that conversation, `mcpServer` suggests that
 * server's tools without narrowing the tool set, and `agent` registers and allows that
 * `~/.atd/agents` subagent for the run with a delegation hint, `command` gives the run that saved
 * command's definition, and `memory` gives it that memory entry's content. Agents and MCP servers
 * an installed plugin contributes are named `<plugin>:<item>`; a command is named by its id, and a
 * memory entry by its content-derived id with its target, so an edited entry no longer resolves.
 */
export const RunReferenceSchema = Type.Union([
  Type.Object({ kind: Type.Literal('task'), taskId: Identifier }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal('agent'), name: SubagentNameSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('mcpServer'), serverId: McpServerIdSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('command'), commandId: Identifier },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('memory'), target: MemoryTargetSchema, entryId: Identifier },
    { additionalProperties: false },
  ),
]);
export type RunReference = Static<typeof RunReferenceSchema>;

/** Identity of a referenced item; one staging, and one run, holds each item once. */
export function runReferenceKey(reference: RunReference): string {
  switch (reference.kind) {
    case 'task':
      return `task:${reference.taskId}`;
    case 'agent':
      return `agent:${reference.name}`;
    case 'mcpServer':
      return `mcpServer:${reference.serverId}`;
    case 'command':
      return `command:${reference.commandId}`;
    case 'memory':
      return `memory:${reference.target}:${reference.entryId}`;
  }
}

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

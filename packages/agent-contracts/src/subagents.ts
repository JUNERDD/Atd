import { QualifiedNameSchema } from '@atd/plugin-kit/model';
import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import { ThinkingLevelSchema } from './models.js';
import { SUBAGENT_TOOLS, SubagentToolSchema } from './subagent-permissions.js';

/**
 * T5 subagents v1: execution identity, the parent-child link and child states. Call shapes
 * (`{ agent, task }`, `tasks`, `chain`) are pi-subagents' own; the service tool contract
 * (agent-service `subagents/tool-contract.ts`) declares the ones a parent may use.
 */

/**
 * A catalog subagent a run can reference by name: a user agent (`~/.atd/agents`, Settings) keeps
 * the identifier alphabet, an agent an installed plugin contributes is `<plugin>:<agent>`
 * (plugin-kit's qualified name). Task agents (`task.<name>`) live in their task and are never
 * referenced.
 */
export const SubagentNameSchema = Type.Union([Identifier, QualifiedNameSchema]);

/** Child execution identity: `child:<parentRunId>:<index>`. */
export function childExecutionId(parentRunId: string, index: number): string {
  return `child:${parentRunId}:${index}`;
}

/** True for T5 child ids; T1 roots stay `root:<runId>`. */
export function isChildExecutionId(executionId: string): boolean {
  return executionId.startsWith('child:');
}

/** Parses `child:<runId>:<n>`; null for roots and malformed ids. */
export function parseChildExecutionId(executionId: string): {
  parentRunId: string;
  index: number;
} | null {
  const match = /^child:([a-zA-Z0-9_-]+):(\d+)$/.exec(executionId);
  if (!match?.[1] || match[2] === undefined) return null;
  return { parentRunId: match[1], index: Number(match[2]) };
}

/** Parent session custom entry type that links a `subagent` call to each child it launched. */
export const SUBAGENT_CHILD_ENTRY = 'app-child';

/**
 * The only link between a parent `subagent` tool call and a child session. The service writes one
 * per child launch into the parent session: `toolCallId` is the admitting call, `seq` the launch
 * order within it, `sessionFile` the child's JSONL (resolved and contained server side only).
 */
export const SubagentChildEntrySchema = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    seq: Type.Integer({ minimum: 0 }),
    executionId: Type.String({ maxLength: 256 }),
    agent: Type.String({ maxLength: 128 }),
    sessionFile: Type.String({ minLength: 1, maxLength: 4096 }),
    /** ISO timestamp of the launch. */
    startedAt: Type.String({ maxLength: 64 }),
  },
  { additionalProperties: false },
);
export type SubagentChildEntry = Static<typeof SubagentChildEntrySchema>;

/**
 * Task agents: subagents a parent defines for its task with `subagent { action: "define" }`
 * (agent-service `subagents/task-agents.ts`). One narrows the run's child tools, keeps the task's
 * approvals and model, and lives in the parent session (`app-agent`), never in the agent catalog.
 * A name is defined once per task: the same definition again is a no-op, a different one is refused.
 */
export const TASK_AGENT_PREFIX = 'task.';
/** The name a define call gives, before the prefix. */
export const TASK_AGENT_NAME_PATTERN = '^[a-z0-9][a-z0-9-]{0,39}$';
export const TASK_AGENT_DESCRIPTION_MAX_LENGTH = 300;
export const TASK_AGENT_INSTRUCTIONS_MAX_LENGTH = 8000;
/** Most definitions one define call carries. */
export const TASK_AGENTS_PER_DEFINE = 4;
/** Most task agents one task holds. */
export const TASK_AGENTS_PER_TASK = 16;

/** The runtime name of the task agent a define call names `name`. */
export function taskAgentName(name: string): string {
  return `${TASK_AGENT_PREFIX}${name}`;
}

/** True for a task agent's runtime name. */
export function isTaskAgent(agent: string): boolean {
  return agent.startsWith(TASK_AGENT_PREFIX);
}

/** One task agent as the service accepted it: what the defining call recorded and the UI shows. */
export const TaskAgentDefinitionSchema = Type.Object(
  {
    /** The runtime name, `task.<name>`. */
    agent: Type.String({ minLength: TASK_AGENT_PREFIX.length + 1, maxLength: 45 }),
    /** When to use it; shown in `list` and on its cards. */
    description: Type.String({ minLength: 1, maxLength: TASK_AGENT_DESCRIPTION_MAX_LENGTH }),
    /** The parent's role text: scope, standards, output format and acceptance criteria. */
    instructions: Type.String({ minLength: 1, maxLength: TASK_AGENT_INSTRUCTIONS_MAX_LENGTH }),
    /** The tools it runs with, within the run's child tools; empty for none. */
    tools: Type.Array(SubagentToolSchema, { maxItems: SUBAGENT_TOOLS.length }),
    /** Its thinking level, at most the defining run's. */
    thinking: ThinkingLevelSchema,
  },
  { additionalProperties: false },
);
export type TaskAgentDefinition = Static<typeof TaskAgentDefinitionSchema>;

/** Parent session custom entry type that records one task agent definition. */
export const SUBAGENT_AGENT_ENTRY = 'app-agent';

/**
 * The `app-agent` entry: a task agent's definition and the define call that recorded it. The
 * service replays them when it reopens the task's session, and the transcript shows them on that
 * call's row.
 */
export const SubagentAgentEntrySchema = Type.Object(
  {
    ...TaskAgentDefinitionSchema.properties,
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    /** ISO timestamp of the definition. */
    definedAt: Type.String({ maxLength: 64 }),
  },
  { additionalProperties: false },
);
export type SubagentAgentEntry = Static<typeof SubagentAgentEntrySchema>;

/** Child transcript key `<toolCallId>:<seq>`; URL-encode it in paths. */
export function subagentChildKey(toolCallId: string, seq: number): string {
  return `${toolCallId}:${seq}`;
}

/** Child terminal states surfaced through parent run events. */
export const SubagentStatusSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('interrupted'),
]);
export type SubagentStatus = Static<typeof SubagentStatusSchema>;

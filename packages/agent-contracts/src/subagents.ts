import { QualifiedNameSchema } from '@atd/plugin-kit/model';
import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/**
 * T5 subagents v1: execution identity, the parent-child link and child states. Call shapes
 * (`{ agent, task }`, `tasks`, `chain`) are pi-subagents' own; the service tool contract
 * (agent-service `subagents/tool-contract.ts`) declares the ones a parent may use.
 */

/** Managed runtime agents; service user profile owns them. */
export const SUBAGENT_RUNTIME_AGENTS = [
  'service.worker',
  'service.reviewer',
  'service.scout',
] as const;
export type SubagentRuntimeAgent = (typeof SUBAGENT_RUNTIME_AGENTS)[number];

/**
 * A catalog subagent a run can reference by name: a user agent (`~/.atd/agents`, Settings) keeps
 * the identifier alphabet, an agent an installed plugin contributes is `<plugin>:<agent>`
 * (plugin-kit's qualified name). System agents (`service.worker`) are named outside both and are
 * never referenced.
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

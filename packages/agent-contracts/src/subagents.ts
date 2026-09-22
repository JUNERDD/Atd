import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/**
 * T5 subagents v1 (UNFROZEN proposal, root freezes as subagents v1).
 * Additive-only: execution identity, named-workflow args, results and limits.
 * Frozen task/ledger/auth DTOs are untouched; T6 consumes events/refs.
 */

/** First-round limits: 2 parents, 3 foreground children, 1 workflow. */
export const SUBAGENT_LIMITS = {
  maxActiveParents: 2,
  maxForegroundChildren: 3,
  maxWorkflowsPerParent: 1,
  /** Upper bound sessions: 2 parents + 6 children (not a model quota). */
  maxSessions: 8,
  /** Named workflow args cap; large materials travel as resource refs. */
  namedArgsLimit: 16384,
} as const;

/** Managed runtime agents; service user profile owns them. */
export const SUBAGENT_RUNTIME_AGENTS = [
  'service.worker',
  'service.reviewer',
  'service.scout',
] as const;
export type SubagentRuntimeAgent = (typeof SUBAGENT_RUNTIME_AGENTS)[number];

/** Named workflow resources; raw scripts stay forbidden. */
export const SUBAGENT_WORKFLOWS = ['service.parallel', 'service.chain'] as const;
export type SubagentWorkflowName = (typeof SUBAGENT_WORKFLOWS)[number];

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

/** One validated child task inside a named workflow. */
export const WorkflowTaskSchema = Type.Object(
  {
    agent: Type.String({ minLength: 1, maxLength: 128 }),
    task: Type.String({ minLength: 1, maxLength: 8000 }),
    label: Type.Optional(Type.String({ maxLength: 256 })),
    resources: Type.Optional(Type.Array(Identifier, { maxItems: 8 })),
  },
  { additionalProperties: false },
);
export type WorkflowTask = Static<typeof WorkflowTaskSchema>;

/** Parallel fanout args: 1-3 independent tasks, one `runs.all` batch. */
export const ParallelWorkflowArgsSchema = Type.Object(
  {
    tasks: Type.Array(WorkflowTaskSchema, { minItems: 1, maxItems: 3 }),
  },
  { additionalProperties: false },
);
export type ParallelWorkflowArgs = Static<typeof ParallelWorkflowArgsSchema>;

/** Serial chain args: 1-4 steps, sequential `runs.run` with handoff. */
export const ChainWorkflowArgsSchema = Type.Object(
  {
    steps: Type.Array(WorkflowTaskSchema, { minItems: 1, maxItems: 4 }),
  },
  { additionalProperties: false },
);
export type ChainWorkflowArgs = Static<typeof ChainWorkflowArgsSchema>;

/** Native single delegation: one bounded foreground child. */
export const SingleDelegationSchema = Type.Object(
  {
    agent: Type.String({ minLength: 1, maxLength: 128 }),
    task: Type.String({ minLength: 1, maxLength: 8000 }),
    resources: Type.Optional(Type.Array(Identifier, { maxItems: 8 })),
  },
  { additionalProperties: false },
);
export type SingleDelegation = Static<typeof SingleDelegationSchema>;

/** Explicit child result landed for the parent model and UI. */
export const SubagentResultSchema = Type.Object(
  {
    executionId: Type.String({ maxLength: 256 }),
    agent: Type.String({ maxLength: 128 }),
    ok: Type.Boolean(),
    output: Type.String({ maxLength: 100000 }),
    runId: Type.Union([Identifier, Type.Null()]),
    sessionFile: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
    error: Type.String({ maxLength: 4000 }),
  },
  { additionalProperties: false },
);
export type SubagentResult = Static<typeof SubagentResultSchema>;

/** Child terminal states surfaced through parent run events. */
export const SubagentStatusSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('interrupted'),
]);
export type SubagentStatus = Static<typeof SubagentStatusSchema>;

/** Encoded size of named args; the 16 KiB cap counts this form. */
export function encodedArgsSize(args: unknown): number {
  return new TextEncoder().encode(JSON.stringify(args ?? {})).length;
}

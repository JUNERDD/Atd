import {
  isTaskAgent,
  TASK_AGENT_PREFIX,
  type SubagentDefineDetails,
  type TaskAgentDefinition,
} from '@atd/agent-contracts';
import type { Block, BlockOf } from '../../../client/agent/transcript-schema';

/**
 * Task agents: the subagents a parent defined for its task with `subagent { action: "define" }`.
 * The parent transcript is their only source: each define row carries the definitions it recorded
 * (`SubagentDefineDetails`), and a task defines a runtime name (`task.<name>`) once, so the name
 * finds one definition. Children that ran one carry only its runtime name.
 */

/** A transcript's task agents by runtime name. */
export type TaskAgentIndex = ReadonlyMap<string, TaskAgentDefinition>;

export const EMPTY_TASK_AGENTS: TaskAgentIndex = new Map();

/** The name a subagent goes by: a task agent's without its `task.` prefix, others' as they are. */
export function agentDisplayName(agent: string): string {
  return isTaskAgent(agent) ? agent.slice(TASK_AGENT_PREFIX.length) : agent;
}

/** The definitions a define row recorded; null for every other row and a define without them. */
export function subagentDefineOf(block: BlockOf<'tool'>): SubagentDefineDetails | null {
  const data = block.details.data;
  return block.name === 'subagent' && data?.type === 'subagentDefine' ? data : null;
}

/**
 * The definitions of every define row, by runtime name. A task records a name once; a name in two
 * rows means the earlier definition was rewound away, so the latest row wins.
 */
export function indexTaskAgents(blocks: readonly Block[]): TaskAgentIndex {
  const agents = new Map<string, TaskAgentDefinition>();
  for (const block of blocks) {
    if (block.kind !== 'tool') continue;
    for (const definition of subagentDefineOf(block)?.agents ?? [])
      agents.set(definition.agent, definition);
  }
  return agents;
}

function sameDefinition(a: TaskAgentDefinition, b: TaskAgentDefinition): boolean {
  return (
    a.description === b.description &&
    a.instructions === b.instructions &&
    a.thinking === b.thinking &&
    a.tools.length === b.tools.length &&
    a.tools.every((tool, index) => tool === b.tools[index])
  );
}

/**
 * Whether two indexes hold the same definitions. Every patch re-indexes the task's blocks, and an
 * equal index keeps the context value (and every reader of it) unchanged.
 */
export function sameTaskAgents(a: TaskAgentIndex, b: TaskAgentIndex): boolean {
  if (a.size !== b.size) return false;
  for (const [agent, definition] of a) {
    const other = b.get(agent);
    if (!other || (other !== definition && !sameDefinition(definition, other))) return false;
  }
  return true;
}

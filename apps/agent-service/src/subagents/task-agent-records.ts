import {
  SUBAGENT_AGENT_ENTRY,
  SubagentAgentEntrySchema,
  TASK_AGENTS_PER_TASK,
  type SubagentAgentEntry,
  type TaskAgentDefinition,
} from '@atd/agent-contracts';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { Compile } from 'typebox/compile';
import { isTaskAgentName } from './task-agent-definition.js';

/**
 * The `app-agent` records of a parent session branch: one entry per task agent definition a
 * define call accepted, in the order the parent defined them. The branch is the task's state:
 * a rewind past a define call leaves its records off the branch, and the agent with them.
 */

const AgentEntry = Compile(SubagentAgentEntrySchema);

/** The longest agent name an audit line repeats from an entry that failed validation. */
const AUDIT_NAME_MAX_LENGTH = 64;

/** The task agents a branch records, and the entries it holds that define none. */
export interface RecordedAgents {
  /**
   * By runtime name in branch order: each name's first record, at most `TASK_AGENTS_PER_TASK`.
   * Only a malformed history holds a later one; a define call writes no other.
   */
  definitions: Map<string, TaskAgentDefinition>;
  /** The entries left out and why; replay audits them. */
  ignored: { agent: string | null; reason: string }[];
}

function entryAgent(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('agent' in data)) return null;
  const { agent } = data;
  return typeof agent === 'string' ? agent.slice(0, AUDIT_NAME_MAX_LENGTH) : null;
}

/** The task agents `branch` records (`SessionManager.getBranch()`). */
export function recordedAgents(branch: readonly SessionEntry[]): RecordedAgents {
  const definitions = new Map<string, TaskAgentDefinition>();
  const ignored: RecordedAgents['ignored'] = [];
  for (const entry of branch) {
    if (entry.type !== 'custom' || entry.customType !== SUBAGENT_AGENT_ENTRY) continue;
    if (!AgentEntry.Check(entry.data)) {
      ignored.push({ agent: entryAgent(entry.data), reason: 'the record is malformed' });
      continue;
    }
    const { toolCallId: _call, definedAt: _at, ...definition } = entry.data;
    const reason = !isTaskAgentName(definition.agent)
      ? 'the record names no task agent'
      : definitions.has(definition.agent)
        ? 'an earlier record defines this name'
        : definitions.size >= TASK_AGENTS_PER_TASK
          ? `the task already holds ${TASK_AGENTS_PER_TASK} task agents`
          : null;
    if (reason) ignored.push({ agent: definition.agent, reason });
    else definitions.set(definition.agent, definition);
  }
  return { definitions, ignored };
}

/** The `app-agent` entry recording `definition` for the define call `toolCallId`. */
export function agentEntry(
  definition: TaskAgentDefinition,
  toolCallId: string,
  definedAt: string,
): SubagentAgentEntry {
  const entry: SubagentAgentEntry = { ...definition, toolCallId, definedAt };
  // The desktop and the next replay drop an entry that fails the contract.
  if (!AgentEntry.Check(entry)) throw new Error(`The record of ${definition.agent} is invalid.`);
  return entry;
}

/** Appends accepted definitions' entries to the parent session. */
export function appendAgentEntries(
  sessions: { appendCustomEntry(customType: string, data?: unknown): string },
  entries: readonly SubagentAgentEntry[],
): void {
  for (const entry of entries) sessions.appendCustomEntry(SUBAGENT_AGENT_ENTRY, entry);
}
